/**
 * Test-only: a small server with just the extraction and transcription routes, wired like the real
 * one (error handler, multipart, rate limit, contract validation) on a PGlite database, so tests
 * can inject a fake Claude client or speech provider. Signed-in requests use the `x-test-user`
 * header, as in server/testing.ts.
 */
import Fastify, { type FastifyInstance, type InjectOptions, type LightMyRequestResponse } from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import { trustProxyFor } from '../proxy'
import { createContext, type AppContext, type DbState } from '../context'
import type { Db } from '../db/client'
import { loadFixtures } from '../db/fixtures'
import { createTestDb, type TestDb } from '../db/testing'
import { installErrorHandler } from '../http'
import { MAX_UPLOAD_BYTES } from '../index'
import { extractRoutes, type ExtractRoutesOptions } from '../routes/extract'
import { transcribeRoutes, type TranscribeRoutesOptions } from '../routes/transcribe'
import { sessionUserById, TEST_USER_HEADER } from '../testing'

export interface VoiceTestApp {
  app: FastifyInstance
  ctx: AppContext
  db: Db
  testDb: TestDb
  inject(opts: InjectOptions & { as?: string }): Promise<LightMyRequestResponse>
  close(): Promise<void>
}

export interface VoiceTestAppOptions {
  extract?: ExtractRoutesOptions
  transcribe?: TranscribeRoutesOptions
  env?: NodeJS.ProcessEnv
  now?: () => Date
  fixtures?: boolean
  /** Simulate a database that is down (`none`) instead of the PGlite one. */
  dbDown?: boolean
  testDb?: TestDb
}

export async function buildVoiceTestApp(opts: VoiceTestAppOptions = {}): Promise<VoiceTestApp> {
  const testDb = opts.testDb ?? (await createTestDb())
  if (opts.fixtures !== false && !opts.testDb) await loadFixtures(testDb.db)
  const dbState: DbState = opts.dbDown
    ? { status: 'unavailable', handle: null, error: 'down for the test' }
    : { status: 'ready', handle: testDb.handle, error: null }
  const ctx = createContext({
    dbState,
    // Provider keys are blanked unless a test sets them, so no test ever reaches the network.
    env: { ...process.env, NODE_ENV: 'test', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', ...opts.env },
    now: opts.now,
    resolveUser: async (req) => {
      const id = req.headers[TEST_USER_HEADER]
      return typeof id === 'string' && id ? sessionUserById(testDb.db, id) : null
    },
  })
  const app = Fastify({ logger: false, trustProxy: trustProxyFor({}) })
  installErrorHandler(app)
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 } })
  await app.register(fastifyRateLimit, { global: false })
  await app.register(async (scope) => extractRoutes(scope, ctx, { log: () => {}, ...opts.extract }))
  await app.register(async (scope) => transcribeRoutes(scope, ctx, { log: () => {}, ...opts.transcribe }))
  await app.ready()
  return {
    app,
    ctx,
    db: testDb.db,
    testDb,
    inject({ as, ...rest }) {
      const headers = { ...(rest.headers ?? {}), ...(as ? { [TEST_USER_HEADER]: as } : {}) }
      return app.inject({ ...rest, headers } as InjectOptions)
    },
    async close() {
      await app.close()
      if (!opts.testDb) await testDb.close()
    },
  }
}

/** A multipart/form-data body by hand (no form-data dependency). */
export function multipartBody(
  parts: Array<{ name: string; value: string } | { name: string; filename: string; contentType: string; data: Buffer }>,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----myescapes${Math.random().toString(16).slice(2)}`
  const chunks: Buffer[] = []
  for (const p of parts) {
    if ('data' in p) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType}\r\n\r\n`,
        ),
        p.data,
        Buffer.from('\r\n'),
      )
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`))
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
