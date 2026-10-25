import { describe, expect, it } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import type { Review, Room } from '@/contracts/types'
import { availableYears, computeWrap, defaultWrapYear } from './computeWrap'

const { rooms, reviews } = FIXTURE_DATASET

function mkReview(over: Partial<Review> & { id: string; roomId: string; date: string }): Review {
  const base = reviews[0]
  return { ...base, puzzles: [], crew: [], ...over }
}

describe('availableYears', () => {
  it('lists distinct years newest first', () => {
    expect(availableYears(reviews)).toEqual([2025, 2024])
    expect(defaultWrapYear(reviews)).toBe(2025)
  })
  it('handles no reviews', () => {
    expect(availableYears([])).toEqual([])
    expect(defaultWrapYear([])).toBe('all')
  })
})

describe('computeWrap on the fixture', () => {
  it('2025', () => {
    const w = computeWrap(rooms, reviews, 2025)
    expect(w.roomsDone).toBe(2)
    expect(w.escapes).toBe(2)
    expect(w.escapeRate).toBe(1)
    expect(w.bestRoom?.room.name).toBe('Mars Base Omega')
    expect(w.bestRoom?.score).toBe(93)
    expect(w.fastestEscape?.room.name).toBe('Mars Base Omega')
    expect(w.fastestEscape?.minutes).toBe(47)
    // lock-and-key, math, logic all appear once; lock-and-key and logic have 1 memorable each,
    // so canonical order decides: lock-and-key.
    expect(w.favouritePuzzleType?.type).toBe('lock-and-key')
    expect(w.cities).toEqual([{ city: 'San Francisco', count: 2 }])
    expect(w.totalMinutes).toBe(99)
    expect(w.crewMvp).toEqual({ name: 'Maya', count: 2 })
    expect(w.longestEscapeStreak).toBe(2)
    expect(w.mostMemorablePuzzle?.puzzle.id).toBe('pz_fx_4')
    expect(w.genres.map((g) => g.genre).sort()).toEqual(['mystery', 'sci-fi'])
    expect(w.firstDate).toBe('2025-03-14')
    expect(w.lastDate).toBe('2025-07-02')
  })

  it('all time', () => {
    const w = computeWrap(rooms, reviews, 'all')
    expect(w.roomsDone).toBe(3)
    expect(w.uniqueRooms).toBe(3)
    expect(w.escapes).toBe(2)
    expect(w.escapeRate).toBeCloseTo(2 / 3)
    expect(w.cities).toEqual([
      { city: 'San Francisco', count: 2 },
      { city: 'Toronto', count: 1 },
    ])
    expect(w.totalMinutes).toBe(159)
    // Everyone attended twice: alphabetical tie-break.
    expect(w.crewMvp).toEqual({ name: 'Brennan', count: 2 })
    expect(w.longestEscapeStreak).toBe(2)
    expect(w.genres).toHaveLength(3)
  })

  it('2024 has no escapes', () => {
    const w = computeWrap(rooms, reviews, 2024)
    expect(w.roomsDone).toBe(1)
    expect(w.escapes).toBe(0)
    expect(w.escapeRate).toBe(0)
    expect(w.fastestEscape).toBeNull()
    expect(w.longestEscapeStreak).toBe(0)
    expect(w.bestRoom?.room.name).toBe('Haunted Lighthouse')
    expect(w.favouritePuzzleType?.type).toBe('search')
  })
})

