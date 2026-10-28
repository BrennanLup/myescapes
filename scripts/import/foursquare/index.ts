/**
 * Foursquare Open Source Places importer (workstream 6). Data licence: Apache-2.0.
 *
 * Streams the FSQ OS Places Parquet files over HTTP range requests (hyparquet), reading only the
 * small category column of each row group first, and the place columns only for row groups that
 * hold an escape room. Row groups are skipped from their footer statistics (country and lat/lng),
 * so a city region touches a handful of row groups and a country region never reads the others.
 *
 * Sources (pick with --base or FSQ_BASE_URL):
 * - default: the Fused mirror of the official release on Source Cooperative (public S3, no key):
 *   `fused/fsq-os-places/<release>/places/*.parquet`, same columns as the official files.
 * - the official Hugging Face dataset `foursquare/fsq-os-places` (gated: needs HF_TOKEN and
 *   access accepted on huggingface.co): `--base hf` . Its large files redirect to an HF CDN host.
 *
 * Run (Node's fetch needs NODE_USE_ENV_PROXY=1 behind an HTTPS proxy):
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --all
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --region us,ca
 * Results per Parquet file are cached under .data/import-cache/foursquare/<release>/, so an
 * interrupted run resumes where it stopped. It then de-duplicates and writes
 * seed/directory/<region>.json.gz + manifest.json (see scripts/import/dedupe).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COUNTRY_CODES, COUNTRY_NAMES } from '../countries'
import type { RawPlace, Region } from '../types'
import { REGIONS } from '../types'

export const FOURSQUARE_LICENSE = 'Apache-2.0'
export const FOURSQUARE_ATTRIBUTION = 'Foursquare Open Source Places'

/** "Arts and Entertainment > Escape Room". */
export const ESCAPE_ROOM_CATEGORY_IDS = new Set(['5f2c2834b6d05514c704451e'])
const ESCAPE_LABEL_RE = /(^|>\s*)escape rooms?\s*$/i

export const FSQ_RELEASE = '2025-02-06'
export const FSQ_SOURCE_COOP_BASE = `https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/fused/fsq-os-places/${FSQ_RELEASE}/places`
export const FSQ_HF_DATASET = 'foursquare/fsq-os-places'

/**
 * City regions beyond the shared list: more big escape-room cities. Bboxes are
 * [south, west, north, east].
 */
