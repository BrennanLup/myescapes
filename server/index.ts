// Fastify server: API routes + the built app from dist/. Owned by workstream 27 (foundation).
//
// Start-up order (main): connect to the database, run migrations (bounded by a timeout), build the
// server, listen. /health never touches the database, so a slow or missing Postgres can't fail
// Railway's health check: when migrations fail or time out the server still listens, DB-backed
// routes answer 503 `db_unavailable`, and migrations are retried in the background.
import { ROOT, appVersion, resolvePort, startupBanner } from './env'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { authMode, resolveUser } from './auth'
import { createContext, type AppContext, type DbState } from './context'
import type { DbHandle } from './db/client'
import { installErrorHandler } from './http'
import { trustProxyFor } from './proxy'
import { registerRoutes } from './routes/registry'
import { extractionMode } from './routes/extract'
import { transcriptionMode } from './routes/transcribe'
import { headTagsFor } from './seo'
import { registerStatic } from './static'

export interface BuildServerOptions {
  /** Folder holding the Vite build. Defaults to `<repo>/dist`. */
  distDir?: string
  /** Fastify logger option. Defaults to off (the startup banner covers the basics). */
  logger?: boolean
  /** A ready (migrated) database. Ignored when `context` is given. Without either, DB routes answer 503. */
  db?: DbHandle | null
  /** Full context override (tests: see server/testing.ts). */
  context?: AppContext
}

export type EscapeServer = FastifyInstance & { distReady: boolean; ctx: AppContext }

/** Upload ceiling for multipart routes (voice notes up to 25 MB; photos are much smaller). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Rate-limit bucket: the signed-in user when there is one, else the client address. */
export function rateLimitKey(ctx: AppContext) {
  return async (req: FastifyRequest): Promise<string> => {
    try {
      const user = await ctx.getUser(req)
      if (user) return `user:${user.id}`
    } catch {
      // Database down or bad session: fall back to the address.
    }
    return `ip:${req.ip}`
  }
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<EscapeServer> {
  const ctx =
    opts.context ??
    createContext({
      dbState: opts.db ? { status: 'ready', handle: opts.db, error: null } : undefined,
      resolveUser,
    })
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024, trustProxy: trustProxyFor(ctx.env) })
  installErrorHandler(app)
  await app.register(fastifyCookie)
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 } })
  // Opt-in per route: defineRoute(..., { config: { rateLimit: { max, timeWindow } } }).
  await app.register(fastifyRateLimit, { global: false, keyGenerator: rateLimitKey(ctx) })
  await registerRoutes(app, ctx)
  const distReady = await registerStatic(app, opts.distDir ?? path.join(ROOT, 'dist'), { headTags: (url) => headTagsFor(url, ctx) })
  app.decorate('distReady', distReady)
  app.decorate('ctx', ctx)
  return app as unknown as EscapeServer
}

/** Connects and migrates, updating `state`. Never throws. Returns true when the database is ready. */
export async function prepareDatabase(state: DbState, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  const { createDb } = await import('./db/client')
  const { runMigrations } = await import('./db/migrate')
  try {
    state.status = 'migrating'
    state.handle ??= await createDb()
    const started = Date.now()
    await runMigrations(state.handle, { timeoutMs: opts.timeoutMs ?? 30_000 })
    state.status = 'ready'
    state.error = null
    console.log(`[db] ${state.handle.kind === 'postgres' ? 'Postgres' : 'Local PGlite'} ready, migrations up to date (${Date.now() - started} ms).`)
    return true
  } catch (err) {
    state.status = 'unavailable'
    state.error = err instanceof Error ? err.message : String(err)
    console.error(`[db] Database not ready: ${state.error}`)
    return false
  }
}

async function main() {
  const port = resolvePort()
  const dbState: DbState = { status: 'none', handle: null, error: null }
  const dbReady = await prepareDatabase(dbState, { timeoutMs: Number(process.env.MIGRATION_TIMEOUT_MS ?? 30_000) })
  let retry: NodeJS.Timeout | undefined
  if (!dbReady) {
    // Keep serving (static pages, /health, seed demo) and keep trying in the background.
    retry = setInterval(async () => {
      if (dbState.status === 'migrating') return
      if (await prepareDatabase(dbState, { timeoutMs: 60_000 })) clearInterval(retry)
    }, 30_000)
    retry.unref()
  }
  const ctx = createContext({ dbState, resolveUser })
  const app = await buildServer({ context: ctx })
  try {
    await app.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use (maybe My Escapes is already running?).`)
      console.error(`  Try another port:  PORT=${port + 1} npm start\n`)
    } else {
      console.error('\n  Could not start the server:', (err as Error).message, '\n')
    }
    process.exit(1)
  }
  console.log(
    startupBanner({
      port,
      extraction: extractionMode(),
      storage: ctx.dbKind(),
      version: appVersion(),
      distReady: app.distReady,
      transcription: transcriptionMode(),
      auth: authMode(),
      database: dbState.status === 'ready' ? 'ready' : `${dbState.status} (retrying every 30 s)`,
    }),
  )

  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`\n  ${signal} received, shutting down...`)
    const force = setTimeout(() => process.exit(1), 5000)
    force.unref()
    clearInterval(retry)
    app
      .close()
      .then(() => dbState.handle?.close())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      )
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
