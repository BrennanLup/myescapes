// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeStreak, resolveServerDay, type PlayRow } from './daily.logic'

const at = (iso: string) => new Date(iso)

describe('resolveServerDay', () => {
  it('a first play uses the zone sent (UTC when missing or invalid), never before the epoch', () => {
    const now = at('2026-10-27T05:00:00Z')
    expect(resolveServerDay({ latest: null, requestedTz: 'Asia/Tokyo', now })).toMatchObject({ day: '2026-10-27', timeZone: 'Asia/Tokyo', fixed: false })
    expect(resolveServerDay({ latest: null, requestedTz: 'America/Los_Angeles', now })).toMatchObject({ day: '2026-10-26', timeZone: 'America/Los_Angeles' })
    expect(resolveServerDay({ latest: null, requestedTz: 'Mars/Olympus', now })).toMatchObject({ day: '2026-10-27', timeZone: 'UTC' })
    expect(resolveServerDay({ latest: null, now })).toMatchObject({ day: '2026-10-27', timeZone: 'UTC' })
    // 2026-10-25 in Los Angeles is before puzzle #1: everyone starts on the epoch.
    expect(resolveServerDay({ latest: null, requestedTz: 'America/Los_Angeles', now: at('2026-10-26T04:00:00Z') }).day).toBe('2026-10-26')
  })

  it('the zone fixed at the first play wins until that day is over there', () => {
    const latest = { day: '2026-10-27', timeZone: 'Asia/Tokyo' }
    // 10:00 in Tokyo; sending LA (still the 26th there) changes nothing.
    const sd = resolveServerDay({ latest, requestedTz: 'America/Los_Angeles', now: at('2026-10-27T01:00:00Z') })
    expect(sd).toMatchObject({ day: '2026-10-27', timeZone: 'Asia/Tokyo', fixed: true })
    expect(sd.nextAt.toISOString()).toBe('2026-10-27T15:00:00.000Z')
    // Sending a zone that is already on the 28th doesn't skip ahead either.
    expect(resolveServerDay({ latest, requestedTz: 'Pacific/Kiritimati', now: at('2026-10-27T12:00:00Z') }).day).toBe('2026-10-27')
  })

  it('after the fixed day ends, the next day follows the zone sent, and never goes backwards', () => {
    const latest = { day: '2026-10-27', timeZone: 'Asia/Tokyo' }
    const after = at('2026-10-27T16:00:00Z') // 01:00 on the 28th in Tokyo, 09:00 on the 27th in LA
    expect(resolveServerDay({ latest, requestedTz: 'Asia/Tokyo', now: after })).toMatchObject({ day: '2026-10-28', timeZone: 'Asia/Tokyo', fixed: false })
    const west = resolveServerDay({ latest, requestedTz: 'America/Los_Angeles', now: after })
    expect(west).toMatchObject({ day: '2026-10-27', timeZone: 'Asia/Tokyo', fixed: true })
    expect(west.nextAt.toISOString()).toBe('2026-10-28T07:00:00.000Z')
    // No zone sent: the last fixed zone is used.
    expect(resolveServerDay({ latest, now: after })).toMatchObject({ day: '2026-10-28', timeZone: 'Asia/Tokyo' })
  })
})

describe('computeStreak', () => {
  const done = new Date('2026-11-01T00:00:00Z')
  const row = (day: string, solved: boolean, timeMs = 60_000, finished = true): PlayRow => ({ day, solved, timeMs, finishedAt: finished ? done : null })

  it('is empty with no plays', () => {
    expect(computeStreak([], '2026-11-01')).toEqual({ current: 0, best: 0, played: 0, solved: 0, lastSolvedDay: null, bestTimeMs: null })
  })

  it('counts consecutive solved days ending today or yesterday', () => {
    const rows = [row('2026-10-26', true, 90_000), row('2026-10-27', true, 30_000), row('2026-10-29', true), row('2026-10-30', true), row('2026-10-31', true)]
    expect(computeStreak(rows, '2026-10-31')).toMatchObject({ current: 3, best: 3, played: 5, solved: 5, lastSolvedDay: '2026-10-31', bestTimeMs: 30_000 })
    // Not played yet today: yesterday's streak is still alive.
    expect(computeStreak(rows, '2026-11-01').current).toBe(3)
    // A missed day breaks it.
    expect(computeStreak(rows, '2026-11-02').current).toBe(0)
    expect(computeStreak(rows, '2026-11-02').best).toBe(3)
  })

  it('a failed finish today resets the current streak; unfinished plays do not count', () => {
    const rows = [row('2026-10-30', true), row('2026-10-31', false)]
    expect(computeStreak(rows, '2026-10-31')).toMatchObject({ current: 0, best: 1, played: 2, solved: 1 })
    const started = [row('2026-10-30', true), row('2026-10-31', false, 0, false)]
    expect(computeStreak(started, '2026-10-31')).toMatchObject({ current: 1, played: 1 })
  })
})
