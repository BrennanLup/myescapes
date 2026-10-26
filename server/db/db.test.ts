// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { count, eq, sql } from 'drizzle-orm'
import { FIXTURE_DATASET } from '../../src/contracts/fixtures'
import { DatasetSchema, type Entry } from '../../src/contracts/types'
import { datasetForUser, getWishlistForUser, putWishlistForUser, saveEntryForUser } from './dataset'
import { FX, loadFixtures, pair } from './fixtures'
import { friendships, reviews, users, venues, visitParticipants, visits } from './schema'
import { seedDemoDirectory } from './seed'
import { ALL_TABLES, createTestDb, resetDb, type TestDb } from './testing'
import { reserveUsage, releaseUsage, usageSummary, capsFromEnv, type Caps } from './usage'
import { citySlug, isUniqueViolation, slugify, toPublicUser, uniqueSlug } from './util'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('migrations', () => {
  it('create every table and are safe to re-run', async () => {
    await t.handle.migrate()
    await t.handle.migrate()
    const rows = await t.db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public'`)
    const names = new Set((rows as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name))
    for (const table of ALL_TABLES) expect(names.has(table), table).toBe(true)
  })

  it('enable pg_trgm for fuzzy search', async () => {
    const r = await t.db.execute<{ s: number }>(sql`select similarity('starlight escapes', 'starlite escape') as s`)
    expect((r as unknown as { rows: { s: number }[] }).rows[0].s).toBeGreaterThan(0.3)
  })
})

describe('fixtures', () => {
  beforeAll(async () => {
    await resetDb(t.db)
    await loadFixtures(t.db)
  })

  it('load the people, friendships and visits', async () => {
    expect((await t.db.select({ n: count() }).from(users))[0].n).toBe(8)
    const ab = pair(FX.users.alice, FX.users.bob)
    const f = await t.db.select().from(friendships).where(eq(friendships.userA, ab.userA))
    expect(f.some((x) => x.status === 'accepted')).toBe(true)
    const parts = await t.db.select().from(visitParticipants).where(eq(visitParticipants.visitId, FX.visits.together))
    expect(parts.map((p) => p.status).sort()).toEqual(['accepted', 'owner'])
  })

  it('enforce one review per author per visit', async () => {
    const dup = t.db.insert(reviews).values({
      visitId: FX.visits.together, authorId: FX.users.alice,
      overallScore: 50, puzzlesScore: 50, settingScore: 50, storylineScore: 50, difficultyScore: 50,
    })
    await expect(dup).rejects.toSatisfy(isUniqueViolation)
  })

  it('reject out-of-range scores and participants with neither user nor guest name', async () => {
    await expect(
      t.db.insert(reviews).values({ visitId: FX.visits.solo, authorId: FX.users.bob, overallScore: 500, puzzlesScore: 50, settingScore: 50, storylineScore: 50, difficultyScore: 50 }),
    ).rejects.toThrow()
    await expect(t.db.insert(visitParticipants).values({ visitId: FX.visits.solo, status: 'accepted' })).rejects.toThrow()
  })

  it('handles are unique case-insensitively', async () => {
    await expect(t.db.update(users).set({ handle: 'ALICE' }).where(eq(users.id, FX.users.bob))).rejects.toSatisfy(isUniqueViolation)
  })

  it('deleting a user cascades their reviews and nulls their tags', async () => {
    await t.db.update(visitParticipants).set({ guestName: 'Bob' }).where(eq(visitParticipants.userId, FX.users.bob))
    await t.db.delete(users).where(eq(users.id, FX.users.bob))
    expect(await t.db.select().from(reviews).where(eq(reviews.authorId, FX.users.bob))).toHaveLength(0)
    const tag = await t.db.select().from(visitParticipants).where(eq(visitParticipants.id, FX.participants.bobTogether))
    expect(tag[0].userId).toBeNull()
    expect(tag[0].guestName).toBe('Bob')
    expect(await t.db.select().from(visits).where(eq(visits.id, FX.visits.together))).toHaveLength(1)
  })
})

