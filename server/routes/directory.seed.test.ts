// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildRegionSeed, writeSeeds } from '../../scripts/import/dedupe'
import type { RawPlace, Region } from '../../scripts/import/types'
import { createContext } from '../context'
import { FX, loadFixtures } from '../db/fixtures'
import { cities, sources, venues } from '../db/schema'
import { createTestDb, resetDb, type TestDb } from '../db/testing'
import {
  DEFAULT_DIRECTORY_SEED_DIR,
  decodeSeed,
  loadDirectorySeed,
  loadSeedRegion,
  readManifest,
  seedCoverage,
  seedLoaderEnabled,
  seedState,
  startDirectorySeedLoader,
} from './directory.seed'

const US: Region = { id: 'us', name: 'United States', country: 'US' }
const CA: Region = { id: 'ca', name: 'Canada', country: 'CA' }

function place(id: string, over: Partial<RawPlace> = {}): RawPlace {
  return {
    source: 'foursquare', sourceId: id, name: `Escape ${id}`, brand: null, address: `${id} Main St`, city: 'Austin', region: 'TX', country: 'US',
    postalCode: null, lat: 30.27 + Number.parseInt(id.replace(/\D/g, '') || '0', 10) * 0.01, lng: -97.74, website: null, phone: null,
    license: 'Apache-2.0', attribution: 'Foursquare Open Source Places', raw: {}, ...over,
  }
}

let tdb: TestDb
let dir: string
beforeAll(async () => {
  tdb = await createTestDb()
})
afterAll(async () => {
  await tdb?.close()
})
beforeEach(async () => {
  await resetDb(tdb.db)
  await tdb.db.execute(sql`drop table if exists directory_seed_state`)
  dir = mkdtempSync(path.join(os.tmpdir(), 'dir-seed-'))
  return () => rmSync(dir, { recursive: true, force: true })
})

function writeTestSeed(us: RawPlace[], ca: RawPlace[] = []) {
  const seeds = [buildRegionSeed(US, us), ...(ca.length ? [buildRegionSeed(CA, ca)] : [])]
  return writeSeeds(dir, seeds)
}

