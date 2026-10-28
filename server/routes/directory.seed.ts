/**
 * The committed directory seed (workstreams 5, 6, 8): reads seed/directory/*.json.gz (written by
 * scripts/import/foursquare via scripts/import/dedupe) and loads it into Postgres.
 *
 * On deploy the server loads it in the background once the database is ready, when the directory
 * holds no imported venues yet or the seed version changed. It never blocks start-up or /health.
 * - Idempotent: venues upsert on `fsq_id`, sources on (entity, source, source id), cities on slug.
 * - Venues a user has corrected (a `user` row in `sources`) keep their corrected fields.
 * - URLs stay stable: an existing venue keeps its slug; a seed slug already taken by another venue
 *   gets the Foursquare id's last 6 characters appended.
 * - One loader at a time across instances: a lease row in `directory_seed_state` (created here,
 *   outside Drizzle's migrations, because it is bookkeeping for this loader only).
 * - Batches of 500 rows, each its own statement, so PGlite (one connection) keeps serving requests.
 *
 * Env: DIRECTORY_SEED=off disables the automatic load (default on, except under NODE_ENV=test).
 * DIRECTORY_SEED_DIR overrides the folder.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { cities, sources, venues } from '../db/schema'

export const SEED_FORMAT = 1
export const DEFAULT_DIRECTORY_SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'directory')
const BATCH = 500
const LEASE_MINUTES = 10
const STATE_ID = 'directory'

export interface SeedCity {
  slug: string
  name: string
  region: string
  country: string
  lat: number | null
  lng: number | null
}

export interface SeedSource {
  /** Foursquare fsq_place_id. */
  id: string
  fields: Record<string, unknown>
}

export interface SeedVenue {
  slug: string
  name: string
  brand: string | null
  address: string
  city: string
  citySlug: string
  region: string
  country: string
  postalCode: string | null
  lat: number | null
  lng: number | null
  website: string | null
  phone: string | null
  /** Primary Foursquare id (the venue's `fsq_id`). */
  fsqId: string
  /** Every merged Foursquare record, primary first. */
  src: SeedSource[]
}

export interface SeedRegionFile {
  format: number
  region: { id: string; name: string; country: string; bbox?: [number, number, number, number] }
  source: 'foursquare'
  license: string
  attribution: string
  generatedAt: string
  cities: SeedCity[]
  venues: SeedVenue[]
}

export interface SeedManifestRegion {
  id: string
  name: string
  country: string
  file: string
  sha: string
  venues: number
  cities: number
  /** Raw escape-room records read for the region, and how many merged into another. */
  read: number
  merged: number
  bytes: number
}

