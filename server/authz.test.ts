// @vitest-environment node
/**
 * Permission suite (workstream 38): the rules in "Who can do what" (docs/PHASE2_PLAN.md) as API
 * tests against buildTestApp({ fixtures: true }), plus cross-user access tests for every
 * user-scoped route that is built. Fixture people and visits: server/db/fixtures.ts.
 *
 * Covered here: photos (add / see / remove), public visibility of a visit through its photos,
 * moderation (report and admin-only hide), and cross-user isolation of /api/data, /api/entries,
 * /api/wishlist and /api/me/usage, and the refusal side of the social rules (see a visit, edit,
 * delete, tag, write/see a review, no emails in people search). The last suites cover the accepted
 * paths (leave, recorded edits, delete, unfriend, account deletion), the self-service join, claim and
 * merge-candidate rules, Phase 1 saves onto shared or left visits, and the read-only signed-out demo
 * in production, each from fresh fixtures.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { ROUTE_LIST } from '../src/contracts/routes'
import { FIXTURE_DATASET } from '../src/contracts/fixtures'
import { PhotoV2Schema } from '../src/contracts/models'
import { DatasetSchema, type Entry } from '../src/contracts/types'
import { FX, pair, TINY_PNG } from './db/fixtures'
import { friendships, reviews, usageCounters, users, visitParticipants, visitPhotos, visitPuzzles, visits, wishlistItems } from './db/schema'
import { utcDay } from './db/usage'
import { multipart } from './routes/photos.testutil'
import { facts, socialKit, U as FU, type Kit } from './routes/visits.testkit'
import { buildTestApp, type TestApp } from './testing'
import { demoWritesAllowed } from './routes/logs.phase1'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

const U = () => t.fx.users
const V = () => t.fx.visits

async function upload(visitId: string, as?: string) {
  const body = await multipart({ caption: 'authz' }, { bytes: TINY_PNG, type: 'image/png' })
  return t.inject({ method: 'POST', url: `/api/visits/${visitId}/photos`, as, payload: body.payload, headers: body.headers })
}
const getPhoto = (id: string, as?: string) => t.inject({ method: 'GET', url: `/api/photos/${id}`, as })
const delPhoto = (id: string, as?: string) => t.inject({ method: 'DELETE', url: `/api/photos/${id}`, as })
const data = async (as: string) => DatasetSchema.parse((await t.inject({ method: 'GET', url: '/api/data', as })).json())

describe('authz baseline', () => {
  it('every user-only route answers 401 when signed out', async () => {
    for (const r of ROUTE_LIST.filter((x) => x.auth === 'user' || x.auth === 'admin')) {
      const url = r.path.replace(/:([A-Za-z_]+)/g, 'x')
      const res = await t.inject({ method: r.method, url, payload: r.body && r.body !== 'multipart' ? {} : undefined })
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(401)
    }
  })

  it('admin routes answer 403 for a signed-in non-admin', async () => {
    for (const r of ROUTE_LIST.filter((x) => x.auth === 'admin')) {
      const url = r.path.replace(/:([A-Za-z_]+)/g, 'x')
      const res = await t.inject({ method: r.method, url, as: t.fx.users.alice, payload: r.body && r.body !== 'multipart' ? {} : undefined })
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(403)
    }
  })

  it('an unknown or empty user id is treated as signed out', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/me/usage', as: 'usr_nobody' })).statusCode).toBe(401)
    expect((await upload(V().together, 'usr_nobody')).statusCode).toBe(401)
  })
})

describe('who can do what: photos', () => {
  it('add photos to a visit: the owner and accepted participants only', async () => {
    expect((await upload(V().together, U().alice)).statusCode).toBe(201) // owner
    expect((await upload(V().together, U().bob)).statusCode).toBe(201) // accepted
    expect((await upload(V().copy, U().mia)).statusCode).toBe(201) // accepted (auto-accept friend)
    expect((await upload(V().pending, U().bob)).statusCode).toBe(403) // pending tag
    for (const stranger of [U().carol, U().dave, U().eve, U().mia, U().newbie]) {
      expect((await upload(V().together, stranger)).statusCode, stranger).toBe(404)
    }
    // Friends are not participants: mia (alice's friend) cannot add to alice's solo visit.
    expect((await upload(V().solo, U().mia)).statusCode).toBe(404)
    // Admins get no special upload rights.
    expect((await upload(V().solo, U().admin)).statusCode).toBe(404)
    // Guests on a visit don't make someone with the same name a participant.
    expect((await upload(V().guest, U().mia)).statusCode).toBe(404)
  })

  it('only the uploader can remove their own photo, even the visit owner cannot', async () => {
    const bobs = PhotoV2Schema.parse((await upload(V().together, U().bob)).json()).id
    expect((await delPhoto(bobs, U().alice)).statusCode).toBe(403)
    expect((await delPhoto(bobs, U().carol)).statusCode).toBe(403)
    expect((await delPhoto(bobs, U().admin)).statusCode).toBe(403)
    expect((await delPhoto(bobs, U().bob)).statusCode).toBe(200)
    const alices = PhotoV2Schema.parse((await upload(V().together, U().alice)).json()).id
    expect((await delPhoto(alices, U().bob)).statusCode).toBe(403)
    expect((await delPhoto(alices, U().alice)).statusCode).toBe(200)
  })

  it('see a visit: participants see its photos; others only through a public review', async () => {
    // `together` has alice's public review: public.
    expect((await getPhoto(t.fx.photos.bobTogether)).statusCode).toBe(200)
    // `solo` has only a private review: never public.
    const solo = PhotoV2Schema.parse((await upload(V().solo, U().alice)).json()).id
    expect((await getPhoto(solo, U().alice)).statusCode).toBe(200)
    for (const other of [U().bob, U().mia, U().carol, U().admin]) expect((await getPhoto(solo, other)).statusCode, other).toBe(404)
    expect((await getPhoto(solo)).statusCode).toBe(404)
    // A stranger can't remove it either, and learns nothing (404, not 403).
    expect((await delPhoto(solo, U().carol)).statusCode).toBe(404)
  })

  it('review visibility: a visit with only private or friends-only reviews never appears publicly', async () => {
    await t.db.update(reviews).set({ visibility: 'private' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    try {
      // bob's friends-only review remains; the visit is not public any more.
      expect((await getPhoto(t.fx.photos.bobTogether)).statusCode).toBe(404)
      expect((await getPhoto(t.fx.photos.bobTogether, U().carol)).statusCode).toBe(404)
      expect((await getPhoto(t.fx.photos.bobTogether, U().alice)).statusCode).toBe(200)
    } finally {
      await t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    }
  })

  it('photo responses carry no email', async () => {
    const res = await upload(V().together, U().bob)
    expect(res.body).not.toMatch(/@example\.com/)
  })
})

describe('who can do what: moderation', () => {
  it('reporting needs a signed-in user who can see the target; only admins hide', async () => {
    expect((await t.inject({ method: 'POST', url: '/api/reports', payload: { targetType: 'review', targetId: t.fx.reviews.carol, reason: 'spam' } })).statusCode).toBe(401)
    expect((await t.inject({ method: 'POST', url: '/api/reports', as: U().carol, payload: { targetType: 'review', targetId: t.fx.reviews.aliceSolo, reason: 'spam' } })).statusCode).toBe(404)
    expect((await t.inject({ method: 'POST', url: '/api/reports', as: U().alice, payload: { targetType: 'review', targetId: t.fx.reviews.carol, reason: 'spam' } })).statusCode).toBe(201)
    for (const who of [U().alice, U().bob, U().carol]) {
      const res = await t.inject({ method: 'POST', url: '/api/admin/hide', as: who, payload: { targetType: 'review', targetId: t.fx.reviews.carol, hidden: true } })
      expect(res.statusCode, who).toBe(403)
    }
    const carol = (await t.db.select().from(reviews).where(eq(reviews.id, t.fx.reviews.carol)))[0]
    expect(carol.hiddenAt).toBeNull()
  })

  it('the reports queue shows reporters without their email', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/admin/reports', as: U().admin })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toMatch(/@example\.com/)
  })
})

describe('cross-user access: /api/data (Phase 1 room data)', () => {
  it('each user sees only visits they own or accepted', async () => {
    const alice = await data(U().alice)
    expect(alice.reviews.map((r) => r.id).sort()).toEqual([V().copy, V().guest, V().pending, V().solo, V().together].sort())
    const bob = await data(U().bob)
    expect(bob.reviews.map((r) => r.id)).toEqual([V().together]) // not `pending` (only tagged), not `solo`
    const carol = await data(U().carol)
    expect(carol.reviews.map((r) => r.id)).toEqual([V().carol])
    const dave = await data(U().dave)
    expect(dave.reviews).toEqual([])
    expect(dave.wishlist).toEqual([])
  })

  it('transcripts and emails never appear in another user\'s responses', async () => {
    const bobRes = await t.inject({ method: 'GET', url: '/api/data', as: U().bob })
    expect(bobRes.body).not.toContain('Alice private transcript')
    expect(bobRes.body).not.toMatch(/@example\.com/)
    const bob = DatasetSchema.parse(bobRes.json())
    expect(bob.reviews[0].voiceTranscript).toBe('Bob private transcript')
    // bob's room shows his own scores on the shared visit, not alice's.
    expect(bob.reviews[0].ratings.overall.score).toBe(80)
    const aliceRes = await t.inject({ method: 'GET', url: '/api/data', as: U().alice })
    expect(aliceRes.body).not.toContain('Bob private transcript')
    expect(aliceRes.body).not.toMatch(/@example\.com/)
  })
})

describe('cross-user access: /api/entries', () => {
  it('saving with someone else\'s visit id creates my own visit and leaves theirs alone', async () => {
    const before = (await t.db.select().from(visits).where(eq(visits.id, V().together)))[0]
    const aliceReview = (await t.db.select().from(reviews).where(eq(reviews.id, t.fx.reviews.aliceTogether)))[0]
    const fx = FIXTURE_DATASET
    const entry: Entry = {
      room: { ...fx.rooms[0], id: t.fx.games.observatory },
      review: { ...fx.reviews[0], id: V().together, roomId: t.fx.games.observatory, date: '2020-01-01', voiceTranscript: 'carol says hi' },
    }
    const res = await t.inject({ method: 'POST', url: '/api/entries', as: U().carol, payload: entry })
    expect(res.statusCode).toBe(200)
    const saved = (res.json() as Entry).review
    expect(saved.id).not.toBe(V().together)

    const after = (await t.db.select().from(visits).where(eq(visits.id, V().together)))[0]
    expect(after.date).toBe(before.date)
    expect(after.createdBy).toBe(U().alice)
    const aliceAfter = (await t.db.select().from(reviews).where(eq(reviews.id, t.fx.reviews.aliceTogether)))[0]
    expect(aliceAfter.overallScore).toBe(aliceReview.overallScore)
    expect(aliceAfter.transcript).toBe(aliceReview.transcript)
    // carol's new visit is hers only.
    expect((await data(U().alice)).reviews.map((r) => r.id)).not.toContain(saved.id)
    expect((await data(U().carol)).reviews.map((r) => r.id)).toContain(saved.id)
  })
})

describe('cross-user access: /api/wishlist', () => {
  it('each user reads only their own wish list', async () => {
    const alice = (await t.inject({ method: 'GET', url: '/api/wishlist', as: U().alice })).json() as { id: string }[]
    expect(alice.map((w) => w.id).sort()).toEqual(['wsh_alice_1', 'wsh_alice_2'])
    const bob = (await t.inject({ method: 'GET', url: '/api/wishlist', as: U().bob })).json() as { id: string }[]
    expect(bob.map((w) => w.id)).toEqual(['wsh_bob_1'])
  })

  it('replacing my list with someone else\'s item ids never touches their rows', async () => {
    const item = { id: 'wsh_alice_1', name: 'Hijacked', city: 'Nowhere', link: '', addedBy: '', priority: 1, done: false }
    const res = await t.inject({ method: 'PUT', url: '/api/wishlist', as: U().bob, payload: [item] })
    expect(res.statusCode).toBe(200)
    const aliceRow = (await t.db.select().from(wishlistItems).where(eq(wishlistItems.id, 'wsh_alice_1')))[0]
    expect(aliceRow).toMatchObject({ userId: U().alice, name: 'Sky Pirates' })
    const aliceItems = await t.db.select().from(wishlistItems).where(eq(wishlistItems.userId, U().alice))
    expect(aliceItems).toHaveLength(2)
    const bobItems = await t.db.select().from(wishlistItems).where(eq(wishlistItems.userId, U().bob))
    expect(bobItems.map((w) => w.name)).toEqual(['Hijacked'])
    expect(bobItems[0].id).not.toBe('wsh_alice_1')
  })
})

describe('cross-user access: /api/me/usage', () => {
  it('shows only my own meters', async () => {
    const day = utcDay(new Date())
    await t.db.insert(usageCounters).values({ subject: U().alice, day, kind: 'extraction', amount: 7 })
    try {
      const alice = (await t.inject({ method: 'GET', url: '/api/me/usage', as: U().alice })).json() as { extractionCalls: { used: number } }
      expect(alice.extractionCalls.used).toBe(7)
      const bob = (await t.inject({ method: 'GET', url: '/api/me/usage', as: U().bob })).json() as { extractionCalls: { used: number } }
      expect(bob.extractionCalls.used).toBe(0)
    } finally {
      await t.db.delete(usageCounters).where(and(eq(usageCounters.subject, U().alice), eq(usageCounters.day, day)))
    }
  })
})

describe('who can do what: visits, reviews, tagging, friends (31-34)', () => {
  // Only refused requests here, so the shared fixture state stays as loaded. The full rules,
  // including the accepted paths, are in server/routes/{visits,reviews,friends,claims}.test.ts.
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, as?: string, payload?: object) =>
    t.inject({ method, url, as, ...(payload ? { payload } : {}) })
  const R = () => t.fx.reviews

  it('see a visit: owner, accepted or pending; everyone else (admins too) gets 404', async () => {
    expect((await call('GET', `/api/visits/${V().together}`, U().alice)).statusCode).toBe(200)
    expect((await call('GET', `/api/visits/${V().together}`, U().bob)).statusCode).toBe(200)
    expect((await call('GET', `/api/visits/${V().pending}`, U().bob)).statusCode).toBe(200)
    for (const who of [U().carol, U().mia, U().eve, U().admin]) {
      expect((await call('GET', `/api/visits/${V().together}`, who)).statusCode, who).toBe(404)
    }
  })

  it('edit shared facts: accepted participants only (pending 403, outsiders 404)', async () => {
    expect((await call('PATCH', `/api/visits/${V().pending}`, U().bob, { facts: { escaped: false } })).statusCode).toBe(403)
    expect((await call('PATCH', `/api/visits/${V().together}`, U().carol, { facts: { escaped: false } })).statusCode).toBe(404)
  })

  it('delete a visit: creator only, and not once another account holder accepted (leave instead)', async () => {
    expect((await call('DELETE', `/api/visits/${V().together}`, U().alice)).statusCode).toBe(409)
    expect((await call('DELETE', `/api/visits/${V().together}`, U().bob)).statusCode).toBe(403)
    expect((await call('DELETE', `/api/visits/${V().together}`, U().carol)).statusCode).toBe(404)
  })

  it('tag people: only my accepted friends (strangers, pending requests and blocked people get 403)', async () => {
    for (const who of [U().carol, U().dave, U().eve]) {
      expect((await call('POST', `/api/visits/${V().together}/participants`, U().alice, { crew: [{ userId: who }] })).statusCode, who).toBe(403)
    }
  })

  it('write a review: owner or accepted only; a review is changed only by its author', async () => {
    const body = { ratings: { overall: { score: 50 }, puzzles: { score: 50 }, setting: { score: 50 }, storyline: { score: 50 }, difficulty: { score: 50 } } }
    expect((await call('PUT', `/api/visits/${V().pending}/review`, U().bob, body)).statusCode).toBe(403)
    expect((await call('PUT', `/api/visits/${V().together}/review`, U().carol, body)).statusCode).toBe(404)
    expect((await call('PATCH', `/api/reviews/${R().aliceTogether}`, U().bob, { visibility: 'private' })).statusCode).toBe(403)
  })

  it('review visibility: private is author-only, friends-only needs an accepted friend, transcripts go only to the author', async () => {
    expect((await call('GET', `/api/reviews/${R().aliceSolo}`, U().bob)).statusCode).toBe(404)
    expect((await call('GET', `/api/reviews/${R().bobTogether}`, U().carol)).statusCode).toBe(404)
    expect((await call('GET', `/api/reviews/${R().bobTogether}`)).statusCode).toBe(404)
    const asFriend = await call('GET', `/api/reviews/${R().bobTogether}`, U().alice)
    expect(asFriend.statusCode).toBe(200)
    expect(asFriend.json().transcript).toBeNull()
    expect(asFriend.body).not.toContain('Bob private transcript')
    expect((await call('GET', `/api/reviews/${R().aliceTogether}`)).json().transcript).toBeNull()
  })

  it('people search and friend lists never show an email', async () => {
    const res = await call('GET', '/api/users/search?q=bob@example.com', U().alice)
    expect(res.body).not.toContain('@example.com')
    expect((await call('GET', '/api/friends', U().alice)).body).not.toContain('@example.com')
  })
})

describe('account deletion (last: it changes the shared fixture state)', () => {
  it('DELETE /api/me: a deleted uploader\'s photos go with them', async () => {
    const { id } = PhotoV2Schema.parse((await upload(V().copy, U().mia)).json())
    expect((await t.inject({ method: 'DELETE', url: '/api/me', as: U().mia, payload: { confirm: 'DELETE' } })).statusCode).toBe(200)
    expect(await t.db.select().from(users).where(eq(users.id, U().mia))).toHaveLength(0)
    expect(await t.db.select().from(visitPhotos).where(eq(visitPhotos.id, id))).toHaveLength(0)
    expect((await getPhoto(id, U().alice)).statusCode).toBe(404)
  })
})

/**
 * Rules whose accepted paths change data, and the join / claim / merge holes found in review.
 * Each test starts from freshly loaded fixtures (its own PGlite app).
 */