describe('loadDirectorySeed', () => {
  it('reports no_seed without a manifest', async () => {
    expect((await loadDirectorySeed(tdb.db, { dir })).status).toBe('no_seed')
  })

  it('loads venues, cities and sources, then is up to date', async () => {
    const m = writeTestSeed([place('f1'), place('f2', { city: 'Dallas' })], [place('c1', { country: 'CA', city: 'Toronto', region: 'ON', lat: 43.65, lng: -79.38 })])
    const r = await loadDirectorySeed(tdb.db, { dir })
    expect(r.status).toBe('loaded')
    expect(r.version).toBe(m.version)
    expect(r.regions.map((x) => [x.id, x.inserted])).toEqual([['us', 2], ['ca', 1]])
    const vs = await tdb.db.select().from(venues)
    expect(vs.map((v) => v.slug).sort()).toEqual(['escape-c1-toronto', 'escape-f1-austin', 'escape-f2-dallas'])
    expect(vs.find((v) => v.fsqId === 'f1')).toMatchObject({ city: 'Austin', citySlug: 'austin-tx-us', country: 'US', status: 'active' })
    expect((await tdb.db.select().from(cities)).map((c) => c.slug).sort()).toEqual(['austin-tx-us', 'dallas-tx-us', 'toronto-on-ca'])
    const src = await tdb.db.select().from(sources)
    expect(src).toHaveLength(3)
    expect(src[0]).toMatchObject({ entityType: 'venue', source: 'foursquare', license: 'Apache-2.0' })
    expect((await seedState(tdb.db))?.version).toBe(m.version)
    expect((await loadDirectorySeed(tdb.db, { dir })).status).toBe('up_to_date')
    expect(await seedCoverage(tdb.db)).toEqual([{ country: 'US', venues: 2 }, { country: 'CA', venues: 1 }])
  })

  it('reloads idempotently when the version changes, without duplicates', async () => {
    writeTestSeed([place('f1'), place('f2')])
    await loadDirectorySeed(tdb.db, { dir })
    const before = await tdb.db.select().from(venues)
    const m2 = writeTestSeed([place('f1', { name: 'Escape f1 Renamed' }), place('f2'), place('f3')])
    const r = await loadDirectorySeed(tdb.db, { dir })
    expect(r.status).toBe('loaded')
    expect(r.regions[0]).toMatchObject({ inserted: 1, updated: 2 })
    const after = await tdb.db.select().from(venues)
    expect(after).toHaveLength(3)
    const f1 = after.find((v) => v.fsqId === 'f1')!
    expect(f1.name).toBe('Escape f1 Renamed')
    // URLs are stable: the slug and id don't change on a re-import.
    expect(f1.slug).toBe(before.find((v) => v.fsqId === 'f1')!.slug)
    expect(f1.id).toBe(before.find((v) => v.fsqId === 'f1')!.id)
    expect(await tdb.db.select().from(sources)).toHaveLength(3)
    expect((await seedState(tdb.db))?.version).toBe(m2.version)
    // Forced reload of the same version is a no-op in effect.
    const forced = await loadDirectorySeed(tdb.db, { dir, force: true })
    expect(forced.regions[0]).toMatchObject({ inserted: 0, updated: 3 })
  })

  it('reloads when the directory was emptied even if the version matches', async () => {
    writeTestSeed([place('f1')])
    await loadDirectorySeed(tdb.db, { dir })
    await tdb.db.delete(venues)
    expect((await loadDirectorySeed(tdb.db, { dir })).status).toBe('loaded')
    expect(await tdb.db.select().from(venues)).toHaveLength(1)
  })

  it("keeps a user's applied correction over the next import, but not a mere suggestion", async () => {
    writeTestSeed([place('f1'), place('f2')])
    await loadDirectorySeed(tdb.db, { dir })
    await loadFixtures(tdb.db)
    const [f1, f2] = await Promise.all(['f1', 'f2'].map(async (id) => (await tdb.db.select().from(venues).where(eq(venues.fsqId, id)))[0]))
    await tdb.db.update(venues).set({ name: 'Corrected Name' }).where(eq(venues.id, f1.id))
    await tdb.db.insert(sources).values([
      { entityType: 'venue', entityId: f1.id, source: 'user', sourceId: FX.users.alice, license: 'user-contribution', fields: { applied: { name: 'Corrected Name' } }, userId: FX.users.alice },
      { entityType: 'venue', entityId: f2.id, source: 'user', sourceId: FX.users.bob, license: 'user-contribution', fields: { suggested: { name: 'Nope' } }, userId: FX.users.bob },
    ])
    await tdb.db.update(venues).set({ name: 'Stale' }).where(eq(venues.id, f2.id))
    writeTestSeed([place('f1', { name: 'Upstream Name' }), place('f2')])
    await loadDirectorySeed(tdb.db, { dir })
    expect((await tdb.db.select().from(venues).where(eq(venues.id, f1.id)))[0].name).toBe('Corrected Name')
    expect((await tdb.db.select().from(venues).where(eq(venues.id, f2.id)))[0].name).toBe('Escape f2')
  })

  it('gives a seed venue a suffixed slug when another venue already holds it', async () => {
    await loadFixtures(tdb.db)
    // The fixture "Starlight Escapes" (fsq_starlight) holds starlight-escapes-san-francisco.
    const seed = buildRegionSeed(US, [place('5f2c2834b6d05514c704abcd', { name: 'Starlight Escapes', city: 'San Francisco', region: 'CA', lat: 37.0, lng: -122.0 })])
    const r = await loadSeedRegion(tdb.db, seed.file)
    expect(r.inserted).toBe(1)
    const v = (await tdb.db.select().from(venues).where(eq(venues.fsqId, '5f2c2834b6d05514c704abcd')))[0]
    expect(v.slug).toBe(`${FX.venueSlugs.starlight}-04abcd`)
    // The fixture keeps its slug.
    expect((await tdb.db.select().from(venues).where(eq(venues.id, FX.venues.starlight)))[0].slug).toBe(FX.venueSlugs.starlight)
  })

  it('lets only one loader hold the lease', async () => {
    writeTestSeed([place('f1')])
    await loadDirectorySeed(tdb.db, { dir: path.join(dir, 'nothing-here') })
    await tdb.db.execute(sql`create table if not exists directory_seed_state (id text primary key, version text, loaded_at timestamptz, lease_until timestamptz, summary jsonb not null default '{}'::jsonb)`)
    await tdb.db.execute(sql`insert into directory_seed_state (id, lease_until) values ('directory', now() + interval '5 minutes')`)
    expect((await loadDirectorySeed(tdb.db, { dir })).status).toBe('busy')
    // An expired lease (a crashed loader) can be taken over.
    await tdb.db.execute(sql`update directory_seed_state set lease_until = now() - interval '1 minute'`)
    expect((await loadDirectorySeed(tdb.db, { dir })).status).toBe('loaded')
  })
})