export interface SeedManifest {
  format: number
  /** Changes whenever any region file changes. */
  version: string
  generatedAt: string
  source: 'foursquare'
  license: string
  attribution: string
  release: string
  regions: SeedManifestRegion[]
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type CompactSeed = Omit<SeedRegionFile, 'cities' | 'venues'> & {
  cities: unknown[][]
  venueKeys: string[]
  sourceKeys: string[]
  venues: unknown[][]
}

/** Parses one gzipped region file (the compact layout written by scripts/import/dedupe). */
export function decodeSeed(buf: Buffer): SeedRegionFile {
  const c = JSON.parse(gunzipSync(buf).toString('utf8')) as CompactSeed
  if (c.format !== SEED_FORMAT) throw new Error(`unsupported directory seed format ${c.format}`)
  const vk = c.venueKeys
  const sk = c.sourceKeys
  return {
    format: c.format,
    region: c.region,
    source: c.source,
    license: c.license,
    attribution: c.attribution,
    generatedAt: c.generatedAt,
    cities: c.cities.map(([slug, name, region, country, lat, lng]) => ({
      slug: String(slug), name: String(name), region: String(region ?? ''), country: String(country), lat: (lat as number | null) ?? null, lng: (lng as number | null) ?? null,
    })),
    venues: c.venues.map((row) => {
      const v = Object.fromEntries(vk.map((k, i) => [k, row[i]])) as unknown as Omit<SeedVenue, 'src'>
      const srcRows = (row[vk.length] as unknown[][]) ?? []
      const src: SeedSource[] = srcRows.map((s) => {
        if (s.length === 2) {
          // The primary: its fields are the venue's.
          return {
            id: String(s[0]),
            fields: {
              name: v.name, address: v.address, city: v.city, region: v.region, postcode: v.postalCode, lat: v.lat, lng: v.lng, website: v.website, tel: v.phone,
              ...(s[1] ? { date_refreshed: s[1] } : {}),
            },
          }
        }
        const fields: Record<string, unknown> = {}
        sk.slice(1).forEach((k, i) => {
          if (s[i + 1] != null) fields[k] = s[i + 1]
        })
        return { id: String(s[0]), fields }
      })
      return { ...v, src }
    }),
  }
}

export function readManifest(dir = DEFAULT_DIRECTORY_SEED_DIR): SeedManifest | null {
  const file = path.join(dir, 'manifest.json')
  if (!existsSync(file)) return null
  const m = JSON.parse(readFileSync(file, 'utf8')) as SeedManifest
  return m.format === SEED_FORMAT ? m : null
}

export function readRegionFile(dir: string, region: SeedManifestRegion): SeedRegionFile {
  return decodeSeed(readFileSync(path.join(dir, region.file)))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

export interface LoadRegionResult {
  venues: number
  inserted: number
  updated: number
  sources: number
  cities: number
}

/** Upserts one region's cities, venues and sources. Safe to repeat. */
export async function loadSeedRegion(db: Db, file: SeedRegionFile): Promise<LoadRegionResult> {
  const out: LoadRegionResult = { venues: file.venues.length, inserted: 0, updated: 0, sources: 0, cities: 0 }
  for (let i = 0; i < file.cities.length; i += BATCH) {
    const batch = file.cities.slice(i, i + BATCH)
    const res = await db.insert(cities).values(batch).onConflictDoNothing({ target: cities.slug }).returning({ slug: cities.slug })
    out.cities += res.length
  }
  for (let i = 0; i < file.venues.length; i += BATCH) {
    const batch = file.venues.slice(i, i + BATCH)
    // Slugs held by a different venue (a user's, or an older seed's) get a stable suffix.
    const held = await db
      .select({ slug: venues.slug, fsqId: venues.fsqId })
      .from(venues)
      .where(inArray(venues.slug, batch.map((v) => v.slug)))
    const owner = new Map(held.map((h) => [h.slug, h.fsqId]))
    const rows = batch.map((v) => {
      const o = owner.get(v.slug)
      const slug = o !== undefined && o !== v.fsqId ? `${v.slug}-${v.fsqId.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, '0')}` : v.slug
      return {
        slug, name: v.name, brand: v.brand, address: v.address, city: v.city, citySlug: v.citySlug, region: v.region, country: v.country,
        postalCode: v.postalCode, lat: v.lat, lng: v.lng, website: v.website, phone: v.phone, fsqId: v.fsqId,
      }
    })
    const res = await db
      .insert(venues)
      .values(rows)
      .onConflictDoUpdate({
        target: venues.fsqId,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          address: sql`excluded.address`,
          city: sql`excluded.city`,
          citySlug: sql`excluded.city_slug`,
          region: sql`excluded.region`,
          country: sql`excluded.country`,
          postalCode: sql`excluded.postal_code`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          website: sql`excluded.website`,
          phone: sql`excluded.phone`,
          updatedAt: sql`now()`,
        },
        // A user's correction wins over the next import.
        setWhere: sql`not exists (select 1 from ${sources} s where s.entity_type = 'venue' and s.entity_id = ${venues.id} and s.source = 'user' and (s.fields -> 'applied') is not null)`,
      })
      .returning({ id: venues.id, inserted: sql<boolean>`(xmax = 0)` })
    for (const r of res) {
      if (r.inserted) out.inserted++
      else out.updated++
    }
    const ids = await db
      .select({ id: venues.id, fsqId: venues.fsqId })
      .from(venues)
      .where(inArray(venues.fsqId, batch.map((v) => v.fsqId)))
    const idByFsq = new Map(ids.map((r) => [r.fsqId, r.id]))
    const srcRows = batch.flatMap((v) => {
      const entityId = idByFsq.get(v.fsqId)
      if (!entityId) return []
      return v.src.map((s) => ({
        entityType: 'venue' as const,
        entityId,
        source: 'foursquare' as const,
        sourceId: s.id,
        license: file.license,
        attribution: file.attribution,
        fields: s.fields,
      }))
    })
    for (let j = 0; j < srcRows.length; j += BATCH) {
      const chunk = srcRows.slice(j, j + BATCH)
      await db
        .insert(sources)
        .values(chunk)
        .onConflictDoUpdate({
          target: [sources.entityType, sources.entityId, sources.source, sources.sourceId],
          set: { fields: sql`excluded.fields`, license: sql`excluded.license`, attribution: sql`excluded.attribution`, fetchedAt: sql`now()` },
        })
      out.sources += chunk.length
    }
    // Let queued requests run between batches (PGlite has one connection; a full seed is ~100 batches).
    await new Promise((r) => setImmediate(r))
  }
  return out
}

// ---------------------------------------------------------------------------
// Version bookkeeping and the deploy-time loader
// ---------------------------------------------------------------------------

export async function ensureSeedStateTable(db: Db): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `create table if not exists directory_seed_state (id text primary key, version text, loaded_at timestamptz, lease_until timestamptz, summary jsonb not null default '{}'::jsonb)`,
      ),
    )
  } catch (err) {
    // Two instances creating it at once: the loser sees a duplicate; the table exists either way.
    const exists = rowsOf<{ t: string | null }>(await db.execute(sql`select to_regclass('directory_seed_state')::text as t`))[0]?.t
    if (!exists) throw err
  }
}

export async function seedState(db: Db): Promise<{ version: string | null; loadedAt: string | null } | null> {
  await ensureSeedStateTable(db)
  const r = rowsOf<{ version: string | null; loaded_at: string | Date | null }>(await db.execute(sql`select version, loaded_at from directory_seed_state where id = ${STATE_ID}`))[0]
  if (!r) return null
  return { version: r.version, loadedAt: r.loaded_at == null ? null : new Date(r.loaded_at).toISOString() }
}

