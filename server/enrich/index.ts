/**
 * Room crawler: fills the directory with each venue's individual escape rooms by reading the
 * venue's own website (site.ts) and listing its rooms with Claude (extract.ts), saved by store.ts.
 *
 * - Runs inside the server (the build container can't reach venue sites; Railway can).
 * - Admins start a run with POST /api/admin/enrich { limit, budgetUsd, country? } and watch it with
 *   GET /api/admin/enrich. One run at a time; a run stops before it could pass its budget.
 * - On deploy, a one-off sample run reads a few venues (ENRICH_SAMPLE_VENUES, default 40) under a
 *   small budget (ENRICH_SAMPLE_BUDGET_USD, default 3) once the directory is loaded. ENRICH_SAMPLE=off
 *   turns it off. Never under NODE_ENV=test, never without ANTHROPIC_API_KEY.
 * - ENRICH_MODEL picks the model (default: ANTHROPIC_MODEL, else the extraction default).
 */
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { ROUTES } from '../../src/contracts/routes'
import type { EnrichRun, EnrichStatus } from '../../src/contracts/models'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { makeId } from '../../src/contracts/types'
import { defineRoute, HttpError } from '../http'
import { anthropicEnrichClient, costUsd, enrichModel, type EnrichClient } from './extract'
import { readVenueSite, type FetchLike, type LookupLike } from './site'
import { ensureEnrichTables, markVenue, saveRooms, venuesToRead } from './store'

type Rows<T> = { rows?: T[] } | T[]
const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as Rows<T> & { rows?: T[] }).rows ?? []))

/** What one venue can cost at most (a long site, a long answer), kept back from the budget. */
export function perVenueCeilingUsd(model: string): number {
  return costUsd({ model, inputTokens: 14_000, outputTokens: 4_000 })
}

export interface RunOptions {
  limit: number
  budgetUsd: number
  country?: string
  venueIds?: string[]
  kind?: 'admin' | 'sample'
  concurrency?: number
  client: EnrichClient
  model: string
  fetchFn?: FetchLike
  lookupFn?: LookupLike
  log?: (msg: string) => void
}

const LEASE_MINUTES = 15

