/**
 * Extraction v2: directory matching hints (workstream 11).
 *
 * The matcher UI (workstream 12) calls GET /api/directory/match with `venue`, `game`, `city` and
 * `country`. This module turns a draft (plus the model's own hints, plus nearby directory venues
 * when the phone sent a location) into those four strings:
 *
 * - `nearbyDirectory(db, lat, lng)` reads active venues within ~50 km and their games, so both the
 *   Claude prompt and the hint builder can spell names the way the directory does (speech-to-text
 *   often mishears brand names: "Star Light Escapes" -> "Starlight Escapes").
 * - `buildHints(...)` picks the venue/game/city/country hints and snaps them to a nearby directory
 *   name when the similarity is high enough.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import type { Db } from '../db/client'
import { games, venues } from '../db/schema'
import { haversineKm } from '../db/util'
import type { ReviewDraft } from '../../src/contracts/types'

export interface ExtractHints {
  venue: string | null
  game: string | null
  city: string | null
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string | null
}

export interface NearbyVenue {
  name: string
  brand: string | null
  city: string
  country: string
  distanceKm: number
  games: string[]
}

export const NEARBY_RADIUS_KM = 50
export const NEARBY_MAX_VENUES = 15
export const NEARBY_MAX_GAMES_PER_VENUE = 12
/** Minimum similarity (0..1) to replace a spoken name with the directory's spelling. */
export const SNAP_THRESHOLD = 0.55

// ---------------------------------------------------------------------------
// Fuzzy matching (a small local trigram similarity, close to pg_trgm's)
// ---------------------------------------------------------------------------

/** Lowercase, strip accents, punctuation, "the" and generic words, collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|escape rooms?|escapes?|rooms?|games?|inc|llc|ltd|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  // Compare without spaces so "Star Light" and "Starlight" match.
  const t = `  ${s.replace(/\s+/g, '')} `
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}

/** Dice coefficient over character trigrams of the normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = trigrams(na)
  const tb = trigrams(nb)
  let shared = 0
  for (const g of ta) if (tb.has(g)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

function bestMatch(name: string | null, candidates: string[]): { name: string; score: number } | null {
  if (!name) return null
  let best: { name: string; score: number } | null = null
  for (const c of candidates) {
    const score = nameSimilarity(name, c)
    if (!best || score > best.score) best = { name: c, score }
  }
  return best && best.score >= SNAP_THRESHOLD ? best : null
}

// ---------------------------------------------------------------------------
// Country inference
// ---------------------------------------------------------------------------

/** Cities people are likely to name, with their country. Not exhaustive: the matcher still searches. */
export const CITY_COUNTRY: Record<string, string> = {
  'san francisco': 'US', oakland: 'US', berkeley: 'US', 'san jose': 'US', 'los angeles': 'US', 'san diego': 'US',
  'new york': 'US', brooklyn: 'US', chicago: 'US', seattle: 'US', portland: 'US', boston: 'US', austin: 'US',
  denver: 'US', dallas: 'US', houston: 'US', atlanta: 'US', miami: 'US', orlando: 'US', 'las vegas': 'US',
  phoenix: 'US', philadelphia: 'US', washington: 'US', minneapolis: 'US', detroit: 'US', nashville: 'US',
  'salt lake city': 'US', sacramento: 'US', pittsburgh: 'US', baltimore: 'US', 'new orleans': 'US',
  toronto: 'CA', vancouver: 'CA', montreal: 'CA', ottawa: 'CA', calgary: 'CA', edmonton: 'CA', winnipeg: 'CA',
  'quebec city': 'CA', halifax: 'CA', victoria: 'CA', mississauga: 'CA', hamilton: 'CA',
  london: 'GB', manchester: 'GB', edinburgh: 'GB', glasgow: 'GB', bristol: 'GB', birmingham: 'GB', leeds: 'GB',
  dublin: 'IE', paris: 'FR', lyon: 'FR', berlin: 'DE', munich: 'DE', hamburg: 'DE', amsterdam: 'NL',
  rotterdam: 'NL', brussels: 'BE', madrid: 'ES', barcelona: 'ES', lisbon: 'PT', rome: 'IT', milan: 'IT',
  vienna: 'AT', zurich: 'CH', prague: 'CZ', budapest: 'HU', warsaw: 'PL', krakow: 'PL', copenhagen: 'DK',
  stockholm: 'SE', oslo: 'NO', helsinki: 'FI', athens: 'GR',
  tokyo: 'JP', osaka: 'JP', kyoto: 'JP', seoul: 'KR', singapore: 'SG', 'hong kong': 'HK', taipei: 'TW',
  bangkok: 'TH', shanghai: 'CN', beijing: 'CN', 'kuala lumpur': 'MY', manila: 'PH',
  sydney: 'AU', melbourne: 'AU', brisbane: 'AU', perth: 'AU', adelaide: 'AU', canberra: 'AU', auckland: 'NZ',
  wellington: 'NZ',
}

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(?:canada|canadian)\b/i, 'CA'],
  [/\b(?:united states|usa|u\.s\.a?\.?|america)\b/i, 'US'],
  [/\b(?:united kingdom|uk|u\.k\.|england|scotland|wales|britain)\b/i, 'GB'],
  [/\bireland\b/i, 'IE'],
  [/\b(?:australia|aussie)\b/i, 'AU'],
  [/\bnew zealand\b/i, 'NZ'],
  [/\bfrance\b/i, 'FR'],
  [/\bgermany\b/i, 'DE'],
  [/\b(?:netherlands|holland)\b/i, 'NL'],
  [/\bspain\b/i, 'ES'],
  [/\bitaly\b/i, 'IT'],
  [/\bjapan\b/i, 'JP'],
  [/\b(?:south )?korea\b/i, 'KR'],
  [/\bsingapore\b/i, 'SG'],
]

