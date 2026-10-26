/**
 * Normalisation and de-duplication (workstream 8).
 *
 * RawPlace[] (any importer) -> cleaned, merged venues with city and country tags, URL slugs and
 * one source record per contributing place. Two places are the same venue when they are
 * - under ~75 m apart and their names are similar (trigram Dice >= 0.5 after normalising), or
 * - under 300 m apart, share a phone number or website host, and their names are not unrelated
 *   (similarity >= 0.25, or one name looks like a person/company and not an escape room).
 *
 * The result is written as a compact committed seed (seed/directory/<region>.json.gz plus
 * manifest.json) that the server loads into Postgres on deploy (server/routes/directory.seed.ts),
 * or merged straight into a database with `upsertPlaces`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Db } from '../../../server/db/client'
import { citySlug, haversineKm, slugify } from '../../../server/db/util'
import {
  SEED_FORMAT,
  loadSeedRegion,
  type SeedCity,
  type SeedManifest,
  type SeedRegionFile,
  type SeedSource,
  type SeedVenue,
} from '../../../server/routes/directory.seed'
import type { ImportStats, RawPlace, Region } from '../types'

export const DEFAULT_SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'seed', 'directory')

/** Distance under which similar names are the same venue (the plan's ~75 m). */
export const SAME_PLACE_METERS = 75
/** Distance under which a shared phone or website host is enough (with a loose name check). */
export const SAME_CONTACT_METERS = 300
export const NAME_SIMILARITY_MIN = 0.5

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Case/diacritic/punctuation-insensitive name key ("Escape Room SF!" -> "escape room sf"). */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    // NFKD splits Hangul into jamo; put them back together.
    .normalize('NFC')
}

/** Words that say "escape room" and nothing about which one. */
const GENERIC_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'escape', 'escapes', 'room', 'rooms', 'game', 'games', 'llc', 'inc', 'ltd', 'co', 'company',
  'experience', 'experiences', 'adventure', 'adventures', 'live', 'exit', 'puzzle', 'puzzles', 'quest', 'quests', 'challenge',
])

/** The distinctive part of a name ("Escape Room Fayetteville" -> "fayetteville"). */
export function coreName(name: string): string {
  return normaliseName(name)
    .split(' ')
    .filter((w) => w && !GENERIC_WORDS.has(w))
    .join(' ')
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (const word of s.split(' ').filter(Boolean)) {
    const w = `  ${word} `
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3))
  }
  return out
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let common = 0
  for (const t of a) if (b.has(t)) common++
  return (2 * common) / (a.size + b.size)
}

/**
 * 0..1 name similarity: trigram Dice over the distinctive parts of the names when both have one
 * ("Escape Room Fayetteville" vs "Escape Room Raleigh" compares "fayetteville" with "raleigh"),
 * else over the whole normalised names.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ca = coreName(a)
  const cb = coreName(b)
  // "No Way Out" vs "Nowayout Escape Rooms City Walk", "EscapeQuest" vs "Escape Quest Zurich":
  // one name, spaces removed, contains the other (which says more than "escape room").
  const fa = na.replace(/ /g, '')
  const fb = nb.replace(/ /g, '')
  const shorter = fa.length <= fb.length ? { s: fa, l: fb, core: ca } : { s: fb, l: fa, core: cb }
  const contained = Boolean(shorter.core) && shorter.s.length >= 5 && shorter.l.includes(shorter.s) ? 0.8 : 0
  if (!ca || !cb) return Math.max(contained, dice(trigrams(na), trigrams(nb)))
  if (ca === cb) return 1
  let core = dice(trigrams(ca), trigrams(cb))
  // "Breakout Games - Greensboro" vs "Breakout Greensboro": one core contains the other.
  if (core < 0.8 && (ca.includes(cb) || cb.includes(ca)) && Math.min(ca.length, cb.length) >= 4) core = 0.8
  return Math.max(core, contained)
}

const ESCAPE_HINT_RE = /escape|room|puzzle|mystery|breakout|break out|exit|quest|locked|clue|riddle|enigma|trapped|lock|game|escapology|脱出|방탈출|密室/i

/** True for names that look like an escape room business rather than a person or an office. */
export function looksLikeEscapeRoom(name: string): boolean {
  return ESCAPE_HINT_RE.test(name)
}

