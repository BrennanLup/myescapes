// @vitest-environment node
// Phase 3 (A): a room picked from the directory is saved against that game, not matched by name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { FIXTURE_DATASET } from '../../src/contracts/fixtures'
import type { Entry } from '../../src/contracts/types'
import { saveEntryForUser } from './dataset'
import { FX, loadFixtures } from './fixtures'
import { games, venues, visits } from './schema'
import { createTestDb, type TestDb } from './testing'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await loadFixtures(t.db)
})
afterAll(async () => {
  await t.close()
})

const base = (): Entry => ({ room: FIXTURE_DATASET.rooms[0], review: { ...FIXTURE_DATASET.reviews[0], id: 'rev_picked_1', crew: [] } })

describe('saveEntryForUser with a directory game id', () => {
  it('uses the picked game and its venue even when the company is the brand, not the venue name', async () => {
    const [{ n: venuesBefore }] = await t.db.select({ n: count() }).from(venues)
    const [{ n: gamesBefore }] = await t.db.select({ n: count() }).from(games)
    const e = base()
    // "Starlight" (brand-ish) and a different city spelling would never match by name.
    const saved = await saveEntryForUser(t.db, FX.users.carol, { ...e, room: { ...e.room, id: FX.games.vault, name: 'The Vault', company: 'Starlight', city: 'SF' } })
    expect(saved.room.id).toBe(FX.games.vault)
    expect(saved.room.name).toBe('The Vault')
    expect(saved.room.city).toBe('San Francisco')
    const [{ n: venuesAfter }] = await t.db.select({ n: count() }).from(venues)
    const [{ n: gamesAfter }] = await t.db.select({ n: count() }).from(games)
    expect(venuesAfter).toBe(venuesBefore)
    expect(gamesAfter).toBe(gamesBefore)
    const [v] = await t.db.select().from(visits).where(eq(visits.id, saved.review.id))
    expect(v.gameId).toBe(FX.games.vault)
  })

  it('falls back to matching by name when the id is not a known game', async () => {
    const e = base()
    const saved = await saveEntryForUser(t.db, FX.users.carol, { ...e, room: { ...e.room, id: 'gam_doesnotexist', name: 'Brand New Room', company: 'New Co', city: 'Austin' }, review: { ...e.review, id: 'rev_picked_2' } })
    expect(saved.room.id).not.toBe('gam_doesnotexist')
    expect(saved.room.name).toBe('Brand New Room')
  })

  it('adds the room at a picked venue instead of making a duplicate venue', async () => {
    const [{ n: venuesBefore }] = await t.db.select({ n: count() }).from(venues)
    const e = base()
    // A typed city ("Toronto") never equals the imported slug ("toronto-on-ca").
    const room = { ...e.room, id: 'room_venuepick', venueId: FX.venues.maple, name: 'The Last Lighthouse Keeper', company: 'Maple & Key', city: 'Toronto' }
    const saved = await saveEntryForUser(t.db, FX.users.carol, { ...e, room, review: { ...e.review, id: 'rev_picked_3' } })
    const [{ n: venuesAfter }] = await t.db.select({ n: count() }).from(venues)
    expect(venuesAfter).toBe(venuesBefore)
    const [g] = await t.db.select().from(games).where(eq(games.id, saved.room.id))
    expect(g.venueId).toBe(FX.venues.maple)
    expect(g.name).toBe('The Last Lighthouse Keeper')
  })

  it('matches an imported venue by name or brand and city name, ignoring the slug suffix', async () => {
    const [{ n: venuesBefore }] = await t.db.select({ n: count() }).from(venues)
    const e = base()
    const room = { ...e.room, id: 'room_typed', name: 'The Vault', company: 'starlight escapes', city: 'san francisco' }
    const saved = await saveEntryForUser(t.db, FX.users.carol, { ...e, room, review: { ...e.review, id: 'rev_picked_4' } })
    const [{ n: venuesAfter }] = await t.db.select({ n: count() }).from(venues)
    expect(venuesAfter).toBe(venuesBefore)
    expect(saved.room.id).toBe(FX.games.vault)
  })
})