/** Province/state codes and names that pin the country ("Toronto, Ontario"). */
const REGION_WORDS: [RegExp, string][] = [
  [/\b(?:ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick)\b/i, 'CA'],
  [/\b(?:california|texas|new york state|washington state|oregon|colorado|florida|illinois|massachusetts|nevada|arizona|georgia|utah)\b/i, 'US'],
]

const ISO2 = /^[A-Z]{2}$/

/** The model's country hint: an ISO code ("us") or a country name ("Canada"); null otherwise. */
export function countryFromModel(value: string | null | undefined): string | null {
  const t = clip(value, 60)
  if (!t) return null
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
  for (const [re, code] of COUNTRY_WORDS) if (re.test(t)) return code
  return null
}

export function countryForCity(city: string | null): string | null {
  if (!city) return null
  return CITY_COUNTRY[city.trim().toLowerCase()] ?? null
}

/** Best-effort ISO country from explicit words, then the city. Null when unsure. */
export function inferCountry(transcript: string, city: string | null): string | null {
  for (const [re, code] of COUNTRY_WORDS) if (re.test(transcript)) return code
  for (const [re, code] of REGION_WORDS) if (re.test(transcript)) return code
  return countryForCity(city)
}

// ---------------------------------------------------------------------------
// Nearby directory context
// ---------------------------------------------------------------------------

export function validLatLng(lat: number | undefined, lng: number | undefined): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  )
}

/**
 * Active venues within `radiusKm` of a point, nearest first, each with its active game names.
 * Uses a bounding box on the plain lat/lng columns (indexed), then exact distance.
 */
