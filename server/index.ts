// PLACEHOLDER (orchestrator). Owned by workstream 20: Local Run.
import 'dotenv/config'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { extractRoutes, extractionMode } from './routes/extract'
import { sheetRoutes, storageMode } from './routes/sheet'
import { API } from '../src/contracts/api'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function buildServer() {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 })
  app.get(API.health, async () => ({ ok: true }))
  app.get(API.status, async () => ({ extraction: extractionMode(), storage: storageMode(), version: '0.1.0' }))
  await app.register(extractRoutes)
  await app.register(sheetRoutes)
  const dist = path.join(root, 'dist')
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  }
  return app
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = await buildServer()
  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`My Escapes running at http://localhost:${port}`)
}
