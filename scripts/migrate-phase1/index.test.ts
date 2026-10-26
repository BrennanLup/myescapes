// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Entry } from '../../src/contracts/types'
import { datasetForUser } from '../../server/db/dataset'
import { TINY_PNG } from '../../server/db/fixtures'
import { games, reviews, users, venues, visitParticipants, visitPhotos, visitPuzzles, visits, wishlistItems } from '../../server/db/schema'
import { createTestDb, resetDb, type TestDb } from '../../server/db/testing'
import { buildTestApp } from '../../server/testing'
import { decodeDataUrl, formatSummary, imageSize, migratePhase1, MigrationError, parseArgs, readPhase1Data, selfNameSet } from './index'

const PNG_URL = `data:image/png;base64,${Buffer.from(TINY_PNG).toString('base64')}`
const USER = { id: 'usr_owner', name: 'Brennan Lup', email: 'Owner@Example.com', emailVerified: true }

function entry(id: string, over: { room?: Partial<Entry['room']>; review?: Partial<Entry['review']> } = {}): Entry {
  const roomId = over.room?.id ?? `room_${id}`
  const rating = (score: number, comment = '') => ({ score, comment })
  return {
    room: { id: roomId, name: `Room ${id}`, company: 'Fog City Escapes', city: 'San Francisco', genre: 'mystery', address: '1 Main St', website: '', photos: [], ...over.room },
    review: {
      id,
      roomId,
      date: '2025-03-01',
      crew: ['Brennan', 'Mia'],
      ratings: { overall: rating(90, 'Loved it'), puzzles: rating(80), setting: rating(85), storyline: rating(70), difficulty: rating(60) },
      puzzles: [
        { id: `${id}_p1`, reviewId: id, description: 'Clock puzzle', type: 'logic', memorable: true },
        { id: `${id}_p2`, reviewId: id, description: 'UV message', type: 'search', memorable: false },
      ],
      escaped: true,
      escapeTimeMinutes: 52,
      visibleTimer: true,
      multiRoom: false,
      flashlights: true,
      liveActors: false,
      toolsUsed: ['UV light'],
      voiceTranscript: 'We loved the clock.',
      photos: [],
      ...over.review,
    },
  }
}

function writeStore(dir: string, store: unknown) {
  writeFileSync(path.join(dir, 'store.json'), JSON.stringify(store))
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
  await t.db.insert(users).values(USER)
  dir = mkdtempSync(path.join(os.tmpdir(), 'migrate-phase1-'))
  return () => rmSync(dir, { recursive: true, force: true })
})

