// @vitest-environment node
/**
 * Reviews (workstream 33): one per author per visit, author-only edits, visibility, spoilers,
 * the copied-score flag and public aggregates. Fixture reviews: server/db/fixtures.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ReviewPageSchema, ReviewV2Schema } from '../../src/contracts/models'
import { FX } from '../db/fixtures'
import { reviews, users } from '../db/schema'
import { decodeCursor, encodeCursor, gameAggregate, gameSummaries, puzzleHighlights } from './reviews.lib'
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

const R = FX.reviews
const V = FX.visits
const S = FX.gameSlugs

describe('write my review', () => {
  it('only accepted participants write, one review per author per visit', async () => {
    const r = await k.api(U.bob, 'PUT', `/api/visits/${V.together}/review`, { ratings: ratings(90, 80, 'Loved it'), visibility: 'public', containsSpoilers: false })
    expect(r.status).toBe(200)
    const rev = ReviewV2Schema.parse(r.body)
    expect(rev).toMatchObject({ id: R.bobTogether, visibility: 'public', transcript: '', scoresCopied: false })
    expect(rev.ratings.overall).toEqual({ score: 90, comment: 'Loved it' })
    expect((await k.t.db.select().from(reviews).where(eq(reviews.visitId, V.together)))).toHaveLength(2)
    // Pending: accept first. Strangers: 404.
    expect((await k.api(U.bob, 'PUT', `/api/visits/${V.pending}/review`, { ratings: ratings(50) })).status).toBe(403)
    expect((await k.api(U.carol, 'PUT', `/api/visits/${V.together}/review`, { ratings: ratings(50) })).status).toBe(404)
    expect((await k.api(U.bob, 'PUT', `/api/visits/${V.together}/review`, { ratings: ratings(0) })).status).toBe(400)
  })

  it('a first review on a visit I accepted', async () => {
    await k.api(U.bob, 'POST', `/api/visits/${V.pending}/respond`, { accept: true })
    await k.t.db.delete(reviews).where(eq(reviews.authorId, U.bob))
    const r = await k.api(U.bob, 'PUT', `/api/visits/${V.pending}/review`, { ratings: ratings(40), visibility: 'friends', memorablePuzzleIds: ['pzl_clock'] })
    expect(r.status).toBe(200)
    // A puzzle of another visit is not memorable here.
    expect(r.body).toMatchObject({ visibility: 'friends', scoresCopied: false, memorablePuzzleIds: [] })
  })

  it('a copied review stays a copy until a score changes', async () => {
    const same = await k.api(U.mia, 'PUT', `/api/visits/${V.copy}/review`, {
      ratings: { ...ratings(84), puzzles: { score: 80, comment: 'mine now' }, setting: { score: 88, comment: '' }, storyline: { score: 82, comment: '' }, difficulty: { score: 77, comment: '' } },
      visibility: 'public',
    })
    expect(same.body.scoresCopied).toBe(true)
    expect(same.body.copiedFromReviewId).toBe(R.aliceCopy)
    const changed = await k.api(U.mia, 'PUT', `/api/visits/${V.copy}/review`, { ratings: ratings(60), visibility: 'public' })
    expect(changed.body.scoresCopied).toBe(false)
    // Changing it back doesn't make it a copy again.
    const back = await k.api(U.mia, 'PUT', `/api/visits/${V.copy}/review`, { ratings: { ...ratings(84), puzzles: { score: 80, comment: '' }, setting: { score: 88, comment: '' }, storyline: { score: 82, comment: '' }, difficulty: { score: 77, comment: '' } } })
    expect(back.body.scoresCopied).toBe(false)
  })

  it('public needs onboarding (403 onboarding_required)', async () => {
    const v = await k.api(U.newbie, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-25'), review: { ratings: ratings(50), visibility: 'private' } })
    const pub = await k.api(U.newbie, 'PUT', `/api/visits/${v.body.id}/review`, { ratings: ratings(55), visibility: 'public' })
    expect(pub.status).toBe(403)
    expect(pub.body.code).toBe('onboarding_required')
    const rid = v.body.reviews[0].id
    expect((await k.api(U.newbie, 'PATCH', `/api/reviews/${rid}`, { visibility: 'public' })).body.code).toBe('onboarding_required')
    expect((await k.api(U.newbie, 'PATCH', `/api/reviews/${rid}`, { visibility: 'friends' })).status).toBe(200)
  })
})

describe('read one review', () => {
  it('private: author only; transcripts never reach anyone else', async () => {
    expect((await k.api(U.carol, 'GET', `/api/reviews/${R.aliceSolo}`)).status).toBe(404)
    expect((await k.api(null, 'GET', `/api/reviews/${R.aliceSolo}`)).status).toBe(404)
    expect((await k.api(U.bob, 'GET', `/api/reviews/${R.aliceSolo}`)).status).toBe(404)
    expect((await k.api(U.alice, 'GET', `/api/reviews/${R.aliceSolo}`)).body.visibility).toBe('private')
    const pub = await k.api(null, 'GET', `/api/reviews/${R.aliceTogether}`)
    expect(pub.status).toBe(200)
    expect(pub.body.transcript).toBeNull()
    expect(text(pub)).not.toContain('Alice private transcript')
    expect(text(pub)).not.toContain('example.com')
    expect((await k.api(U.alice, 'GET', `/api/reviews/${R.aliceTogether}`)).body.transcript).toBe('Alice private transcript')
  })

  it('friends only: the author\'s friends', async () => {
    expect((await k.api(U.alice, 'GET', `/api/reviews/${R.bobTogether}`)).status).toBe(200)
    expect((await k.api(U.carol, 'GET', `/api/reviews/${R.bobTogether}`)).status).toBe(404)
    expect((await k.api(null, 'GET', `/api/reviews/${R.bobTogether}`)).status).toBe(404)
    expect((await k.api(U.mia, 'GET', `/api/reviews/${R.bobTogether}`)).status).toBe(404)
  })

  it('spoiler-flagged comments are blank until revealed (?spoilers=1); the author always sees them', async () => {
    const hidden = await k.api(U.alice, 'GET', `/api/reviews/${R.bobTogether}`)
    expect(hidden.body.containsSpoilers).toBe(true)
    expect(hidden.body.ratings.overall).toEqual({ score: 80, comment: '' })
    const shown = await k.api(U.alice, 'GET', `/api/reviews/${R.bobTogether}?spoilers=1`)
    expect(shown.body.ratings.overall.comment).toBe('Bob thought the ending twist was great.')
    expect((await k.api(U.bob, 'GET', `/api/reviews/${R.bobTogether}`)).body.ratings.overall.comment).toBe('Bob thought the ending twist was great.')
  })

  it('a hidden review is visible only to its author', async () => {
    await k.t.db.update(reviews).set({ hiddenAt: new Date(), hiddenReason: 'spam' }).where(eq(reviews.id, R.aliceGuest))
    expect((await k.api(null, 'GET', `/api/reviews/${R.aliceGuest}`)).status).toBe(404)
    expect((await k.api(U.mia, 'GET', `/api/reviews/${R.aliceGuest}`)).status).toBe(404)
    expect((await k.api(U.alice, 'GET', `/api/reviews/${R.aliceGuest}`)).body.hidden).toBe(true)
  })
})

describe('change visibility or the spoiler flag', () => {
  it('author only', async () => {
    expect((await k.api(U.alice, 'PATCH', `/api/reviews/${R.bobTogether}`, { visibility: 'public' })).status).toBe(403)
    expect((await k.api(U.carol, 'PATCH', `/api/reviews/${R.bobTogether}`, { visibility: 'public' })).status).toBe(404)
    const r = await k.api(U.bob, 'PATCH', `/api/reviews/${R.bobTogether}`, { visibility: 'public', containsSpoilers: false })
    expect(r.body).toMatchObject({ visibility: 'public', containsSpoilers: false, transcript: 'Bob private transcript' })
    expect((await k.api(null, 'GET', `/api/reviews/${R.bobTogether}`)).body.ratings.overall.comment).toBe('Bob thought the ending twist was great.')
    expect((await k.api(U.bob, 'PATCH', `/api/reviews/${R.bobTogether}`, { visibility: 'private' })).status).toBe(200)
    expect((await k.api(U.alice, 'GET', `/api/reviews/${R.bobTogether}`)).status).toBe(404)
  })
})

describe('public game reviews', () => {
  it('anonymous: public reviews only, newest first, with "played together" links and photos', async () => {
    const r = await k.api(null, 'GET', `/api/games/${S.observatory}/reviews`)
    expect(r.status).toBe(200)
    const page = ReviewPageSchema.parse(r.body)
    expect(page.reviews.map((x) => x.id).sort()).toEqual([R.aliceTogether, R.carol].sort())
    const alice = page.reviews.find((x) => x.id === R.aliceTogether)!
    expect(alice).toMatchObject({ date: '2026-10-12', escaped: true, escapeTimeMinutes: 52, scoresCopied: false })
    expect(alice.playedWith).toEqual([]) // Bob's review is friends-only
    expect(alice.photos.map((p) => p.id)).toEqual([FX.photos.bobTogether])
    expect(text(r)).not.toContain('transcript')
    expect(text(r)).not.toContain('example.com')
    expect(page.nextCursor).toBeNull()
  })

  it('signed in: plus friends-only reviews by my friends, spoilers blank until revealed', async () => {
    const page = ReviewPageSchema.parse((await k.api(U.alice, 'GET', `/api/games/${S.observatory}/reviews`)).body)
    expect(page.reviews.map((x) => x.id).sort()).toEqual([R.aliceTogether, R.bobTogether, R.carol].sort())
    const bob = page.reviews.find((x) => x.id === R.bobTogether)!
    expect(bob.ratings.overall.comment).toBe('')
    expect(page.reviews.find((x) => x.id === R.aliceTogether)!.playedWith).toEqual([{ reviewId: R.bobTogether, author: expect.objectContaining({ id: U.bob }) }])
    const shown = ReviewPageSchema.parse((await k.api(U.alice, 'GET', `/api/games/${S.observatory}/reviews?spoilers=1`)).body)
    expect(shown.reviews.find((x) => x.id === R.bobTogether)!.ratings.overall.comment).toBe('Bob thought the ending twist was great.')
    // Carol isn't Bob's friend.
    expect(ReviewPageSchema.parse((await k.api(U.carol, 'GET', `/api/games/${S.observatory}/reviews`)).body).reviews).toHaveLength(2)
  })

  it('private and hidden reviews never appear; a visit with only private reviews stays off the page', async () => {
    const vault = ReviewPageSchema.parse((await k.api(null, 'GET', `/api/games/${S.vault}/reviews`)).body)
    expect(vault.reviews.map((x) => x.id)).toEqual([R.alicePending])
    expect(vault.reviews.some((x) => x.visitId === V.solo)).toBe(false)
    await k.t.db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, R.alicePending))
    expect(ReviewPageSchema.parse((await k.api(U.alice, 'GET', `/api/games/${S.vault}/reviews`)).body).reviews).toEqual([])
  })

  it('a "public" review by someone without an @handle is not public', async () => {
    const v = await k.api(U.newbie, 'POST', '/api/visits', { gameId: FX.games.vault, facts: facts('2026-10-25'), review: { ratings: ratings(10), visibility: 'private' } })
    await k.t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.authorId, U.newbie))
    const page = ReviewPageSchema.parse((await k.api(null, 'GET', `/api/games/${S.vault}/reviews`)).body)
    expect(page.reviews.some((x) => x.visitId === v.body.id)).toBe(false)
    expect((await gameAggregate(k.t.db, FX.games.vault)).reviewCount).toBe(1)
  })

  it('pages with a cursor without gaps or repeats', async () => {
    // Five more public reviews of the Observatory by Bob (on new visits).
    for (let i = 1; i <= 5; i++) {
      await k.api(U.bob, 'POST', '/api/visits', { gameId: FX.games.observatory, facts: facts(`2026-09-0${i}`), review: { ratings: ratings(50 + i), visibility: 'public' } })
    }
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const res: { body: unknown } = await k.api(null, 'GET', `/api/games/${S.observatory}/reviews?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      const page = ReviewPageSchema.parse(res.body)
      seen.push(...page.reviews.map((x) => x.id))
      cursor = page.nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
    expect((await k.api(null, 'GET', `/api/games/${S.observatory}/reviews?cursor=bad`)).status).toBe(200)
  })

  it('unknown or hidden games are 404', async () => {
    expect((await k.api(null, 'GET', '/api/games/no-such-game/reviews')).status).toBe(404)
  })
})

describe('public aggregates', () => {
  it('count public, non-copied reviews; visits once; copied scores join once a score changes', async () => {
    const before = await gameAggregate(k.t.db, FX.games.lighthouse)
    // aliceGuest 92 + aliceCopy 84; Mia's copy (84) is excluded.
    expect(before).toMatchObject({ reviewCount: 2, visitCount: 2, escapeRate: 1, avgEscapeMinutes: 49 })
    expect(before.avg.overall).toBe(88)
    await k.api(U.mia, 'PUT', `/api/visits/${V.copy}/review`, { ratings: ratings(60), visibility: 'public' })
    const after = await gameAggregate(k.t.db, FX.games.lighthouse)
    expect(after.reviewCount).toBe(3)
    expect(after.visitCount).toBe(2)
    expect(after.avg.overall).toBeCloseTo((92 + 84 + 60) / 3, 1)
    const summary = (await gameSummaries(k.t.db, [FX.games.lighthouse])).get(FX.games.lighthouse)!
    expect(summary).toMatchObject({ reviewCount: 3, venueName: 'Maple & Key', genre: 'horror' })
  })

  it('friends-only and private reviews are left out; escape rate over public visits', async () => {
    const obs = await gameAggregate(k.t.db, FX.games.observatory)
    // aliceTogether 88 + carol 65 (bob's is friends-only). together escaped, carol's visit did not.
    expect(obs).toMatchObject({ reviewCount: 2, visitCount: 2, escapeRate: 0.5, avgEscapeMinutes: 52 })
    expect(obs.avg.overall).toBe(76.5)
    const vault = await gameAggregate(k.t.db, FX.games.vault)
    expect(vault).toMatchObject({ reviewCount: 1, visitCount: 1 })
    await k.t.db.update(users).set({ handle: null }).where(eq(users.id, U.carol))
    expect((await gameAggregate(k.t.db, FX.games.observatory)).reviewCount).toBe(1)
  })

  it('no public data gives nulls', async () => {
    await k.t.db.update(reviews).set({ visibility: 'private' })
    expect(await gameAggregate(k.t.db, FX.games.lighthouse)).toEqual({
      reviewCount: 0, visitCount: 0, escapeRate: null, avgEscapeMinutes: null,
      avg: { overall: null, puzzles: null, setting: null, storyline: null, difficulty: null },
    })
  })
})

describe('puzzle highlights (spoilers)', () => {
  it('hide descriptions and notes unless revealed, most memorable first', async () => {
    const hidden = await puzzleHighlights(k.t.db, FX.games.observatory)
    expect(hidden).toHaveLength(2)
    expect(hidden.every((p) => p.description === '' && p.notes === '' && p.spoiler)).toBe(true)
    const shown = await puzzleHighlights(k.t.db, FX.games.observatory, { reveal: true })
    expect(shown[0]).toMatchObject({ description: 'Set the telescope clock to 4:35', memorableCount: 1, notes: 'The hands were hidden in the star chart.' })
    // The solo visit's review is private, so nothing from it is public.
    expect(await puzzleHighlights(k.t.db, FX.games.vault, { reveal: true })).toEqual([])
  })
})

describe('cursors', () => {
  it('round-trip and reject junk', () => {
    const c = encodeCursor('2026-10-26 04:21:52.123456+00', 'rev_x')
    expect(decodeCursor(c)).toEqual({ ts: '2026-10-26 04:21:52.123456+00', id: 'rev_x' })
    expect(decodeCursor(Buffer.from("1'; drop table x|id").toString('base64url'))).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
  })
})

describe('public game reviews: integration rules', () => {
  it('photos of a visit with only friends-only reviews show only to people on the visit', async () => {
    await k.t.db.update(reviews).set({ visibility: 'friends' }).where(eq(reviews.id, R.aliceTogether))
    // Mia is alice's friend but not on the visit: she sees the review, not the photo (the photo route would 404 for her).
    const mia = ReviewPageSchema.parse((await k.api(U.mia, 'GET', `/api/games/${S.observatory}/reviews`)).body)
    const seen = mia.reviews.find((x) => x.id === R.aliceTogether)!
    expect(seen.photos).toEqual([])
    expect(text({ status: 200, body: mia })).not.toContain('We escaped!')
    expect((await k.api(U.mia, 'GET', `/api/photos/${FX.photos.bobTogether}`)).status).toBe(404)
    // Alice is on the visit: Bob's friends-only review of it shows her the photo.
    const alice = ReviewPageSchema.parse((await k.api(U.alice, 'GET', `/api/games/${S.observatory}/reviews`)).body)
    expect(alice.reviews.find((x) => x.id === R.bobTogether)!.photos.map((p) => p.id)).toEqual([FX.photos.bobTogether])
  })

  it('a public review needs both an @handle and a display name (authorIsPublic) to show publicly or count', async () => {
    await k.t.db.update(users).set({ displayName: null }).where(eq(users.id, U.carol))
    const anon = ReviewPageSchema.parse((await k.api(null, 'GET', `/api/games/${S.observatory}/reviews`)).body)
    expect(anon.reviews.map((x) => x.id)).toEqual([R.aliceTogether])
    expect((await gameAggregate(k.t.db, FX.games.observatory)).reviewCount).toBe(1)
    expect((await k.api(null, 'GET', `/api/reviews/${R.carol}`)).status).toBe(404)
  })

  it('the game page uses the same rules and spoiler blanking as the paged endpoint', async () => {
    const page = (await k.api(U.alice, 'GET', `/api/games/${S.observatory}`)).body
    const paged = ReviewPageSchema.parse((await k.api(U.alice, 'GET', `/api/games/${S.observatory}/reviews`)).body)
    expect(page.reviews).toEqual(paged)
    expect(page.puzzles.every((p: { description: string }) => p.description === '')).toBe(true)
    const shown = (await k.api(U.alice, 'GET', `/api/games/${S.observatory}?spoilers=1`)).body
    expect(shown.reviews.reviews.find((x: { id: string }) => x.id === R.bobTogether).ratings.overall.comment).toBe('Bob thought the ending twist was great.')
  })
})