describe('computeWrap edge cases', () => {
  it('no reviews', () => {
    const w = computeWrap(rooms, [], 'all')
    expect(w.roomsDone).toBe(0)
    expect(w.escapeRate).toBe(0)
    expect(w.bestRoom).toBeNull()
    expect(w.fastestEscape).toBeNull()
    expect(w.favouritePuzzleType).toBeNull()
    expect(w.mostMemorablePuzzle).toBeNull()
    expect(w.crewMvp).toBeNull()
    expect(w.cities).toEqual([])
    expect(w.totalMinutes).toBe(0)
    expect(w.longestEscapeStreak).toBe(0)
    expect(w.firstDate).toBeNull()
  })

  it('no rooms at all and a year with nothing', () => {
    expect(computeWrap([], [], 2020).roomsDone).toBe(0)
    expect(computeWrap(rooms, reviews, 1999).roomsDone).toBe(0)
  })

  it('ignores reviews of unknown rooms', () => {
    const w = computeWrap(rooms, [mkReview({ id: 'x', roomId: 'nope', date: '2025-01-01' })], 'all')
    expect(w.roomsDone).toBe(0)
  })

  it('favourite puzzle type ties broken by memorable count', () => {
    const r = mkReview({
      id: 'a',
      roomId: 'room_fx_1',
      date: '2026-01-01',
      puzzles: [
        { id: 'p1', reviewId: 'a', description: 'x', type: 'lock-and-key', memorable: false },
        { id: 'p2', reviewId: 'a', description: 'x', type: 'lock-and-key', memorable: false },
        { id: 'p3', reviewId: 'a', description: 'x', type: 'physical', memorable: true },
        { id: 'p4', reviewId: 'a', description: 'x', type: 'physical', memorable: false },
        { id: 'p5', reviewId: 'a', description: 'x', type: 'math', memorable: true },
      ],
    })
    const w = computeWrap(rooms, [r], 2026)
    expect(w.favouritePuzzleType).toEqual({ type: 'physical', count: 2, memorable: 1 })
  })

  it('best room ties -> most recent; fastest ties -> higher rating; streak resets on fail', () => {
    const rate = (o: number) => ({ ...reviews[0].ratings, overall: { score: o, comment: '' } })
    const list: Review[] = [
      mkReview({ id: '1', roomId: 'room_fx_1', date: '2026-01-01', ratings: rate(90), escaped: true, escapeTimeMinutes: 40 }),
      mkReview({ id: '2', roomId: 'room_fx_2', date: '2026-02-01', ratings: rate(90), escaped: true, escapeTimeMinutes: 40 }),
      mkReview({ id: '3', roomId: 'room_fx_3', date: '2026-03-01', ratings: rate(95), escaped: true, escapeTimeMinutes: 40 }),
      mkReview({ id: '4', roomId: 'room_fx_1', date: '2026-04-01', ratings: rate(95), escaped: false, escapeTimeMinutes: 30 }),
      mkReview({ id: '5', roomId: 'room_fx_2', date: '2026-05-01', ratings: rate(50), escaped: true, escapeTimeMinutes: null }),
    ]
    const w = computeWrap(rooms, list, 2026)
    expect(w.bestRoom?.review.id).toBe('4')
    // 30 min was a fail; null minutes are unknown; three at 40 -> highest rated.
    expect(w.fastestEscape?.review.id).toBe('3')
    expect(w.longestEscapeStreak).toBe(3)
    expect(w.totalMinutes).toBe(150)
    expect(w.uniqueRooms).toBe(3)
    expect(w.roomsDone).toBe(5)
  })

  it('counts a crew member once per visit even if listed twice', () => {
    const room: Room = { ...rooms[0], id: 'solo' }
    const w = computeWrap([room], [mkReview({ id: 's', roomId: 'solo', date: '2026-01-01', crew: ['Ana', 'Ana ', 'Bo'] })], 'all')
    expect(w.crew).toEqual([
      { name: 'Ana', count: 1 },
      { name: 'Bo', count: 1 },
    ])
  })

  it('handles 200 rooms', () => {
    const many: Room[] = Array.from({ length: 200 }, (_, i) => ({ ...rooms[i % 3], id: `r${i}` }))
    const revs = many.map((r, i) =>
      mkReview({ id: `v${i}`, roomId: r.id, date: `20${10 + (i % 15)}-0${1 + (i % 9)}-1${i % 10}` }),
    )
    const w = computeWrap(many, revs, 'all')
    expect(w.roomsDone).toBe(200)
    expect(availableYears(revs)).toHaveLength(15)
  })
})