export async function nearbyDirectory(
  db: Db,
  lat: number,
  lng: number,
  opts: { radiusKm?: number; limit?: number } = {},
): Promise<NearbyVenue[]> {
  const radius = opts.radiusKm ?? NEARBY_RADIUS_KM
  const limit = opts.limit ?? NEARBY_MAX_VENUES
  const dLat = radius / 111
  const dLng = radius / (111 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  const rows = await db
    .select({ id: venues.id, name: venues.name, brand: venues.brand, city: venues.city, country: venues.country, lat: venues.lat, lng: venues.lng })
    .from(venues)
    .where(
      and(
        eq(venues.status, 'active'),
        gte(venues.lat, lat - dLat),
        lte(venues.lat, lat + dLat),
        gte(venues.lng, lng - dLng),
        lte(venues.lng, lng + dLng),
      ),
    )
    .limit(500)
  const near = rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({ ...r, distanceKm: haversineKm(lat, lng, r.lat!, r.lng!) }))
    .filter((r) => r.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
  if (near.length === 0) return []
  const gameRows = await db
    .select({ venueId: games.venueId, name: games.name })
    .from(games)
    .where(and(inArray(games.venueId, near.map((v) => v.id)), eq(games.status, 'active')))
  const byVenue = new Map<string, string[]>()
  for (const g of gameRows) {
    const list = byVenue.get(g.venueId) ?? []
    if (list.length < NEARBY_MAX_GAMES_PER_VENUE) list.push(g.name)
    byVenue.set(g.venueId, list)
  }
  return near.map((v) => ({
    name: v.name,
    brand: v.brand,
    city: v.city,
    country: v.country,
    distanceKm: Math.round(v.distanceKm * 10) / 10,
    games: (byVenue.get(v.id) ?? []).sort((a, b) => a.localeCompare(b)),
  }))
}

/** Prompt text listing nearby venues. Names are data from the directory, quoted and length-capped. */
export function nearbyPromptText(nearby: NearbyVenue[]): string {
  if (nearby.length === 0) return ''
  const clean = (s: string) => s.replace(/[\r\n<>]/g, ' ').slice(0, 120)
  const lines = nearby.map((v) => {
    const gamesText = v.games.length ? `; games: ${v.games.map((g) => `"${clean(g)}"`).join(', ')}` : ''
    return `- "${clean(v.name)}" (${clean(v.city)}, ${v.country}, ${v.distanceKm} km away${gamesText})`
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Hint builder
// ---------------------------------------------------------------------------

function clip(s: string | null | undefined, max: number): string | null {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  return t ? t.slice(0, max) : null
}

/** Reads `hints` from a raw model answer, tolerating junk. */
export function rawHintsFrom(raw: unknown): Partial<ExtractHints> {
  if (!raw || typeof raw !== 'object') return {}
  const h = (raw as { hints?: unknown }).hints
  if (!h || typeof h !== 'object') return {}
  const o = h as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return { venue: str(o.venue), game: str(o.game), city: str(o.city), country: str(o.country) }
}

/**
 * Builds the four matcher hints:
 * - venue: the model's hint, else the room's company; game: the model's hint, else the room name.
 * - Each is snapped to the closest nearby directory name when similar enough. If only the game
 *   matched a nearby venue's game, that venue becomes the venue hint.
 * - city: the draft's city, else the snapped venue's city. country: the model's ISO code, else
 *   the snapped venue's, else words in the transcript or the city.
 */
export function buildHints(
  draft: ReviewDraft,
  opts: { transcript: string; raw?: Partial<ExtractHints>; nearby?: NearbyVenue[] } = { transcript: '' },
): ExtractHints {
  const raw = opts.raw ?? {}
  const nearby = opts.nearby ?? []
  let venue = clip(raw.venue, 160) ?? clip(draft.room.company, 160)
  let game = clip(raw.game, 160) ?? clip(draft.room.name, 160)
  let city = clip(draft.room.city, 120) ?? clip(raw.city, 120)
  let matchedVenue: NearbyVenue | null = null

  if (nearby.length) {
    const venueNames = nearby.flatMap((v) => [v.name, ...(v.brand ? [v.brand] : [])])
    const vm = bestMatch(venue, venueNames)
    if (vm) {
      matchedVenue = nearby.find((v) => v.name === vm.name || v.brand === vm.name) ?? null
      venue = matchedVenue?.name ?? vm.name
    }
    // Games: prefer the matched venue's games, then any nearby game.
    const pool = matchedVenue ? matchedVenue.games : nearby.flatMap((v) => v.games)
    const gm = bestMatch(game, pool) ?? (matchedVenue ? bestMatch(game, nearby.flatMap((v) => v.games)) : null)
    if (gm) {
      game = gm.name
      if (!matchedVenue) {
        matchedVenue = nearby.find((v) => v.games.includes(gm.name)) ?? null
        if (matchedVenue && !venue) venue = matchedVenue.name
      }
    }
    if (!city && matchedVenue) city = matchedVenue.city
  }

  const country =
    countryFromModel(raw.country) ??
    matchedVenue?.country ??
    inferCountry(opts.transcript, city)
  return { venue, game, city, country: country && ISO2.test(country) && country !== 'ZZ' ? country : null }
}
