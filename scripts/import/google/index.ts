/**
 * Google place-ID linker (workstream 9). Optional: without GOOGLE_MAPS_API_KEY it does nothing.
 *
 * For venues that have no `google_place_id` yet, it asks the Places API (New) Text Search for the
 * venue and stores **only the place id** (Google's terms let us keep place ids indefinitely, and
 * nothing else). The display name and location in the response are used in memory to check the
 * match (name similarity, and under ~200 m when we know the venue's coordinates), then dropped.
 * Public pages turn the id into an "Open in Google Maps" link (server/db/util.ts googleMapsUrl).
 *
 * Resumable and cheap to re-run: venues tried in the last 30 days without a match are remembered
 * in `<DATA_DIR>/google-linker-state.json` and skipped. Stops on a quota or key error.
 *
 *   npx tsx scripts/import/google/index.ts [--limit 100] [--country US] [--dry-run]
 *
 * Cost: one Text Search (Pro fields: id, displayName, location) per venue tried. Keep a hard
 * monthly cap in Google Cloud.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from '../../../server/db/client'
import { sources, venues } from '../../../server/db/schema'
import { haversineKm } from '../../../server/db/util'
import { normaliseName } from '../dedupe'

export const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
/** id is all we keep; displayName and location are only for checking the match. */
export const FIELD_MASK = 'places.id,places.displayName,places.location'
export const GOOGLE_LICENSE = 'Google Maps Platform Terms (place id only)'
export const GOOGLE_ATTRIBUTION = 'Google'
export const MAX_MATCH_KM = 0.2
const RETRY_AFTER_DAYS = 30

export interface PlaceCandidate {
  id: string
  displayName?: { text?: string }
  location?: { latitude?: number; longitude?: number }
}

export interface VenueForLink {
  id: string
  name: string
  brand: string | null
  address: string
  city: string
  region: string
  country: string
  lat: number | null
  lng: number | null
}

export interface LinkOptions {
  /** Max venues to look up in this run. Default 100. */
  limit?: number
  /** Default env GOOGLE_MAPS_API_KEY. Without one the linker does nothing. */
  apiKey?: string
  /** Only venues in this country (ISO alpha-2). */
  country?: string
  dryRun?: boolean
  /** Remembered misses. Default `<DATA_DIR or .data>/google-linker-state.json`; null disables. */
  statePath?: string | null
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Pause between requests. Default 100 ms. */
  delayMs?: number
  log?: (line: string) => void
}

export interface LinkResult {
  linked: number
  /** Venues not looked up (remembered misses). */
  skipped: number
  /** Looked up, no confident match. */
  missed: number
  failed: number
  /** True when there was no API key, so nothing ran. */
  disabled: boolean
  /** Set when a quota or key error stopped the run. */
  stoppedReason: string | null
}

/** Word-overlap similarity of two names (0..1), ignoring case, accents and punctuation. */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  const stop = new Set(['the', 'and', 'escape', 'escapes', 'room', 'rooms', 'game', 'games', 'co', 'inc', 'ltd', 'llc'])
  const words = (s: string) => new Set(s.split(' ').filter((w) => w && !stop.has(w)))
  const wa = words(na)
  const wb = words(nb)
  if (!wa.size || !wb.size) return 0
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  return common / Math.min(wa.size, wb.size)
}

/** The best candidate that matches the venue by name (and by distance when both have coordinates), or null. */
export function pickMatch(venue: VenueForLink, candidates: PlaceCandidate[]): PlaceCandidate | null {
  let best: { c: PlaceCandidate; score: number } | null = null
  for (const c of candidates) {
    if (!c?.id) continue
    const name = c.displayName?.text ?? ''
    const sim = Math.max(nameSimilarity(venue.name, name), venue.brand ? nameSimilarity(venue.brand, name) : 0)
    if (sim < 0.6) continue
    const lat = c.location?.latitude
    const lng = c.location?.longitude
    if (venue.lat !== null && venue.lng !== null) {
      if (typeof lat !== 'number' || typeof lng !== 'number') continue
      if (haversineKm(venue.lat, venue.lng, lat, lng) > MAX_MATCH_KM) continue
    }
    if (!best || sim > best.score) best = { c, score: sim }
  }
  return best?.c ?? null
}

export function searchRequest(v: VenueForLink): Record<string, unknown> {
  const textQuery = [v.name, v.address, v.city, v.region].filter(Boolean).join(', ')
  return {
    textQuery,
    pageSize: 5,
    ...(v.country && v.country !== 'ZZ' ? { regionCode: v.country } : {}),
    ...(v.lat !== null && v.lng !== null ? { locationBias: { circle: { center: { latitude: v.lat, longitude: v.lng }, radius: 500 } } } : {}),
  }
}

interface State {
  misses: Record<string, string>
}

function readState(file: string | null): State {
  if (!file || !existsSync(file)) return { misses: {} }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>
    return { misses: s.misses && typeof s.misses === 'object' ? s.misses : {} }
  } catch {
    return { misses: {} }
  }
}

function writeState(file: string | null, s: State) {
  if (!file) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}

class StopError extends Error {}