/** Claims the single run slot. Returns the run id, or null when a live run holds it. */
async function claimRun(db: Db, kind: string, limit: number, budgetUsd: number): Promise<string | null> {
  await ensureEnrichTables(db)
  await db.execute(sql`update enrich_runs set status = 'abandoned', finished_at = now() where status = 'running' and lease_until < now()`)
  const id = makeId('enr')
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into enrich_runs (id, kind, status, venue_limit, budget_usd, lease_until)
      select ${id}, ${kind}, 'running', ${limit}, ${budgetUsd}, now() + make_interval(mins => ${LEASE_MINUTES})
      where not exists (select 1 from enrich_runs where status = 'running')
      returning id`),
  )
  return rows[0]?.id ?? null
}

/** Reads venues until the limit, the budget, or the venues run out. */
export async function runEnrichment(db: Db, runId: string, o: RunOptions): Promise<EnrichRun> {
  const ceiling = perVenueCeilingUsd(o.model)
  const queue = await venuesToRead(db, { limit: o.limit, country: o.country, venueIds: o.venueIds })
  let spent = 0
  let reserved = 0
  let tried = 0
  let withRooms = 0
  let added = 0
  let stopNote: string | null = queue.length ? null : 'No venues left to read.'

  const worker = async () => {
    for (;;) {
      if (spent + reserved + ceiling > o.budgetUsd) {
        stopNote ??= 'Stopped at the budget.'
        return
      }
      const venue = queue.shift()
      if (!venue) return
      reserved += ceiling
      let cost = 0
      try {
        const site = await readVenueSite(venue.website, o.fetchFn, o.lookupFn)
        if (!site.pages.length) {
          await markVenue(db, venue.id, site.reason ?? 'unreachable', 0, 0, null)
          continue
        }
        const { facts, usage } = await o.client.extract(venue, site.pages)
        cost = costUsd(usage)
        if (!facts) {
          await markVenue(db, venue.id, 'unreadable', 0, cost, null)
        } else if (!facts.isEscapeRoomVenue || !facts.rooms.length) {
          await markVenue(db, venue.id, facts.isEscapeRoomVenue ? 'no_rooms' : 'not_escape_room', 0, cost, null)
        } else {
          const n = await saveRooms(db, venue, facts, site.pages.map((p) => p.url))
          added += n
          if (facts.rooms.length) withRooms++
          await markVenue(db, venue.id, 'ok', facts.rooms.length, cost, null)
          o.log?.(`[enrich] ${venue.name} (${venue.city}): ${facts.rooms.length} rooms, ${n} new`)
        }
      } catch (err) {
        await markVenue(db, venue.id, 'error', 0, cost, (err instanceof Error ? err.message : String(err)).slice(0, 300)).catch(() => undefined)
      } finally {
        reserved -= ceiling
        spent += cost
        tried++
        await db
          .execute(sql`update enrich_runs set spent_usd = ${spent}, venues = ${tried}, venues_with_rooms = ${withRooms}, rooms_added = ${added}, lease_until = now() + make_interval(mins => ${LEASE_MINUTES}) where id = ${runId}`)
          .catch(() => undefined)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 3) }, worker))
    stopNote ??= tried >= o.limit ? 'Reached the venue limit.' : 'No venues left to read.'
    await db.execute(sql`update enrich_runs set status = 'done', note = ${stopNote}, finished_at = now(), lease_until = null, spent_usd = ${spent}, venues = ${tried}, venues_with_rooms = ${withRooms}, rooms_added = ${added} where id = ${runId}`)
  } catch (err) {
    await db
      .execute(sql`update enrich_runs set status = 'failed', note = ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}, finished_at = now(), lease_until = null where id = ${runId}`)
      .catch(() => undefined)
    throw err
  }
  o.log?.(`[enrich] run ${runId}: ${tried} venues read, ${withRooms} with rooms, ${added} new rooms, $${spent.toFixed(2)}`)
  return (await recentRuns(db, 1))[0]
}

type RunRow = {
  id: string; kind: string; status: string; venue_limit: number; budget_usd: number; spent_usd: number; venues: number
  venues_with_rooms: number; rooms_added: number; note: string | null; started_at: string | Date; finished_at: string | Date | null
}

const iso = (d: string | Date | null) => (d == null ? null : new Date(d).toISOString())

async function recentRuns(db: Db, n: number): Promise<EnrichRun[]> {
  await ensureEnrichTables(db)
  return rowsOf<RunRow>(await db.execute(sql`select * from enrich_runs order by started_at desc limit ${n}`)).map((r) => ({
    id: r.id,
    kind: r.kind === 'sample' ? 'sample' : 'admin',
    status: r.status as EnrichRun['status'],
    limit: Number(r.venue_limit),
    budgetUsd: Number(r.budget_usd),
    spentUsd: Math.round(Number(r.spent_usd) * 100) / 100,
    venues: Number(r.venues),
    venuesWithRooms: Number(r.venues_with_rooms),
    roomsAdded: Number(r.rooms_added),
    note: r.note,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
  }))
}

export async function enrichStatus(db: Db, model: string): Promise<EnrichStatus> {
  const runs = await recentRuns(db, 10)
  const t = rowsOf<{ tried: number; with_rooms: number; spent: number }>(
    await db.execute(sql`select count(*)::int as tried, count(*) filter (where status = 'ok')::int as with_rooms, coalesce(sum(cost_usd), 0)::float as spent from venue_enrichment`),
  )[0]
  const left = rowsOf<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n from venues v
      where v.status = 'active' and v.fsq_id is not null and coalesce(v.website, '') <> ''
        and not exists (select 1 from venue_enrichment e where e.venue_id = v.id)
        and not exists (select 1 from games g where g.venue_id = v.id)`),
  )[0]
  const games = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from games where status <> 'hidden'`))[0]
  const tried = Number(t?.tried ?? 0)
  const spent = Number(t?.spent ?? 0)
  const venuesLeft = Number(left?.n ?? 0)
  return {
    model,
    running: runs.find((r) => r.status === 'running') ?? null,
    runs,
    venuesTried: tried,
    venuesWithRooms: Number(t?.with_rooms ?? 0),
    venuesLeft,
    rooms: Number(games?.n ?? 0),
    spentUsd: Math.round(spent * 100) / 100,
    // From what runs so far actually cost per venue; the ceiling until there is data.
    estimatedUsdForRest: Math.round(venuesLeft * (tried >= 10 ? spent / tried : perVenueCeilingUsd(model) / 2) * 100) / 100,
  }
}

export function enrichEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim()) && env.NODE_ENV !== 'test'
}

/** Starts a run in the background. Throws 409 when one is already running. */
export async function startRun(ctx: AppContext, db: Db, opts: Omit<RunOptions, 'client' | 'model'> & { client?: EnrichClient; model?: string }): Promise<string> {
  const model = opts.model ?? enrichModel(ctx.env)
  const client = opts.client ?? anthropicEnrichClient(ctx.env)
  const id = await claimRun(db, opts.kind ?? 'admin', opts.limit, opts.budgetUsd)
  if (!id) throw new HttpError('conflict', 'A crawl is already running.')
  void runEnrichment(db, id, { ...opts, client, model, log: opts.log ?? ((m) => console.log(m)) }).catch((err) =>
    console.error(`[enrich] run ${id} failed: ${err instanceof Error ? err.message : String(err)}`),
  )
  return id
}

/** One-off sample run after deploy, once the directory has imported venues. */
export function startSampleEnrichment(ctx: AppContext, opts: { pollMs?: number } = {}): () => void {
  const env = ctx.env
  const off = ['off', '0', 'false'].includes((env.ENRICH_SAMPLE ?? '').trim().toLowerCase())
  if (off || !enrichEnabled(env)) return () => undefined
  const limit = Math.max(1, Math.min(500, Number(env.ENRICH_SAMPLE_VENUES) || 40))
  const budgetUsd = Math.max(0.5, Math.min(10, Number(env.ENRICH_SAMPLE_BUDGET_USD) || 3))
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(tick, ms)
    timer.unref?.()
  }
  const tick = async () => {
    if (stopped) return
    const db = ctx.dbState.status === 'ready' ? ctx.dbState.handle?.db : undefined
    if (!db) return schedule(opts.pollMs ?? 5000)
    try {
      await ensureEnrichTables(db)
      const done = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from enrich_runs where kind = 'sample'`))[0]
      if (Number(done?.n ?? 0) > 0) return
      const ready = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from venues where fsq_id is not null and coalesce(website, '') <> ''`))[0]
      if (Number(ready?.n ?? 0) < 100) return schedule(60_000)
      const id = await startRun(ctx, db, { kind: 'sample', limit, budgetUsd })
      console.log(`[enrich] Sample run ${id} started: up to ${limit} venues, budget $${budgetUsd}.`)
    } catch (err) {
      if (err instanceof HttpError) return
      console.error(`[enrich] Sample run not started: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  schedule(opts.pollMs ?? 30_000)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

export async function enrichRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.adminEnrichStatus, async () => enrichStatus(ctx.db(), enrichModel(ctx.env)))
  defineRoute(app, ctx, ROUTES.adminEnrichStart, async ({ body }) => {
    if (!enrichEnabled(ctx.env)) throw new HttpError('conflict', 'The crawler needs ANTHROPIC_API_KEY and is off in tests.')
    const db = ctx.db()
    const id = await startRun(ctx, db, { kind: 'admin', limit: body.limit, budgetUsd: body.budgetUsd, country: body.country })
    return { id }
  })
  const stop = startSampleEnrichment(ctx)
  app.addHook('onClose', async () => stop())
}
