/**
 * Phase 1 data migration (workstream 28): import seed/reviews.json and `.data/store.json` entries
 * into one user's account (by email), idempotently. `saveEntryForUser` in server/db/dataset.ts
 * already maps an Entry to venue/game/visit/review rows (keyed by the Phase 1 review id).
 * Run: `npx tsx scripts/migrate-phase1/index.ts --email you@example.com`. STUB.
 */
import type { Db } from '../../server/db/client'

export async function migratePhase1(_db: Db, _opts: { email: string; dataDir?: string; includeSeed?: boolean }): Promise<{ imported: number; skipped: number }> {
  return { imported: 0, skipped: 0 }
}