async function search(v: VenueForLink, apiKey: string, fetchImpl: typeof fetch): Promise<PlaceCandidate[]> {
  const res = await fetchImpl(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(searchRequest(v)),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    // The body can echo request details; report only the status.
    throw new StopError(`Places API answered ${res.status} (${res.status === 429 ? 'quota exceeded' : 'key rejected or API not enabled'})`)
  }
  if (!res.ok) throw new Error(`Places API answered ${res.status}`)
  const body = (await res.json()) as { places?: PlaceCandidate[] }
  return Array.isArray(body.places) ? body.places : []
}

export async function linkGooglePlaceIds(db: Db, opts: LinkOptions = {}): Promise<LinkResult> {
  const log = opts.log ?? (() => {})
  const result: LinkResult = { linked: 0, skipped: 0, missed: 0, failed: 0, disabled: false, stoppedReason: null }
  const apiKey = opts.apiKey ?? process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    log('GOOGLE_MAPS_API_KEY is not set: nothing to do.')
    return { ...result, disabled: true }
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())
  const limit = Math.max(0, opts.limit ?? 100)
  const statePath = opts.statePath === undefined ? path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), '.data')), 'google-linker-state.json') : opts.statePath
  const state = readState(statePath)
  const cutoff = now().getTime() - RETRY_AFTER_DAYS * 24 * 3600 * 1000
  const recentlyMissed = (id: string) => {
    const at = state.misses[id] ? Date.parse(state.misses[id]) : NaN
    return Number.isFinite(at) && at > cutoff
  }

  const where = [isNull(venues.googlePlaceId), eq(venues.status, 'active'), ...(opts.country ? [eq(venues.country, opts.country.toUpperCase())] : [])]
  // Read a little more than the limit so remembered misses don't eat the whole batch.
  const rows = await db
    .select({ id: venues.id, name: venues.name, brand: venues.brand, address: venues.address, city: venues.city, region: venues.region, country: venues.country, lat: venues.lat, lng: venues.lng })
    .from(venues)
    .where(and(...where))
    .orderBy(asc(venues.createdAt), asc(venues.id))
    .limit(limit + Object.keys(state.misses).length)

  let tried = 0
  try {
    for (const v of rows) {
      if (tried >= limit) break
      if (recentlyMissed(v.id)) {
        result.skipped++
        continue
      }
      tried++
      let candidates: PlaceCandidate[]
      try {
        candidates = await search(v, apiKey, fetchImpl)
      } catch (err) {
        if (err instanceof StopError) {
          result.stoppedReason = err.message
          log(`stopping: ${err.message}`)
          break
        }
        result.failed++
        log(`failed: ${v.name} (${v.city}): ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      const match = pickMatch(v, candidates)
      if (!match) {
        result.missed++
        state.misses[v.id] = now().toISOString()
        continue
      }
      // A place id already on another venue means a duplicate venue: leave it to dedupe (8).
      const taken = (await db.select({ id: venues.id }).from(venues).where(eq(venues.googlePlaceId, match.id)).limit(1))[0]
      if (taken) {
        result.missed++
        state.misses[v.id] = now().toISOString()
        log(`duplicate: ${v.name} (${v.city}) matches a place already linked to ${taken.id}`)
        continue
      }
      if (!opts.dryRun) {
        await db.transaction(async (tx) => {
          await tx.update(venues).set({ googlePlaceId: match.id }).where(and(eq(venues.id, v.id), isNull(venues.googlePlaceId)))
          await tx
            .insert(sources)
            .values({ entityType: 'venue', entityId: v.id, source: 'google', sourceId: match.id, license: GOOGLE_LICENSE, attribution: GOOGLE_ATTRIBUTION, fields: { googlePlaceId: match.id } })
            .onConflictDoNothing()
        })
      }
      delete state.misses[v.id]
      result.linked++
      if (opts.delayMs !== 0) await new Promise((r) => setTimeout(r, opts.delayMs ?? 100))
    }
  } finally {
    if (!opts.dryRun) writeState(statePath, state)
  }
  return result
}

/** Venues still without a place id (for the coverage report). */
export async function unlinkedCount(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(venues).where(and(isNull(venues.googlePlaceId), eq(venues.status, 'active')))
  return Number(r?.n ?? 0)
}

async function main() {
  await import('../../../server/env')
  const args = process.argv.slice(2)
  const val = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.log('[google] GOOGLE_MAPS_API_KEY is not set: nothing to do.')
    return
  }
  const { createDb } = await import('../../../server/db/client')
  const { runMigrations } = await import('../../../server/db/migrate')
  const handle = await createDb()
  try {
    await runMigrations(handle, { timeoutMs: 120_000 })
    const r = await linkGooglePlaceIds(handle.db, {
      limit: val('--limit') ? Number(val('--limit')) : undefined,
      country: val('--country'),
      dryRun: args.includes('--dry-run'),
      log: (l) => console.log(`[google] ${l}`),
    })
    console.log(`[google] linked ${r.linked}, no match ${r.missed}, skipped ${r.skipped} (missed recently), failed ${r.failed}. ${await unlinkedCount(handle.db)} venues still unlinked.`)
    if (r.stoppedReason) process.exitCode = 1
  } finally {
    await handle.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
