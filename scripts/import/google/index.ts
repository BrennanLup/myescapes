/**
 * Google place-ID linker (workstream 9, optional key GOOGLE_MAPS_API_KEY). Stores only
 * `google_place_id` (Google's terms forbid storing other Places data). STUB.
 */
import type { Db } from '../../../server/db/client'

export async function linkGooglePlaceIds(_db: Db, _opts: { limit?: number; apiKey?: string } = {}): Promise<{ linked: number; skipped: number }> {
  return { linked: 0, skipped: 0 }
}
