// Fastify server: API routes + the built app from dist/. Owned by workstream 20: Local Run.
import { ROOT, appVersion, resolvePort, startupBanner } from './env'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { extractRoutes, extractionMode } from './routes/extract'
import { sheetRoutes, storageMode } from './routes/sheet'
import { registerStatic } from './static'
import { API, type ServerStatus } from '../src/contracts/api'

export interface BuildServerOptions {
  /** Folder holding the Vite build. Defaults to `<repo>/dist`. */
  distDir?: string
  /** Fastify logger option. Defaults to off (the startup banner covers the basics). */
  logger?: boolean
}

export type EscapeServer = FastifyInstance & { distReady: boolean }

export async function buildServer(opts: BuildServerOptions = {}): Promise<EscapeServer> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 })
  app.get(API.health, async () => ({ ok: true as const }))
  app.get(API.status, async (): Promise<ServerStatus> => ({
    extraction: extractionMode(),
    storage: storageMode(),
    version: appVersion(),
  }))
  await app.register(extractRoutes)
  await app.register(sheetRoutes)
  const distReady = await registerStatic(app, opts.distDir ?? path.join(ROOT, 'dist'))
  app.decorate('distReady', distReady)
  return app as unknown as EscapeServer
}

async function main() {
  const port = resolvePort()
  const app = await buildServer()
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
    startupBanner({ port, extraction: extractionMode(), storage: storageMode(), version: appVersion(), distReady: app.distReady }),
  )

  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`\n  ${signal} received, shutting down...`)
    const force = setTimeout(() => process.exit(1), 5000)
    force.unref()
    app.close().then(
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
