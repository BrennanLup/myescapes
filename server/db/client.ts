/**
 * Database connection. Owned by workstream 2 (foundation).
 *
 * - `DATABASE_URL` set: node-postgres pool (Railway Postgres).
 * - Otherwise: PGlite, an in-process Postgres (WASM) stored in `<DATA_DIR>/pglite`, or in memory
 *   for tests. Same SQL, same migrations, so local runs and Vitest need no external Postgres.
 *
 * Every query goes through Drizzle, which parameterises values. Never build SQL by string
 * concatenation; use the `sql` template tag for raw fragments.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'

export type Schema = typeof schema
/** The Drizzle database, whichever driver is underneath. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>
/** A transaction handle (same API as Db). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbKind = 'postgres' | 'pglite'

export interface DbHandle {
  db: Db
  kind: DbKind
  /** Run the migrations in server/db/migrations (idempotent). */
  migrate(): Promise<void>
  /** Cheap liveness probe (`select 1`). */
  ping(): Promise<boolean>
  close(): Promise<void>
}

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Arbitrary constant for pg_advisory_lock, so two instances never migrate at once. */
const MIGRATION_LOCK_KEY = 727_433_001

export interface CreateDbOptions {
  /** Postgres URL. Defaults to env DATABASE_URL. */
  url?: string
  /** PGlite data folder. `memory` keeps it in RAM (tests). */
  pgliteDir?: string | 'memory'
}

export async function createPostgres(url: string): Promise<DbHandle> {
  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10), connectionTimeoutMillis: 10_000 })
  // An idle client error (e.g. Postgres restarted) must not crash the process.
  pool.on('error', (err) => console.error(`[db] idle client error: ${err.message}`))
  const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db
  return {
    db,
    kind: 'postgres',
    async migrate() {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator')
      const client = await pool.connect()
      try {
        await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
        try {
          await migrate(drizzle(client, { schema, casing: 'snake_case' }), { migrationsFolder: MIGRATIONS_DIR })
        } finally {
          await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        }
      } finally {
        client.release()
      }
    },
    async ping() {
      try {
        await pool.query('select 1')
        return true
      } catch {
        return false
      }
    },
    async close() {
      await pool.end()
    },
  }
}

export interface PgliteHandle extends DbHandle {
  kind: 'pglite'
  /** Snapshot of the whole data dir (gzipped tarball). Tests use it as a migrated template. */
  dumpDataDir(): Promise<Blob>
}

export async function createPglite(dir: string | 'memory' = 'memory', opts: { loadDataDir?: Blob } = {}): Promise<PgliteHandle> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')
  const { drizzle } = await import('drizzle-orm/pglite')
  const options = { extensions: { pg_trgm }, ...(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : {}) }
  const client = dir === 'memory' ? new PGlite(options) : new PGlite(dir, options)
  await client.waitReady
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db
  return {
    db,
    kind: 'pglite',
    async migrate() {
      const { migrate } = await import('drizzle-orm/pglite/migrator')
      await migrate(drizzle(client, { schema, casing: 'snake_case' }), { migrationsFolder: MIGRATIONS_DIR })
    },
    async ping() {
      try {
        await client.query('select 1')
        return true
      } catch {
        return false
      }
    },
    async close() {
      if (!client.closed) await client.close()
    },
    async dumpDataDir() {
      return client.dumpDataDir('gzip')
    },
  }
}

/** Postgres when DATABASE_URL is set, else PGlite in `<DATA_DIR or .data>/pglite`. */
export async function createDb(opts: CreateDbOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<DbHandle> {
  const url = opts.url ?? env.DATABASE_URL
  if (url) return createPostgres(url)
  const dir = opts.pgliteDir ?? path.join(path.resolve(env.DATA_DIR || path.join(process.cwd(), '.data')), 'pglite')
  if (dir !== 'memory') {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
  }
  return createPglite(dir)
}

export { schema }
