// @vitest-environment node
/**
 * Escape of the Day API (workstream 23) on the PGlite harness with fixtures and a fake clock.
 * Fixture: puzzle #1 on 2026-10-26 (combination), and alice finished it (solved, 900 points).
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DailyTodaySchema, StreakSchema, type DailyResultInput } from '../../src/contracts/models'
import { dailySpec, generateDaily } from '../../src/daily/engine'
import { dailyPuzzles, dailyResults } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'

let t: TestApp
let clock = new Date('2026-10-27T01:00:00Z')
const setNow = (iso: string) => {
  clock = new Date(iso)
}

beforeAll(async () => {
  t = await buildTestApp({ fixtures: true, now: () => clock })
})
afterAll(async () => {
  await t?.close()
})
beforeEach(() => {
  setNow('2026-10-27T01:00:00Z')
})

const U = () => t.fx.users
const json = <T = Record<string, unknown>>(res: { body: string }) => JSON.parse(res.body) as T

async function today(as?: string, tz?: string) {
  const res = await t.inject({ method: 'GET', url: `/api/daily/today${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`, as })
  expect(res.statusCode, res.body).toBe(200)
  return DailyTodaySchema.parse(json(res))
}
async function start(as: string, tz: string) {
  const res = await t.inject({ method: 'POST', url: '/api/daily/start', as, payload: { tz } })
  expect(res.statusCode, res.body).toBe(200)
  return DailyTodaySchema.parse(json(res))
}
/** A guess row of the right width for that day's puzzle. */
const row = (day: string, mark: 'hit' | 'close' | 'miss') => Array(generateDaily(dailySpec(day)).slots).fill(mark) as typeof mark[]
const submit = (as: string, payload: Partial<DailyResultInput> & { day: string; number: number }) =>
  t.inject({
    method: 'POST',
    url: '/api/daily/results',
    as,
    payload: { solved: true, guesses: 2, hintsUsed: 0, timeMs: 60_000, grid: [row(payload.day, 'miss'), row(payload.day, 'hit')], ...payload },
  })

describe('GET /api/daily/today', () => {
  it('signed out: the puzzle for the zone sent, the same for everyone, themed on a directory game', async () => {
    const a = await today(undefined, 'Asia/Tokyo')
    expect(a.serverDay).toBe('2026-10-27')
    expect(a.timeZone).toBe('Asia/Tokyo')
    expect(a.result).toBeNull()
    expect(a.streak).toBeNull()
    expect(a.puzzle).toMatchObject(dailySpec('2026-10-27'))
    expect(a.puzzle.number).toBe(2)
    expect(a.puzzle.theme).not.toBeNull()
    expect([t.fx.gameSlugs.observatory, t.fx.gameSlugs.vault, t.fx.gameSlugs.lighthouse]).toContain(a.puzzle.theme!.gameSlug)
    expect(a.nextAt).toBe('2026-10-27T15:00:00.000Z')
    // Same puzzle for another caller in another zone on the same date, and it is stored once.
    setNow('2026-10-27T20:00:00Z')
    const b = await today(U().carol, 'America/New_York')
    expect(b.puzzle).toEqual(a.puzzle)
    const rows = await t.db.select().from(dailyPuzzles).where(eq(dailyPuzzles.day, '2026-10-27'))
    expect(rows).toHaveLength(1)
    // The puzzle generates on the client from the seed.
    expect(generateDaily(a.puzzle).kind).toBe(a.puzzle.kind)
  })

  it('signed out: a junk zone falls back to UTC; a western zone before puzzle #1 gets puzzle #1', async () => {
    expect((await today(undefined, 'Not/AZone')).timeZone).toBe('UTC')
    setNow('2026-10-26T04:00:00Z')
    const early = await today(undefined, 'America/Los_Angeles')
    expect(early.serverDay).toBe('2026-10-26')
    expect(early.puzzle.number).toBe(1)
    expect(early.puzzle.seed).toBe('fixture-seed-1')
  })

  it('signed in, never played: streak is empty, no result yet', async () => {
    const d = await today(U().carol, 'Europe/London')
    expect(d.serverDay).toBe('2026-10-27')
    expect(d.result).toBeNull()
    expect(d.streak).toEqual({ current: 0, best: 0, played: 0, solved: 0, lastSolvedDay: null, bestTimeMs: null })
  })

  it('signed in: shows my finished result and streak for my fixed day', async () => {
    setNow('2026-10-26T20:00:00Z') // 13:00 in Los Angeles on the 26th
    const d = await today(U().alice, 'Asia/Tokyo') // Tokyo is already on the 27th; alice's day is fixed in LA
    expect(d.serverDay).toBe('2026-10-26')
    expect(d.timeZone).toBe('America/Los_Angeles')
    expect(d.result).toMatchObject({ solved: true, score: 900, guesses: 3 })
    expect(d.streak).toMatchObject({ current: 1, best: 1, played: 1, solved: 1, lastSolvedDay: '2026-10-26', bestTimeMs: 120_000 })
    expect(d.nextAt).toBe('2026-10-27T07:00:00.000Z')
  })
})