describe('background loader', () => {
  it('is off under NODE_ENV=test unless asked, on otherwise', () => {
    expect(seedLoaderEnabled({ NODE_ENV: 'test' })).toBe(false)
    expect(seedLoaderEnabled({ NODE_ENV: 'test', DIRECTORY_SEED: 'on' })).toBe(true)
    expect(seedLoaderEnabled({ NODE_ENV: 'production' })).toBe(true)
    expect(seedLoaderEnabled({ DIRECTORY_SEED: 'off' })).toBe(false)
  })

  it('waits for the database, then loads in the background', async () => {
    writeTestSeed([place('f1'), place('f2')])
    const dbState = { status: 'migrating' as 'migrating' | 'ready', handle: null as typeof tdb.handle | null, error: null }
    const ctx = createContext({ dbState, env: { NODE_ENV: 'production' } })
    const stop = startDirectorySeedLoader(ctx, { dir, pollMs: 20 })
    await new Promise((r) => setTimeout(r, 60))
    expect(await tdb.db.select().from(venues)).toHaveLength(0)
    dbState.handle = tdb.handle
    dbState.status = 'ready'
    for (let i = 0; i < 100 && (await tdb.db.select().from(venues)).length < 2; i++) await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(await tdb.db.select().from(venues)).toHaveLength(2)
  })
})

describe('the committed seed', () => {
  const manifest = readManifest(DEFAULT_DIRECTORY_SEED_DIR)

  it('has a manifest whose files exist and match their hashes, under 25 MB in total', () => {
    expect(manifest, 'seed/directory/manifest.json').not.toBeNull()
    let total = 0
    for (const r of manifest!.regions) {
      const file = path.join(DEFAULT_DIRECTORY_SEED_DIR, r.file)
      expect(existsSync(file), r.file).toBe(true)
      const buf = readFileSync(file)
      expect(createHash('sha256').update(buf).digest('hex').slice(0, 16), r.file).toBe(r.sha)
      total += statSync(file).size
    }
    expect(total).toBeLessThan(25 * 1024 * 1024)
    expect(manifest!.regions.slice(0, 2).map((r) => r.id)).toEqual(['us', 'ca'])
  })

  it('decodes cleanly: unique slugs and Foursquare ids, valid countries and coordinates', () => {
    const slugs = new Set<string>()
    const ids = new Set<string>()
    for (const r of manifest!.regions) {
      const file = decodeSeed(readFileSync(path.join(DEFAULT_DIRECTORY_SEED_DIR, r.file)))
      expect(file.venues.length, r.id).toBe(r.venues)
      for (const v of file.venues) {
        expect(v.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        expect(slugs.has(v.slug), v.slug).toBe(false)
        slugs.add(v.slug)
        expect(ids.has(v.fsqId), v.fsqId).toBe(false)
        ids.add(v.fsqId)
        expect(v.country).toBe(r.country)
        expect(v.city.length).toBeGreaterThan(0)
        if (v.lat != null) expect(Math.abs(v.lat)).toBeLessThanOrEqual(90)
        if (v.website) expect(v.website).toMatch(/^https?:\/\//)
      }
    }
    expect(slugs.size).toBeGreaterThan(1000)
  })

  it('covers the world: a region for every country with escape rooms, readable city slugs', () => {
    const countries = new Set(manifest!.regions.map((r) => r.country))
    expect(countries.size).toBeGreaterThan(100)
    for (const r of manifest!.regions) if (!r.id.includes('-')) expect(r.id, r.id).toBe(r.country.toLowerCase())
    for (const cc of ['GB', 'DE', 'FR', 'RU', 'BR', 'KR', 'JP']) expect(manifest!.regions.some((r) => r.id === cc.toLowerCase()), cc).toBe(true)
    let venues = 0
    let hashed = 0
    for (const r of manifest!.regions) {
      const file = decodeSeed(readFileSync(path.join(DEFAULT_DIRECTORY_SEED_DIR, r.file)))
      venues += file.venues.length
      hashed += file.venues.filter((v) => /^city-[0-9a-f]{8}-/.test(v.citySlug)).length
      expect(r.bytes, r.file).toBeLessThan(1024 * 1024)
    }
    // Only names in scripts with no transliteration (CJK, Arabic, Hebrew...) get hashed city slugs.
    expect(hashed / venues).toBeLessThan(0.02)
  })

  it('loads into Postgres in reasonable time and is idempotent', async () => {
    const t0 = Date.now()
    const r = await loadDirectorySeed(tdb.db)
    expect(r.status).toBe('loaded')
    const total = manifest!.regions.reduce((n, x) => n + x.venues, 0)
    const count = (await tdb.db.select({ n: sql<number>`count(*)::int` }).from(venues))[0].n
    expect(count).toBe(total)
    expect(Date.now() - t0).toBeLessThan(90_000)
    expect((await loadDirectorySeed(tdb.db)).status).toBe('up_to_date')
  }, 120_000)
})