// ---------------------------------------------------------------------------
// Field cleaning
// ---------------------------------------------------------------------------

const GENERIC_HOSTS = new Set([
  'facebook.com', 'm.facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'google.com', 'sites.google.com', 'goo.gl',
  'linktr.ee', 'yelp.com', 'tripadvisor.com', 'wixsite.com', 'squarespace.com', 'square.site', 'business.site', 'fareharbor.com',
  'bookeo.com', 'resova.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'line.me',
])

/** `http://www.Example.com/x` -> `example.com`; null for missing or generic hosts. */
export function websiteHost(url: string | null): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (GENERIC_HOSTS.has(host) || [...GENERIC_HOSTS].some((g) => host.endsWith(`.${g}`))) return null
    return host
  } catch {
    return null
  }
}

/** Adds `https://` when missing; null when it is not a usable http(s) URL. */
export function cleanWebsite(url: string | null): string | null {
  if (!url) return null
  let s = url.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u.toString().slice(0, 500)
  } catch {
    return null
  }
}

export function phoneDigits(phone: string | null): string | null {
  if (!phone) return null
  const d = phone.replace(/\D+/g, '')
  return d.length >= 7 ? d.slice(-10) : null
}

const dropNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))
const round6 = (n: number | null) => (n == null ? null : Math.round(n * 1e6) / 1e6)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() : s)

/** Cleans one RawPlace and tags its city. City regions (with a bbox) use the region's name. */
export function normalisePlace(p: RawPlace, region?: Region): RawPlace {
  const name = clip(p.name.replace(/\s+/g, ' ').trim(), 160)
  let address = clip(p.address.replace(/\s+/g, ' ').trim(), 300)
  let city = p.city.replace(/\s+/g, ' ').trim()
  if (region?.bbox) {
    // "Shibuya" in Tokyo, "Camden Town" in London: keep it in the address, group under the city.
    if (city && normaliseName(city) !== normaliseName(region.name) && !normaliseName(address).includes(normaliseName(city))) {
      address = address ? `${address}, ${city}` : city
    }
    city = region.name
  }
  // City regions group under one city page ("london-gb"): their state/prefecture strings vary
  // ("Tokyo", "東京都", "Tōkyō-to") and would split it.
  const regionName = region?.bbox ? '' : p.region.replace(/\s+/g, ' ').trim()
  return {
    ...p,
    name,
    brand: p.brand?.trim() || null,
    address,
    city: clip(city, 120),
    region: clip(regionName, 120),
    country: p.country.trim().toUpperCase(),
    postalCode: p.postalCode?.trim().slice(0, 20) || null,
    lat: round6(p.lat),
    lng: round6(p.lng),
    website: cleanWebsite(p.website),
    phone: p.phone?.trim().slice(0, 40) || null,
  }
}

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

export interface MergedVenue {
  /** The best record: its fields win, others only fill gaps. */
  primary: RawPlace
  /** Every contributing record, primary first. */
  members: RawPlace[]
}

const distanceM = (a: RawPlace, b: RawPlace) =>
  a.lat == null || a.lng == null || b.lat == null || b.lng == null ? Infinity : haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000

/** Are these two records the same venue? */
export function isSamePlace(a: RawPlace, b: RawPlace): boolean {
  if (a.country !== b.country) return false
  const d = distanceM(a, b)
  if (d > SAME_CONTACT_METERS) return false
  const sim = nameSimilarity(a.name, b.name)
  if (d <= SAME_PLACE_METERS && sim >= NAME_SIMILARITY_MIN) return true
  const samePhone = phoneDigits(a.phone) != null && phoneDigits(a.phone) === phoneDigits(b.phone)
  const hostA = websiteHost(a.website)
  const sameHost = hostA != null && hostA === websiteHost(b.website)
  if (!samePhone && !sameHost) return false
  if (sim >= 0.25) return true
  // Same phone at the same spot, one name is a person or an office: "George Nicksich" + "Ready Set Escape".
  return d <= SAME_PLACE_METERS && samePhone && looksLikeEscapeRoom(a.name) !== looksLikeEscapeRoom(b.name)
}

