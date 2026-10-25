// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { API } from '../../src/contracts/api'
import { DatasetSchema, EntrySchema, type Entry } from '../../src/contracts/types'
import { SeedRepository } from '../../src/data/server/seedRepository'
import { sheetRoutes, storageMode } from './sheet'

let app: FastifyInstance
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'escapes-routes-'))
  app = Fastify()
  await app.register(sheetRoutes, { repository: new SeedRepository({ dataDir: dir }) })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

describe('data routes', () => {
  it('GET /api/data returns the seed dataset', async () => {
    const res = await app.inject({ method: 'GET', url: API.data })
    expect(res.statusCode).toBe(200)
    const d = DatasetSchema.parse(res.json())
    expect(d.rooms).toHaveLength(12)
    expect(storageMode()).toBe('seed')
  })

  it('POST /api/entries saves a valid entry and rejects bad input', async () => {
    const d = DatasetSchema.parse((await app.inject({ method: 'GET', url: API.data })).json())
    const entry: Entry = {
      room: { ...d.rooms[0], id: 'room_route', name: 'Route Room' },
      review: { ...d.reviews[0], id: 'rev_route', roomId: 'room_route', puzzles: [] },
    }
    const ok = await app.inject({ method: 'POST', url: API.entries, payload: entry })
    expect(ok.statusCode).toBe(200)
    expect(EntrySchema.parse(ok.json()).room.name).toBe('Route Room')

    const after = DatasetSchema.parse((await app.inject({ method: 'GET', url: API.data })).json())
    expect(after.rooms).toHaveLength(13)

    const bad = await app.inject({ method: 'POST', url: API.entries, payload: { room: { id: 'x' } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toMatch(/Invalid entry/)

    const badScore = structuredClone(entry)
    badScore.review.ratings.overall.score = 500
    expect((await app.inject({ method: 'POST', url: API.entries, payload: badScore })).statusCode).toBe(400)
  })

  it('GET/PUT /api/wishlist', async () => {
    const get = await app.inject({ method: 'GET', url: API.wishlist })
    expect(get.statusCode).toBe(200)
    expect(get.json().length).toBeGreaterThanOrEqual(5)

    const items = [{ id: 'w1', name: 'Moon Base', city: 'Toronto', link: '', addedBy: 'Theo', priority: 1, done: false }]
    const put = await app.inject({ method: 'PUT', url: API.wishlist, payload: items })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual(items)
    expect((await app.inject({ method: 'GET', url: API.wishlist })).json()).toEqual(items)

    const bad = await app.inject({ method: 'PUT', url: API.wishlist, payload: [{ name: 'no id' }] })
    expect(bad.statusCode).toBe(400)
  })
})
