/**
 * Shared shapes for the directory importers (workstreams 6-9). Owned by foundation.
 *
 * Pipeline: each importer streams `RawPlace`s for a region -> dedupe/normalise (8) merges them
 * into `venues` (+ `cities`, + one `sources` row per contributing record) -> the Google linker
 * (9) attaches `google_place_id` only. Every run is resumable and region by region.
 */
export type ImportSource = 'foursquare' | 'osm' | 'google'

export interface RawPlace {
  source: ImportSource
  /** Foursquare fsq_place_id, OSM `node/123` / `way/45`, Google place id. */
  sourceId: string
  name: string
  brand: string | null
  address: string
  city: string
  region: string
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string
  postalCode: string | null
  lat: number | null
  lng: number | null
  website: string | null
  phone: string | null
  /** e.g. `Apache-2.0`, `ODbL-1.0`. */
  license: string
  attribution: string
  /** The source fields as read, for the `sources.fields` column. */
  raw: Record<string, unknown>
}

export interface Region {
  /** `us`, `ca`, `gb-london`, ... */
  id: string
  name: string
  country: string
  /** [south, west, north, east] for city regions; omitted for whole countries. */
  bbox?: [number, number, number, number]
}

/** Import order: the US and Canada first, then major cities in Europe, Asia and Australia. */
export const REGIONS: Region[] = [
  { id: 'us', name: 'United States', country: 'US' },
  { id: 'ca', name: 'Canada', country: 'CA' },
  { id: 'gb-london', name: 'London', country: 'GB', bbox: [51.28, -0.51, 51.69, 0.33] },
  { id: 'fr-paris', name: 'Paris', country: 'FR', bbox: [48.8, 2.22, 48.92, 2.47] },
  { id: 'de-berlin', name: 'Berlin', country: 'DE', bbox: [52.34, 13.09, 52.68, 13.76] },
  { id: 'nl-amsterdam', name: 'Amsterdam', country: 'NL', bbox: [52.28, 4.73, 52.43, 5.07] },
  { id: 'es-madrid', name: 'Madrid', country: 'ES', bbox: [40.31, -3.89, 40.56, -3.52] },
  { id: 'es-barcelona', name: 'Barcelona', country: 'ES', bbox: [41.32, 2.05, 41.47, 2.23] },
  { id: 'it-rome', name: 'Rome', country: 'IT', bbox: [41.79, 12.35, 42.0, 12.62] },
  { id: 'jp-tokyo', name: 'Tokyo', country: 'JP', bbox: [35.52, 139.56, 35.82, 139.92] },
  { id: 'kr-seoul', name: 'Seoul', country: 'KR', bbox: [37.43, 126.8, 37.7, 127.18] },
  { id: 'sg-singapore', name: 'Singapore', country: 'SG', bbox: [1.2, 103.6, 1.48, 104.05] },
  { id: 'hk-hong-kong', name: 'Hong Kong', country: 'HK', bbox: [22.15, 113.83, 22.56, 114.41] },
  { id: 'au-sydney', name: 'Sydney', country: 'AU', bbox: [-34.12, 150.52, -33.58, 151.34] },
  { id: 'au-melbourne', name: 'Melbourne', country: 'AU', bbox: [-38.1, 144.59, -37.51, 145.51] },
]

export interface ImportStats {
  region: string
  source: ImportSource
  read: number
  inserted: number
  merged: number
  skipped: number
}
