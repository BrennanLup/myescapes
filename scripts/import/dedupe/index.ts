/**
 * Normalisation and de-duplication (workstream 8): name similarity + distance under ~75 m,
 * city and country tagging, slugs, `sources` rows. Writes venues and cities. STUB.
 */
import type { Db } from '../../../server/db/client'
import type { ImportStats, RawPlace, Region } from '../types'

/** Case/diacritic/punctuation-insensitive name key ("Escape Room SF!" -> "escape room sf"). */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function upsertPlaces(_db: Db, region: Region, places: AsyncIterable<RawPlace> | RawPlace[]): Promise<ImportStats> {
  let read = 0
  for await (const _p of places) read++
  return { region: region.id, source: 'foursquare', read, inserted: 0, merged: 0, skipped: read }
}
