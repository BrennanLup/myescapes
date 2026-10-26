// @vitest-environment node
/**
 * Account routes (workstream 4): profile + onboarding, handle checks, my rooms, export, deletion.
 * Runs on the PGlite harness with the fixture people (server/db/fixtures.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { AccountExportSchema, LogRowSchema } from '../../src/contracts/models'
import { FX, loadFixtures } from '../db/fixtures'
import {
  dailyResults,
  friendships,
  games,
  invites,
  notifications,
  reports,
  reviews,
  sessions,
  usageCounters,
  users,
  venues,
  visitParticipants,
  visitPhotos,
  visits,
  wishlistItems,
} from '../db/schema'
import { resetDb } from '../db/testing'
import { buildTestApp, type TestApp } from '../testing'
import { resolveUser } from '../auth'
import { FIXTURE_DATASET } from '../../src/contracts/fixtures'
import type { Entry } from '../../src/contracts/types'

const U = FX.users
let t: TestApp

beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

/** Tests that change data reload the fixtures afterwards. */
async function reload() {
  await resetDb(t.db)
  await loadFixtures(t.db)
}

describe('GET /api/me', () => {
  it('returns the signed-in user including their own email', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/me', as: U.alice })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: U.alice, handle: 'alice', displayName: 'Alice', email: 'alice@example.com', onboarded: true, isAdmin: false })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a new user is not onboarded and shows their Google name until they choose one', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/me', as: U.newbie })
    expect(res.json()).toMatchObject({ handle: null, displayName: 'Newbie Google Name', onboarded: false })
  })

  it('401 when signed out', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)
  })
})

