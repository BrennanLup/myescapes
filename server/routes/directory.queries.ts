/**
 * Directory queries (workstream 5): search, nearby, match and page data. Every value goes through
 * Drizzle's `sql` template as a bound parameter; the only `sql.raw` fragments are constants.
 *
 * Fuzzy search uses pg_trgm (`similarity`, `word_similarity`, GIN trigram indexes on venue and game
 * names) when the extension is installed, and falls back to ILIKE with a simple score when not.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { Attribution, GameSummary, VenueSummary } from '../../src/contracts/models'
import { GENRES, type Genre } from '../../src/contracts/types'
import type { Db } from '../db/client'

export const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

async function rows<T>(db: Db, q: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(q))
}

// ---------------------------------------------------------------------------
// pg_trgm detection
// ---------------------------------------------------------------------------

const trgmCache = new WeakMap<object, Promise<boolean>>()

/** True when pg_trgm is installed in this database (cached per connection object). */
export function hasTrgm(db: Db): Promise<boolean> {
  let p = trgmCache.get(db)
  if (!p) {
    p = rows<{ ok: boolean }>(db, sql`select exists(select 1 from pg_extension where extname = 'pg_trgm') as ok`)
      .then((r) => Boolean(r[0]?.ok))
      .catch(() => false)
    trgmCache.set(db, p)
  }
  return p
}

/** Test hook: forget the cached answer (or force one). */
export function setTrgmForTests(db: Db, value: boolean | null) {
  if (value === null) trgmCache.delete(db)
  else trgmCache.set(db, Promise.resolve(value))
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Great-circle km from (lat, lng) to the venue row aliased `v`. */
export function distanceKmSql(lat: number, lng: number): SQL {
  return sql`(6371 * 2 * asin(least(1, sqrt(power(sin(radians(v.lat - ${lat}::float8) / 2), 2) + cos(radians(${lat}::float8)) * cos(radians(v.lat)) * power(sin(radians(v.lng - ${lng}::float8) / 2), 2)))))`
}

/** 0..1 name score of column `col` against `q`. */
function nameScoreSql(col: SQL, q: string, trgm: boolean): SQL {
  if (trgm) return sql`greatest(similarity(${col}, ${q}::text), word_similarity(${q}::text, ${col}))`
  const pat = likeEscape(q.toLowerCase())
  return sql`(case when lower(${col}) = ${q.toLowerCase()} then 1.0 when lower(${col}) like ${`${pat}%`} then 0.8 when lower(${col}) like ${`%${pat}%`} then 0.6 else 0.0 end)`
}

/** Candidate filter that can use the trigram index. */
function nameMatchSql(col: SQL, q: string, trgm: boolean): SQL {
  const contains = sql`${col} ilike ${`%${likeEscape(q)}%`}`
  if (!trgm) return contains
  return sql`(${contains} or ${col} % ${q}::text or ${q}::text <% ${col})`
}

const VENUE_COLS = sql`v.id, v.slug, v.name, v.brand, v.address, v.city, v.city_slug as "citySlug", v.region, v.country, v.lat, v.lng, v.status,
  (select count(*)::int from games g2 where g2.venue_id = v.id and g2.status <> 'hidden') as "gameCount"`

/** Reviews that count publicly: public, not hidden, by an onboarded author (handle and display name set, same rule as authorIsPublic). */
const PUBLIC_REVIEW = sql`r.visibility = 'public' and r.hidden_at is null and exists (select 1 from users u where u.id = r.author_id and u.handle is not null and u.display_name is not null)`

const GAME_COLS = sql`g.id, g.slug, g.name, g.genre, g.status, g.venue_id as "venueId", v.name as "venueName", v.slug as "venueSlug", v.city, v.country,
  coalesce(agg.n, 0)::int as "reviewCount", agg.avg as "avgOverall"`

const GAME_AGG_JOIN = sql`left join lateral (
  select count(*)::int as n, avg(r.overall_score)::float8 as avg
  from reviews r join visits vi on vi.id = r.visit_id
  where vi.game_id = g.id and ${PUBLIC_REVIEW} and not r.scores_copied
) agg on true`

type VenueRow = Omit<VenueSummary, 'distanceKm'> & { distanceKm?: number | null; score?: number }
type GameRow = Omit<GameSummary, 'genre'> & { genre: string | null; score?: number }

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

export function toGenre(g: string | null): Genre | null {
  return g && (GENRES as readonly string[]).includes(g) ? (g as Genre) : null
}

export function toVenueSummary(r: VenueRow, withDistance = false): VenueSummary {
  return {
    id: r.id, slug: r.slug, name: r.name, brand: r.brand, address: r.address, city: r.city, citySlug: r.citySlug, region: r.region,
    country: r.country, lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), status: r.status,
    gameCount: Number(r.gameCount ?? 0),
    ...(withDistance ? { distanceKm: r.distanceKm == null ? null : round(Number(r.distanceKm), 2) } : {}),
  }
}

