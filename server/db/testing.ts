/**
 * Test harness: an in-process, migrated Postgres (PGlite) per test file. No external Postgres.
 *
 *   import { createTestDb } from '../db/testing'
 *   const tdb = await createTestDb()          // fresh, migrated, empty
 *   const fx = await loadFixtures(tdb.db)     // optional: users, friends, directory, visits...
 *   ...
 *   await tdb.close()
 *
 * Use `resetDb(db)` between tests that need a clean slate. Vitest's global setup
 * (server/db/test-global-setup.ts) prepares a migrated template so this takes ~0.5 s.
 */
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createPglite, type Db, type PgliteHandle } from './client'

export interface TestDb {
  db: Db
  handle: PgliteHandle
  close(): Promise<void>
}

async function templateBlob(): Promise<Blob | undefined> {
  try {
    const { inject } = await import('vitest')
    const file = inject('pgliteTemplate')
    if (!file) return undefined
    return new Blob([readFileSync(file)])
  } catch {
    return undefined
  }
}

export async function createTestDb(): Promise<TestDb> {
  const blob = await templateBlob()
  const handle = await createPglite('memory', blob ? { loadDataDir: blob } : {})
  // Always run migrate: a no-op on the template, the full run without one.
  await handle.migrate()
  return { db: handle.db, handle, close: () => handle.close() }
}

/** Every app table, children first (for TRUNCATE ... CASCADE it doesn't matter, but it documents them). */
export const ALL_TABLES = [
  'usage_counters', 'reports', 'daily_results', 'daily_puzzles', 'wishlist_items', 'notifications', 'invites',
  'friendships', 'visit_edits', 'visit_photos', 'visit_puzzles', 'reviews', 'visit_participants', 'visits',
  'sources', 'games', 'venues', 'cities', 'verifications', 'accounts', 'sessions', 'users',
] as const

/** Empty every table (keeps the schema and migrations). */
export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} cascade`))
}