describe('start and submit', () => {
  it('fixes the time zone at the first play; the device clock and later zones cannot move the day', async () => {
    const bob = U().bob
    const s1 = await start(bob, 'Asia/Tokyo')
    expect(s1).toMatchObject({ serverDay: '2026-10-27', timeZone: 'Asia/Tokyo' })
    expect(s1.result).toMatchObject({ timeZone: 'Asia/Tokyo', startedAt: '2026-10-27T01:00:00.000Z', finishedAt: null, solved: false })
    // Idempotent: a second start (another zone, later) keeps the first zone and start time.
    setNow('2026-10-27T01:05:00Z')
    const s2 = await start(bob, 'America/Los_Angeles')
    expect(s2.timeZone).toBe('Asia/Tokyo')
    expect(s2.result?.startedAt).toBe('2026-10-27T01:00:00.000Z')
    const rows = await t.db.select().from(dailyResults).where(eq(dailyResults.userId, bob))
    expect(rows).toHaveLength(1)
    // A result for another day (say, from a device clock set back) is refused.
    const wrong = await submit(bob, { day: '2026-10-26', number: 1 })
    expect(wrong.statusCode).toBe(400)
    expect(json(wrong).code).toBe('wrong_day')
    const wrongTomorrow = await submit(bob, { day: '2026-10-28', number: 3 })
    expect(json(wrongTomorrow).code).toBe('wrong_day')
  })

  it('stores a result once, with the server-side score, time bounded by the server clock, and a streak', async () => {
    const mia = U().mia
    await start(mia, 'Europe/Paris')
    setNow('2026-10-27T01:00:40Z') // 40 s after the start
    const res = await submit(mia, { day: '2026-10-27', number: 2, timeMs: 10 * 60_000, guesses: 2 })
    expect(res.statusCode, res.body).toBe(200)
    const body = json<{ result: Record<string, unknown>; streak: unknown }>(res)
    // Claimed 10 minutes, but only 40 s passed on the server: 40 s counts.
    expect(body.result).toMatchObject({ solved: true, guesses: 2, timeMs: 40_000, score: 1000 - 120 - 10, finishedAt: '2026-10-27T01:00:40.000Z', timeZone: 'Europe/Paris' })
    expect(StreakSchema.parse(body.streak)).toMatchObject({ current: 1, played: 1, solved: 1, bestTimeMs: 40_000 })
    const again = await submit(mia, { day: '2026-10-27', number: 2 })
    expect(again.statusCode).toBe(409)
    expect(json(again).code).toBe('conflict')
    const d = await today(mia)
    expect(d.result?.finishedAt).toBe('2026-10-27T01:00:40.000Z')
  })

  it('submit before start is a conflict; a bad number or an inconsistent grid is invalid', async () => {
    const dave = U().dave
    const early = await submit(dave, { day: '2026-10-27', number: 2 })
    expect(early.statusCode).toBe(409)
    await start(dave, 'UTC')
    const badNumber = await submit(dave, { day: '2026-10-27', number: 5 })
    expect(badNumber.statusCode).toBe(400)
    expect(json(badNumber).code).toBe('invalid')
    const fakeSolve = await submit(dave, { day: '2026-10-27', number: 2, guesses: 1, grid: [row('2026-10-27', 'close')] })
    expect(fakeSolve.statusCode).toBe(400)
    const tooMany = await submit(dave, { day: '2026-10-27', number: 2, solved: false, guesses: 7, grid: Array(7).fill(row('2026-10-27', 'miss')) })
    expect(tooMany.statusCode).toBe(400)
    const wrongWidth = await submit(dave, { day: '2026-10-27', number: 2, guesses: 1, grid: [[...row('2026-10-27', 'hit'), 'hit']] })
    expect(wrongWidth.statusCode).toBe(400)
    expect(json(wrongWidth).error).toMatch(/marks today/)
    // Hint rows are fine.
    expect(json(await submit(dave, { day: '2026-10-27', number: 2, hintsUsed: 0, guesses: 1, grid: [['hint'], row('2026-10-27', 'hit')] })).error).toMatch(/hint rows/)
    const schema = await submit(dave, { day: '2026-10-27', number: 2, grid: [['nope' as 'hit']] })
    expect(schema.statusCode).toBe(400)
    // Giving up (not solved) is fine and scores 0.
    const fail = await submit(dave, { day: '2026-10-27', number: 2, solved: false, guesses: 1, hintsUsed: 1, grid: [['hint'], row('2026-10-27', 'miss')] })
    expect(fail.statusCode, fail.body).toBe(200)
    expect(json<{ result: { score: number }; streak: { current: number } }>(fail)).toMatchObject({ result: { score: 0 }, streak: { current: 0, played: 1 } })
  })

  it('an unknown zone at start falls back to UTC', async () => {
    const s = await start(U().eve, 'Mars/Olympus')
    expect(s.timeZone).toBe('UTC')
    expect(s.result?.timeZone).toBe('UTC')
  })

  it('streaks build over consecutive server days and reset after a missed day', async () => {
    const user = U().admin
    const play = async (iso: string, tz: string) => {
      setNow(iso)
      const s = await start(user, tz)
      const res = await submit(user, { day: s.serverDay, number: s.puzzle.number, guesses: 1, grid: [row(s.serverDay, 'hit')] })
      expect(res.statusCode, res.body).toBe(200)
      return json<{ streak: { current: number; best: number } }>(res).streak
    }
    expect(await play('2026-10-27T10:00:00Z', 'UTC')).toMatchObject({ current: 1 })
    expect(await play('2026-10-28T10:00:00Z', 'UTC')).toMatchObject({ current: 2 })
    // Late evening in New York on the 29th is already the 30th in UTC: the day follows the zone sent.
    const s29 = await play('2026-10-30T02:00:00Z', 'America/New_York')
    expect(s29).toMatchObject({ current: 3, best: 3 })
    // Switching back to UTC an hour later: the New York day is still running, so it's still the 29th.
    setNow('2026-10-30T03:00:00Z')
    expect((await today(user, 'UTC')).serverDay).toBe('2026-10-29')
    // Skip the 30th and 31st.
    setNow('2026-11-01T12:00:00Z')
    const streak = await t.inject({ method: 'GET', url: '/api/daily/streak', as: user })
    expect(json(streak)).toMatchObject({ current: 0, best: 3, played: 3, solved: 3 })
    expect(await play('2026-11-01T12:00:00Z', 'UTC')).toMatchObject({ current: 1, best: 3 })
  })
})