export function toGameSummary(r: GameRow): GameSummary {
  return {
    id: r.id, slug: r.slug, name: r.name, genre: toGenre(r.genre), status: r.status, venueId: r.venueId, venueName: r.venueName, venueSlug: r.venueSlug,
    city: r.city, country: r.country, reviewCount: Number(r.reviewCount ?? 0), avgOverall: r.avgOverall == null ? null : round(Number(r.avgOverall)),
  }
}

// ---------------------------------------------------------------------------
// Search, nearby, match
// ---------------------------------------------------------------------------

export interface SearchInput {
  q: string
  lat?: number
  lng?: number
  country?: string
  limit?: number
}

/** Distance penalty for search ranking: 0 nearby, up to 0.3 for far away. */
const distancePenalty = (d: SQL) => sql`least(0.3, coalesce(${d}, 20000) / 2000.0)`

export async function searchVenues(db: Db, input: SearchInput): Promise<VenueSummary[]> {
  const trgm = await hasTrgm(db)
  const limit = input.limit ?? 10
  const point = input.lat != null && input.lng != null
  const dist = point ? distanceKmSql(input.lat!, input.lng!) : sql`null::float8`
  const nameScore = nameScoreSql(sql`v.name`, input.q, trgm)
  const cityHit = sql`lower(v.city) = ${input.q.toLowerCase()}`
  const score = sql`greatest(${nameScore}, case when ${cityHit} then 0.5 else 0 end)`
  const r = await rows<VenueRow>(
    db,
    sql`select ${VENUE_COLS}, ${dist} as "distanceKm", ${score} as score
      from venues v
      where v.status <> 'hidden'
        ${input.country ? sql`and v.country = ${input.country.toUpperCase()}` : sql``}
        and (${nameMatchSql(sql`v.name`, input.q, trgm)} or ${cityHit})
      order by ${point ? sql`${score} - ${distancePenalty(dist)}` : score} desc, v.name asc
      limit ${limit}`,
  )
  return r.map((x) => toVenueSummary(x, point))
}

export async function searchGames(db: Db, input: SearchInput): Promise<GameSummary[]> {
  const trgm = await hasTrgm(db)
  const limit = input.limit ?? 10
  const point = input.lat != null && input.lng != null
  const dist = point ? distanceKmSql(input.lat!, input.lng!) : sql`null::float8`
  const score = nameScoreSql(sql`g.name`, input.q, trgm)
  const r = await rows<GameRow>(
    db,
    sql`select ${GAME_COLS}, ${score} as score
      from games g join venues v on v.id = g.venue_id
      ${GAME_AGG_JOIN}
      where g.status <> 'hidden' and v.status <> 'hidden'
        ${input.country ? sql`and v.country = ${input.country.toUpperCase()}` : sql``}
        and ${nameMatchSql(sql`g.name`, input.q, trgm)}
      order by ${point ? sql`${score} - ${distancePenalty(dist)}` : score} desc, g.name asc
      limit ${limit}`,
  )
  return r.map(toGameSummary)
}

export async function nearbyVenues(db: Db, input: { lat: number; lng: number; radiusKm?: number; limit?: number }): Promise<VenueSummary[]> {
  const radius = input.radiusKm ?? 25
  const dLat = radius / 111
  const dLng = radius / (111 * Math.max(0.01, Math.cos((input.lat * Math.PI) / 180)))
  const dist = distanceKmSql(input.lat, input.lng)
  const r = await rows<VenueRow>(
    db,
    sql`select * from (
        select ${VENUE_COLS}, ${dist} as "distanceKm"
        from venues v
        where v.status <> 'hidden' and v.lat is not null and v.lng is not null
          and v.lat between ${input.lat - dLat}::float8 and ${input.lat + dLat}::float8
          and v.lng between ${input.lng - dLng}::float8 and ${input.lng + dLng}::float8
      ) x
      where x."distanceKm" <= ${radius}::float8
      order by x."distanceKm" asc, x.name asc
      limit ${input.limit ?? 20}`,
  )
  return r.map((x) => toVenueSummary(x, true))
}