describe('who can do what: accepted paths and self-service joins (fresh fixtures per test)', () => {
  let k: Kit
  beforeAll(async () => {
    k = await socialKit()
  })
  afterAll(async () => {
    await k?.close()
  })
  beforeEach(async () => {
    await k.reset()
  })
  const FV = FX.visits
  const onVisit = async (visitId: string, userId: string) =>
    (await k.t.db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, visitId), eq(visitParticipants.userId, userId)))).length > 0
  const befriend = async (x: string, y: string) => {
    const p = pair(x, y)
    await k.t.db.insert(friendships).values({ userA: p.userA, userB: p.userB, status: 'accepted', requestedBy: x, acceptedAt: new Date() })
  }
  const logVisit = async (as: string, gameId: string, date: string) => {
    const r = await k.api(as, 'POST', '/api/visits', { gameId, facts: facts(date) })
    expect(r.status).toBe(201)
    return r.body.id as string
  }

  it('join: a friend who was not tagged cannot add themselves to a solo or private visit', async () => {
    expect((await k.api(FU.bob, 'POST', `/api/visits/${FV.solo}/join`, {})).status).toBe(404)
    // Even with a log of the same room the same day: alice's only review there is private.
    const bobs = await logVisit(FU.bob, FX.games.vault, '2026-09-01')
    expect((await k.api(FU.bob, 'POST', `/api/visits/${FV.solo}/join`, { fromVisitId: bobs })).status).toBe(404)
    expect(await onVisit(FV.solo, FU.bob)).toBe(false)
    // ...and the visit is never offered as a merge candidate.
    expect((await k.api(FU.bob, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.vault}&date=2026-09-01`)).body.candidates).toEqual([])
    // Alice can still delete her own solo visit.
    expect((await k.api(FU.alice, 'DELETE', `/api/visits/${FV.solo}`)).status).toBe(200)
  })

  it('join: a friend of a member (not of the creator) and a blocked user are refused', async () => {
    await befriend(FU.bob, FU.carol)
    // carol has her own log of the Observatory on the same day (vis_carol).
    expect((await k.api(FU.carol, 'POST', `/api/visits/${FV.together}/join`, {})).status).toBe(404)
    expect((await k.api(FU.carol, 'POST', `/api/visits/${FV.together}/join`, { fromVisitId: FV.carol })).status).toBe(404)
    expect((await k.api(FU.carol, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates).toEqual([])
    const eves = await logVisit(FU.eve, FX.games.observatory, '2026-10-12')
    expect((await k.api(FU.eve, 'POST', `/api/visits/${FV.together}/join`, { fromVisitId: eves })).status).toBe(404)
    expect(await onVisit(FV.together, FU.carol)).toBe(false)
    expect(await onVisit(FV.together, FU.eve)).toBe(false)
  })

  it('merge candidates: only with my own log of the room, only visits a friend created', async () => {
    expect((await k.api(FU.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates).toEqual([])
    await logVisit(FU.mia, FX.games.observatory, '2026-10-12')
    const c = (await k.api(FU.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates
    expect(c.map((x: { visitId: string }) => x.visitId)).toEqual([FV.together])
    // bob accepted onto carol's visit does not expose carol's visit to bob's friends.
    await k.t.db.insert(visitParticipants).values({ visitId: FV.carol, userId: FU.bob, status: 'accepted', addedBy: FU.carol })
    const ids = (await k.api(FU.alice, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-13`)).body.candidates
    expect(ids).toEqual([]) // alice is on vis_together already; vis_carol is not a friend's log
  })

  it('claim: a friend cannot claim a guest name that is not theirs', async () => {
    const r = await k.api(FU.bob, 'POST', '/api/claims', { inviterId: FU.alice, guestName: 'Mia' })
    expect(r.status).toBe(404)
    const p = await k.t.db.select().from(visitParticipants).where(eq(visitParticipants.id, FX.participants.guestMia))
    expect(p[0]).toMatchObject({ userId: null, guestName: 'Mia' })
    expect(await onVisit(FV.guest, FU.bob)).toBe(false)
  })

  it('claim: a friend\'s guest name on a stranger\'s visit does not open that visit', async () => {
    // alice is on carol's visit and added a guest "Mia" there; mia is alice's friend, not carol's.
    await k.t.db.insert(visitParticipants).values([
      { visitId: FV.carol, userId: FU.alice, status: 'accepted', addedBy: FU.carol },
      { visitId: FV.carol, guestName: 'Mia', status: 'accepted', addedBy: FU.alice },
    ])
    const r = await k.api(FU.mia, 'POST', '/api/claims', { inviterId: FU.alice, guestName: 'Mia' })
    expect(r.body).toEqual({ claimed: 1 }) // vis_guest only
    expect(await onVisit(FV.guest, FU.mia)).toBe(true)
    expect(await onVisit(FV.carol, FU.mia)).toBe(false)
    expect((await k.api(FU.mia, 'GET', '/api/claims')).body.claims).toEqual([])
  })

  it('/api/entries: a creator who left can no longer change the visit or add a review to it', async () => {
    const alice = DatasetSchema.parse((await k.api(FU.alice, 'GET', '/api/data')).body)
    const rv = alice.reviews.find((r) => r.id === FV.together)!
    const room = alice.rooms.find((r) => r.id === rv.roomId)!
    expect((await k.api(FU.alice, 'POST', `/api/visits/${FV.together}/leave`)).status).toBe(200)
    const before = (await k.t.db.select().from(visits).where(eq(visits.id, FV.together)))[0]
    expect(before.createdBy).toBeNull()
    const res = await k.api(FU.alice, 'POST', '/api/entries', { room, review: { ...rv, date: '2020-02-02', escaped: false, crew: [], puzzles: [] } })
    expect(res.status).toBe(200)
    expect(res.body.review.id).not.toBe(FV.together)
    const after = (await k.t.db.select().from(visits).where(eq(visits.id, FV.together)))[0]
    expect(after).toMatchObject({ date: before.date, escaped: before.escaped })
    expect(await k.t.db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, FV.together))).toHaveLength(2)
    expect(await k.t.db.select().from(reviews).where(and(eq(reviews.visitId, FV.together), eq(reviews.authorId, FU.alice)))).toHaveLength(0)
    const d = (await k.api(FU.bob, 'GET', `/api/visits/${FV.together}`)).body
    expect(d.reviews.map((r: { author: { id: string } }) => r.author.id)).toEqual([FU.bob])
  })

  it('/api/entries on a shared visit: facts and puzzles are recorded edits, other people\'s guests stay', async () => {
    await k.api(FU.alice, 'POST', `/api/visits/${FV.together}/participants`, { crew: [{ guestName: 'Sam' }] })
    const bob = DatasetSchema.parse((await k.api(FU.bob, 'GET', '/api/data')).body)
    const rv = bob.reviews.find((r) => r.id === FV.together)!
    const room = bob.rooms.find((r) => r.id === rv.roomId)!
    const res = await k.api(FU.bob, 'POST', '/api/entries', { room, review: { ...rv, escapeTimeMinutes: 58, crew: [], puzzles: rv.puzzles.slice(0, 1) } })
    expect(res.status).toBe(200)
    expect(res.body.review.id).toBe(FV.together)
    const d = (await k.api(FU.alice, 'GET', `/api/visits/${FV.together}`)).body
    expect(d.facts.escapeTimeMinutes).toBe(58)
    expect(d.participants.some((p: { guestName: string | null }) => p.guestName === 'Sam')).toBe(true)
    // The kept puzzle keeps its id, so alice's memorable pick still points at it.
    expect(d.puzzles.map((p: { id: string }) => p.id)).toEqual([FX.puzzles.clock])
    expect(d.reviews.find((r: { author: { id: string } }) => r.author.id === FU.alice).memorablePuzzleIds).toEqual([FX.puzzles.clock])
    const edits = (await k.api(FU.alice, 'GET', `/api/visits/${FV.together}/edits`)).body.edits
    expect(edits[0]).toMatchObject({ editor: { id: FU.bob }, changes: { escapeTimeMinutes: { from: 52, to: 58 } } })
    expect(Object.keys(edits[0].changes)).toContain('puzzles')
  })

  it('edit shared facts: an accepted edit is recorded and visible in the history', async () => {
    expect((await k.api(FU.bob, 'PATCH', `/api/visits/${FV.together}`, { facts: { escaped: false } })).status).toBe(200)
    const edits = (await k.api(FU.alice, 'GET', `/api/visits/${FV.together}/edits`)).body.edits
    expect(edits[0]).toMatchObject({ editor: { id: FU.bob }, changes: { escaped: { from: true, to: false } } })
  })

  it('remove yourself from a visit: my review goes, the visit stays for the others', async () => {
    expect((await k.api(FU.bob, 'POST', `/api/visits/${FV.together}/leave`)).status).toBe(200)
    expect(await k.t.db.select().from(reviews).where(eq(reviews.id, FX.reviews.bobTogether))).toHaveLength(0)
    expect((await k.api(FU.bob, 'GET', `/api/visits/${FV.together}`)).status).toBe(404)
    const d = (await k.api(FU.alice, 'GET', `/api/visits/${FV.together}`)).body
    expect(d.participants.map((p: { user: { id: string } | null }) => p.user?.id)).toEqual([FU.alice])
  })

  it('delete a visit: the creator can when nobody else accepted', async () => {
    expect((await k.api(FU.alice, 'DELETE', `/api/visits/${FV.solo}`)).status).toBe(200)
    expect(await k.t.db.select().from(visits).where(eq(visits.id, FV.solo))).toHaveLength(0)
    expect((await k.api(FU.alice, 'GET', `/api/visits/${FV.solo}`)).status).toBe(404)
  })

  it('unfriending keeps past shared visits but stops new tags', async () => {
    expect((await k.api(FU.alice, 'DELETE', `/api/friends/${FU.bob}`)).status).toBe(200)
    expect((await k.api(FU.bob, 'GET', `/api/visits/${FV.together}`)).status).toBe(200)
    expect((await k.api(FU.alice, 'GET', `/api/visits/${FV.together}`)).status).toBe(200)
    expect((await k.api(FU.alice, 'POST', `/api/visits/${FV.solo}/participants`, { crew: [{ userId: FU.bob }] })).status).toBe(403)
  })

  it('deleting an account removes reviews and transcripts and turns tags into plain names', async () => {
    expect((await k.api(FU.bob, 'DELETE', '/api/me', { confirm: 'DELETE' })).status).toBe(200)
    expect(await k.t.db.select().from(reviews).where(eq(reviews.authorId, FU.bob))).toHaveLength(0)
    const d = await k.api(FU.alice, 'GET', `/api/visits/${FV.together}`)
    expect(JSON.stringify(d.body)).not.toContain('Bob private transcript')
    expect(d.body.participants).toEqual(expect.arrayContaining([expect.objectContaining({ user: null, guestName: 'Bob' })]))
    expect(d.body.reviews.map((r: { author: { id: string } }) => r.author.id)).toEqual([FU.alice])
  })
})

