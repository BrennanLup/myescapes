// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_LIST, ServerStatusV2Schema } from '../../src/contracts/routes'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { DatasetSchema } from '../../src/contracts/types'
import { createContext } from '../context'
import { buildServer } from '../index'
import { buildTestApp, type TestApp } from '../testing'
import { ROUTE_MODULES } from './registry'

const urlFor = (path: string) => path.replace(/:([A-Za-z_]+)/g, 'x')

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

describe('route registry', () => {
  it('lists each module once', () => {
    expect(new Set(ROUTE_MODULES.map((m) => m.file)).size).toBe(ROUTE_MODULES.length)
  })

  it('registers every contract route (none fall through to the generic 404)', async () => {
    for (const r of ROUTE_LIST) {
      const res = await t.inject({ method: r.method, url: urlFor(r.path), as: t.fx.users.admin, payload: r.body && r.body !== 'multipart' ? {} : undefined })
      const body = res.headers['content-type']?.includes('json') ? res.json() : null
      const generic404 = res.statusCode === 404 && typeof body?.error === 'string' && body.error.startsWith('not found:')
      expect(generic404, `${r.method} ${r.path} is not registered`).toBe(false)
    }
  })

  it('stubs answer 501 not_implemented with an ApiError body', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/friends', as: t.fx.users.alice })
    expect(res.statusCode).toBe(501)
    expect(ApiErrorSchema.parse(res.json()).code).toBe('not_implemented')
  })

  it('validates bodies against the contract (400 invalid with details)', async () => {
    const res = await t.inject({ method: 'PUT', url: '/api/wishlist', as: t.fx.users.alice, payload: [{ name: 'no id' }] })
    expect(res.statusCode).toBe(400)
    const err = ApiErrorSchema.parse(res.json())
    expect(err.code).toBe('invalid')
    expect(err.details?.length).toBeGreaterThan(0)
  })
})

describe('platform and Phase 1 routes', () => {
  it('/health and /api/status', async () => {
    expect((await t.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true })
    const s = ServerStatusV2Schema.parse((await t.inject({ method: 'GET', url: '/api/status' })).json())
    expect(s).toMatchObject({ storage: 'pglite', database: 'ready' })
  })

  it('/api/data: seed demo when signed out, the user\'s rows when signed in', async () => {
    const anon = DatasetSchema.parse((await t.inject({ method: 'GET', url: '/api/data' })).json())
    expect(anon.source).toBe('seed')
    expect(anon.rooms.length).toBeGreaterThanOrEqual(12)
    const mine = DatasetSchema.parse((await t.inject({ method: 'GET', url: '/api/data', as: t.fx.users.alice })).json())
    expect(mine.source).toBe('postgres')
    expect(mine.reviews).toHaveLength(5)
  })

  it('/api/wishlist round trip for a signed-in user', async () => {
    const items = [{ id: 'w1', name: 'Moon Base', city: 'Toronto', link: '', addedBy: 'Alice', priority: 1, done: false, gameId: null }]
    const put = await t.inject({ method: 'PUT', url: ROUTES.putWishlist.path, as: t.fx.users.alice, payload: items })
    expect(put.statusCode).toBe(200)
    expect((await t.inject({ method: 'GET', url: '/api/wishlist', as: t.fx.users.alice })).json()).toEqual(items)
  })

  it('/api/me/usage reports today\'s meters', async () => {
    const res = await t.inject({ method: 'GET', url: ROUTES.usage.path, as: t.fx.users.alice })
    expect(res.statusCode).toBe(200)
    expect(res.json().extractionCalls).toEqual({ used: 0, limit: 30 })
  })
})

describe('without a database', () => {
  it('keeps /health, static pages and the seed demo up; DB routes answer 503', async () => {
    const app = await buildServer({
      distDir: '/nonexistent-dist',
      context: createContext({ dbState: { status: 'unavailable', handle: null, error: 'down' }, resolveUser: async () => ({ id: 'u', email: 'u@example.com', name: 'U', handle: 'u', displayName: 'U', image: null, isAdmin: false, onboarded: true }) }),
    })
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
      const status = ServerStatusV2Schema.parse((await app.inject({ method: 'GET', url: '/api/status' })).json())
      expect(status.database).toBe('unavailable')
      const res = await app.inject({ method: 'GET', url: '/api/me/usage' })
      expect(res.statusCode).toBe(503)
      expect(res.json().code).toBe('db_unavailable')
    } finally {
      await app.close()
    }
  })

  it('test-only routes do not exist outside NODE_ENV=test', async () => {
    const app = await buildServer({ distDir: '/nonexistent-dist', context: createContext({ env: { NODE_ENV: 'production' } }) })
    try {
      const res = await app.inject({ method: 'POST', url: ROUTES.testLogin.path, payload: { email: 'a@example.com' } })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
