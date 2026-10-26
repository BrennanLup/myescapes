/**
 * Migrations. `npm run db:migrate` runs them against DATABASE_URL (or the local PGlite store);
 * the server also runs them on every start, before it listens. Both are idempotent: Drizzle
 * records applied migrations in `drizzle.__drizzle_migrations`, and an advisory lock keeps two
 * instances from migrating at once.
 */
import '../env'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, type DbHandle } from './client'

export class MigrationTimeoutError extends Error {}

/** Runs migrations, failing after `timeoutMs` (the migration itself keeps going in the background). */
export async function runMigrations(handle: DbHandle, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MigrationTimeoutError(`migrations did not finish within ${timeoutMs} ms`)), timeoutMs)
    timer.unref()
  })
  try {
    await Promise.race([handle.migrate(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const usingUrl = Boolean(process.env.DATABASE_URL)
  console.log(`[db] Migrating ${usingUrl ? 'Postgres (DATABASE_URL)' : 'local PGlite store'}...`)
  const handle = await createDb()
  const started = Date.now()
  try {
    await runMigrations(handle, { timeoutMs: 120_000 })
    console.log(`[db] Migrations up to date (${Date.now() - started} ms).`)
  } catch (err) {
    console.error(`[db] Migration failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    await handle.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
