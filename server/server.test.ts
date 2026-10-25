// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildServer, type EscapeServer } from './index'
import { ServerStatusSchema, HealthSchema } from '../src/contracts/api'
import { CACHE_IMMUTABLE, CACHE_NONE, cacheControlFor } from './static'
import { startupBanner, resolvePort } from './env'

const INDEX = '<!doctype html><html><body><div id="root">spa</div></body></html>'

describe('buildServer with a dist folder', () => {
  let dir: string
  let app: EscapeServer

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'escapes-dist-'))
    mkdirSync(path.join(dir, 'assets'))
    writeFileSync(path.join(dir, 'index.html'), INDEX)
    writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
    writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    app = await buildServer({ distDir: dir })
  })
  afterAll(async () => {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports dist as ready', () => {
    expect(app.distReady).toBe(true)
  })

  it('GET /health -> { ok: true }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(HealthSchema.parse(res.json())).toEqual({ ok: true })
  })

  it('GET /api/status matches ServerStatus', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' })
    expect(res.statusCode).toBe(200)
    const status = ServerStatusSchema.parse(res.json())
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('serves index.html at / with no-cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['cache-control']).toBe(CACHE_NONE)
    expect(res.body).toContain('spa')
  })

  it('falls back to index.html for client routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/deep/route?x=1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('spa')
    expect(res.headers['cache-control']).toBe(CACHE_NONE)
  })

  it('serves hashed assets with an immutable long cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe(CACHE_IMMUTABLE)
    expect(res.body).toBe('console.log(1)')
  })

  it('serves other static files with a short cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/favicon.svg' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toMatch(/max-age=3600/)
  })

  it('404s a missing asset instead of returning HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('spa')
  })

  it('returns JSON 404 for unknown /api routes', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const res = await app.inject({ method, url: '/api/nope' })
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.json()).toHaveProperty('error')
    }
  })

  it('still registers the extract and sheet routes', async () => {
    const data = await app.inject({ method: 'GET', url: '/api/data' })
    expect(data.statusCode).toBe(200)
    const bad = await app.inject({ method: 'POST', url: '/api/extract', payload: {} })
    expect(bad.statusCode).toBe(400)
  })
})

describe('buildServer without a dist folder', () => {
  it('serves a friendly build-needed page, keeps API working', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'escapes-empty-'))
    const app = await buildServer({ distDir: path.join(dir, 'dist') })
    try {
      expect(app.distReady).toBe(false)
      const page = await app.inject({ method: 'GET', url: '/' })
      expect(page.statusCode).toBe(503)
      expect(page.body).toContain('npm run build')
      const health = await app.inject({ method: 'GET', url: '/health' })
      expect(health.json()).toEqual({ ok: true })
      const api = await app.inject({ method: 'GET', url: '/api/missing' })
      expect(api.statusCode).toBe(404)
      expect(api.json()).toHaveProperty('error')
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('helpers', () => {
  it('cacheControlFor', () => {
    expect(cacheControlFor('assets/x-1.js')).toBe(CACHE_IMMUTABLE)
    expect(cacheControlFor('index.html')).toBe(CACHE_NONE)
  })

  it('resolvePort', () => {
    expect(resolvePort({})).toBe(3000)
    expect(resolvePort({ PORT: '4120' })).toBe(4120)
    expect(resolvePort({ PORT: 'abc' })).toBe(3000)
  })

  it('startupBanner lists modes and var names, never values', () => {
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-secret-value'
    try {
      const text = startupBanner({ port: 3000, extraction: 'claude', storage: 'seed', version: '1.0.0', distReady: false })
      expect(text).toContain('[REAL] Review extraction')
      expect(text).toContain('[MOCK] Storage')
      expect(text).toContain('GOOGLE_SHEET_ID')
      expect(text).toContain('npm run build')
      expect(text).not.toContain('sk-secret-value')
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
