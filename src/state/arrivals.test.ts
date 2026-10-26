import { afterEach, describe, expect, it } from 'vitest'
import { LAST_SEEN_KEY, lastSeenMark, MAX_ARRIVALS, newArrivals, readLastSeen, writeLastSeen } from './arrivals'
import { logRow } from './testRows'

const rows = [
  logRow('v1', 'g1', [], '2026-10-20T10:00:00.000Z'),
  logRow('v2', 'g2', [], '2026-10-26T08:00:00.000Z'),
  logRow('v3', 'g3', [], '2026-10-26T07:00:00.000Z'),
  logRow('v4', 'g2', [], '2026-10-26T09:00:00.000Z'),
]

describe('newArrivals', () => {
  it('returns rooms reviewed after the mark, oldest first, each once', () => {
    expect(newArrivals(rows, '2026-10-25T00:00:00.000Z')).toEqual(['g3', 'g2'])
  })
  it('returns nothing on the first visit (no mark) or a bad mark', () => {
    expect(newArrivals(rows, null)).toEqual([])
    expect(newArrivals(rows, 'not a date')).toEqual([])
  })
  it('ignores rows without my review', () => {
    const r = { ...logRow('v9', 'g9', [], '2026-10-26T10:00:00.000Z'), myReview: null }
    expect(newArrivals([r], '2026-10-25T00:00:00.000Z')).toEqual([])
  })
  it('keeps the newest few', () => {
    const many = Array.from({ length: 9 }, (_, i) => logRow('v' + i, 'g' + i, [], `2026-10-26T0${i}:00:00.000Z`))
    const out = newArrivals(many, '2026-10-25T00:00:00.000Z')
    expect(out).toHaveLength(MAX_ARRIVALS)
    expect(out.at(-1)).toBe('g8')
  })
})

describe('last-seen mark', () => {
  afterEach(() => localStorage.clear())

  it('is the later of now and the newest review', () => {
    expect(lastSeenMark(rows, Date.parse('2026-10-01T00:00:00Z'))).toBe('2026-10-26T09:00:00.000Z')
    expect(lastSeenMark([], Date.parse('2026-10-27T00:00:00Z'))).toBe('2026-10-27T00:00:00.000Z')
  })

  it('stores only a timestamp', () => {
    expect(readLastSeen()).toBeNull()
    writeLastSeen(rows, Date.parse('2026-10-01T00:00:00Z'))
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('2026-10-26T09:00:00.000Z')
    expect(readLastSeen()).toBe('2026-10-26T09:00:00.000Z')
    expect(Object.keys(localStorage)).toEqual([LAST_SEEN_KEY])
  })

  it('an empty room still records a mark, so the first room logged later flies in', () => {
    writeLastSeen([], Date.parse('2026-10-26T04:00:00Z'))
    expect(newArrivals([logRow('v1', 'g1', [], '2026-10-26T05:00:00.000Z')], readLastSeen())).toEqual(['g1'])
  })
})