describe('Phase 1 dataset mapping', () => {
  beforeAll(async () => {
    await resetDb(t.db)
    await loadFixtures(t.db)
  })

  it('maps a user\'s visits to the Phase 1 Dataset shape', async () => {
    const d = DatasetSchema.parse(await datasetForUser(t.db, FX.users.alice))
    expect(d.source).toBe('postgres')
    // alice: together, solo, guest, pending, copy (not carol's)
    expect(d.reviews.map((r) => r.id).sort()).toEqual([FX.visits.copy, FX.visits.guest, FX.visits.pending, FX.visits.solo, FX.visits.together].sort())
    const together = d.reviews.find((r) => r.id === FX.visits.together)!
    expect(together.crew).toEqual(['Bob'])
    expect(together.puzzles.find((p) => p.id === FX.puzzles.clock)?.memorable).toBe(true)
    expect(together.photos[0].url).toBe(`/api/photos/${FX.photos.bobTogether}`)
    expect(d.wishlist.map((w) => w.name)).toEqual(['Sky Pirates', 'The Vault'])
  })

  it('bob sees only visits he accepted, never alice\'s transcript', async () => {
    const d = await datasetForUser(t.db, FX.users.bob)
    expect(d.reviews.map((r) => r.id)).toEqual([FX.visits.together])
    expect(d.reviews[0].voiceTranscript).toBe('Bob private transcript')
  })

  it('saves a Phase 1 entry and re-saves it idempotently', async () => {
    const entry: Entry = { room: FIXTURE_DATASET.rooms[0], review: { ...FIXTURE_DATASET.reviews[0], crew: ['Alice', 'Maya'] } }
    const saved = await saveEntryForUser(t.db, FX.users.carol, entry)
    expect(saved.room.name).toBe('The Clockmaker')
    expect(saved.review.crew).toEqual(['Alice', 'Maya'])
    expect(saved.review.ratings.overall.score).toBe(88)
    const again = await saveEntryForUser(t.db, FX.users.carol, { ...entry, review: { ...entry.review, ratings: { ...entry.review.ratings, overall: { score: 91, comment: 'Even better' } } } })
    expect(again.review.id).toBe(saved.review.id)
    expect(again.review.ratings.overall.score).toBe(91)
    const d = await datasetForUser(t.db, FX.users.carol)
    expect(d.reviews.filter((r) => r.roomId === saved.room.id)).toHaveLength(1)
    // Re-saving by the visit id (what the client sends back) also updates in place.
    const third = await saveEntryForUser(t.db, FX.users.carol, { room: again.room, review: { ...again.review, escaped: false } })
    expect(third.review.id).toBe(saved.review.id)
    expect(third.review.escaped).toBe(false)
  })

  it('wish list: replace and read back, per user', async () => {
    const items = [{ id: 'w_new', name: 'Moon Base', city: 'Toronto', link: '', addedBy: 'Alice', priority: 1, done: false }]
    expect((await putWishlistForUser(t.db, FX.users.alice, items)).map((w) => w.name)).toEqual(['Moon Base'])
    // Bob's item id can't be hijacked by alice.
    const hijack = await putWishlistForUser(t.db, FX.users.alice, [{ id: 'wsh_bob_1', name: 'Mine now', city: '', link: '', addedBy: '', priority: 1, done: false }])
    expect(hijack[0].id).not.toBe('wsh_bob_1')
    expect((await getWishlistForUser(t.db, FX.users.bob)).map((w) => w.name)).toEqual(['Moon Base'])
  })
})