export const FSQ_CITY_REGIONS: Region[] = [
  { id: 'gb-manchester', name: 'Manchester', country: 'GB', bbox: [53.34, -2.42, 53.58, -2.08] },
  { id: 'ie-dublin', name: 'Dublin', country: 'IE', bbox: [53.22, -6.45, 53.45, -6.04] },
  { id: 'pt-lisbon', name: 'Lisbon', country: 'PT', bbox: [38.68, -9.25, 38.81, -9.09] },
  { id: 'be-brussels', name: 'Brussels', country: 'BE', bbox: [50.76, 4.24, 50.92, 4.49] },
  { id: 'de-munich', name: 'Munich', country: 'DE', bbox: [48.06, 11.36, 48.25, 11.72] },
  { id: 'de-hamburg', name: 'Hamburg', country: 'DE', bbox: [53.39, 9.73, 53.74, 10.33] },
  { id: 'at-vienna', name: 'Vienna', country: 'AT', bbox: [48.12, 16.18, 48.33, 16.58] },
  { id: 'ch-zurich', name: 'Zurich', country: 'CH', bbox: [47.32, 8.45, 47.44, 8.63] },
  { id: 'cz-prague', name: 'Prague', country: 'CZ', bbox: [49.94, 14.22, 50.18, 14.71] },
  { id: 'pl-warsaw', name: 'Warsaw', country: 'PL', bbox: [52.1, 20.85, 52.37, 21.27] },
  { id: 'hu-budapest', name: 'Budapest', country: 'HU', bbox: [47.35, 18.92, 47.62, 19.34] },
  { id: 'dk-copenhagen', name: 'Copenhagen', country: 'DK', bbox: [55.6, 12.45, 55.73, 12.65] },
  { id: 'se-stockholm', name: 'Stockholm', country: 'SE', bbox: [59.24, 17.85, 59.43, 18.2] },
  { id: 'it-milan', name: 'Milan', country: 'IT', bbox: [45.39, 9.04, 45.54, 9.28] },
  { id: 'gr-athens', name: 'Athens', country: 'GR', bbox: [37.88, 23.62, 38.08, 23.87] },
  { id: 'tr-istanbul', name: 'Istanbul', country: 'TR', bbox: [40.8, 28.6, 41.25, 29.4] },
  { id: 'jp-osaka', name: 'Osaka', country: 'JP', bbox: [34.55, 135.37, 34.78, 135.6] },
  { id: 'tw-taipei', name: 'Taipei', country: 'TW', bbox: [24.96, 121.45, 25.21, 121.67] },
  { id: 'th-bangkok', name: 'Bangkok', country: 'TH', bbox: [13.5, 100.33, 13.96, 100.94] },
  { id: 'my-kuala-lumpur', name: 'Kuala Lumpur', country: 'MY', bbox: [2.9, 101.5, 3.3, 101.8] },
  { id: 'ph-manila', name: 'Manila', country: 'PH', bbox: [14.35, 120.9, 14.8, 121.15] },
  { id: 'id-jakarta', name: 'Jakarta', country: 'ID', bbox: [-6.4, 106.65, -6.08, 107.0] },
  { id: 'ae-dubai', name: 'Dubai', country: 'AE', bbox: [24.9, 54.9, 25.4, 55.6] },
  { id: 'au-brisbane', name: 'Brisbane', country: 'AU', bbox: [-27.7, 152.8, -27.2, 153.25] },
  { id: 'au-perth', name: 'Perth', country: 'AU', bbox: [-32.3, 115.7, -31.7, 116.1] },
  { id: 'au-adelaide', name: 'Adelaide', country: 'AU', bbox: [-35.15, 138.45, -34.7, 138.8] },
  { id: 'nz-auckland', name: 'Auckland', country: 'NZ', bbox: [-37.1, 174.6, -36.7, 175.0] },
]

/** A whole-country region: id is the lowercase ISO code (`gb`, `de`), so `us` and `ca` keep theirs. */
export function countryRegion(country: string): Region {
  return { id: country.toLowerCase(), name: COUNTRY_NAMES[country] ?? country, country, unifyCities: true }
}

/**
 * Every country without a whole-country region yet (all but the US and Canada), in code order.
 * A place in a city region's bbox stays in the city region (see `regionForPlace`); the rest of
 * the country lands here, so every escape room worldwide has a region. Countries with no escape
 * rooms produce no file.
 */
export const FSQ_COUNTRY_REGIONS: Region[] = COUNTRY_CODES.filter((cc) => !REGIONS.some((r) => r.country === cc && !r.bbox)).map(countryRegion)

/**
 * Regions this importer covers, in seed order: the shared list (US, Canada, then major cities in
 * Europe, Asia and Australia), more big cities, then every other country. New regions go at the
 * end so existing ones keep their order (and their venues' slugs).
 */
export const FSQ_REGIONS: Region[] = [...REGIONS, ...FSQ_CITY_REGIONS, ...FSQ_COUNTRY_REGIONS]

/** The Parquet columns the importer reads for a matching row group. */
export const PLACE_COLUMNS = [
  'fsq_place_id', 'name', 'latitude', 'longitude', 'address', 'locality', 'post_town', 'region', 'admin_region',
  'postcode', 'country', 'tel', 'website', 'date_closed', 'date_refreshed',
] as const
export const CATEGORY_COLUMN = 'fsq_category_ids'
export const CATEGORY_LABEL_COLUMN = 'fsq_category_labels'
/** Bump when the matching rules change, so cached per-file results are re-read. */
export const SCAN_RULES_VERSION = 4