describe('signed-out demo writes in production', () => {
  let p: TestApp
  beforeAll(async () => {
    p = await buildTestApp({ env: { NODE_ENV: 'production' } })
  })
  afterAll(async () => {
    await p?.close()
  })

  it('POST /api/entries and PUT /api/wishlist are refused and change nothing other visitors read', async () => {
    const dataBefore = (await p.inject({ method: 'GET', url: '/api/data' })).body
    const wishBefore = (await p.inject({ method: 'GET', url: '/api/wishlist' })).body
    const fx = FIXTURE_DATASET
    const entry: Entry = { room: fx.rooms[0], review: { ...fx.reviews[0], id: 'rev_anon', voiceTranscript: 'anonymous secret note', crew: ['Private Friend'] } }
    expect((await p.inject({ method: 'POST', url: '/api/entries', payload: entry })).statusCode).toBe(401)
    const item = { id: 'wsh_anon', name: 'Defaced', city: 'Nowhere', link: '', addedBy: '', priority: 1, done: false }
    expect((await p.inject({ method: 'PUT', url: '/api/wishlist', payload: [item] })).statusCode).toBe(401)
    const dataAfter = (await p.inject({ method: 'GET', url: '/api/data' })).body
    expect(dataAfter).toBe(dataBefore)
    expect(dataAfter).not.toContain('anonymous secret note')
    expect((await p.inject({ method: 'GET', url: '/api/wishlist' })).body).toBe(wishBefore)
  })
})