describe('GET /api/daily/leaderboard', () => {
  it('shows me and my accepted friends only, best first, with public profiles and no streaks or grids', async () => {
    const day = t.fx.dailyDay
    const add = (userId: string, solved: boolean, score: number, timeMs: number) =>
      t.db.insert(dailyResults).values({ userId, day, number: 1, timeZone: 'UTC', solved, guesses: 3, score, timeMs, finishedAt: new Date('2026-10-26T12:00:00Z'), grid: [['hit']] })
    await t.db.delete(dailyResults).where(eq(dailyResults.day, day))
    await t.db.insert(dailyResults).values({ userId: U().alice, day, number: 1, timeZone: 'America/Los_Angeles', solved: true, guesses: 3, score: 900, timeMs: 120_000, finishedAt: new Date('2026-10-26T15:02:00Z'), grid: [['hit']] })
    await add(U().bob, true, 950, 60_000) // friend
    await add(U().mia, false, 0, 30_000) // friend, failed
    await add(U().carol, true, 1000, 10_000) // stranger
    await add(U().dave, true, 1000, 10_000) // pending request
    await add(U().eve, true, 1000, 10_000) // blocked

    const res = await t.inject({ method: 'GET', url: `/api/daily/leaderboard?day=${day}`, as: U().alice })
    expect(res.statusCode, res.body).toBe(200)
    const body = json<{ day: string; entries: Array<{ user: { id: string }; solved: boolean; score: number } & Record<string, unknown>> }>(res)
    expect(body.day).toBe(day)
    expect(body.entries.map((e) => e.user.id)).toEqual([U().bob, U().alice, U().mia])
    expect(body.entries[0]).toEqual({ user: { id: U().bob, handle: 'bob', displayName: 'Bob', image: null }, solved: true, guesses: 3, timeMs: 60_000, score: 950 })
    expect(res.body).not.toContain('@example.com')
    expect(res.body).not.toContain('streak')
    expect(res.body).not.toContain('grid')

    // Carol (no friends) sees only herself.
    const carol = json<{ entries: Array<{ user: { id: string } }> }>(await t.inject({ method: 'GET', url: `/api/daily/leaderboard?day=${day}`, as: U().carol }))
    expect(carol.entries.map((e) => e.user.id)).toEqual([U().carol])

    // Eve started 2026-10-27 but never finished: an unfinished play doesn't show.
    const eve = json<{ entries: unknown[] }>(await t.inject({ method: 'GET', url: '/api/daily/leaderboard?day=2026-10-27', as: U().eve }))
    expect(eve.entries).toEqual([])
  })

  it('defaults to my server day', async () => {
    setNow('2026-10-27T01:00:00Z')
    const res = await t.inject({ method: 'GET', url: '/api/daily/leaderboard', as: U().carol })
    expect(json(res).day).toBe('2026-10-27')
  })

  it('every daily route except today needs a signed-in user', async () => {
    for (const [method, url] of [['POST', '/api/daily/start'], ['POST', '/api/daily/results'], ['GET', '/api/daily/streak'], ['GET', '/api/daily/leaderboard']] as const) {
      const res = await t.inject({ method, url, payload: method === 'POST' ? {} : undefined })
      expect(res.statusCode, url).toBe(401)
    }
    const rows = await t.db.select().from(dailyResults).where(and(eq(dailyResults.userId, U().carol), eq(dailyResults.day, '2026-10-27')))
    expect(rows).toHaveLength(0)
  })
})