describe('PATCH /api/me (onboarding)', () => {
  afterEach(reload)

  it('sets display name and handle, normalises the handle, and stamps onboardedAt', async () => {
    const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.newbie, payload: { displayName: '  Brennan  ', handle: '@Brennan_L' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ handle: 'brennan_l', displayName: 'Brennan', onboarded: true })
    const row = (await t.db.select().from(users).where(eq(users.id, U.newbie)))[0]
    expect(row.onboardedAt).toBeInstanceOf(Date)
  })

  it('is not onboarded with only one of the two', async () => {
    const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.newbie, payload: { handle: 'newbie1' } })
    expect(res.json()).toMatchObject({ handle: 'newbie1', onboarded: false })
    const row = (await t.db.select().from(users).where(eq(users.id, U.newbie)))[0]
    expect(row.onboardedAt).toBeNull()
  })

  it('409 handle_taken for a taken handle, case-insensitively', async () => {
    for (const handle of ['alice', 'ALICE', '@Alice']) {
      const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.newbie, payload: { handle } })
      expect(res.statusCode, handle).toBe(409)
      expect(res.json().code).toBe('handle_taken')
    }
  })

  it('409 handle_taken for a reserved handle', async () => {
    for (const handle of ['admin', 'privacy', 'settings', 'Support']) {
      const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.newbie, payload: { handle } })
      expect(res.statusCode, handle).toBe(409)
      expect(res.json().code).toBe('handle_taken')
    }
  })

  it('400 for an invalid handle or display name', async () => {
    for (const payload of [{ handle: '1abc' }, { handle: 'ab' }, { handle: 'has space' }, { handle: 'x'.repeat(25) }, { displayName: '   ' }, { displayName: 'x'.repeat(61) }]) {
      const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.newbie, payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it('keeping your own handle is fine; changing it frees the old one', async () => {
    expect((await t.inject({ method: 'PATCH', url: '/api/me', as: U.alice, payload: { handle: 'Alice' } })).statusCode).toBe(200)
    expect((await t.inject({ method: 'PATCH', url: '/api/me', as: U.alice, payload: { handle: 'alice_2' } })).json().handle).toBe('alice_2')
    expect((await t.inject({ method: 'GET', url: '/api/handles/alice' })).json()).toMatchObject({ available: true })
  })

  it('cannot change email, admin flag or anyone else', async () => {
    const res = await t.inject({ method: 'PATCH', url: '/api/me', as: U.carol, payload: { displayName: 'Carol C', isAdmin: true, email: 'x@evil.test', id: U.alice } })
    expect(res.statusCode).toBe(200)
    const carol = (await t.db.select().from(users).where(eq(users.id, U.carol)))[0]
    expect(carol).toMatchObject({ displayName: 'Carol C', isAdmin: false, email: 'carol@example.com' })
    const alice = (await t.db.select().from(users).where(eq(users.id, U.alice)))[0]
    expect(alice.displayName).toBe('Alice')
  })

  it('401 when signed out', async () => {
    expect((await t.inject({ method: 'PATCH', url: '/api/me', payload: { handle: 'someone' } })).statusCode).toBe(401)
  })
})

describe('GET /api/handles/:handle', () => {
  it('answers taken, reserved, invalid or available, and never who has it', async () => {
    const taken = await t.inject({ method: 'GET', url: '/api/handles/Alice' })
    expect(taken.json()).toEqual({ handle: 'alice', available: false, reason: 'taken' })
    expect(taken.body).not.toContain('example.com')
    expect(taken.body).not.toContain(U.alice)
    expect((await t.inject({ method: 'GET', url: '/api/handles/admin' })).json()).toMatchObject({ available: false, reason: 'reserved' })
    expect((await t.inject({ method: 'GET', url: '/api/handles/9lives' })).json()).toMatchObject({ available: false, reason: 'invalid' })
    expect((await t.inject({ method: 'GET', url: '/api/handles/%40fresh_one' })).json()).toEqual({ handle: 'fresh_one', available: true, reason: null })
  })

  it("a signed-in user's own handle shows as available to them", async () => {
    expect((await t.inject({ method: 'GET', url: '/api/handles/alice', as: U.alice })).json()).toMatchObject({ available: true })
  })
})

describe('GET /api/logs (my room)', () => {
  it("alice sees the visits she owns, newest first, never carol's", async () => {
    const res = await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    for (const r of rows) LogRowSchema.parse(r)
    expect(rows.map((r: { visitId: string }) => r.visitId)).toEqual([FX.visits.pending, FX.visits.together, FX.visits.solo, FX.visits.copy, FX.visits.guest])
    const together = rows.find((r: { visitId: string }) => r.visitId === FX.visits.together)
    expect(together.myReview.id).toBe(FX.reviews.aliceTogether)
    expect(together.myReview.transcript).toBe('Alice private transcript')
    expect(together.crew.map((c: { user: { id: string } | null }) => c.user?.id)).toEqual([U.bob])
    expect(together.coverPhotoUrl).toBe(`/api/photos/${FX.photos.bobTogether}`)
    const guest = rows.find((r: { visitId: string }) => r.visitId === FX.visits.guest)
    expect(guest.crew).toEqual([expect.objectContaining({ user: null, guestName: 'Mia' })])
  })

  it('pending tags are not in my room until accepted; my review is my own', async () => {
    const rows = (await t.inject({ method: 'GET', url: '/api/logs', as: U.bob })).json().rows
    expect(rows.map((r: { visitId: string }) => r.visitId)).toEqual([FX.visits.together])
    expect(rows[0].myReview.id).toBe(FX.reviews.bobTogether)
    expect(rows[0].myReview.transcript).toBe('Bob private transcript')
  })

  it("never leaks someone else's transcript or email", async () => {
    const res = await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })
    expect(res.body).not.toContain('Bob private transcript')
    expect(res.body).not.toContain('@example.com')
  })

  it('public aggregates count only public, visible, non-copied reviews by onboarded authors', async () => {
    const rows = (await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })).json().rows
    const obs = rows.find((r: { visitId: string }) => r.visitId === FX.visits.together).game
    expect(obs).toMatchObject({ id: FX.games.observatory, reviewCount: 2, avgOverall: 76.5 })
    const lh = rows.find((r: { visitId: string }) => r.visitId === FX.visits.copy).game
    expect(lh).toMatchObject({ reviewCount: 2, avgOverall: 88 })
    const venue = rows.find((r: { visitId: string }) => r.visitId === FX.visits.together).venue
    expect(venue).toMatchObject({ id: FX.venues.starlight, gameCount: 2 })

    await t.db.update(users).set({ handle: null }).where(eq(users.id, U.carol))
    try {
      const again = (await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })).json().rows
      expect(again.find((r: { visitId: string }) => r.visitId === FX.visits.together).game).toMatchObject({ reviewCount: 1, avgOverall: 88 })
    } finally {
      await t.db.update(users).set({ handle: 'carol' }).where(eq(users.id, U.carol))
    }
  })

  it('filters by crew: with / without a friend (id, @handle or guest name)', async () => {
    const ids = async (q: string) => (await t.inject({ method: 'GET', url: `/api/logs?${q}`, as: U.alice })).json().rows.map((r: { visitId: string }) => r.visitId)
    expect(await ids('with=mia')).toEqual([FX.visits.copy, FX.visits.guest])
    expect(await ids(`with=${U.mia}`)).toEqual([FX.visits.copy])
    expect(await ids('with=%40bob')).toEqual([FX.visits.pending, FX.visits.together])
    expect(await ids('without=mia')).toEqual([FX.visits.pending, FX.visits.together, FX.visits.solo])
    expect(await ids('with=nobody')).toEqual([])
  })

  it('a hidden review still shows to its author', async () => {
    await t.db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, FX.reviews.aliceSolo))
    try {
      const rows = (await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })).json().rows
      expect(rows.find((r: { visitId: string }) => r.visitId === FX.visits.solo).myReview).toMatchObject({ id: FX.reviews.aliceSolo, hidden: true })
    } finally {
      await t.db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, FX.reviews.aliceSolo))
    }
  })

  it('a brand-new user has an empty room', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/logs', as: U.newbie })).json()).toEqual({ rows: [] })
  })
})

