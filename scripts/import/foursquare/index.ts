/**
 * Foursquare Open Source Places importer (workstream 6). Apache-2.0.
 * Streams the Parquet files from Hugging Face (hyparquet + hyparquet-compressors are installed),
 * filters to the escape room category, and yields RawPlace per region.
 * Run: `npx tsx scripts/import/foursquare/index.ts --region us`. STUB.
 */
import type { RawPlace, Region } from '../types'

export const FOURSQUARE_LICENSE = 'Apache-2.0'
export const FOURSQUARE_ATTRIBUTION = 'Foursquare Open Source Places'

export async function* foursquarePlaces(_region: Region): AsyncGenerator<RawPlace> {
  // STUB: yields nothing.
}