describe('readPhase1Data', () => {
  it('needs a store.json unless the seed is included', async () => {
    await expect(readPhase1Data({ dataDir: dir })).rejects.toBeInstanceOf(MigrationError)
  })

  it('reads the seed and lays the overlay over it by review and room id', async () => {
    const seedOnly = await readPhase1Data({ dataDir: dir, includeSeed: true })
    expect(seedOnly.entries).toHaveLength(12)
    expect(seedOnly.wishlist.length).toBeGreaterThan(0)

    const lighthouse = seedOnly.entries.find((e) => e.review.id === 'rev_lighthouse')!
    const changed = { room: { ...lighthouse.room, name: 'Renamed Lighthouse' }, review: { ...lighthouse.review, escaped: false } }
    writeStore(dir, { entries: [changed, entry('rev_new')], wishlist: [{ id: 'w1', name: 'Moon Base', priority: 1 }] })
    const both = await readPhase1Data({ dataDir: dir, includeSeed: true })
    expect(both.entries).toHaveLength(13)
    const merged = both.entries.find((e) => e.review.id === 'rev_lighthouse')!
    expect(merged.room.name).toBe('Renamed Lighthouse')
    expect(merged.review.escaped).toBe(false)
    // A non-null overlay wish list replaces the seed's, as in Phase 1.
    expect(both.wishlist.map((w) => w.name)).toEqual(['Moon Base'])
    // Sorted by date.
    const dates = both.entries.map((e) => e.review.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('skips invalid overlay entries with a warning instead of failing', async () => {
    writeStore(dir, { entries: [entry('rev_ok'), { room: { id: 'x' }, review: { id: 'rev_bad' } }], wishlist: [{ nope: true }] })
    const data = await readPhase1Data({ dataDir: dir })
    expect(data.entries.map((e) => e.review.id)).toEqual(['rev_ok'])
    expect(data.warnings.join('\n')).toMatch(/rev_bad/)
    expect(data.warnings.join('\n')).toMatch(/wish list item 0/)
  })

  it('reports a store.json that is not JSON', async () => {
    writeFileSync(path.join(dir, 'store.json'), '{nope')
    await expect(readPhase1Data({ dataDir: dir })).rejects.toThrow(/Could not read/)
  })
})

describe('migratePhase1', () => {
  it('refuses an unknown account and a bad visibility', async () => {
    writeStore(dir, { entries: [entry('rev_a')] })
    await expect(migratePhase1(t.db, { email: 'nobody@example.com', dataDir: dir })).rejects.toThrow(/No account/)
    await expect(migratePhase1(t.db, { email: '', dataDir: dir })).rejects.toThrow(/email/)
    await expect(migratePhase1(t.db, { email: USER.email, dataDir: dir, visibility: 'everyone' as never })).rejects.toThrow(/visibility/)
  })

  it('imports entries into the account: venue, game, visit, private review, puzzles, guests', async () => {
    writeStore(dir, { entries: [entry('rev_a'), entry('rev_b', { room: { id: 'room_a', name: 'Room rev_a' }, review: { date: '2025-06-01', crew: ['brennan', 'Jules'] } })] })
    const r = await migratePhase1(t.db, { email: 'owner@example.com', dataDir: dir })
    expect(r).toMatchObject({ imported: 2, skipped: 0, failed: 0, updated: 0 })

    expect(await t.db.select().from(venues)).toHaveLength(1)
    expect(await t.db.select().from(games)).toHaveLength(1)
    const vs = await t.db.select().from(visits).where(eq(visits.createdBy, USER.id))
    expect(vs.map((v) => v.legacyId).sort()).toEqual(['rev_a', 'rev_b'])
    const rv = await t.db.select().from(reviews).where(eq(reviews.authorId, USER.id))
    expect(rv).toHaveLength(2)
    expect(rv.every((x) => x.visibility === 'private' && !x.scoresCopied)).toBe(true)
    expect(rv.find((x) => x.visitId === vs.find((v) => v.legacyId === 'rev_a')!.id)!.overallComment).toBe('Loved it')

    const a = vs.find((v) => v.legacyId === 'rev_a')!
    const parts = await t.db.select().from(visitParticipants).where(eq(visitParticipants.visitId, a.id))
    // "Brennan" is the owner's first name: not a guest.
    expect(parts.filter((p) => p.userId === USER.id).map((p) => p.status)).toEqual(['owner'])
    expect(parts.filter((p) => !p.userId).map((p) => p.guestName)).toEqual(['Mia'])
    const b = vs.find((v) => v.legacyId === 'rev_b')!
    const bGuests = await t.db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, b.id), sql`${visitParticipants.userId} is null`))
    expect(bGuests.map((p) => p.guestName)).toEqual(['Jules'])
    expect(await t.db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, a.id))).toHaveLength(2)

    // The 3D room (Phase 1 shape) shows them.
    const ds = await datasetForUser(t.db, USER.id)
    expect(ds.reviews).toHaveLength(2)
    expect(ds.reviews[0].puzzles.filter((p) => p.memorable)).toHaveLength(1)
    expect(ds.reviews[0].voiceTranscript).toBe('We loved the clock.')
  })

  it('honours --visibility and --self-name', async () => {
    writeStore(dir, { entries: [entry('rev_a', { review: { crew: ['Bren', 'Mia'] } })] })
    await migratePhase1(t.db, { email: USER.email, dataDir: dir, visibility: 'public', selfNames: ['Bren'] })
    const rv = await t.db.select().from(reviews)
    expect(rv[0].visibility).toBe('public')
    const guests = await t.db.select().from(visitParticipants).where(sql`${visitParticipants.userId} is null`)
    expect(guests.map((g) => g.guestName)).toEqual(['Mia'])
  })

  it('is idempotent: a re-run skips imported entries and keeps in-app edits', async () => {
    writeStore(dir, { entries: [entry('rev_a')], wishlist: [{ id: 'w1', name: 'Moon Base', city: 'Toronto', priority: 1 }] })
    await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    await t.db.update(reviews).set({ overallScore: 42 })
    const again = await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    expect(again).toMatchObject({ imported: 0, skipped: 1, failed: 0, wishlist: { added: 0, skipped: 1 } })
    expect((await t.db.select().from(reviews))[0].overallScore).toBe(42)
    expect(await t.db.select().from(visits)).toHaveLength(1)
    expect(await t.db.select().from(wishlistItems)).toHaveLength(1)
  })

  it('--update overwrites earlier imports in place', async () => {
    writeStore(dir, { entries: [entry('rev_a')] })
    await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    const before = (await t.db.select().from(visits))[0]
    writeStore(dir, { entries: [entry('rev_a', { review: { escaped: false, crew: ['Theo'] } })] })
    const r = await migratePhase1(t.db, { email: USER.email, dataDir: dir, update: true })
    expect(r).toMatchObject({ imported: 0, updated: 1 })
    const after = await t.db.select().from(visits)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(after[0].escaped).toBe(false)
    const guests = await t.db.select().from(visitParticipants).where(sql`${visitParticipants.userId} is null`)
    expect(guests.map((g) => g.guestName)).toEqual(['Theo'])
  })

  it('a dry run reports and writes nothing', async () => {
    writeStore(dir, { entries: [entry('rev_a'), entry('rev_b')], wishlist: [{ id: 'w1', name: 'Moon Base', priority: 1 }] })
    const r = await migratePhase1(t.db, { email: USER.email, dataDir: dir, dryRun: true })
    expect(r).toMatchObject({ dryRun: true, imported: 2, wishlist: { added: 1 } })
    expect(await t.db.select().from(visits)).toHaveLength(0)
    expect(await t.db.select().from(venues)).toHaveLength(0)
    expect(await t.db.select().from(wishlistItems)).toHaveLength(0)
    expect(formatSummary(r)).toMatch(/dry run/)
  })

  it('copies data: image photos, skips SVG and links, and puts room photos on the first visit only', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`
    writeStore(dir, {
      entries: [
        entry('rev_a', { room: { id: 'room_x', photos: [{ url: PNG_URL, caption: 'Room shot' }, { url: '/seed/photos/x.svg' }] }, review: { photos: [{ url: PNG_URL, caption: 'Dup' }, { url: svg }] } }),
        entry('rev_b', { room: { id: 'room_x', photos: [{ url: PNG_URL, caption: 'Room shot' }] }, review: { date: '2025-09-09', photos: [{ url: 'https://example.com/a.jpg' }] } }),
      ],
    })
    const r = await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    // The later entry's room replaces the earlier one (as in Phase 1), so the room photos are [PNG]: a duplicate.
    expect(r.photos).toEqual({ imported: 1, skipped: 2 })
    const ph = await t.db.select().from(visitPhotos)
    expect(ph).toHaveLength(1)
    expect(ph[0]).toMatchObject({ mime: 'image/png', width: 1, height: 1, uploaderId: USER.id, caption: 'Dup', sizeBytes: TINY_PNG.length })
    const a = (await t.db.select().from(visits).where(eq(visits.legacyId, 'rev_a')))[0]
    expect(ph[0].visitId).toBe(a.id)
  })

  it('merges the wish list without duplicates', async () => {
    await t.db.insert(wishlistItems).values({ userId: USER.id, name: 'Moon Base', city: 'Toronto', priority: 1 })
    writeStore(dir, {
      entries: [],
      wishlist: [
        { id: 'w1', name: 'moon base', city: 'toronto', priority: 1 },
        { id: 'w2', name: 'Sky Pirates', city: 'San Francisco', link: 'https://example.com', addedBy: 'Mia', priority: 2, done: true },
        { id: 'w3', name: 'Sky Pirates', city: 'San Francisco', priority: 3 },
      ],
    })
    const r = await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    expect(r.wishlist).toEqual({ added: 1, skipped: 2 })
    const items = await t.db.select().from(wishlistItems)
    expect(items.map((i) => i.name).sort()).toEqual(['Moon Base', 'Sky Pirates'])
    expect(items.find((i) => i.name === 'Sky Pirates')).toMatchObject({ done: true, addedBy: 'Mia', link: 'https://example.com' })
    expect(items.every((i) => i.id.startsWith('wsh_'))).toBe(true)
  })

  it('imports the whole Phase 1 seed with --include-seed, and nobody else sees private reviews', async () => {
    const r = await migratePhase1(t.db, { email: USER.email, dataDir: dir, includeSeed: true })
    expect(r).toMatchObject({ imported: 12, failed: 0 })
    expect(r.wishlist.added).toBeGreaterThan(0)
    const ds = await datasetForUser(t.db, USER.id)
    expect(ds.reviews).toHaveLength(12)
    // Seed crew "Brennan" is the owner, so never a guest.
    const guests = await t.db.select({ n: visitParticipants.guestName }).from(visitParticipants).where(sql`lower(${visitParticipants.guestName}) = 'brennan'`)
    expect(guests).toHaveLength(0)
    expect((await t.db.select().from(reviews)).every((x) => x.visibility === 'private')).toBe(true)
  })
})

describe('API after migration', () => {
  it('GET /api/data shows the imported visits to the owner only', async () => {
    writeStore(dir, { entries: [entry('rev_a'), entry('rev_b')] })
    await migratePhase1(t.db, { email: USER.email, dataDir: dir })
    await t.db.insert(users).values({ id: 'usr_other', name: 'Someone Else', email: 'other@example.com' })
    const app = await buildTestApp({ testDb: t })
    try {
      const mine = await app.inject({ method: 'GET', url: '/api/data', as: USER.id })
      expect(mine.statusCode).toBe(200)
      const body = mine.json() as { source: string; reviews: { crew: string[] }[] }
      expect(body.source).toBe('postgres')
      expect(body.reviews).toHaveLength(2)
      expect(body.reviews[0].crew).toEqual(['Mia'])
      const theirs = await app.inject({ method: 'GET', url: '/api/data', as: 'usr_other' })
      expect((theirs.json() as { reviews: unknown[] }).reviews).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})

describe('helpers', () => {
  it('parseArgs reads every flag', () => {
    expect(parseArgs(['--email', 'a@b.c', '--data-dir=/x', '--include-seed', '--visibility', 'public', '--update', '--dry-run', '--self-name', 'Bren', '--no-wishlist', '--no-photos'])).toEqual({
      email: 'a@b.c', dataDir: '/x', includeSeed: true, visibility: 'public', update: true, dryRun: true, selfNames: ['Bren'], wishlist: false, photos: false,
    })
    expect(parseArgs(['--help']).help).toBe(true)
    expect(() => parseArgs(['--bogus'])).toThrow(MigrationError)
    expect(() => parseArgs(['--email'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--email', '--dry-run'])).toThrow(/needs a value/)
  })

  it('decodeDataUrl accepts raster images only', () => {
    expect(decodeDataUrl(PNG_URL)?.mime).toBe('image/png')
    expect(decodeDataUrl('data:image/jpg;base64,/9j/4AAQ')?.mime).toBe('image/jpeg')
    expect(decodeDataUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull()
    expect(decodeDataUrl('data:text/html;base64,PGgxPg==')).toBeNull()
    expect(decodeDataUrl('/seed/photos/a.svg')).toBeNull()
    expect(decodeDataUrl('data:image/png;base64,')).toBeNull()
  })

  it('imageSize reads PNG, GIF and JPEG headers', () => {
    expect(imageSize(TINY_PNG, 'image/png')).toEqual({ width: 1, height: 1 })
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 2, 0])
    expect(imageSize(gif, 'image/gif')).toEqual({ width: 3, height: 2 })
    // SOI, APP0 (len 4), SOF0 with height 0x10 and width 0x20.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0, 0, 0, 0])
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ width: 32, height: 16 })
    expect(imageSize(Uint8Array.from([1, 2, 3]), 'image/png')).toBeNull()
  })

  it('selfNameSet includes first names', () => {
    expect([...selfNameSet({ name: 'Brennan Lup', displayName: 'B' }, ['Bren'])].sort()).toEqual(['b', 'bren', 'brennan', 'brennan lup'])
  })
})