describe('GET /api/me/export', () => {
  it('downloads all of my data as a JSON attachment', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/me/export', as: U.alice })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="myescapes-export-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const data = AccountExportSchema.parse(res.json())
    expect(data.format).toBe('myescapes-export-v1')
    expect(data.me).toMatchObject({ id: U.alice, email: 'alice@example.com' })
    expect(data.visits.map((v) => v.id).sort()).toEqual([FX.visits.copy, FX.visits.guest, FX.visits.pending, FX.visits.solo, FX.visits.together].sort())
    expect(data.reviews.map((r) => r.id).sort()).toEqual([FX.reviews.aliceCopy, FX.reviews.aliceGuest, FX.reviews.alicePending, FX.reviews.aliceSolo, FX.reviews.aliceTogether].sort())
    expect(data.reviews.every((r) => r.transcript !== null)).toBe(true)
    expect(data.wishlist.map((w) => w.id)).toEqual(['wsh_alice_1', 'wsh_alice_2'])
    expect(data.friends.map((f) => [f.user.id, f.visitsTogether, f.autoAccept, f.theyAutoAccept]).sort()).toEqual([
      [U.bob, 1, false, false],
      [U.mia, 1, false, true],
    ])
    expect(data.invites).toHaveLength(3)
    expect(data.invites.find((i) => i.code === FX.invites.used)?.usedBy?.id).toBe(U.mia)
    expect(data.invites[0].url).toMatch(/^http:\/\/localhost(:80)?\/invite\//)
    expect(data.dailyResults).toEqual([expect.objectContaining({ day: FX.dailyDay, solved: true, score: 900, timeZone: 'America/Los_Angeles' })])
    expect(data.notifications).toEqual([expect.objectContaining({ type: 'friend_request', text: 'Dave sent you a friend request' })])
    expect(data.reports).toEqual([])
  })

  it("contains friends' reviews only as the visibility allows, never their transcripts or emails", async () => {
    const res = await t.inject({ method: 'GET', url: '/api/me/export', as: U.alice })
    const data = AccountExportSchema.parse(res.json())
    const together = data.visits.find((v) => v.id === FX.visits.together)!
    const bob = together.reviews.find((r) => r.author.id === U.bob)!
    expect(bob.visibility).toBe('friends')
    expect(bob.transcript).toBeNull()
    expect(res.body).not.toContain('Bob private transcript')
    for (const other of ['bob', 'mia', 'carol', 'dave', 'eve']) expect(res.body).not.toContain(`${other}@example.com`)
  })

  it("carol's export has her report and nothing of alice's", async () => {
    const data = AccountExportSchema.parse((await t.inject({ method: 'GET', url: '/api/me/export', as: U.carol })).json())
    expect(data.reports.map((r) => r.id)).toEqual([FX.reports.open])
    expect(data.visits.map((v) => v.id)).toEqual([FX.visits.carol])
    expect(data.wishlist).toEqual([])
  })

  it('401 when signed out', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/me/export' })).statusCode).toBe(401)
  })
})

