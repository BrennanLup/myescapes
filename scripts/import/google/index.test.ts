// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FX, loadFixtures } from '../../../server/db/fixtures'
import { sources, venues } from '../../../server/db/schema'
import { createTestDb, resetDb, type TestDb } from '../../../server/db/testing'
import { FIELD_MASK, PLACES_SEARCH_URL, linkGooglePlaceIds, nameSimilarity, pickMatch, searchRequest, type PlaceCandidate, type VenueForLink } from './index'

const MAPLE: VenueForLink = { id: FX.venues.maple, name: 'Maple & Key', brand: null, address: '10 Queen St W', city: 'Toronto', region: 'ON', country: 'CA', lat: 43.6519, lng: -79.3817 }

function fakeFetch(answer: (body: { textQuery: string }) => { status?: number; places?: PlaceCandidate[] }) {
  const calls: { url: string; headers: Record<string, string>; body: { textQuery: string } }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { textQuery: string }
    calls.push({ url, headers: init.headers as Record<string, string>, body })
    const a = answer(body)
    return new Response(JSON.stringify({ places: a.places ?? [] }), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

let t: TestDb
let dir: string
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await resetDb(t.db)
  await loadFixtures(t.db)
  dir = mkdtempSync(path.join(os.tmpdir(), 'google-linker-'))
  return () => rmSync(dir, { recursive: true, force: true })
})

describe('matching', () => {
  it('nameSimilarity ignores case, accents, punctuation and filler words', () => {
    expect(nameSimilarity('Maple & Key', 'MAPLE AND KEY')).toBe(1)
    expect(nameSimilarity('Escape Room Café', 'Escape Room Cafe Toronto')).toBeGreaterThanOrEqual(0.9)
    expect(nameSimilarity('Starlight Escapes', 'Starlight Escape Rooms')).toBe(1)
    expect(nameSimilarity('Maple & Key', 'Lockbox Social')).toBe(0)
  })

  it('pickMatch needs a similar name and, with coordinates, under 200 m', () => {
    const near = { latitude: 43.652, longitude: -79.3818 }
    expect(pickMatch(MAPLE, [{ id: 'far', displayName: { text: 'Maple and Key' }, location: { latitude: 43.7, longitude: -79.4 } }])).toBeNull()
    expect(pickMatch(MAPLE, [{ id: 'other', displayName: { text: 'Tim Hortons' }, location: near }])).toBeNull()
    expect(pickMatch(MAPLE, [{ id: 'noloc', displayName: { text: 'Maple and Key' } }])).toBeNull()
    expect(pickMatch(MAPLE, [{ id: 'x', displayName: { text: 'Tim Hortons' }, location: near }, { id: 'ok', displayName: { text: 'Maple & Key Escape Rooms' }, location: near }])?.id).toBe('ok')
    // Without venue coordinates the name decides.
    expect(pickMatch({ ...MAPLE, lat: null, lng: null }, [{ id: 'ok', displayName: { text: 'Maple and Key' } }])?.id).toBe('ok')
  })

  it('searchRequest biases to the venue location and country', () => {
    expect(searchRequest(MAPLE)).toEqual({
      textQuery: 'Maple & Key, 10 Queen St W, Toronto, ON',
      pageSize: 5,
      regionCode: 'CA',
      locationBias: { circle: { center: { latitude: 43.6519, longitude: -79.3817 }, radius: 500 } },
    })
    expect(searchRequest({ ...MAPLE, country: 'ZZ', lat: null, lng: null })).not.toHaveProperty('regionCode')
  })
})