/** Field completeness + "looks like an escape room" + freshness: the higher, the better a primary. */
function quality(p: RawPlace): number {
  let q = 0
  if (looksLikeEscapeRoom(p.name)) q += 4
  if (p.address) q += 2
  if (p.website) q += 2
  if (p.phone) q += 1
  if (p.postalCode) q += 0.5
  if (p.city) q += 1
  if (p.lat != null) q += 1
  const refreshed = typeof p.raw.date_refreshed === 'string' ? Date.parse(p.raw.date_refreshed) : NaN
  if (Number.isFinite(refreshed)) q += Math.min(1, Math.max(0, (refreshed - Date.UTC(2016, 0, 1)) / (Date.UTC(2026, 0, 1) - Date.UTC(2016, 0, 1))))
  return q
}

/** Grid cell for neighbour lookups (~330 m tall; width shrinks with latitude, so check 3x3). */
const CELL_DEG = 0.003
const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / (CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))))}`

/**
 * Merges duplicates (union-find over pairs within 300 m). Places without coordinates are merged
 * only with an exact name + city + country match. Output order is stable: by primary source id.
 */
export function dedupePlaces(input: readonly RawPlace[]): MergedVenue[] {
  // The same source record twice (two regions, a re-run): keep the first.
  const seen = new Set<string>()
  const places = input.filter((p) => {
    const k = `${p.source}:${p.sourceId}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const parent = places.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const grid = new Map<string, number[]>()
  const noCoords = new Map<string, number>()
  places.forEach((p, i) => {
    if (p.lat == null || p.lng == null) {
      const k = `${normaliseName(p.name)}|${normaliseName(p.city)}|${p.country}`
      const prev = noCoords.get(k)
      if (prev != null) union(prev, i)
      else noCoords.set(k, i)
      return
    }
    const latCell = Math.floor(p.lat / CELL_DEG)
    const lngCell = Number(cellKey(p.lat, p.lng).split(':')[1])
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${latCell + dy}:${lngCell + dx}`) ?? []) if (isSamePlace(p, places[j])) union(i, j)
      }
    }
    const key = `${latCell}:${lngCell}`
    const list = grid.get(key) ?? []
    list.push(i)
    grid.set(key, list)
  })
  const groups = new Map<number, RawPlace[]>()
  places.forEach((p, i) => {
    const r = find(i)
    const list = groups.get(r) ?? []
    list.push(p)
    groups.set(r, list)
  })
  const merged: MergedVenue[] = []
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => quality(b) - quality(a) || a.sourceId.localeCompare(b.sourceId))
    const best = sorted[0]
    const fill = <K extends keyof RawPlace>(k: K): RawPlace[K] => {
      const v = best[k]
      if (v != null && v !== '') return v
      return sorted.find((m) => m[k] != null && m[k] !== '')?.[k] ?? v
    }
    const primary: RawPlace = {
      ...best,
      address: fill('address'),
      city: fill('city'),
      region: fill('region'),
      postalCode: fill('postalCode'),
      lat: best.lat ?? sorted.find((m) => m.lat != null)?.lat ?? null,
      lng: best.lat != null ? best.lng : (sorted.find((m) => m.lat != null)?.lng ?? null),
      website: fill('website'),
      phone: fill('phone'),
    }
    merged.push({ primary, members: sorted })
  }
  return merged.sort((a, b) => a.primary.sourceId.localeCompare(b.primary.sourceId))
}

/** Venues without a city borrow the nearest tagged venue's city (within 25 km) in the same country. */
export function fillMissingCities(venues: MergedVenue[], fallback: string): void {
  const tagged = venues.filter((v) => v.primary.city && v.primary.lat != null && v.primary.lng != null)
  for (const v of venues) {
    if (v.primary.city) continue
    let best: MergedVenue | null = null
    let bestKm = 25
    if (v.primary.lat != null && v.primary.lng != null) {
      for (const t of tagged) {
        if (t.primary.country !== v.primary.country) continue
        const km = haversineKm(v.primary.lat, v.primary.lng, t.primary.lat!, t.primary.lng!)
        if (km < bestKm) {
          bestKm = km
          best = t
        }
      }
    }
    v.primary = { ...v.primary, city: best?.primary.city ?? fallback, region: v.primary.region || best?.primary.region || '' }
  }
}

/** True when a city name has no Latin letters or digits ("里士满"), so it cannot make a URL slug. */
export function isNonLatinCity(name: string): boolean {
  return !!name.trim() && !/[a-z0-9]/i.test(name.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
}

/**
 * Foursquare sometimes tags a place with the city's name in another script (Richmond, BC as
 * "里士满", Mississauga as "米西索加"). Such a venue takes the city of the nearest Latin-named venue
 * in the same country and region within `maxKm`; otherwise it keeps its name (citySlug then gives
 * it a hashed slug of its own).
 */
export function latinizeCities(venues: MergedVenue[], maxKm = 5): void {
  const latin = venues.filter((v) => v.primary.city && !isNonLatinCity(v.primary.city) && v.primary.lat != null && v.primary.lng != null)
  for (const v of venues) {
    const p = v.primary
    if (!isNonLatinCity(p.city) || p.lat == null || p.lng == null) continue
    let best: MergedVenue | null = null
    let bestKm = maxKm
    for (const t of latin) {
      if (t.primary.country !== p.country || t.primary.region !== p.region) continue
      const km = haversineKm(p.lat, p.lng, t.primary.lat!, t.primary.lng!)
      if (km < bestKm) {
        bestKm = km
        best = t
      }
    }
    if (best) v.primary = { ...p, city: best.primary.city }
  }
}

/**
 * Chains: a website host shared by venues in at least 3 cities names the brand (the shortest
 * venue name among them, e.g. "Escapology"). Hosts used in one city only are not brands.
 */
export function tagBrands(venues: MergedVenue[]): void {
  const byHost = new Map<string, MergedVenue[]>()
  for (const v of venues) {
    const h = websiteHost(v.primary.website)
    if (!h) continue
    const list = byHost.get(h) ?? []
    list.push(v)
    byHost.set(h, list)
  }
  for (const list of byHost.values()) {
    const cities = new Set(list.map((v) => `${normaliseName(v.primary.city)}|${v.primary.country}`))
    if (cities.size < 3) continue
    const names = list.map((v) => v.primary.name.replace(/\s*[-–|:(].*$/, '').trim()).filter((n) => n.length >= 3 && n.length <= 40)
    if (!names.length) continue
    const counts = new Map<string, number>()
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
    const brand = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
    for (const v of list) if (!v.primary.brand) v.primary = { ...v.primary, brand }
  }
}

// ---------------------------------------------------------------------------
// Slugs and seeds
// ---------------------------------------------------------------------------

/** `starlight-escapes-san-francisco`; names in other scripts fall back to `escape-room-<city>-<id>`. */
export function venueSlugBase(p: Pick<RawPlace, 'name' | 'city' | 'sourceId'>): string {
  const name = slugify(p.name, 60)
  const city = slugify(p.city, 40)
  if (name === 'item') return slugify(`escape room ${city === 'item' ? '' : city} ${p.sourceId.slice(-6)}`, 100)
  const nameHasCity = city !== 'item' && name.includes(city)
  return slugify(nameHasCity || city === 'item' ? name : `${name} ${city}`, 100)
}

/** Assigns unique slugs (in order), skipping `taken`. Mutates and returns `taken`. */
export function assignSlugs(bases: string[], taken: Set<string> = new Set()): string[] {
  return bases.map((base) => {
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    taken.add(slug)
    return slug
  })
}

export interface RegionSeed {
  file: SeedRegionFile
  /** Records read, merged into another record, and dropped (outside the region's country). */
  stats: { read: number; merged: number; dropped: number }
}

/** RawPlaces of one region -> its seed file (slugs unique against `takenSlugs`). */
export function buildRegionSeed(region: Region, raw: readonly RawPlace[], takenSlugs: Set<string> = new Set(), generatedAt = new Date().toISOString()): RegionSeed {
  const cleaned = raw.map((p) => normalisePlace(p, region)).filter((p) => p.country === region.country)
  const merged = dedupePlaces(cleaned)
  fillMissingCities(merged, region.bbox ? region.name : 'Unknown')
  latinizeCities(merged)
  tagBrands(merged)
  const slugs = assignSlugs(merged.map((m) => venueSlugBase(m.primary)), takenSlugs)
  const cities = new Map<string, SeedCity & { n: number; latSum: number; lngSum: number }>()
  const venues: SeedVenue[] = merged.map((m, i) => {
    const p = m.primary
    const cSlug = citySlug(p.city, p.region, p.country)
    const c = cities.get(cSlug) ?? { slug: cSlug, name: p.city, region: p.region, country: p.country, lat: null, lng: null, n: 0, latSum: 0, lngSum: 0 }
    if (p.lat != null && p.lng != null) {
      c.n++
      c.latSum += p.lat
      c.lngSum += p.lng
    }
    cities.set(cSlug, c)
    // The primary record's fields are the venue's (after gap filling); others keep what they said.
    const src: SeedSource[] = m.members.map((x, j) => {
      const y = j === 0 ? p : x
      const fields: Record<string, unknown> = {
        name: y.name,
        address: y.address,
        city: y.city,
        region: y.region,
        postcode: y.postalCode,
        lat: y.lat,
        lng: y.lng,
        website: y.website,
        tel: y.phone,
        ...(typeof x.raw.date_refreshed === 'string' ? { date_refreshed: x.raw.date_refreshed } : {}),
      }
      return { id: x.sourceId, fields: j === 0 ? fields : dropNulls(fields) }
    })
    return {
      slug: slugs[i],
      name: p.name,
      brand: p.brand,
      address: p.address,
      city: p.city,
      citySlug: cSlug,
      region: p.region,
      country: p.country,
      postalCode: p.postalCode,
      lat: p.lat,
      lng: p.lng,
      website: p.website,
      phone: p.phone,
      fsqId: m.primary.sourceId,
      src,
    }
  })
  const cityList: SeedCity[] = [...cities.values()]
    .map(({ n, latSum, lngSum, ...c }) => ({ ...c, lat: n ? round6(latSum / n) : null, lng: n ? round6(lngSum / n) : null }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
  return {
    file: {
      format: SEED_FORMAT,
      region: { id: region.id, name: region.name, country: region.country, ...(region.bbox ? { bbox: region.bbox } : {}) },
      source: 'foursquare',
      license: 'Apache-2.0',
      attribution: 'Foursquare Open Source Places',
      generatedAt,
      cities: cityList,
      venues,
    },
    stats: { read: raw.length, merged: cleaned.length - venues.length, dropped: raw.length - cleaned.length },
  }
}

/** Every region in import order, with slugs unique across regions. */
export function buildSeeds(regions: readonly Region[], byRegion: Map<string, RawPlace[]>, opts: { takenSlugs?: Set<string> } = {}): RegionSeed[] {
  const taken = opts.takenSlugs ?? new Set<string>()
  const generatedAt = new Date().toISOString()
  return regions.filter((r) => byRegion.has(r.id)).map((r) => buildRegionSeed(r, byRegion.get(r.id) ?? [], taken, generatedAt))
}

/** Seeds serialise as compact arrays; see server/routes/directory.seed.ts for the reader. */
export function encodeSeed(file: SeedRegionFile): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(compactSeed(file))), { level: 9 })
}

const VENUE_KEYS = ['slug', 'name', 'brand', 'address', 'city', 'citySlug', 'region', 'country', 'postalCode', 'lat', 'lng', 'website', 'phone', 'fsqId'] as const
const SOURCE_FIELD_KEYS = ['name', 'address', 'city', 'region', 'postcode', 'lat', 'lng', 'website', 'tel', 'date_refreshed'] as const

/** Column-oriented layout: about 3x smaller than plain objects before gzip. */
export function compactSeed(file: SeedRegionFile) {
  return {
    ...file,
    cities: file.cities.map((c) => [c.slug, c.name, c.region, c.country, c.lat, c.lng]),
    venueKeys: VENUE_KEYS,
    sourceKeys: ['id', ...SOURCE_FIELD_KEYS],
    venues: file.venues.map((v) => [
      ...VENUE_KEYS.map((k) => v[k]),
      // Sources: the primary's fields equal the venue's, so store only its id and date.
      v.src.map((s, i) => (i === 0 && s.id === v.fsqId ? [s.id, s.fields.date_refreshed ?? null] : [s.id, ...SOURCE_FIELD_KEYS.map((k) => s.fields[k] ?? null)])),
    ]),
  }
}

export function sha16(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

/**
 * Writes `<region>.json.gz` files and `manifest.json`. With `merge`, regions not in `seeds` keep
 * their existing files and manifest rows (single-region re-runs).
 */
export function writeSeeds(dir: string, seeds: RegionSeed[], opts: { merge?: boolean } = {}): SeedManifest {
  mkdirSync(dir, { recursive: true })
  const manifestPath = path.join(dir, 'manifest.json')
  const previous: SeedManifest | null = opts.merge && existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as SeedManifest) : null
  const rows = new Map((previous?.regions ?? []).map((r) => [r.id, r]))
  for (const s of seeds) {
    const buf = encodeSeed(s.file)
    const file = `${s.file.region.id}.json.gz`
    writeFileSync(path.join(dir, file), buf)
    rows.set(s.file.region.id, {
      id: s.file.region.id,
      name: s.file.region.name,
      country: s.file.region.country,
      file,
      sha: sha16(buf),
      venues: s.file.venues.length,
      cities: s.file.cities.length,
      read: s.stats.read,
      merged: s.stats.merged,
      bytes: buf.length,
    })
  }
  if (!opts.merge) {
    // A full run owns the folder: drop region files that are no longer produced.
    const keep = new Set([...rows.values()].map((r) => r.file))
    for (const f of readdirSync(dir)) if (f.endsWith('.json.gz') && !keep.has(f)) unlinkSync(path.join(dir, f))
  }
  const ordered = [...rows.values()]
  const manifest: SeedManifest = {
    format: SEED_FORMAT,
    version: sha16(ordered.map((r) => `${r.id}:${r.sha}`).join('|')),
    generatedAt: new Date().toISOString(),
    source: 'foursquare',
    license: 'Apache-2.0',
    attribution: 'Foursquare Open Source Places',
    release: previous?.release ?? 'fsq-os-places 2025-02-06',
    regions: ordered,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Slugs already used by the committed seed files (for single-region re-runs). */
export function seedSlugs(dir: string, except: Set<string> = new Set()): Set<string> {
  const out = new Set<string>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json.gz') || except.has(f.replace(/\.json\.gz$/, ''))) continue
    const data = JSON.parse(gunzipSync(readFileSync(path.join(dir, f))).toString('utf8')) as { venues: unknown[][] }
    for (const v of data.venues) out.add(String(v[0]))
  }
  return out
}

/**
 * Merges places straight into a database (incremental runs, other importers). Same merge rules
 * and the same writer as the seed loader, so an import and a deploy agree.
 */
export async function upsertPlaces(db: Db, region: Region, places: AsyncIterable<RawPlace> | RawPlace[]): Promise<ImportStats> {
  const list: RawPlace[] = []
  for await (const p of places) list.push(p)
  const seed = buildRegionSeed(region, list)
  const r = await loadSeedRegion(db, seed.file)
  return { region: region.id, source: list[0]?.source ?? 'foursquare', read: list.length, inserted: r.inserted, merged: seed.stats.merged + r.updated, skipped: seed.stats.dropped }
}