describe('DELETE /api/me', () => {
  beforeEach(reload)
  afterAll(reload)

  it('needs the explicit confirmation', async () => {
    expect((await t.inject({ method: 'DELETE', url: '/api/me', as: U.alice, payload: {} })).statusCode).toBe(400)
    expect((await t.inject({ method: 'DELETE', url: '/api/me', as: U.alice, payload: { confirm: 'yes' } })).statusCode).toBe(400)
    expect((await t.db.select().from(users).where(eq(users.id, U.alice))).length).toBe(1)
  })

  it('removes reviews, photos, friendships and personal data; shared visits keep a plain name', async () => {
    await t.db.insert(usageCounters).values({ subject: U.alice, day: '2026-10-26', kind: 'extraction', amount: 3 })
    const res = await t.inject({ method: 'DELETE', url: '/api/me', as: U.alice, payload: { confirm: 'DELETE' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: true })
    const cleared = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
    expect(cleared.some((c) => c.startsWith('myescapes.session_token=;') && /Max-Age=0/.test(c))).toBe(true)

    expect(await t.db.select().from(users).where(eq(users.id, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(reviews).where(eq(reviews.authorId, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(wishlistItems).where(eq(wishlistItems.userId, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(dailyResults).where(eq(dailyResults.userId, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(invites).where(eq(invites.inviterId, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(notifications).where(eq(notifications.userId, U.alice))).toHaveLength(0)
    expect(await t.db.select().from(usageCounters).where(eq(usageCounters.subject, U.alice))).toHaveLength(0)
    const fr = await t.db.select().from(friendships)
    expect(fr.some((f) => f.userA === U.alice || f.userB === U.alice)).toBe(false)

    // Visits only alice (and guests or pending tags) were on are gone.
    const left = (await t.db.select({ id: visits.id }).from(visits)).map((v) => v.id).sort()
    expect(left).toEqual([FX.visits.carol, FX.visits.copy, FX.visits.together].sort())
    // Shared visits: her tag became the plain name "Alice", and the others keep their reviews.
    const together = await t.db.select().from(visitParticipants).where(eq(visitParticipants.visitId, FX.visits.together))
    expect(together.map((p) => [p.userId, p.guestName, p.status]).sort()).toEqual([
      [null, 'Alice', 'accepted'],
      [U.bob, null, 'accepted'],
    ].sort())
    expect((await t.db.select().from(visits).where(eq(visits.id, FX.visits.together)))[0].createdBy).toBeNull()
    expect(await t.db.select().from(reviews).where(eq(reviews.id, FX.reviews.bobTogether))).toHaveLength(1)
    expect(await t.db.select().from(visitPhotos).where(eq(visitPhotos.id, FX.photos.bobTogether))).toHaveLength(1)
    // Mia's copied review stays, without a link to the deleted review.
    expect((await t.db.select().from(reviews).where(eq(reviews.id, FX.reviews.miaCopy)))[0].copiedFromReviewId).toBeNull()
    // Reports about her reviews are gone; her directory contribution stays without her.
    expect(await t.db.select().from(reports).where(eq(reports.id, FX.reports.open))).toHaveLength(0)
    expect((await t.db.select().from(games).where(eq(games.id, FX.games.lighthouse)))[0].createdBy).toBeNull()

    // Bob's room still shows the visit, with "Alice" as a plain name.
    const bobRows = (await t.inject({ method: 'GET', url: '/api/logs', as: U.bob })).json().rows
    expect(bobRows[0].crew).toEqual([expect.objectContaining({ user: null, guestName: 'Alice' })])
    // And she is signed out.
    expect((await t.inject({ method: 'GET', url: '/api/me', as: U.alice })).statusCode).toBe(401)
  })

  it("deleting bob removes his photos and turns his pending tag into a plain name; alice's data is untouched", async () => {
    expect((await t.inject({ method: 'DELETE', url: '/api/me', as: U.bob, payload: { confirm: 'DELETE' } })).statusCode).toBe(200)
    expect(await t.db.select().from(visitPhotos).where(eq(visitPhotos.uploaderId, U.bob))).toHaveLength(0)
    const pend = await t.db.select().from(visitParticipants).where(eq(visitParticipants.visitId, FX.visits.pending))
    expect(pend.map((p) => [p.userId, p.guestName]).sort()).toEqual([
      [null, 'Bob'],
      [U.alice, null],
    ].sort())
    expect(await t.db.select().from(reviews).where(inArray(reviews.visitId, [FX.visits.together]))).toHaveLength(1)
    const aliceRows = (await t.inject({ method: 'GET', url: '/api/logs', as: U.alice })).json().rows
    expect(aliceRows).toHaveLength(5)
    expect(aliceRows.find((r: { visitId: string }) => r.visitId === FX.visits.together).crew).toEqual([expect.objectContaining({ user: null, guestName: 'Bob' })])
  })

  it('a carol-only visit disappears with her', async () => {
    await t.inject({ method: 'DELETE', url: '/api/me', as: U.carol, payload: { confirm: 'DELETE' } })
    expect(await t.db.select().from(visits).where(eq(visits.id, FX.visits.carol))).toHaveLength(0)
    expect(await t.db.select().from(reports).where(eq(reports.id, FX.reports.open))).toHaveLength(1)
    expect((await t.db.select().from(reports).where(eq(reports.id, FX.reports.open)))[0].reporterId).toBeNull()
  })

  it('401 when signed out', async () => {
    expect((await t.inject({ method: 'DELETE', url: '/api/me', payload: { confirm: 'DELETE' } })).statusCode).toBe(401)
  })
})

describe('DELETE /api/me with a real session', () => {
  it('deletes the sessions, so the cookie stops working', async () => {
    const real = await buildTestApp({ fixtures: true, resolveUser })
    try {
      const login = await real.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'mia@example.com' } })
      const raw = login.headers['set-cookie']
      const cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
      expect((await real.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(200)
      const del = await real.inject({ method: 'DELETE', url: '/api/me', headers: { cookie }, payload: { confirm: 'DELETE' } })
      expect(del.statusCode).toBe(200)
      expect(await real.db.select().from(sessions).where(eq(sessions.userId, U.mia))).toHaveLength(0)
      expect((await real.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401)
    } finally {
      await real.close()
    }
  })
})

describe('wish list and Phase 1 data are per user', () => {
  afterAll(reload)

  it('each user sees only their own wish list', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/wishlist', as: U.alice })).json().map((w: { id: string }) => w.id)).toEqual(['wsh_alice_1', 'wsh_alice_2'])
    expect((await t.inject({ method: 'GET', url: '/api/wishlist', as: U.bob })).json().map((w: { id: string }) => w.id)).toEqual(['wsh_bob_1'])
  })

  it("replacing my list cannot touch someone else's items, even by reusing their id", async () => {
    const res = await t.inject({
      method: 'PUT',
      url: '/api/wishlist',
      as: U.alice,
      payload: [{ id: 'wsh_bob_1', name: 'Stolen', city: '', link: '', addedBy: '', priority: 1, done: false, gameId: null }],
    })
    expect(res.statusCode).toBe(200)
    const bob = (await t.inject({ method: 'GET', url: '/api/wishlist', as: U.bob })).json()
    expect(bob).toEqual([expect.objectContaining({ id: 'wsh_bob_1', name: 'Moon Base' })])
    const alice = (await t.inject({ method: 'GET', url: '/api/wishlist', as: U.alice })).json()
    expect(alice).toHaveLength(1)
    expect(alice[0]).toMatchObject({ name: 'Stolen' })
    expect(alice[0].id).not.toBe('wsh_bob_1')
  })

  it('GET /api/data is the signed-in user’s own room', async () => {
    const data = (await t.inject({ method: 'GET', url: '/api/data', as: U.bob })).json()
    expect(data.source).toBe('postgres')
    expect(data.reviews.map((r: { id: string }) => r.id)).toEqual([FX.visits.together])
    expect(JSON.stringify(data)).not.toContain('Alice private transcript')
  })
})

describe('POST /api/entries (signed in) size limits and website rule', () => {
  afterEach(reload)
  const base = (): Entry => {
    const fx = structuredClone(FIXTURE_DATASET)
    return { room: { ...fx.rooms[0], id: 'room_lim', name: 'Limit Room', company: 'Limit Co', city: 'Limitville', website: '' }, review: { ...fx.reviews[0], id: 'rev_lim', roomId: 'room_lim' } }
  }
  const post = (entry: unknown) => t.inject({ method: 'POST', url: '/api/entries', as: U.alice, payload: entry as object })

  it('rejects oversized names, transcripts, puzzle lists and crews before anything is written', async () => {
    const venuesBefore = (await t.db.select({ id: venues.id }).from(venues)).length
    const e = base()
    const huge = 'x'.repeat(200_000)
    const p0 = e.review.puzzles[0] ?? { id: 'p0', reviewId: 'rev_lim', description: 'lock', type: 'logic' as const, memorable: false }
    const cases: Entry[] = [
      { ...e, room: { ...e.room, name: huge } },
      { ...e, room: { ...e.room, company: huge } },
      { ...e, room: { ...e.room, website: huge } },
      { ...e, review: { ...e.review, voiceTranscript: 'y'.repeat(50_001) } },
      { ...e, review: { ...e.review, puzzles: Array.from({ length: 41 }, (_, i) => ({ ...p0, id: `p${i}` })) } },
      { ...e, review: { ...e.review, crew: Array.from({ length: 21 }, (_, i) => `Friend ${i}`) } },
    ]
    for (const c of cases) expect((await post(c)).statusCode).toBe(400)
    expect((await t.db.select({ id: venues.id }).from(venues)).length).toBe(venuesBefore)
  })

  it('stores only http(s) websites on the venue and game it creates', async () => {
    const e = base()
    expect((await post({ ...e, room: { ...e.room, website: 'javascript:alert(1)' } })).statusCode).toBe(200)
    const v = (await t.db.select().from(venues).where(eq(venues.name, 'Limit Co')))[0]
    expect(v.website).toBeNull()
    const g = (await t.db.select().from(games).where(eq(games.venueId, v.id)))[0]
    expect(g.website).toBeNull()
    const e2 = base()
    expect((await post({ room: { ...e2.room, id: 'room_lim2', company: 'Limit Co Two', website: 'limit.example/room' }, review: { ...e2.review, id: 'rev_lim2', roomId: 'room_lim2' } })).statusCode).toBe(200)
    expect((await t.db.select().from(venues).where(eq(venues.name, 'Limit Co Two')))[0].website).toBe('https://limit.example/room')
  })
})
