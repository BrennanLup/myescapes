// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildServer, type EscapeServer } from './index'
import { ServerStatusSchema, HealthSchema } from '../src/contracts/api'
import { CACHE_IMMUTABLE, CACHE_NONE, STATIC_PAGES, cacheControlFor } from './static'
import { precompressDist } from './precompress'
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
    for (const page of STATIC_PAGES) writeFileSync(path.join(dir, `${page}.html`), `<html><body>${page} page</body></html>`)
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

  it('serves the static info pages at clean URLs', async () => {
    for (const page of STATIC_PAGES) {
      const res = await app.inject({ method: 'GET', url: `/${page}` })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.headers['cache-control']).toBe(CACHE_NONE)
      expect(res.body).toContain(`${page} page`)
    }
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

describe('precompressed static assets', () => {
  const JS = `export const rooms = [${Array.from({ length: 400 }, (_, i) => `{ id: ${i}, name: "room ${i}" }`).join(', ')}]\n`
  const CSS = `.cozy{color:#ffb067;padding:12px}\n`.repeat(200)
  const BIG_INDEX = `<!doctype html><html><body><div id="root">spa</div>${'<!-- cozy -->'.repeat(100)}</body></html>`
  const JPG = Buffer.alloc(4096, 7)
  let dir: string
  let app: EscapeServer

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'escapes-gz-'))
    mkdirSync(path.join(dir, 'assets'))
    writeFileSync(path.join(dir, 'index.html'), BIG_INDEX)
    writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), JS)
    writeFileSync(path.join(dir, 'assets', 'index-abc123.css'), CSS)
    writeFileSync(path.join(dir, 'assets', 'tiny-1.js'), 'x()')
    writeFileSync(path.join(dir, 'photo.jpg'), JPG)
    app = await buildServer({ distDir: dir })
  })
  afterAll(async () => {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes .br and .gz siblings at startup for text assets only', () => {
    for (const f of ['index.html', 'assets/index-abc123.js', 'assets/index-abc123.css']) {
      expect(existsSync(path.join(dir, `${f}.br`))).toBe(true)
      expect(existsSync(path.join(dir, `${f}.gz`))).toBe(true)
    }
    expect(existsSync(path.join(dir, 'photo.jpg.br'))).toBe(false)
    expect(existsSync(path.join(dir, 'assets', 'tiny-1.js.br'))).toBe(false)
  })

  it('does not rewrite fresh siblings', () => {
    const again = precompressDist(dir)
    expect(again.files).toHaveLength(3)
    expect(again.written).toBe(0)
  })

  it('serves brotli when the client accepts br', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'br, gzip' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['content-type']).toMatch(/javascript/)
    expect(res.headers['cache-control']).toBe(CACHE_IMMUTABLE)
    expect(String(res.headers.vary)).toMatch(/accept-encoding/i)
    expect(res.rawPayload.length).toBeLessThan(JS.length / 3)
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(JS)
  })

  it('serves gzip when the client accepts only gzip', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.css', headers: { 'accept-encoding': 'gzip' } })
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['content-type']).toMatch(/text\/css/)
    expect(res.headers['cache-control']).toBe(CACHE_IMMUTABLE)
    expect(gunzipSync(res.rawPayload).toString()).toBe(CSS)
  })

  it('serves the plain file without Accept-Encoding, still varying on it', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(String(res.headers.vary)).toMatch(/accept-encoding/i)
    expect(res.body).toBe(JS)
  })

  it('compresses index.html and the SPA fallback, keeping no-cache', async () => {
    for (const url of ['/', '/some/route']) {
      const res = await app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'gzip, deflate, br' } })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-encoding']).toBe('br')
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.headers['cache-control']).toBe(CACHE_NONE)
      expect(brotliDecompressSync(res.rawPayload).toString()).toBe(BIG_INDEX)
    }
  })

  it('falls back to the plain file when no compressed sibling exists', async () => {
    const tiny = await app.inject({ method: 'GET', url: '/assets/tiny-1.js', headers: { 'accept-encoding': 'br, gzip' } })
    expect(tiny.headers['content-encoding']).toBeUndefined()
    expect(tiny.body).toBe('x()')
    const jpg = await app.inject({ method: 'GET', url: '/photo.jpg', headers: { 'accept-encoding': 'br, gzip' } })
    expect(jpg.statusCode).toBe(200)
    expect(jpg.headers['content-encoding']).toBeUndefined()
    expect(jpg.headers['content-type']).toMatch(/image\/jpeg/)
    expect(jpg.rawPayload.length).toBe(JPG.length)
  })

  it('still 404s a missing asset with Accept-Encoding', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js', headers: { 'accept-encoding': 'br, gzip' } })
    expect(res.statusCode).toBe(404)
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
    expect(cacheControlFor('assets/x-1.js.br')).toBe(CACHE_IMMUTABLE)
    expect(cacheControlFor('index.html.gz')).toBe(CACHE_NONE)
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