export type FsqRow = Partial<Record<(typeof PLACE_COLUMNS)[number], unknown>> & {
  fsq_category_ids?: unknown
  fsq_category_labels?: unknown
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export function isEscapeRoom(ids: unknown, labels?: unknown): boolean {
  if (Array.isArray(ids) && ids.some((id) => typeof id === 'string' && ESCAPE_ROOM_CATEGORY_IDS.has(id))) return true
  if (Array.isArray(labels) && labels.some((l) => typeof l === 'string' && ESCAPE_LABEL_RE.test(l))) return true
  return false
}

/**
 * Many escape rooms sit in older or broader categories ("Entertainment Service", "Arcade", no
 * category at all). A name that says so ("... Escape Room", "Escape Game ...", "방탈출", "脱出ゲーム",
 * "Evden Kaçış Oyunu", "Szabadulószoba", "Úniková hra", "Pokój zagadek", "חדר בריחה") counts
 * too, unless its categories say it is something else (a bar, a hotel, a shop...).
 */
export const ESCAPE_NAME_RE =
  /\b(escape[\s-]?rooms?|escape[\s-]?games?|room[\s-]?escapes?|escapology|escape[\s-]?hunt|exit[\s-]?games?|puzzle[\s-]?rooms?|breakout[\s-]?games|mystery[\s-]?rooms?|all in adventures|escape[\s-]?(house|zone|quest|rush|experience|experiences|adventures?|challenge|mansion|factory|artist|the room)|salle d'?[eé]vasion|escape[\s-]?(salle|spiel)|fluchtspiel|raum[\s-]?flucht|salas? de escape|quest[\s-]?rooms?)\b|fluchtr[aä]um|r[aä]tselr[aä]um|ka[çc][ıi][şs] oyun|szabadul[oó]s[\s-]?(szoba|j[aá]t[eé]k)|szabadul[oó]szob|kijut[oó]s j[aá]t[eé]k|[uú]nikov[aá] (hra|m[ií]stnost)|[uú]nikovk|pok[oó]j zagad|חדר בריחה|эскейп[\s-]?рум|방탈출|脱出ゲーム|リアル脱出|謎解き|密室逃[脱脫]|密室|實境解謎|实景解谜/i

/**
 * Names that usually mean an escape room but are also used for other things: Russian/Ukrainian
 * "Квест" (also any quiz or city game), "Exit Room" and "Locked Room" (also meeting rooms),
 * "Live Escape", "Real Escape", "Enigma Room", Japanese "脱出" alone. These count only with an
 * entertainment category (or, for "Квест ...", with no category at all).
 */
export const WEAK_ESCAPE_NAME_RE =
  /(?<![\p{L}\p{N}])(квест(ы|ов|а|ам|ами|ах)?(?!\p{L})|exit[\s-]?rooms?|exit the room|locked[\s-]?rooms?|live[\s-]?escape|real[\s-]?escape|enigma[\s-]?rooms?)|脱出/iu
/**
 * The weak names that may also count with no category at all: "Квест ..." (Russian listings
 * often have none), but not a bare "КВЕСТ" (usually a company of that name).
 */
const WEAK_UNCATEGORISED_RE = /(?<![\p{L}\p{N}])квест(ы|ов|а|ам|ами|ах)?(?!\p{L})/iu

/** Categories that rule out a name match ("Great Escape Pub", "Escape Room Supplies Store"). */
export const NOT_ESCAPE_LABEL_RE =
  /^(Dining and Drinking|Retail|Travel and Transportation|Health and Medicine|Landmarks and Outdoors|Sports and Recreation > (Gym|Golf)|Business and Professional Services > (Real Estate|Health|Automotive|Financial|Legal)|Arts and Entertainment > (Movie Theater|Museum|Performing Arts Venue|Strip Club|Night ?club|Zoo)|Community and Government > Residential Building)/i

/** Categories a weak name match needs (one of them). */
export const ENTERTAINMENT_LABEL_RE =
  /^(Arts and Entertainment|Sports and Recreation|Event|Business and Professional Services > (Entertainment Service|Event Space|Event Service))/i

/** "strong": the name alone says escape room; "weak": only with fitting categories; null: no. */
export function escapeNameMatch(name: unknown): 'strong' | 'weak' | null {
  if (typeof name !== 'string') return null
  if (ESCAPE_NAME_RE.test(name)) return 'strong'
  return WEAK_ESCAPE_NAME_RE.test(name) ? 'weak' : null
}

export function nameLooksLikeEscapeRoom(name: unknown): boolean {
  return escapeNameMatch(name) != null
}

/**
 * A name match is kept unless every category it has is one that rules it out. A weak name
 * match (pass the name) needs an entertainment category instead, or for "Квест ..." none.
 */
export function categoriesAllowNameMatch(labels: unknown, name?: unknown): boolean {
  const list = Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string') : []
  if (typeof name === 'string' && escapeNameMatch(name) === 'weak') {
    if (list.length) return list.some((l) => ENTERTAINMENT_LABEL_RE.test(l))
    return WEAK_UNCATEGORISED_RE.test(name) && !/^\P{L}*квест\P{L}*$/iu.test(name)
  }
  if (!list.length) return true
  return !list.every((l) => NOT_ESCAPE_LABEL_RE.test(l))
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** One Parquet row -> RawPlace, or null when it is unusable (no id/name/country, or closed). */
export function rowToRawPlace(row: FsqRow): RawPlace | null {
  const sourceId = str(row.fsq_place_id)
  const name = str(row.name)
  const country = str(row.country)?.toUpperCase() ?? null
  if (!sourceId || !name || !country || !/^[A-Z]{2}$/.test(country)) return null
  if (str(row.date_closed)) return null
  const lat = num(row.latitude)
  const lng = num(row.longitude)
  const raw: Record<string, unknown> = {}
  for (const k of PLACE_COLUMNS) if (row[k] != null && k !== 'date_closed') raw[k] = row[k]
  return {
    source: 'foursquare',
    sourceId,
    name,
    brand: null,
    address: str(row.address) ?? '',
    city: str(row.locality) ?? str(row.post_town) ?? '',
    region: str(row.region) ?? str(row.admin_region) ?? '',
    country,
    postalCode: str(row.postcode),
    lat: lat != null && Math.abs(lat) <= 90 ? lat : null,
    lng: lng != null && Math.abs(lng) <= 180 ? lng : null,
    website: str(row.website),
    phone: str(row.tel),
    license: FOURSQUARE_LICENSE,
    attribution: FOURSQUARE_ATTRIBUTION,
    raw,
  }
}

export function inBbox(lat: number | null, lng: number | null, bbox: [number, number, number, number]): boolean {
  if (lat == null || lng == null) return false
  const [s, w, n, e] = bbox
  return lat >= s && lat <= n && lng >= w && lng <= e
}

/**
 * The region a place belongs to: the first city region of its country whose bbox holds it, else
 * its country's whole-country region, else null.
 */
export function regionForPlace(p: Pick<RawPlace, 'country' | 'lat' | 'lng'>, regions: readonly Region[]): Region | null {
  let country: Region | null = null
  for (const r of regions) {
    if (r.country !== p.country) continue
    if (!r.bbox) country ??= r
    else if (inBbox(p.lat, p.lng, r.bbox)) return r
  }
  return country
}

export interface RowGroupStats {
  rowStart: number
  rowEnd: number
  countryMin?: string
  countryMax?: string
  latMin?: number
  latMax?: number
  lngMin?: number
  lngMax?: number
}

/** False only when the footer statistics prove no row of the group can be in any region. */
export function rowGroupMayMatch(rg: RowGroupStats, regions: readonly Region[]): boolean {
  return regions.some((r) => {
    if (rg.countryMin != null && rg.countryMax != null && (r.country < rg.countryMin || r.country > rg.countryMax)) return false
    if (r.bbox && rg.latMin != null && rg.latMax != null && rg.lngMin != null && rg.lngMax != null) {
      const [s, w, n, e] = r.bbox
      if (rg.latMax < s || rg.latMin > n || rg.lngMax < w || rg.lngMin > e) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** What the scanner needs from a Parquet file. The real one is HTTP + hyparquet; tests fake it. */
export interface ParquetFileReader {
  rowGroups: RowGroupStats[]
  read(columns: readonly string[], rowStart: number, rowEnd: number): Promise<Record<string, unknown>[]>
}

export interface ParquetSource {
  listFiles(): Promise<string[]>
  open(file: string): Promise<ParquetFileReader>
}

export interface ScanHit {
  regionId: string
  place: RawPlace
}

export interface ScanProgress {
  file: string
  fileIndex: number
  fileCount: number
  rowGroupsRead: number
  rowGroupsSkipped: number
  hits: number
  cached: boolean
}

export interface ScanOptions extends ScanFileOptions {
  /** Per-file results cache folder (resumable runs). */
  cacheDir?: string
  onProgress?(p: ScanProgress): void
  /** Only scan the first N files (smoke runs). */
  maxFiles?: number
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export interface ScanFileOptions {
  /** Row groups read in parallel within a file (default 4). */
  concurrency?: number
  /**
   * Regions a place is assigned with (default `regions`). With the full list, a run for `gb`
   * alone still leaves London's venues to `gb-london`: places are assigned against every region
   * and only those landing in `regions` are kept.
   */
  classifyWith?: readonly Region[]
  /** Called for an escape room that no region takes (a country code with no region). */
  onUnassigned?(place: RawPlace): void
}

/** Escape rooms of one Parquet file, tagged with their region. */
export async function scanFile(reader: ParquetFileReader, regions: readonly Region[], opts: ScanFileOptions = {}): Promise<{ hits: ScanHit[]; read: number; skipped: number }> {
  const wanted = new Set(regions.map((r) => r.id))
  const classifyWith = opts.classifyWith ?? regions
  const groups = reader.rowGroups.filter((rg) => rowGroupMayMatch(rg, regions))
  const perGroup = await mapLimit(groups, opts.concurrency ?? 4, async (rg) => {
    const cats = await reader.read([CATEGORY_COLUMN, 'name'], rg.rowStart, rg.rowEnd)
    const matches: number[] = []
    const byName = new Set<number>()
    cats.forEach((r, i) => {
      if (isEscapeRoom(r[CATEGORY_COLUMN])) matches.push(i)
      else if (nameLooksLikeEscapeRoom(r.name)) {
        matches.push(i)
        byName.add(i)
      }
    })
    if (!matches.length) return []
    // Read the place columns once for the span holding the matches.
    const first = matches[0]
    const last = matches[matches.length - 1]
    const rows = await reader.read(byName.size ? [...PLACE_COLUMNS, CATEGORY_LABEL_COLUMN] : PLACE_COLUMNS, rg.rowStart + first, rg.rowStart + last + 1)
    const hits: ScanHit[] = []
    for (const i of matches) {
      const row = rows[i - first] as FsqRow
      if (byName.has(i) && !categoriesAllowNameMatch(row[CATEGORY_LABEL_COLUMN], row.name)) continue
      const place = rowToRawPlace(row)
      if (!place) continue
      if (byName.has(i)) place.raw.matched_by = 'name'
      const region = regionForPlace(place, classifyWith)
      if (!region) opts.onUnassigned?.(place)
      else if (wanted.has(region.id)) hits.push({ regionId: region.id, place })
    }
    return hits
  })
  return { hits: perGroup.flat(), read: groups.length, skipped: reader.rowGroups.length - groups.length }
}

/** Streams every escape room in `regions` from all files of `source`. Resumable with `cacheDir`. */
export async function* scanFoursquare(source: ParquetSource, regions: readonly Region[], opts: ScanOptions = {}): AsyncGenerator<ScanHit> {
  let files = await source.listFiles()
  if (opts.maxFiles != null) files = files.slice(0, opts.maxFiles)
  const ids = (rs: readonly Region[]) => rs.map((r) => r.id).sort().join(',')
  const regionKey = `v${SCAN_RULES_VERSION}:${ids(regions)}${opts.classifyWith ? `|${ids(opts.classifyWith)}` : ''}`
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]
    const cacheFile = opts.cacheDir ? path.join(opts.cacheDir, `${file.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`) : null
    let hits: ScanHit[] | null = null
    let cached = false
    let read = 0
    let skipped = 0
    if (cacheFile && existsSync(cacheFile)) {
      try {
        const c = JSON.parse(readFileSync(cacheFile, 'utf8')) as { regions: string; hits: ScanHit[] }
        if (c.regions === regionKey) {
          hits = c.hits
          cached = true
        }
      } catch {
        hits = null
      }
    }
    if (!hits) {
      const reader = await source.open(file)
      const r = await scanFile(reader, regions, opts)
      hits = r.hits
      read = r.read
      skipped = r.skipped
      if (cacheFile) {
        mkdirSync(path.dirname(cacheFile), { recursive: true })
        writeFileSync(cacheFile, JSON.stringify({ regions: regionKey, hits }))
      }
    }
    opts.onProgress?.({ file, fileIndex: fi, fileCount: files.length, rowGroupsRead: read, rowGroupsSkipped: skipped, hits: hits.length, cached })
    yield* hits
  }
}

// ---------------------------------------------------------------------------
// HTTP + hyparquet source
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch

/** fetch with retries on network errors and 5xx/429 (S3 and HF both throttle now and then). */
export function retryingFetch(base: FetchLike = fetch, attempts = 5): FetchLike {
  return (async (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await base(input, init)
        if (res.status < 500 && res.status !== 429) return res
        lastErr = new Error(`HTTP ${res.status}`)
      } catch (err) {
        lastErr = err
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** i))
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }) as FetchLike
}

const toNum = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined)
const toStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export interface HttpSourceOptions {
  /** Folder URL holding `*.parquet`, an S3 bucket path (default: Source Cooperative), or `hf`. */
  base?: string
  /** Hugging Face token for the gated official dataset. Never logged. */
  hfToken?: string
  fetch?: FetchLike
}

/** S3 ListObjectsV2 over a path-style bucket URL, e.g. https://s3.<region>.amazonaws.com/<bucket>/<prefix>. */
async function listS3(base: string, f: FetchLike): Promise<string[]> {
  const u = new URL(base)
  const [, bucket, ...rest] = u.pathname.split('/')
  const prefix = rest.join('/').replace(/\/?$/, '/')
  const keys: string[] = []
  let token: string | null = null
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix })
    if (token) q.set('continuation-token', token)
    const res = await f(`${u.origin}/${bucket}?${q}`)
    if (!res.ok) throw new Error(`listing ${u.origin}/${bucket}/${prefix} failed: HTTP ${res.status}`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) if (m[1].endsWith('.parquet')) keys.push(m[1].slice(prefix.length))
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null
  } while (token)
  // Numeric order (0, 1, 2 ... 80) so progress reads naturally.
  return keys.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b))
}

