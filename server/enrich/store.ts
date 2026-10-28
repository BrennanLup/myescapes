/**
 * Database side of the room crawler: bookkeeping tables (created here, outside Drizzle's
 * migrations, like directory_seed_state), which venues to read next, and saving the rooms found.
 *
 * Saving never overwrites what people entered: an existing room (same venue, same name, any case)
 * only gets its empty fields filled. Every saved room gets a `website` row in `sources`, so game
 * pages credit the venue's site.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { games, sources, venues } from '../db/schema'
import { isUniqueViolation, safeWebsite, slugify, uniqueSlug } from '../db/util'
import type { RoomFact, SiteFacts } from './extract'
import { normalizeSite } from './site'

type Rows<T> = { rows?: T[] } | T[]
const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as Rows<T> & { rows?: T[] }).rows ?? []))

export async function ensureEnrichTables(db: Db): Promise<void> {
  for (const ddl of [
    `create table if not exists venue_enrichment (venue_id text primary key, status text not null, rooms integer not null default 0, cost_usd double precision not null default 0, note text, attempted_at timestamptz not null default now())`,
    `create table if not exists enrich_runs (id text primary key, kind text not null, status text not null, venue_limit integer not null, budget_usd double precision not null, spent_usd double precision not null default 0, venues integer not null default 0, venues_with_rooms integer not null default 0, rooms_added integer not null default 0, note text, started_at timestamptz not null default now(), finished_at timestamptz, lease_until timestamptz)`,
  ]) {
    try {
      await db.execute(sql.raw(ddl))
    } catch (err) {
      // Two instances creating it at once: the loser errors, the table exists either way.
      const table = /exists (\w+)/.exec(ddl)![1]
      const exists = rowsOf<{ t: string | null }>(await db.execute(sql`select to_regclass(${table})::text as t`))[0]?.t
      if (!exists) throw err
    }
  }
}

export interface VenueToRead {
  id: string
  name: string
  city: string
  country: string
  website: string
}

/**
 * Venues to read next: active, imported from Foursquare, with a website, never tried, and no
 * rooms yet. Venues in busier cities first, so a small run helps the most people.
 */
export async function venuesToRead(db: Db, opts: { limit: number; country?: string; venueIds?: string[] }): Promise<VenueToRead[]> {
  const filters = [
    sql`v.status = 'active'`,
    sql`v.fsq_id is not null`,
    sql`coalesce(v.website, '') <> ''`,
    sql`not exists (select 1 from venue_enrichment e where e.venue_id = v.id)`,
    sql`not exists (select 1 from ${games} g where g.venue_id = v.id)`,
  ]
  if (opts.country) filters.push(sql`v.country = ${opts.country.toUpperCase()}`)
  if (opts.venueIds?.length) filters.push(sql`v.id in (${sql.join(opts.venueIds.map((id) => sql`${id}`), sql`, `)})`)
  return rowsOf<VenueToRead>(
    await db.execute(sql`
      select v.id, v.name, v.city, v.country, v.website
      from ${venues} v
      left join (select city_slug, count(*)::int as n from ${venues} group by city_slug) c on c.city_slug = v.city_slug
      where ${sql.join(filters, sql` and `)}
      order by coalesce(c.n, 0) desc, v.id
      limit ${opts.limit}`),
  )
}

export async function markVenue(db: Db, venueId: string, status: string, rooms: number, costUsd: number, note: string | null): Promise<void> {
  await db.execute(sql`
    insert into venue_enrichment (venue_id, status, rooms, cost_usd, note, attempted_at) values (${venueId}, ${status}, ${rooms}, ${costUsd}, ${note}, now())
    on conflict (venue_id) do update set status = excluded.status, rooms = excluded.rooms, cost_usd = venue_enrichment.cost_usd + excluded.cost_usd, note = excluded.note, attempted_at = now()`)
}

/** A room's own page, only when it is on the venue's site. */
function roomUrl(room: RoomFact, site: URL | null): string | null {
  if (!room.url || !site) return null
  try {
    const u = new URL(room.url, site)
    if (u.hostname.replace(/^www\./, '') !== site.hostname.replace(/^www\./, '')) return null
    return safeWebsite(u.href)
  } catch {
    return null
  }
}

/** Saves the rooms found on a venue's site. Returns how many rooms were new. */
export async function saveRooms(db: Db, venue: VenueToRead & { slug?: string }, facts: SiteFacts, pagesRead: string[]): Promise<number> {
  const site = normalizeSite(venue.website)
  const host = site?.hostname.replace(/^www\./, '') ?? ''
  const v = (await db.select({ slug: venues.slug, name: venues.name, city: venues.city }).from(venues).where(eq(venues.id, venue.id)).limit(1))[0]
  if (!v) return 0
  let added = 0
  for (const room of facts.rooms) {
    if (room.status === 'coming_soon') continue
    const url = roomUrl(room, site)
    const values = {
      genre: room.genre,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      durationMinutes: room.durationMinutes,
      description: room.summary,
      website: url,
    }
    let game = (await db.select().from(games).where(and(eq(games.venueId, venue.id), sql`lower(${games.name}) = ${room.name.toLowerCase()}`)).limit(1))[0]
    if (game) {
      if (game.status === 'hidden') continue
      const fill: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(values)) if (val != null && (game as Record<string, unknown>)[k] == null) fill[k] = val
      if (Object.keys(fill).length) await db.update(games).set(fill).where(eq(games.id, game.id))
    } else {
      const base = slugify(`${room.name} ${v.name.toLowerCase().includes(v.city.toLowerCase()) ? v.name : `${v.name} ${v.city}`}`, 110)
      for (let attempt = 0; attempt < 4 && !game; attempt++) {
        const slug = await uniqueSlug(db, games, games.slug, attempt ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base)
        try {
          game = (await db.insert(games).values({ venueId: venue.id, slug, name: room.name, status: room.status === 'closed' ? 'closed' : 'active', ...values }).returning())[0]
          added++
        } catch (err) {
          if (!isUniqueViolation(err)) throw err
          // Same name added meanwhile: use that row.
          game = (await db.select().from(games).where(and(eq(games.venueId, venue.id), sql`lower(${games.name}) = ${room.name.toLowerCase()}`)).limit(1))[0]
        }
      }
      if (!game) continue
    }
    await db
      .insert(sources)
      .values({
        entityType: 'game',
        entityId: game.id,
        source: 'website',
        sourceId: url ?? site?.href ?? venue.website,
        license: 'facts',
        attribution: `Room details from ${host || 'the venue website'}`,
        fields: { ...room, pages: pagesRead },
      })
      .onConflictDoUpdate({ target: [sources.entityType, sources.entityId, sources.source, sources.sourceId], set: { fields: { ...room, pages: pagesRead } } })
  }
  return added
}