describe('signed-out demo writes on a Railway deploy without NODE_ENV', () => {
  it('only local and test servers write the shared demo overlay', () => {
    expect(demoWritesAllowed({ NODE_ENV: 'production' })).toBe(false)
    expect(demoWritesAllowed({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(false)
    expect(demoWritesAllowed({ NODE_ENV: 'development', RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' })).toBe(false)
    expect(demoWritesAllowed({ NODE_ENV: 'test' })).toBe(true)
    expect(demoWritesAllowed({})).toBe(true)
  })

  it('POST /api/entries answers 401 when Railway variables are present', async () => {
    const r = await buildTestApp({ env: { NODE_ENV: '', RAILWAY_ENVIRONMENT_NAME: 'production' } })
    try {
      const fx = FIXTURE_DATASET
      const entry: Entry = { room: fx.rooms[0], review: { ...fx.reviews[0], id: 'rev_anon2', voiceTranscript: 'anonymous secret note' } }
      expect((await r.inject({ method: 'POST', url: '/api/entries', payload: entry })).statusCode).toBe(401)
      expect((await r.inject({ method: 'GET', url: '/api/data' })).body).not.toContain('anonymous secret note')
    } finally {
      await r.close()
    }
  })
})

describe('per-client rate limits behind the proxy', () => {
  it('trusts only private proxy hops by default, so a client-supplied X-Forwarded-For does not get a fresh bucket', async () => {
    const r = await buildTestApp({})
    try {
      const codes: number[] = []
      for (let i = 0; i < 70; i++) {
        // The client sends a random address; Railway's edge appends the address it really saw, then an internal hop.
        const res = await r.inject({ method: 'GET', url: '/api/invites/NOSUCHCODE2', headers: { 'x-forwarded-for': `198.51.${i}.${i}, 203.0.113.9, 10.0.0.2` } })
        codes.push(res.statusCode)
      }
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
      // A different real client still has its own bucket.
      expect((await r.inject({ method: 'GET', url: '/api/invites/NOSUCHCODE2', headers: { 'x-forwarded-for': '203.0.113.10' } })).statusCode).not.toBe(429)
    } finally {
      await r.close()
    }
  })

  it('TRUST_PROXY_HOPS is a small whole number, default 3, and only private peers are proxies', async () => {
    const { trustProxyHops, trustProxyFor, isPrivateAddress } = await import('./proxy')
    expect(trustProxyHops({})).toBe(3)
    const trust = trustProxyFor({})
    expect(trust('10.4.0.7', 0)).toBe(true)
    expect(trust('::ffff:100.64.1.2', 0)).toBe(true)
    expect(trust('fd12::1', 0)).toBe(true)
    expect(trust('10.4.0.7', 2)).toBe(true)
    expect(trust('10.4.0.7', 3)).toBe(false)
    expect(trust('203.0.113.9', 0)).toBe(false)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('not an ip')).toBe(false)
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2)
    expect(trustProxyHops({ TRUST_PROXY_HOPS: 'true' })).toBe(3)
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '-1' })).toBe(3)
  })

  it('signed-in callers are limited per account, whatever address they claim', async () => {
    const r = await buildTestApp({ fixtures: true })
    try {
      let limited = false
      for (let i = 0; i < 70 && !limited; i++) {
        const res = await r.inject({ method: 'GET', url: '/api/invites/NOSUCHCODE3', as: FX.users.alice, headers: { 'x-forwarded-for': `10.1.${i}.${i}` } })
        limited = res.statusCode === 429
      }
      expect(limited).toBe(true)
    } finally {
      await r.close()
    }
  })
})