export interface DirectorySeedResult {
  status: 'loaded' | 'up_to_date' | 'busy' | 'no_seed'
  version: string | null
  regions: { id: string; venues: number; inserted: number; updated: number }[]
  ms: number
}

/** Loads the seed when needed (tables empty or version changed), or always with `force`. */
export async function loadDirectorySeed(db: Db, opts: { dir?: string; force?: boolean; log?: (msg: string) => void } = {}): Promise<DirectorySeedResult> {
  const started = Date.now()
  const dir = opts.dir ?? DEFAULT_DIRECTORY_SEED_DIR
  const manifest = readManifest(dir)
  if (!manifest || !manifest.regions.length) return { status: 'no_seed', version: null, regions: [], ms: Date.now() - started }
  const state = await seedState(db)
  const hasImported = rowsOf<{ x: boolean }>(await db.execute(sql`select exists(select 1 from ${venues} where ${venues.fsqId} is not null) as x`))[0]?.x
  if (!opts.force && hasImported && state?.version === manifest.version) {
    return { status: 'up_to_date', version: manifest.version, regions: [], ms: Date.now() - started }
  }
  const claimed = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into directory_seed_state (id, lease_until) values (${STATE_ID}, now() + make_interval(mins => ${LEASE_MINUTES}))
      on conflict (id) do update set lease_until = excluded.lease_until
      where directory_seed_state.lease_until is null or directory_seed_state.lease_until < now()
      returning id`),
  )
  if (!claimed.length) return { status: 'busy', version: manifest.version, regions: [], ms: Date.now() - started }
  const regions: DirectorySeedResult['regions'] = []
  try {
    for (const r of manifest.regions) {
      const file = readRegionFile(dir, r)
      const res = await loadSeedRegion(db, file)
      regions.push({ id: r.id, venues: res.venues, inserted: res.inserted, updated: res.updated })
      opts.log?.(`[directory] seed ${r.id}: ${res.venues} venues (${res.inserted} new)`)
      // Keep the lease alive on long loads.
      await db.execute(sql`update directory_seed_state set lease_until = now() + make_interval(mins => ${LEASE_MINUTES}) where id = ${STATE_ID}`)
    }
    const summary = JSON.stringify({ regions: regions.map((r) => ({ id: r.id, venues: r.venues })) })
    await db.execute(sql`update directory_seed_state set version = ${manifest.version}, loaded_at = now(), lease_until = null, summary = ${summary}::jsonb where id = ${STATE_ID}`)
  } catch (err) {
    await db.execute(sql`update directory_seed_state set lease_until = null where id = ${STATE_ID}`).catch(() => undefined)
    throw err
  }
  return { status: 'loaded', version: manifest.version, regions, ms: Date.now() - started }
}

export function seedLoaderEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env.DIRECTORY_SEED ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  return env.NODE_ENV !== 'test'
}

/**
 * Starts the background loader: waits for the database, loads when needed, retries a failure a
 * few times. Returns a stop function. Timers are unref'd so they never keep the process alive.
 */
export function startDirectorySeedLoader(ctx: AppContext, opts: { dir?: string; pollMs?: number; retryMs?: number; maxAttempts?: number } = {}): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let attempts = 0
  const dir = opts.dir ?? ctx.env.DIRECTORY_SEED_DIR ?? DEFAULT_DIRECTORY_SEED_DIR
  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(tick, ms)
    timer.unref?.()
  }
  const tick = async () => {
    if (stopped) return
    if (ctx.dbState.status !== 'ready' || !ctx.dbState.handle) return schedule(opts.pollMs ?? 2000)
    attempts++
    try {
      const r = await loadDirectorySeed(ctx.dbState.handle.db, { dir })
      if (r.status === 'loaded') {
        const total = r.regions.reduce((n, x) => n + x.venues, 0)
        console.log(`[directory] Seed ${r.version} loaded: ${total} venues in ${r.regions.length} regions (${r.ms} ms).`)
      } else if (r.status === 'busy') {
        // Another instance is loading; check again later in case it dies.
        if (attempts < (opts.maxAttempts ?? 5)) schedule(opts.retryMs ?? 60_000)
      }
    } catch (err) {
      if (stopped) return
      console.error(`[directory] Seed load failed: ${err instanceof Error ? err.message : String(err)}`)
      if (attempts < (opts.maxAttempts ?? 5)) schedule(opts.retryMs ?? 60_000)
    }
  }
  schedule(0)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

/** For tests and the admin: the counts the seed promised vs. what is in the database. */
export async function seedCoverage(db: Db): Promise<{ country: string; venues: number }[]> {
  const rows = await db
    .select({ country: venues.country, venues: sql<number>`count(*)::int` })
    .from(venues)
    .where(and(sql`${venues.fsqId} is not null`, eq(venues.status, 'active')))
    .groupBy(venues.country)
  return rows.sort((a, b) => b.venues - a.venues)
}
