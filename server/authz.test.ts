// @vitest-environment node
/**
 * Permission suite (workstream 38): the rules in "Who can do what" (docs/PHASE2_PLAN.md) as API
 * tests against buildTestApp({ fixtures: true }), plus cross-user access tests for every
 * user-scoped route that is built. Fixture people and visits: server/db/fixtures.ts.
 *
 * Covered here: photos (add / see / remove), public visibility of a visit through its photos,
 * moderation (report and admin-only hide), and cross-user isolation of /api/data, /api/entries,
 * /api/wishlist and /api/me/usage, and the refusal side of the social rules (see a visit, edit,
 * delete, tag, write/see a review, no emails in people search). Rules whose routes are still 501
 * stubs on main (account deletion) are added here by the bundles that build those routes, or by
 * the integrator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { ROUTE_LIST } from '../src/contracts/routes'
import { FIXTURE_DATASET } from '../src/contracts/fixtures'
import { PhotoV2Schema } from '../src/contracts/models'
import { DatasetSchema, type Entry } from '../src/contracts/types'
import { TINY_PNG } from './db/fixtures'
import { reviews, usageCounters, users, visitParticipants, visitPhotos, visits, wishlistItems } from './db/schema'
import { utcDay } from './db/usage'
import { multipart } from './routes/photos.testutil'
import { buildTestApp, type TestApp } from './testing'

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

describe('account deletion (database level, until DELETE /api/me lands)', () => {
  it('a deleted uploader\'s photos go with them', async () => {
    const { id } = PhotoV2Schema.parse((await upload(V().copy, U().mia)).json())
    // Account deletion turns tags into plain names first (schema: visit_participants_who_ck).
    await t.db.update(visitParticipants).set({ guestName: 'Mia' }).where(eq(visitParticipants.userId, U().mia))
    await t.db.delete(users).where(eq(users.id, U().mia))
    expect(await t.db.select().from(visitPhotos).where(eq(visitPhotos.id, id))).toHaveLength(0)
    expect((await getPhoto(id, U().alice)).statusCode).toBe(404)
  })
})
