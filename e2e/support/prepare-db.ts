/**
 * Runs before the e2e server starts (see playwright.config.ts `webServer.command`).
 *
 * - With DATABASE_URL (a real local Postgres, from E2E_DATABASE_URL): drops and recreates that
 *   database so every run starts empty. Refuses anything that isn't on localhost and whose
 *   database name doesn't contain "e2e", so it can never wipe a real database.
 * - Without it: the PGlite store in DATA_DIR (a fresh temp folder per run).
 *
 * Then runs the migrations and loads the demo directory (seed/reviews.json venues and games, e.g.
 * "The Lost Observatory" at "Starlight Escapes", San Francisco), so the logging flow has real
 * directory venues to match.
 */
import '../../server/env'
import { createDb } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { seedDemoDirectory } from '../../server/db/seed'

async function resetPostgres(url: string) {
  const u = new URL(url)
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || !/e2e/i.test(name) || !/^[a-z0-9_]+$/i.test(name)) {
    throw new Error('prepare-db: refusing to reset a database that is not a local *e2e* database')
  }
  const { Client } = await import('pg')
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const client = new Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    await client.query(`drop database if exists "${name}" with (force)`)
    await client.query(`create database "${name}"`)
  } finally {
    await client.end()
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (url) await resetPostgres(url)
  const handle = await createDb()
  try {
    await runMigrations(handle, { timeoutMs: 120_000 })
    const n = await seedDemoDirectory(handle.db)
    console.log(`[e2e] ${handle.kind} database ready: ${n.venues} demo venues, ${n.games} demo games.`)
  } finally {
    await handle.close()
  }
}

await main()
