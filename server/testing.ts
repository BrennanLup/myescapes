/**
 * Route-test harness: the full server (every route module, real validation and error handling)
 * on an in-process PGlite database, with a header-based fake sign-in.
 *
 *   const t = await buildTestApp({ fixtures: true })
 *   const res = await t.inject({ method: 'GET', url: '/api/logs', as: FX.users.alice })
 *   await t.close()
 *
 * `as` sets the `x-test-user` header, which only this harness understands (the production
 * resolver is server/auth). An unknown id behaves like "not signed in".
 */
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { eq } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createContext, type AppContext, type SessionUser, type UserResolver } from './context'
import type { Db } from './db/client'
import { FX, loadFixtures } from './db/fixtures'
import { users } from './db/schema'
import { createTestDb, type TestDb } from './db/testing'
import { buildServer, type EscapeServer } from './index'

export const TEST_USER_HEADER = 'x-test-user'

export async function sessionUserById(db: Db, id: string): Promise<SessionUser | null> {
  const u = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]
  if (!u) return null
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    handle: u.handle,
    displayName: u.displayName,
    image: u.image,
    isAdmin: u.isAdmin,
    onboarded: Boolean(u.handle && u.displayName),
  }
}

export interface TestApp {
  app: EscapeServer
  ctx: AppContext
  db: Db
  testDb: TestDb
  fx: typeof FX
  /** `app.inject` plus `as: userId` for a signed-in request. */
  inject(opts: InjectOptions & { as?: string }): Promise<LightMyRequestResponse>
  close(): Promise<void>
}

export interface BuildTestAppOptions {
  /** Load server/db/fixtures.ts (default false: an empty, migrated database). */
  fixtures?: boolean
  /** Reuse an existing test database instead of creating one. */
  testDb?: TestDb
  /** Override how the signed-in user is resolved (default: the `x-test-user` header). */
  resolveUser?: UserResolver
  env?: NodeJS.ProcessEnv
  now?: () => Date
}

export async function buildTestApp(opts: BuildTestAppOptions = {}): Promise<TestApp> {
  const testDb = opts.testDb ?? (await createTestDb())
  if (opts.fixtures) await loadFixtures(testDb.db)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'myescapes-test-'))
  const resolveUser: UserResolver =
    opts.resolveUser ??
    (async (req) => {
      const id = req.headers[TEST_USER_HEADER]
      return typeof id === 'string' && id ? sessionUserById(testDb.db, id) : null
    })
  const ctx = createContext({
    dbState: { status: 'ready', handle: testDb.handle, error: null },
    resolveUser,
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dataDir, ...opts.env },
    now: opts.now,
  })
  const app = await buildServer({ context: ctx, distDir: path.join(dataDir, 'no-dist') })
  await app.ready()
  return {
    app,
    ctx,
    db: testDb.db,
    testDb,
    fx: FX,
    inject({ as, ...rest }) {
      const headers = { ...(rest.headers ?? {}), ...(as ? { [TEST_USER_HEADER]: as } : {}) }
      return app.inject({ ...rest, headers } as InjectOptions)
    },
    async close() {
      await app.close()
      if (!opts.testDb) await testDb.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
