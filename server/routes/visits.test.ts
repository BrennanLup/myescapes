// @vitest-environment node
/**
 * Visits and participants (workstream 32): the "Who can do what" rules for seeing, editing,
 * tagging, leaving and deleting visits. Fixture people and visits: server/db/fixtures.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { VisitDetailSchema, VisitEditSchema, type VisitDetail } from '../../src/contracts/models'
import { FX } from '../db/fixtures'
import { reviews, visitParticipants, visits } from '../db/schema'
import { diffFacts } from './visits.lib'
import { facts, ratings, socialKit, text, U, type Kit } from './visits.testkit'

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
const statusOf = (d: VisitDetail, userId: string) => d.participants.find((p) => p.user?.id === userId)?.status

describe('create a visit', () => {
  it('logs facts, puzzles, crew and my review; tags friends (auto-accept per friend) and guests', async () => {
    const r = await k.api(U.alice, 'POST', '/api/visits', {
      gameId: FX.games.vault,
      facts: facts('2026-10-25', { escaped: false, escapeTimeMinutes: 60, toolsUsed: ['uv light'] }),
      puzzles: [
        { id: 'tmp1', description: 'Crack the safe', type: 'lock-and-key', notes: 'Use the receipt' },
        { description: 'Laser maze', type: 'physical' },
      ],
      crew: [{ userId: U.bob }, { userId: U.mia }, { guestName: 'Sam' }, { guestName: 'sam' }, { userId: U.alice }],
      review: { ratings: ratings(77, 70, 'Tense!'), transcript: 'my voice note', memorablePuzzleIds: ['tmp1', 'bogus'], visibility: 'public' },
    })
    expect(r.status).toBe(201)
    const d = VisitDetailSchema.parse(r.body)
    expect(d.facts).toMatchObject({ date: '2026-10-25', escaped: false, toolsUsed: ['uv light'] })
    expect(d.game).toMatchObject({ id: FX.games.vault, venueName: 'Starlight Escapes' })
    expect(d.venue.gameCount).toBe(2)
    expect(d.myStatus).toBe('owner')
    expect(d.puzzles.map((p) => p.description)).toEqual(['Crack the safe', 'Laser maze'])
    expect(statusOf(d, U.alice)).toBe('owner')
    expect(statusOf(d, U.bob)).toBe('pending')
    expect(statusOf(d, U.mia)).toBe('accepted') // mia auto-accepts alice
    expect(d.participants.filter((p) => p.guestName === 'Sam' || p.guestName === 'sam')).toHaveLength(1)
    const mine = d.reviews.find((x) => x.author.id === U.alice)!
    expect(mine.transcript).toBe('my voice note')
    expect(mine.memorablePuzzleIds).toEqual([d.puzzles[0].id]) // temp id mapped, bogus dropped
    // Mia's review is a flagged copy of mine, without my transcript.
    const mia = (await k.t.db.select().from(reviews).where(and(eq(reviews.visitId, d.id), eq(reviews.authorId, U.mia))))[0]
    expect(mia).toMatchObject({ scoresCopied: true, copiedFromReviewId: mine.id, overallScore: 77, overallComment: 'Tense!', transcript: '' })
    expect(text(r)).not.toContain('@example.com')

    const bob = await k.api(U.bob, 'GET', '/api/notifications')
    expect(bob.body.items[0]).toMatchObject({ type: 'tagged', visitId: d.id, text: 'Alice says you played The Vault together on Oct 25' })
    const miaN = await k.api(U.mia, 'GET', '/api/notifications')
    expect(miaN.body.items[0]).toMatchObject({ type: 'tag_auto_added', text: 'Alice logged The Vault with you' })
    // The visit shows in Mia's room straight away; Bob's needs his answer.
    expect((await k.api(U.mia, 'GET', `/api/visits/${d.id}`)).body.myStatus).toBe('accepted')
    expect((await k.api(U.bob, 'GET', '/api/tags/pending')).body.tags.map((x: { visitId: string }) => x.visitId)).toContain(d.id)
  })

  it('only accepted friends can be tagged; nothing is saved on a 403', async () => {
    for (const who of [U.carol, U.eve, U.dave, 'usr_nobody']) {
      const before = (await k.t.db.select().from(visits)).length
      const r = await k.api(U.alice, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-25'), crew: [{ userId: who }] })
      expect(r.status, who).toBe(403)
      expect((await k.t.db.select().from(visits)).length).toBe(before)
    }
  })

  it('a public review needs onboarding; private is fine', async () => {
    const pub = await k.api(U.newbie, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-25'), review: { ratings: ratings(50) } })
    expect(pub.status).toBe(403)
    expect(pub.body.code).toBe('onboarding_required')
    const priv = await k.api(U.newbie, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-25'), review: { ratings: ratings(50), visibility: 'private' } })
    expect(priv.status).toBe(201)
    // No review at all is fine too.
    expect((await k.api(U.newbie, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-26') })).status).toBe(201)
  })

  it('unknown games and invalid bodies', async () => {
    expect((await k.api(U.alice, 'POST', '/api/visits', { gameId: 'gam_nope', facts: facts('2026-10-25') })).status).toBe(404)
    expect((await k.api(U.alice, 'POST', '/api/visits', { gameId: FX.games.vault, facts: { date: 'yesterday' } })).status).toBe(400)
  })
})

describe('see a visit', () => {
  it('participants (owner, accepted, pending) only; everyone else 404', async () => {
    expect((await k.api(U.alice, 'GET', `/api/visits/${V.together}`)).status).toBe(200)
    expect((await k.api(U.bob, 'GET', `/api/visits/${V.together}`)).status).toBe(200)
    expect((await k.api(U.bob, 'GET', `/api/visits/${V.pending}`)).body.myStatus).toBe('pending')
    for (const who of [U.carol, U.mia, U.eve, U.admin]) expect((await k.api(who, 'GET', `/api/visits/${V.together}`)).status, who).toBe(404)
    expect((await k.api(U.alice, 'GET', '/api/visits/vis_nope')).status).toBe(404)
    expect((await k.api(null, 'GET', `/api/visits/${V.together}`)).status).toBe(401)
  })

  it('shows reviews by visibility, transcripts only to their author, and the photos', async () => {
    const a = VisitDetailSchema.parse((await k.api(U.alice, 'GET', `/api/visits/${V.together}`)).body)
    const bobRev = a.reviews.find((r) => r.author.id === U.bob)!
    expect(bobRev.visibility).toBe('friends')
    expect(bobRev.transcript).toBeNull()
    expect(a.reviews.find((r) => r.author.id === U.alice)!.transcript).toBe('Alice private transcript')
    expect(a.photos).toEqual([expect.objectContaining({ id: FX.photos.bobTogether, url: `/api/photos/${FX.photos.bobTogether}`, uploaderId: U.bob })])
    const b = await k.api(U.bob, 'GET', `/api/visits/${V.together}`)
    expect(text(b)).not.toContain('Alice private transcript')
    expect(text(b)).toContain('Bob private transcript')
    // After unfriending, a friends-only review is no longer visible to the other participant.
    await k.api(U.bob, 'DELETE', `/api/friends/${U.alice}`)
    const a2 = VisitDetailSchema.parse((await k.api(U.alice, 'GET', `/api/visits/${V.together}`)).body)
    expect(a2.reviews.map((r) => r.author.id)).toEqual([U.alice])
  })
})

describe('edit shared facts', () => {
  it('any accepted participant can edit; each edit is recorded and the others are notified', async () => {
    const r = await k.api(U.bob, 'PATCH', `/api/visits/${V.together}`, { facts: { escaped: false, escapeTimeMinutes: 60, date: '2026-10-12' } })
    expect(r.status).toBe(200)
    expect(r.body.facts).toMatchObject({ escaped: false, escapeTimeMinutes: 60 })
    const e = await k.api(U.alice, 'GET', `/api/visits/${V.together}/edits`)
    expect(e.body.edits).toHaveLength(1)
    const edit = VisitEditSchema.parse(e.body.edits[0])
    expect(edit.editor?.id).toBe(U.bob)
    // Unchanged fields (date) are not part of the record.
    expect(edit.changes).toEqual({ escaped: { from: true, to: false }, escapeTimeMinutes: { from: 52, to: 60 } })
    expect((await k.api(U.alice, 'GET', '/api/notifications')).body.items[0]).toMatchObject({ type: 'visit_edited', actor: { id: U.bob } })
    // A no-op edit records nothing.
    await k.api(U.alice, 'PATCH', `/api/visits/${V.together}`, { facts: { escaped: false } })
    expect((await k.api(U.alice, 'GET', `/api/visits/${V.together}/edits`)).body.edits).toHaveLength(1)
    // The owner edits too; newest first.
    await k.api(U.alice, 'PATCH', `/api/visits/${V.together}`, { facts: { liveActors: true } })
    const e2 = await k.api(U.bob, 'GET', `/api/visits/${V.together}/edits`)
    expect(e2.body.edits.map((x: { editor: { id: string } }) => x.editor.id)).toEqual([U.alice, U.bob])
  })

  it('pending, declined and outside users cannot edit', async () => {
    expect((await k.api(U.bob, 'PATCH', `/api/visits/${V.pending}`, { facts: { escaped: false } })).status).toBe(403)
    expect((await k.api(U.bob, 'GET', `/api/visits/${V.pending}/edits`)).status).toBe(403)
    expect((await k.api(U.carol, 'PATCH', `/api/visits/${V.together}`, { facts: { escaped: false } })).status).toBe(404)
    expect((await k.api(U.carol, 'GET', `/api/visits/${V.together}/edits`)).status).toBe(404)
    const v = (await k.t.db.select().from(visits).where(eq(visits.id, V.together)))[0]
    expect(v.escaped).toBe(true)
  })

  it('puzzle edits keep ids, drop removed ones from memorable lists and are recorded', async () => {
    const r = await k.api(U.bob, 'PATCH', `/api/visits/${V.together}`, {
      puzzles: [
        { id: FX.puzzles.stars, description: 'Match the constellations to the keypad', type: 'logic' },
        { description: 'Find the hidden lens', type: 'search', notes: 'Under the rug' },
      ],
    })
    expect(r.status).toBe(200)
    const d = VisitDetailSchema.parse(r.body)
    expect(d.puzzles.map((p) => p.id)[0]).toBe(FX.puzzles.stars)
    expect(d.puzzles).toHaveLength(2)
    const aliceRev = (await k.t.db.select().from(reviews).where(eq(reviews.id, FX.reviews.aliceTogether)))[0]
    expect(aliceRev.memorablePuzzleIds).toEqual([]) // the clock puzzle was removed
    const edits = (await k.api(U.alice, 'GET', `/api/visits/${V.together}/edits`)).body.edits
    expect(Object.keys(edits[0].changes)).toEqual(['puzzles'])
  })
})

describe('tagging and answering', () => {
  it('tag more people on a visit: friends only, auto-accept applies, existing participants untouched', async () => {
    const r = await k.api(U.alice, 'POST', `/api/visits/${V.together}/participants`, { crew: [{ userId: U.mia }, { userId: U.bob }, { guestName: 'Sam' }] })
    expect(r.status).toBe(200)
    const d = VisitDetailSchema.parse(r.body)
    expect(statusOf(d, U.mia)).toBe('accepted')
    expect(statusOf(d, U.bob)).toBe('accepted')
    expect(d.participants.some((p) => p.guestName === 'Sam')).toBe(true)
    const miaRev = (await k.t.db.select().from(reviews).where(and(eq(reviews.visitId, V.together), eq(reviews.authorId, U.mia))))[0]
    expect(miaRev).toMatchObject({ scoresCopied: true, copiedFromReviewId: FX.reviews.aliceTogether })
    expect((await k.api(U.alice, 'POST', `/api/visits/${V.together}/participants`, { crew: [{ userId: U.carol }] })).status).toBe(403)
    // Bob is on the visit but is not Mia's friend.
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.together}/participants`, { crew: [{ userId: U.mia }] })).status).toBe(403)
    // Pending participants can't tag; strangers don't see the visit.
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.pending}/participants`, { crew: [{ guestName: 'X' }] })).status).toBe(403)
    expect((await k.api(U.carol, 'POST', `/api/visits/${V.together}/participants`, { crew: [{ guestName: 'X' }] })).status).toBe(404)
  })

  it('accept: added to my room with a copied review, and the tagger hears about it', async () => {
    const r = await k.api(U.bob, 'POST', `/api/visits/${V.pending}/respond`, { accept: true })
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('accepted')
    const d = VisitDetailSchema.parse(r.body.visit)
    expect(d.myStatus).toBe('accepted')
    const mine = d.reviews.find((x) => x.author.id === U.bob)!
    expect(mine).toMatchObject({ scoresCopied: true, copiedFromReviewId: FX.reviews.alicePending, transcript: '' })
    expect((await k.api(U.alice, 'GET', '/api/notifications')).body.items[0]).toMatchObject({ type: 'tag_accepted', text: 'Bob added The Vault to their room' })
    expect((await k.api(U.bob, 'GET', '/api/tags/pending')).body.tags).toEqual([])
    // Accepting twice is harmless.
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.pending}/respond`, { accept: true })).status).toBe(200)
  })

  it('decline ("That wasn\'t me"): gone from my inbox and my view', async () => {
    const r = await k.api(U.bob, 'POST', `/api/visits/${V.pending}/respond`, { accept: false })
    expect(r.body).toEqual({ visit: null, status: 'declined' })
    expect((await k.api(U.bob, 'GET', `/api/visits/${V.pending}`)).status).toBe(404)
    expect((await k.api(U.bob, 'GET', '/api/tags/pending')).body.tags).toEqual([])
    const a = VisitDetailSchema.parse((await k.api(U.alice, 'GET', `/api/visits/${V.pending}`)).body)
    expect(a.participants.some((p) => p.user?.id === U.bob)).toBe(false)
    // Declining something already in my room is a conflict (leave instead); strangers get 404.
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.together}/respond`, { accept: false })).status).toBe(409)
    expect((await k.api(U.carol, 'POST', `/api/visits/${V.pending}/respond`, { accept: true })).status).toBe(404)
  })

  it('pending tags inbox', async () => {
    const r = await k.api(U.bob, 'GET', '/api/tags/pending')
    expect(r.body.tags).toEqual([
      expect.objectContaining({ visitId: V.pending, participantId: FX.participants.bobPending, date: '2026-10-20', taggedBy: expect.objectContaining({ id: U.alice }), game: expect.objectContaining({ name: 'The Vault' }) }),
    ])
    expect((await k.api(U.alice, 'GET', '/api/tags/pending')).body.tags).toEqual([])
  })

  it('crew suggestions: friends by visits together, then guest names', async () => {
    // Two more rooms with Mia make her the first chip.
    for (const date of ['2026-10-01', '2026-10-02']) {
      await k.api(U.alice, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts(date), crew: [{ userId: U.mia }, { guestName: 'Sam' }] })
    }
    const r = await k.api(U.alice, 'GET', '/api/crew/suggestions')
    expect(r.status).toBe(200)
    const s = r.body.suggestions
    expect(s[0]).toMatchObject({ kind: 'friend', user: { id: U.mia }, visitsTogether: 3 })
    expect(s[1]).toMatchObject({ kind: 'friend', user: { id: U.bob }, visitsTogether: 1 })
    expect(s.slice(2)).toEqual([
      { kind: 'guest', guestName: 'Sam', visitsTogether: 2 },
      { kind: 'guest', guestName: 'Mia', visitsTogether: 1 },
    ])
    expect(text(r)).not.toContain('example.com')
  })
})

describe('leave and delete', () => {
  it('any participant can leave: their review goes, the visit stays for the others', async () => {
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.together}/leave`)).body).toEqual({ left: true })
    expect((await k.t.db.select().from(reviews).where(eq(reviews.id, FX.reviews.bobTogether)))).toHaveLength(0)
    expect((await k.api(U.bob, 'GET', `/api/visits/${V.together}`)).status).toBe(404)
    const a = VisitDetailSchema.parse((await k.api(U.alice, 'GET', `/api/visits/${V.together}`)).body)
    expect(a.participants.map((p) => p.user?.id)).toEqual([U.alice])
    // A pending participant can leave too (same as declining).
    expect((await k.api(U.bob, 'POST', `/api/visits/${V.pending}/leave`)).status).toBe(200)
    expect((await k.api(U.carol, 'POST', `/api/visits/${V.together}/leave`)).status).toBe(404)
  })

  it('the owner can leave a shared visit; it stays for the others', async () => {
    expect((await k.api(U.alice, 'POST', `/api/visits/${V.together}/leave`)).status).toBe(200)
    const b = VisitDetailSchema.parse((await k.api(U.bob, 'GET', `/api/visits/${V.together}`)).body)
    expect(b.reviews.map((r) => r.author.id)).toEqual([U.bob])
  })

  it('leaving a visit nobody else (with an account) is on removes it', async () => {
    await k.api(U.alice, 'POST', `/api/visits/${V.guest}/leave`)
    expect(await k.t.db.select().from(visits).where(eq(visits.id, V.guest))).toHaveLength(0)
  })

  it('delete: creator only, and only while nobody else accepted', async () => {
    const together = await k.api(U.alice, 'DELETE', `/api/visits/${V.together}`)
    expect(together.status).toBe(409)
    expect((await k.api(U.bob, 'DELETE', `/api/visits/${V.together}`)).status).toBe(403)
    expect((await k.api(U.carol, 'DELETE', `/api/visits/${V.together}`)).status).toBe(404)
    // Bob is only pending on vis_pending, and the guest on vis_guest has no account.
    expect((await k.api(U.alice, 'DELETE', `/api/visits/${V.pending}`)).body).toEqual({ deleted: true })
    expect((await k.api(U.bob, 'GET', '/api/tags/pending')).body.tags).toEqual([])
    expect((await k.api(U.bob, 'GET', '/api/notifications')).body.items.some((n: { visitId: string }) => n.visitId === V.pending)).toBe(false)
    expect((await k.api(U.alice, 'DELETE', `/api/visits/${V.guest}`)).status).toBe(200)
    expect((await k.api(U.alice, 'DELETE', `/api/visits/${V.solo}`)).status).toBe(200)
    expect(await k.t.db.select().from(visitParticipants).where(eq(visitParticipants.visitId, V.solo))).toHaveLength(0)
  })
})

describe('diffFacts', () => {
  it('compares arrays by value and ignores missing keys', () => {
    expect(diffFacts({ toolsUsed: ['a'], escaped: true }, { toolsUsed: ['a'], escaped: false })).toEqual(['escaped'])
    expect(diffFacts({ date: '2026-01-01' }, { escaped: true })).toEqual([])
  })
})