async function listHf(token: string | undefined, f: FetchLike): Promise<{ files: string[]; root: string }> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const info = (await (await f(`https://huggingface.co/api/datasets/${FSQ_HF_DATASET}`, { headers })).json()) as {
    siblings?: { rfilename: string }[]
    cardData?: { configs?: { config_name: string; data_files: string }[] }
  }
  const pattern = info.cardData?.configs?.find((c) => c.config_name === 'places')?.data_files ?? ''
  const dir = pattern.replace(/\/[^/]*$/, '/')
  const files = (info.siblings ?? []).map((s) => s.rfilename).filter((n) => n.startsWith(dir) && n.endsWith('.parquet'))
  return { files: files.map((n) => n.slice(dir.length)), root: `https://huggingface.co/datasets/${FSQ_HF_DATASET}/resolve/main/${dir}` }
}

export function httpParquetSource(opts: HttpSourceOptions = {}): ParquetSource {
  const f = opts.fetch ?? retryingFetch()
  const base = opts.base ?? FSQ_SOURCE_COOP_BASE
  const isHf = base === 'hf'
  const requestInit = isHf && opts.hfToken ? { headers: { Authorization: `Bearer ${opts.hfToken}` } } : undefined
  let root = base.replace(/\/+$/, '') + '/'
  return {
    async listFiles() {
      if (isHf) {
        const r = await listHf(opts.hfToken, f)
        root = r.root
        return r.files
      }
      return listS3(base, f)
    },
    async open(file) {
      const { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } = await import('hyparquet')
      const { compressors } = await import('hyparquet-compressors')
      const asyncFile = await asyncBufferFromUrl({ url: root + file, requestInit, fetch: f })
      const metadata = await parquetMetadataAsync(asyncFile)
      const rowGroups: RowGroupStats[] = []
      let start = 0
      for (const rg of metadata.row_groups) {
        const n = Number(rg.num_rows)
        const stat = (name: string) => rg.columns.find((c) => c.meta_data?.path_in_schema.join('.') === name)?.meta_data?.statistics
        const country = stat('country')
        const lat = stat('latitude')
        const lng = stat('longitude')
        rowGroups.push({
          rowStart: start,
          rowEnd: start + n,
          countryMin: toStr(country?.min_value ?? country?.min),
          countryMax: toStr(country?.max_value ?? country?.max),
          latMin: toNum(lat?.min_value ?? lat?.min),
          latMax: toNum(lat?.max_value ?? lat?.max),
          lngMin: toNum(lng?.min_value ?? lng?.min),
          lngMax: toNum(lng?.max_value ?? lng?.max),
        })
        start += n
      }
      return {
        rowGroups,
        async read(columns, rowStart, rowEnd) {
          return (await parquetReadObjects({ file: asyncFile, metadata, columns: [...columns], rowStart, rowEnd, compressors })) as Record<string, unknown>[]
        },
      }
    },
  }
}