describe('spending caps', () => {
  const caps: Caps = { transcription: { user: 100, global: 150 }, extraction: { user: 2, global: 1000 } }
  const now = new Date('2026-10-26T10:00:00Z')

  beforeAll(async () => {
    await resetDb(t.db)
    await loadFixtures(t.db)
  })

  it('counts per user and refuses over the user cap without counting', async () => {
    expect(await reserveUsage(t.db, { userId: FX.users.alice, kind: 'extraction', amount: 1, now, caps })).toEqual({ ok: true })
    expect(await reserveUsage(t.db, { userId: FX.users.alice, kind: 'extraction', amount: 1, now, caps })).toEqual({ ok: true })
    const over = await reserveUsage(t.db, { userId: FX.users.alice, kind: 'extraction', amount: 1, now, caps })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.cap).toMatchObject({ kind: 'extraction', scope: 'user', limit: 2, used: 2, unit: 'calls' })
    expect((await usageSummary(t.db, FX.users.alice, now, caps)).extractionCalls).toEqual({ used: 2, limit: 2 })
  })

  it('enforces the global ceiling across users and rolls back the user counter', async () => {
    expect((await reserveUsage(t.db, { userId: FX.users.alice, kind: 'transcription', amount: 90, now, caps })).ok).toBe(true)
    const r = await reserveUsage(t.db, { userId: FX.users.bob, kind: 'transcription', amount: 90, now, caps })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.cap.scope).toBe('global')
    expect((await usageSummary(t.db, FX.users.bob, now, caps)).transcriptionSeconds.used).toBe(0)
    await releaseUsage(t.db, { userId: FX.users.alice, kind: 'transcription', amount: 90, now })
    expect((await reserveUsage(t.db, { userId: FX.users.bob, kind: 'transcription', amount: 90, now, caps })).ok).toBe(true)
  })

  it('resets on the next UTC day', async () => {
    const tomorrow = new Date('2026-10-27T00:00:01Z')
    expect((await reserveUsage(t.db, { userId: FX.users.alice, kind: 'extraction', amount: 1, now: tomorrow, caps })).ok).toBe(true)
  })

  it('reads limits from env, ignoring junk', () => {
    const c = capsFromEnv({ CAP_EXTRACT_CALLS_PER_USER: '5', CAP_TRANSCRIBE_SECONDS_GLOBAL: 'lots' })
    expect(c.extraction.user).toBe(5)
    expect(c.transcription.global).toBe(6 * 60 * 60)
  })
})

describe('util', () => {
  it('slugify and citySlug', () => {
    expect(slugify('Maple & Key: Haunted Lighthouse!')).toBe('maple-and-key-haunted-lighthouse')
    expect(slugify('Café Évasion')).toBe('cafe-evasion')
    expect(slugify('???')).toBe('item')
    expect(citySlug('San Francisco', 'CA', 'US')).toBe('san-francisco-ca-us')
    expect(citySlug('‘Aiea', 'HI', 'US')).toBe('aiea-hi-us')
    expect(citySlug('Itemville', 'TX', 'US')).toBe('itemville-tx-us')
  })

  it('citySlug keeps non-Latin city names apart instead of collapsing them to the region', () => {
    const richmond = citySlug('里士满', 'BC', 'CA')
    const vancouver = citySlug('温哥华', 'BC', 'CA')
    expect(richmond).toMatch(/^city-[0-9a-f]{8}-bc-ca$/)
    expect(vancouver).toMatch(/^city-[0-9a-f]{8}-bc-ca$/)
    expect(richmond).not.toBe(vancouver)
    expect(citySlug(' 里士满 ', 'BC', 'CA')).toBe(richmond)
    expect(citySlug('', 'BC', 'CA')).toBe('bc-ca')
  })

  it('uniqueSlug finds the next free suffix', async () => {
    await resetDb(t.db)
    await loadFixtures(t.db)
    expect(await uniqueSlug(t.db, venues, venues.slug, FX.venueSlugs.starlight)).toBe(`${FX.venueSlugs.starlight}-2`)
    expect(await uniqueSlug(t.db, venues, venues.slug, 'brand-new')).toBe('brand-new')
  })

  it('toPublicUser never includes the email', () => {
    const p = toPublicUser({ id: 'u', handle: 'h', displayName: null, name: 'Google Name', image: null, email: 'x@example.com' } as never)
    expect(p).toEqual({ id: 'u', handle: 'h', displayName: 'Google Name', image: null })
  })

  it('demo seed is idempotent', async () => {
    await resetDb(t.db)
    const first = await seedDemoDirectory(t.db)
    expect(first.games).toBe(12)
    const second = await seedDemoDirectory(t.db)
    expect(second).toEqual({ venues: 0, games: 0 })
  })
})
