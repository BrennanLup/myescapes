import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { computeAggregate, type AggregateInput } from './aggregate'
import { createTestDb, type TestDb } from '../../../server/db/testing'
import { FX, loadFixtures } from '../../../server/db/fixtures'
import { reviews, visits } from '../../../server/db/schema'

const scores = (n: number) => ({ overall: { score: n }, puzzles: { score: n }, setting: { score: n }, storyline: { score: n }, difficulty: { score: n } })
const row = (over: Partial<AggregateInput> & { visitId: string }): AggregateInput => ({
  visibility: 'public',
  hidden: false,
  scoresCopied: false,
  ratings: scores(80),
  escaped: true,
  escapeTimeMinutes: 50,
  ...over,
})

describe('computeAggregate', () => {
  it('is empty with no reviews', () => {
    expect(computeAggregate([])).toEqual({
      reviewCount: 0,
      visitCount: 0,
      escapeRate: null,
      avgEscapeMinutes: null,
      avg: { overall: null, puzzles: null, setting: null, storyline: null, difficulty: null },
    })
  })

  it('leaves copied scores out of the averages but counts the visit once', () => {
    const agg = computeAggregate([
      row({ visitId: 'v1', ratings: scores(90) }),
      row({ visitId: 'v1', ratings: scores(90), scoresCopied: true }),
      row({ visitId: 'v2', ratings: scores(60), escaped: false, escapeTimeMinutes: 60 }),
    ])
    expect(agg.reviewCount).toBe(2)
    expect(agg.avg.overall).toBe(75)
    expect(agg.visitCount).toBe(2)
    expect(agg.escapeRate).toBe(0.5)
    // Escape time averages escaped visits only.
    expect(agg.avgEscapeMinutes).toBe(50)
  })

  it('ignores friends-only, private and hidden reviews entirely', () => {
    const agg = computeAggregate([
      row({ visitId: 'v1', ratings: scores(70) }),
      row({ visitId: 'v2', ratings: scores(10), visibility: 'friends', escaped: false }),
      row({ visitId: 'v3', ratings: scores(10), visibility: 'private', escaped: false }),
      row({ visitId: 'v4', ratings: scores(10), hidden: true, escaped: false }),
    ])
    expect(agg).toMatchObject({ reviewCount: 1, visitCount: 1, escapeRate: 1, avg: { overall: 70 } })
  })

  it('counts a visit whose only public review is a copy for the escape rate, not the scores', () => {
    const agg = computeAggregate([row({ visitId: 'v1', scoresCopied: true, escaped: false })])
    expect(agg).toMatchObject({ reviewCount: 0, visitCount: 1, escapeRate: 0, avg: { overall: null } })
  })

  it('treats unknown escape results as unknown, not as failures', () => {
    const agg = computeAggregate([row({ visitId: 'v1', escaped: null, escapeTimeMinutes: null }), row({ visitId: 'v2', escaped: true, escapeTimeMinutes: 41 })])
    expect(agg.escapeRate).toBe(1)
    expect(agg.avgEscapeMinutes).toBe(41)
  })

  it('rounds averages to one decimal', () => {
    const agg = computeAggregate([row({ visitId: 'a', ratings: scores(80) }), row({ visitId: 'b', ratings: scores(81) }), row({ visitId: 'c', ratings: scores(81) })])
    expect(agg.avg.overall).toBe(80.7)
  })
})

describe('computeAggregate on the shared database fixtures (PGlite)', () => {
  let tdb: TestDb
  beforeAll(async () => {
    tdb = await createTestDb()
    await loadFixtures(tdb.db)
  })
  afterAll(async () => {
    await tdb?.close()
  })

  async function rowsForGame(gameId: string): Promise<AggregateInput[]> {
    const vs = await tdb.db.select().from(visits).where(eq(visits.gameId, gameId))
    const rs = await tdb.db.select().from(reviews).where(inArray(reviews.visitId, vs.map((v) => v.id)))
    return rs.map((r) => {
      const v = vs.find((x) => x.id === r.visitId)!
      return {
        visitId: r.visitId,
        visibility: r.visibility,
        hidden: r.hiddenAt != null,
        scoresCopied: r.scoresCopied,
        escaped: v.escaped,
        escapeTimeMinutes: v.escapeTimeMinutes,
        ratings: {
          overall: { score: r.overallScore },
          puzzles: { score: r.puzzlesScore },
          setting: { score: r.settingScore },
          storyline: { score: r.storylineScore },
          difficulty: { score: r.difficultyScore },
        },
      }
    })
  }

  it("Haunted Lighthouse: Mia's untouched copy of Alice's review is not counted", async () => {
    const agg = computeAggregate(await rowsForGame(FX.games.lighthouse))
    // aliceGuest (92, public) + aliceCopy (84, public); miaCopy (84, copied) left out.
    expect(agg.reviewCount).toBe(2)
    expect(agg.avg.overall).toBe(88)
    expect(agg.visitCount).toBe(2)
    expect(agg.escapeRate).toBe(1)
  })

  it("The Lost Observatory: Bob's friends-only review stays out of public numbers", async () => {
    const agg = computeAggregate(await rowsForGame(FX.games.observatory))
    // aliceTogether (88) + carol (65); bob is friends-only.
    expect(agg.reviewCount).toBe(2)
    expect(agg.avg.overall).toBe(76.5)
    expect(agg.escapeRate).toBe(0.5)
    expect(agg.avgEscapeMinutes).toBe(52)
  })

  it('The Vault: a private review and a pending tag leave one public review', async () => {
    const agg = computeAggregate(await rowsForGame(FX.games.vault))
    expect(agg.reviewCount).toBe(1)
    expect(agg.avg.overall).toBe(70)
  })
})