/** Escape rooms in one region (the importer contract in scripts/import/types.ts). */
export async function* foursquarePlaces(region: Region, opts: HttpSourceOptions & ScanOptions = {}): AsyncGenerator<RawPlace> {
  for await (const hit of scanFoursquare(httpParquetSource(opts), [region], opts)) yield hit.place
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i >= 0) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`${name}=`))
  return eq?.slice(name.length + 1)
}

async function main() {
  const args = process.argv.slice(2)
  const { buildSeeds, writeSeeds, seedPrimaryIds, seedSlugsById, DEFAULT_SEED_DIR } = await import('../dedupe')
  const regionArg = argValue(args, '--region')
  const regions = args.includes('--all') || !regionArg ? FSQ_REGIONS : FSQ_REGIONS.filter((r) => regionArg.split(',').includes(r.id))
  if (!regions.length) throw new Error(`unknown region "${regionArg}". Known: ${FSQ_REGIONS.map((r) => r.id).join(', ')}`)
  const base = argValue(args, '--base') ?? process.env.FSQ_BASE_URL ?? FSQ_SOURCE_COOP_BASE
  const cacheDir = argValue(args, '--cache') ?? path.join(process.cwd(), '.data', 'import-cache', 'foursquare', FSQ_RELEASE)
  const outDir = argValue(args, '--out') ?? DEFAULT_SEED_DIR
  const maxFiles = argValue(args, '--max-files')
  console.log(`[fsq] Scanning ${base === 'hf' ? `Hugging Face ${FSQ_HF_DATASET}` : base} for ${regions.length} regions...`)
  const started = Date.now()
  const byRegion = new Map<string, RawPlace[]>()
  const unassigned = new Map<string, number>()
  for await (const hit of scanFoursquare(httpParquetSource({ base, hfToken: process.env.HF_TOKEN }), regions, {
    cacheDir,
    // Assign against every region, so `--region gb` leaves London's venues to gb-london.
    classifyWith: FSQ_REGIONS,
    onUnassigned: (p) => unassigned.set(p.country, (unassigned.get(p.country) ?? 0) + 1),
    concurrency: Number(argValue(args, '--concurrency') ?? 4),
    maxFiles: maxFiles ? Number(maxFiles) : undefined,
    onProgress: (p) =>
      console.log(`[fsq] ${p.fileIndex + 1}/${p.fileCount} ${p.file}: ${p.hits} escape rooms${p.cached ? ' (cached)' : `, ${p.rowGroupsRead} row groups read, ${p.rowGroupsSkipped} skipped`} (${Math.round((Date.now() - started) / 1000)} s)`),
  })) {
    const list = byRegion.get(hit.regionId) ?? []
    list.push(hit.place)
    byRegion.set(hit.regionId, list)
  }
  if (unassigned.size) console.warn(`[fsq] Escape rooms in countries with no region (skipped): ${[...unassigned].map(([c, n]) => `${c} ${n}`).join(', ')}`)
  // Venues keep the slugs and primary records they had in the committed seed (URLs and database
  // rows never change on a re-run).
  const seeds = buildSeeds(regions, byRegion, {
    previousSlugs: seedSlugsById(outDir),
    previousPrimaries: seedPrimaryIds(outDir),
    cityRegions: FSQ_REGIONS.filter((r) => r.bbox),
  })
  const manifest = writeSeeds(outDir, seeds, { merge: !args.includes('--all') })
  console.log(`[fsq] Wrote ${seeds.length} region seeds to ${outDir} (version ${manifest.version}).`)
  for (const r of manifest.regions) console.log(`  ${r.id.padEnd(16)} ${String(r.venues).padStart(6)} venues  ${String(r.read).padStart(6)} read  ${String(r.merged).padStart(5)} merged  ${r.cities} cities`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[fsq] Import failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