export interface MatchInput {
  venue?: string
  game?: string
  city?: string
  country?: string
  lat?: number
  lng?: number
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 1000) / 1000))

/**
 * Scored candidates for the matcher UI. Venue score = weighted mean of the parts we have hints
 * for: name 0.65, city 0.2, distance 0.15 (1 at the point, 0 at 50 km). Game score = 0.65 game
 * name + 0.35 venue score (or 0.8 game name alone when no venue hint).
 */
export async function matchDirectory(db: Db, input: MatchInput): Promise<{ venues: { venue: VenueSummary; score: number }[]; games: { game: GameSummary; score: number }[] }> {
  const trgm = await hasTrgm(db)
  const venueQ = input.venue?.trim() || ''
  const gameQ = input.game?.trim() || ''
  const cityQ = input.city?.trim() || ''
  const point = input.lat != null && input.lng != null && Number.isFinite(input.lat) && Number.isFinite(input.lng)
  const country = input.country?.toUpperCase()
  const dist = point ? distanceKmSql(input.lat!, input.lng!) : sql`null::float8`
  const citySim = cityQ ? (trgm ? sql`greatest(similarity(v.city, ${cityQ}::text), case when lower(v.city) = ${cityQ.toLowerCase()} then 1 else 0 end)` : sql`(case when lower(v.city) = ${cityQ.toLowerCase()} then 1.0 else 0.0 end)`) : sql`null::float8`
  const venueNameSim = venueQ ? nameScoreSql(sql`v.name`, venueQ, trgm) : sql`null::float8`
  const countryFilter = country ? sql`and v.country = ${country}` : sql``

  const parts = (name: number | null, city: number | null, d: number | null) => {
    let total = 0
    let weight = 0
    if (name != null) {
      total += 0.65 * name
      weight += 0.65
    }
    if (city != null) {
      total += 0.2 * city
      weight += 0.2
    }
    if (d != null) {
      total += 0.15 * Math.max(0, 1 - d / 50)
      weight += 0.15
    }
    return weight ? total / weight : 0
  }

  type Scored = VenueRow & { nameSim: number | null; citySim: number | null }
  let venueRows: Scored[] = []
  if (venueQ || cityQ || point) {
    const where: SQL[] = []
    if (venueQ) where.push(nameMatchSql(sql`v.name`, venueQ, trgm))
    else if (cityQ) where.push(trgm ? sql`(lower(v.city) = ${cityQ.toLowerCase()} or v.city % ${cityQ}::text)` : sql`lower(v.city) = ${cityQ.toLowerCase()}`)
    if (point && !venueQ && !cityQ) {
      const dLat = 50 / 111
      const dLng = 50 / (111 * Math.max(0.01, Math.cos((input.lat! * Math.PI) / 180)))
      where.push(sql`v.lat between ${input.lat! - dLat}::float8 and ${input.lat! + dLat}::float8 and v.lng between ${input.lng! - dLng}::float8 and ${input.lng! + dLng}::float8`)
    }
    venueRows = await rows<Scored>(
      db,
      sql`select ${VENUE_COLS}, ${dist} as "distanceKm", ${venueNameSim} as "nameSim", ${citySim} as "citySim"
        from venues v
        where v.status <> 'hidden' ${countryFilter} and ${sql.join(where, sql` and `)}
        order by ${venueQ ? venueNameSim : point ? dist : sql`v.name`} ${venueQ ? sql`desc` : sql`asc`}
        limit 60`,
    )
  }
  const venueScores = venueRows
    .map((v) => ({
      venue: toVenueSummary(v, point),
      score: clamp01(parts(v.nameSim == null ? null : Number(v.nameSim), v.citySim == null ? null : Number(v.citySim), point && v.distanceKm != null ? Number(v.distanceKm) : null)),
    }))
    .sort((a, b) => b.score - a.score || a.venue.name.localeCompare(b.venue.name))
    .slice(0, 10)

  let games: { game: GameSummary; score: number }[] = []
  if (gameQ) {
    const gameSim = nameScoreSql(sql`g.name`, gameQ, trgm)
    type G = GameRow & { gameSim: number; nameSim: number | null; citySim: number | null; distanceKm: number | null }
    const g = await rows<G>(
      db,
      sql`select ${GAME_COLS}, ${gameSim} as "gameSim", ${venueNameSim} as "nameSim", ${citySim} as "citySim", ${dist} as "distanceKm"
        from games g join venues v on v.id = g.venue_id
        ${GAME_AGG_JOIN}
        where g.status <> 'hidden' and v.status <> 'hidden' ${countryFilter}
          and ${nameMatchSql(sql`g.name`, gameQ, trgm)}
        order by ${gameSim} desc
        limit 60`,
    )
    games = g.map((x) => {
      const venuePart = venueQ || cityQ || point ? parts(x.nameSim == null ? null : Number(x.nameSim), x.citySim == null ? null : Number(x.citySim), point && x.distanceKm != null ? Number(x.distanceKm) : null) : null
      const score = venuePart == null ? 0.8 * Number(x.gameSim) : 0.65 * Number(x.gameSim) + 0.35 * venuePart
      return { game: toGameSummary(x), score: clamp01(score) }
    })
  }
  // Games at the best venues, so "it was at Starlight" offers its rooms even without a game hint.
  const topVenues = venueScores.filter((v) => v.score >= 0.4).slice(0, 3)
  if (topVenues.length) {
    const ids = topVenues.map((v) => v.venue.id)
    const at = await rows<GameRow>(
      db,
      sql`select ${GAME_COLS} from games g join venues v on v.id = g.venue_id ${GAME_AGG_JOIN}
        where g.status <> 'hidden' and g.venue_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        order by g.name limit 30`,
    )
    const have = new Set(games.map((x) => x.game.id))
    for (const x of at) {
      if (have.has(x.id)) continue
      const vs = topVenues.find((v) => v.venue.id === x.venueId)!.score
      games.push({ game: toGameSummary(x), score: clamp01(gameQ ? 0.35 * vs : 0.5 * vs) })
    }
  }
  games.sort((a, b) => b.score - a.score || a.game.name.localeCompare(b.game.name))
  return { venues: venueScores, games: games.slice(0, 10) }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function venueSummaryById(db: Db, id: string): Promise<VenueSummary | null> {
  const r = await rows<VenueRow>(db, sql`select ${VENUE_COLS} from venues v where v.id = ${id}`)
  return r[0] ? toVenueSummary(r[0]) : null
}

export async function gamesAtVenue(db: Db, venueId: string): Promise<GameSummary[]> {
  const r = await rows<GameRow>(
    db,
    sql`select ${GAME_COLS} from games g join venues v on v.id = g.venue_id ${GAME_AGG_JOIN}
      where g.venue_id = ${venueId} and g.status <> 'hidden'
      order by g.name asc`,
  )
  return r.map(toGameSummary)
}

export async function venuesInCity(db: Db, citySlug: string, limit = 500): Promise<VenueSummary[]> {
  const r = await rows<VenueRow>(
    db,
    sql`select ${VENUE_COLS} from venues v where v.city_slug = ${citySlug} and v.status <> 'hidden'
      order by "gameCount" desc, v.name asc limit ${limit}`,
  )
  return r.map((x) => toVenueSummary(x))
}

export const SOURCE_ATTRIBUTION: Record<string, { license: string; text: string; url?: string }> = {
  foursquare: { license: 'Apache-2.0', text: 'Venue data from Foursquare Open Source Places', url: 'https://opensource.foursquare.com/os-places/' },
  osm: { license: 'ODbL-1.0', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  user: { license: 'user-contribution', text: 'Added and corrected by My Escapes players' },
  google: { license: 'Google Maps Platform', text: 'Map link by Google' },
}

/** One attribution line per source behind these entities. */
export async function attributionFor(db: Db, entities: { type: 'venue' | 'game'; ids: string[] }[]): Promise<Attribution[]> {
  const conds = entities.filter((e) => e.ids.length).map((e) => sql`(s.entity_type = ${e.type} and s.entity_id in (${sql.join(e.ids.map((id) => sql`${id}`), sql`, `)}))`)
  if (!conds.length) return []
  const r = await rows<{ source: string; license: string; attribution: string }>(
    db,
    sql`select s.source, min(s.license) as license, min(s.attribution) as attribution from sources s where ${sql.join(conds, sql` or `)} group by s.source order by s.source`,
  )
  return r
    .filter((x) => x.source !== 'google')
    .map((x) => {
      const known = SOURCE_ATTRIBUTION[x.source]
      return {
        source: x.source as Attribution['source'],
        license: known?.license ?? x.license,
        text: known?.text ?? x.attribution,
        ...(known?.url ? { url: known.url } : {}),
      }
    })
}

// Game page aggregates, puzzle highlights and review pages live in reviews.lib.ts (workstream 33).
