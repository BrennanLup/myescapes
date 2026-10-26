// @vitest-environment node
/** Guest-name claims and same-room merges (workstream 34). Fixture visits: server/db/fixtures.ts. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { GuestClaimSchema, MergeCandidateSchema, VisitDetailSchema } from '../../src/contracts/models'
import { FX, pair } from '../db/fixtures'
import { friendships, reviews, visitParticipants, visitPhotos, visits } from '../db/schema'
import { addDays, daysApart, namesForUser } from './claims'
import { facts, ratings, socialKit, U, type Kit } from './visits.testkit'

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

const V = FX.visits

async function guestVisit(date: string, guestName = 'Mia') {
  const r = await k.api(U.alice, 'POST', '/api/visits', {
    gameId: FX.games.vault,
    facts: facts(date),
    crew: [{ guestName }],
    review: { ratings: ratings(70, 70, 'Alice says hi'), visibility: 'public' },
  })
  expect(r.status).toBe(201)
  return r.body.id as string
}

describe('guest-name claims', () => {
  it('suggests a friend\'s guest names that match my name', async () => {
    const r = await k.api(U.mia, 'GET', '/api/claims')
    expect(r.status).toBe(200)
    const claims = r.body.claims.map((c: unknown) => GuestClaimSchema.parse(c))
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ inviter: { id: U.alice }, guestName: 'Mia' })
    expect(claims[0].visits).toEqual([expect.objectContaining({ visitId: V.guest, participantId: FX.participants.guestMia, date: '2025-05-01' })])
    // Bob is Alice's friend, but "Mia" isn't his name; Carol isn't Alice's friend.
    expect((await k.api(U.bob, 'GET', '/api/claims')).body.claims).toEqual([])
    expect((await k.api(U.carol, 'GET', '/api/claims')).body.claims).toEqual([])
  })

  it('the guest name on an accepted invite comes first, whatever my own name is', async () => {
    await guestVisit('2026-10-01', 'Bobby')
    await k.api(U.carol, 'POST', `/api/invites/${FX.invites.valid}/accept`) // invite for guest "Mia"
    const claims = (await k.api(U.carol, 'GET', '/api/claims')).body.claims
    expect(claims.map((c: { guestName: string }) => c.guestName)).toEqual(['Mia'])
  })

  it('claim all: linked to my account with a flagged copy of the friend\'s review, and they hear about it', async () => {
    const extra = await guestVisit('2026-10-01')
    const r = await k.api(U.mia, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'mia' })
    expect(r.body).toEqual({ claimed: 2 })
    for (const id of [V.guest, extra]) {
      const d = VisitDetailSchema.parse((await k.api(U.mia, 'GET', `/api/visits/${id}`)).body)
      expect(d.myStatus).toBe('accepted')
      expect(d.participants.some((p) => p.guestName === 'Mia')).toBe(false)
      const mine = d.reviews.find((x) => x.author.id === U.mia)!
      expect(mine.scoresCopied).toBe(true)
      expect(mine.transcript).toBe('')
    }
    const n = (await k.api(U.alice, 'GET', '/api/notifications')).body.items[0]
    expect(n).toMatchObject({ type: 'tag_accepted', text: 'Mia claimed 2 visits as "mia"', actor: { id: U.mia } })
    // Nothing left to claim.
    expect((await k.api(U.mia, 'GET', '/api/claims')).body.claims).toEqual([])
    expect((await k.api(U.mia, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'Mia' })).body).toEqual({ claimed: 0 })
    // Claimed visits show up in her room (Phase 1 shape for the 3D room).
    const data = await k.api(U.mia, 'GET', '/api/data')
    expect(data.body.reviews.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([V.guest, extra]))
  })

  it('claim some: only the picked participant ids', async () => {
    const extra = await guestVisit('2026-10-01')
    const r = await k.api(U.mia, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'Mia', participantIds: [FX.participants.guestMia, 'par_not_mine'] })
    expect(r.body).toEqual({ claimed: 1 })
    expect((await k.api(U.mia, 'GET', `/api/visits/${extra}`)).status).toBe(404)
    expect((await k.api(U.mia, 'GET', '/api/claims')).body.claims[0].visits.map((v: { visitId: string }) => v.visitId)).toEqual([extra])
  })

  it('only from accepted friends', async () => {
    expect((await k.api(U.carol, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'Mia' })).status).toBe(404)
    expect((await k.api(U.eve, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'Mia' })).status).toBe(404)
    expect((await k.api(U.dave, 'POST', '/api/claims', { inviterId: U.alice, guestName: 'Mia' })).status).toBe(404)
    const p = await k.t.db.select().from(visitParticipants).where(eq(visitParticipants.id, FX.participants.guestMia))
    expect(p[0]).toMatchObject({ userId: null, guestName: 'Mia' })
  })

  it('the morning-test path: invite link -> sign in -> claim -> tagged visits show up', async () => {
    const inv = await k.api(U.alice, 'POST', '/api/invites', { guestName: 'Mia' })
    // Carol plays the new girlfriend here (no friendship with Alice yet).
    const acc = await k.api(U.carol, 'POST', `/api/invites/${inv.body.code}/accept`)
    expect(acc.body.claimableVisits).toBe(1)
    const claims = (await k.api(U.carol, 'GET', '/api/claims')).body.claims
    expect(claims[0].visits).toHaveLength(1)
    expect((await k.api(U.carol, 'POST', '/api/claims', { inviterId: U.alice, guestName: claims[0].guestName })).body.claimed).toBe(1)
    await k.api(U.carol, 'PATCH', `/api/friends/${U.alice}`, { autoAccept: true })
    const v = await k.api(U.alice, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: facts('2026-10-26'), crew: [{ userId: U.carol }], review: { ratings: ratings(91) } })
    expect(v.status).toBe(201)
    const rows = (await k.api(U.carol, 'GET', '/api/data')).body.reviews.map((x: { id: string }) => x.id)
    expect(rows).toEqual(expect.arrayContaining([V.guest, v.body.id]))
  })
})

describe('same-room merge detection', () => {
  it('offers a friend\'s visit of the same game within a day, with conflicting facts', async () => {
    // Nothing is offered until I've logged the room myself (no probing friends' visits).
    expect((await k.api(U.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-13`)).body.candidates).toEqual([])
    await k.api(U.mia, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: { ...facts('2026-10-13'), escapeTimeMinutes: 52, toolsUsed: ['keypads'] } })
    const r = await k.api(U.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-13`)
    expect(r.status).toBe(200)
    const c = r.body.candidates.map((x: unknown) => MergeCandidateSchema.parse(x))
    // vis_together (Alice is Mia's friend). Carol's visit the same day is not a friend's.
    expect(c.map((x: { visitId: string }) => x.visitId)).toEqual([V.together])
    expect(c[0]).toMatchObject({ loggedBy: { id: U.alice }, conflicts: ['date'], facts: { date: '2026-10-12', escaped: true } })
    expect((await k.api(U.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-15`)).body.candidates).toEqual([])
    // Visits I'm already on are not offered.
    expect((await k.api(U.alice, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates).toEqual([])
    expect((await k.api(U.carol, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates).toEqual([])
    expect((await k.api(U.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=bad`)).status).toBe(400)
  })

  it('compares against my own log of the same room', async () => {
    await k.api(U.mia, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: { ...facts('2026-10-12'), escaped: false, escapeTimeMinutes: 60, toolsUsed: ['keypads'] } })
    const c = (await k.api(U.mia, 'GET', `/api/visits/merge-candidates?gameId=${FX.games.observatory}&date=2026-10-12`)).body.candidates
    expect(c[0].conflicts.sort()).toEqual(['escapeTimeMinutes', 'escaped'])
  })

  it('join without a tag or a log of my own is refused: friends can\'t add themselves to a visit', async () => {
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, {})).status).toBe(404)
    expect(await k.t.db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, V.together), eq(visitParticipants.userId, U.mia)))).toHaveLength(0)
  })

  it('merging my log: the logger hears about it, and joining again is harmless', async () => {
    const mine = await k.api(U.mia, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: facts('2026-10-12') })
    const r = await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: mine.body.id })
    expect(r.status).toBe(200)
    const d = VisitDetailSchema.parse(r.body)
    expect(d.myStatus).toBe('accepted')
    expect((await k.api(U.alice, 'GET', '/api/notifications')).body.items[0]).toMatchObject({ type: 'tag_accepted', text: 'Mia joined your visit to The Lost Observatory on Oct 12' })
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, {})).status).toBe(200)
  })

  it('join and merge my own log: facts picked, my review, crew, photos and new puzzles move; both reviews kept', async () => {
    const mine = await k.api(U.mia, 'POST', '/api/visits', {
      gameId: FX.games.observatory,
      facts: { ...facts('2026-10-12'), escaped: false, escapeTimeMinutes: 61 },
      puzzles: [
        { id: 't1', description: 'set the telescope clock to 4:35', type: 'lock-and-key' },
        { id: 't2', description: 'Open the star globe', type: 'physical' },
      ],
      crew: [{ guestName: 'Sam' }],
      review: { ratings: ratings(66, 60, 'My own take'), memorablePuzzleIds: ['t1', 't2'], visibility: 'public' },
    })
    expect(mine.status).toBe(201)
    await k.t.db.insert(visitPhotos).values({ visitId: mine.body.id, uploaderId: U.mia, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3 })

    const r = await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: mine.body.id, resolve: { escapeTimeMinutes: 61 } })
    expect(r.status).toBe(200)
    const d = VisitDetailSchema.parse(r.body)
    expect(d.facts).toMatchObject({ escaped: true, escapeTimeMinutes: 61 })
    // All three reviews are kept (Mia doesn't see Bob's: it's friends-only and they aren't friends).
    expect(d.reviews.map((x) => x.author.id).sort()).toEqual([U.alice, U.mia].sort())
    expect((await k.t.db.select().from(reviews).where(eq(reviews.visitId, V.together))).map((x) => x.authorId).sort()).toEqual([U.alice, U.bob, U.mia].sort())
    const myReview = d.reviews.find((x) => x.author.id === U.mia)!
    expect(myReview).toMatchObject({ scoresCopied: false })
    expect(myReview.ratings.overall.comment).toBe('My own take')
    // The duplicate clock puzzle merged into the existing one; the globe moved over.
    expect(d.puzzles.map((p) => p.description)).toEqual(['Set the telescope clock to 4:35', 'Match the constellations to the keypad', 'Open the star globe'])
    expect(myReview.memorablePuzzleIds.sort()).toEqual([FX.puzzles.clock, d.puzzles[2].id].sort())
    expect(d.participants.some((p) => p.guestName === 'Sam')).toBe(true)
    expect(d.photos).toHaveLength(2)
    expect(await k.t.db.select().from(visits).where(eq(visits.id, mine.body.id))).toHaveLength(0)
    const edits = (await k.api(U.alice, 'GET', `/api/visits/${V.together}/edits`)).body.edits
    expect(edits[0]).toMatchObject({ editor: { id: U.mia }, changes: { escapeTimeMinutes: { from: 52, to: 61 } } })
  })

  it('merging a log someone else created only moves my review and leaves theirs', async () => {
    // Bob and Mia become friends; Bob logs the Lighthouse the day after vis_copy (Alice + Mia).
    const p = pair(U.bob, U.mia)
    await k.t.db.insert(friendships).values({ userA: p.userA, userB: p.userB, status: 'accepted', requestedBy: U.bob, acceptedAt: new Date() })
    const bobs = await k.api(U.bob, 'POST', '/api/visits', { gameId: FX.games.lighthouse, facts: facts('2026-08-16'), review: { ratings: ratings(70), visibility: 'public' } })
    const r = await k.api(U.mia, 'POST', `/api/visits/${bobs.body.id}/join`, { fromVisitId: V.copy })
    expect(r.status).toBe(200)
    expect(r.body.reviews.find((x: { author: { id: string } }) => x.author.id === U.mia).id).toBe(FX.reviews.miaCopy)
    const copy = VisitDetailSchema.parse((await k.api(U.alice, 'GET', `/api/visits/${V.copy}`)).body)
    expect(copy.participants.map((x) => x.user?.id)).toEqual([U.alice])
    expect(copy.reviews.map((x) => x.author.id)).toEqual([U.alice])
  })

  it('join is refused for strangers, other games, far dates and visits that aren\'t mine', async () => {
    expect((await k.api(U.carol, 'POST', `/api/visits/${V.together}/join`, {})).status).toBe(404)
    expect((await k.api(U.mia, 'POST', `/api/visits/vis_nope/join`, {})).status).toBe(404)
    const other = await k.api(U.mia, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-12') })
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: other.body.id })).status).toBe(400)
    const far = await k.api(U.mia, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: facts('2026-10-20') })
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: far.body.id })).status).toBe(400)
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: V.carol })).status).toBe(404)
    expect((await k.api(U.mia, 'POST', `/api/visits/${V.together}/join`, { fromVisitId: V.together })).status).toBe(400)
    // Nothing changed on a refusal.
    expect(await k.t.db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, V.together), eq(visitParticipants.userId, U.mia)))).toHaveLength(0)
  })

  it('a pending tag can be answered by joining', async () => {
    const r = await k.api(U.bob, 'POST', `/api/visits/${V.pending}/join`, { review: { ratings: ratings(55), visibility: 'friends' } })
    expect(r.status).toBe(200)
    expect(r.body.myStatus).toBe('accepted')
    const mine = (await k.t.db.select().from(reviews).where(and(eq(reviews.visitId, V.pending), eq(reviews.authorId, U.bob))))[0]
    expect(mine).toMatchObject({ overallScore: 55, scoresCopied: false, visibility: 'friends' })
  })

  it('a public review in a join needs onboarding', async () => {
    expect((await k.api(U.newbie, 'POST', `/api/visits/${V.together}/join`, { review: { ratings: ratings(55) } })).body.code).toBe('onboarding_required')
  })
})

describe('helpers', () => {
  it('dates and names', () => {
    expect(daysApart('2026-10-12', '2026-10-13')).toBe(1)
    expect(daysApart('2026-03-08', '2026-03-09')).toBe(1)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect([...namesForUser({ name: 'Mia Rossi', displayName: 'Mimi' })].sort()).toEqual(['mia', 'mia rossi', 'mimi'])
  })
})
