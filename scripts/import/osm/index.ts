/**
 * OpenStreetMap importer (workstream 7): `leisure=escape_game` via Overpass. ODbL: use for finding
 * and cross-checking; keep stored facts tied to Foursquare and user contributions (see the plan).
 * overpass-api.de is often unreachable from the build container: best-effort. STUB.
 */
import type { RawPlace, Region } from '../types'

export const OSM_LICENSE = 'ODbL-1.0'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

export async function* osmPlaces(_region: Region): AsyncGenerator<RawPlace> {
  // STUB: yields nothing.
}