describe('linkGooglePlaceIds', () => {
  it('does nothing without an API key', async () => {
    const f = fakeFetch(() => ({}))
    const prev = process.env.GOOGLE_MAPS_API_KEY
    delete process.env.GOOGLE_MAPS_API_KEY
    try {
      const r = await linkGooglePlaceIds(t.db, { fetchImpl: f.impl, statePath: null })
      expect(r).toMatchObject({ disabled: true, linked: 0 })
      expect(f.calls).toHaveLength(0)
    } finally {
      if (prev !== undefined) process.env.GOOGLE_MAPS_API_KEY = prev
    }
  })

  it('stores only the place id and a source row, for matching venues', async () => {
    const f = fakeFetch(() => ({ places: [{ id: 'ChIJmaple', displayName: { text: 'Maple and Key' }, location: { latitude: 43.652, longitude: -79.3818 } }] }))
    const r = await linkGooglePlaceIds(t.db, { apiKey: 'test-key', fetchImpl: f.impl, statePath: null, delayMs: 0 })
    // Only Maple lacks a place id in the fixtures.
    expect(r).toMatchObject({ linked: 1, missed: 0, failed: 0, disabled: false })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe(PLACES_SEARCH_URL)
    expect(f.calls[0].headers['X-Goog-FieldMask']).toBe(FIELD_MASK)
    const [v] = await t.db.select().from(venues).where(eq(venues.id, FX.venues.maple))
    expect(v.googlePlaceId).toBe('ChIJmaple')
    // Nothing else from Google was written.
    expect(v.name).toBe('Maple & Key')
    expect(v.lat).toBe(43.6519)
    const src = await t.db.select().from(sources).where(eq(sources.source, 'google'))
    expect(src).toHaveLength(1)
    expect(src[0]).toMatchObject({ entityId: FX.venues.maple, sourceId: 'ChIJmaple', fields: { googlePlaceId: 'ChIJmaple' } })
  })

  it('remembers misses and skips them on the next run', async () => {
    const statePath = path.join(dir, 'state.json')
    const miss = fakeFetch(() => ({ places: [{ id: 'nope', displayName: { text: 'Somewhere Else' }, location: { latitude: 0, longitude: 0 } }] }))
    const r1 = await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: miss.impl, statePath, delayMs: 0 })
    expect(r1).toMatchObject({ linked: 0, missed: 1 })
    expect(Object.keys(JSON.parse(readFileSync(statePath, 'utf8')).misses)).toEqual([FX.venues.maple])
    const r2 = await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: miss.impl, statePath, delayMs: 0 })
    expect(r2).toMatchObject({ linked: 0, missed: 0, skipped: 1 })
    expect(miss.calls).toHaveLength(1)
    // After 30 days it tries again.
    const later = () => new Date(Date.now() + 31 * 24 * 3600 * 1000)
    const r3 = await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: miss.impl, statePath, delayMs: 0, now: later })
    expect(r3.missed).toBe(1)
  })

  it('does not reuse a place id that another venue already has', async () => {
    const f = fakeFetch(() => ({ places: [{ id: 'ChIJfixtureStarlight', displayName: { text: 'Maple and Key' }, location: { latitude: 43.652, longitude: -79.3818 } }] }))
    const r = await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: f.impl, statePath: null, delayMs: 0 })
    expect(r).toMatchObject({ linked: 0, missed: 1 })
    expect((await t.db.select().from(venues).where(eq(venues.id, FX.venues.maple)))[0].googlePlaceId).toBeNull()
  })

  it('stops on quota or key errors, counts other failures, and a dry run writes nothing', async () => {
    const quota = fakeFetch(() => ({ status: 429 }))
    const r = await linkGooglePlaceIds(t.db, { apiKey: 'SECRET-KEY-123', fetchImpl: quota.impl, statePath: null, delayMs: 0 })
    expect(r.stoppedReason).toMatch(/429/)
    expect(r.stoppedReason).not.toContain('SECRET-KEY-123')
    const boom = fakeFetch(() => ({ status: 500 }))
    expect(await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: boom.impl, statePath: null, delayMs: 0 })).toMatchObject({ failed: 1, linked: 0 })

    const statePath = path.join(dir, 'dry.json')
    const ok = fakeFetch(() => ({ places: [{ id: 'ChIJmaple', displayName: { text: 'Maple and Key' }, location: { latitude: 43.652, longitude: -79.3818 } }] }))
    expect(await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: ok.impl, statePath, delayMs: 0, dryRun: true })).toMatchObject({ linked: 1 })
    expect((await t.db.select().from(venues).where(eq(venues.id, FX.venues.maple)))[0].googlePlaceId).toBeNull()
    expect(existsSync(statePath)).toBe(false)
  })

  it('respects --country and --limit', async () => {
    const f = fakeFetch(() => ({ places: [] }))
    expect(await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: f.impl, statePath: null, delayMs: 0, country: 'us' })).toMatchObject({ linked: 0, missed: 0 })
    expect(await linkGooglePlaceIds(t.db, { apiKey: 'k', fetchImpl: f.impl, statePath: null, delayMs: 0, limit: 0 })).toMatchObject({ missed: 0 })
    expect(f.calls).toHaveLength(0)
  })
})
