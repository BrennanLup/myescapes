/**
 * Pure "Year in Escape Rooms" statistics. No React, no DOM: unit-tested in computeWrap.test.ts.
 *
 * A "room done" is one visit (one review). Replays of the same room in the period
 * count again; `uniqueRooms` gives the distinct count. Reviews whose room is not in
 * `rooms` are ignored (dangling data).
 */
import { PUZZLE_TYPES, type Genre, type Puzzle, type PuzzleType, type Review, type Room } from '@/contracts/types'

export type WrapYear = number | 'all'

export interface WrapVisit {
  room: Room
  review: Review
}

export interface WrapStats {
  year: WrapYear
  /** Visits (reviews) in the period. */
  roomsDone: number
  uniqueRooms: number
  escapes: number
  /** escapes / roomsDone, 0..1 (0 when no rooms). */
  escapeRate: number
  /** Highest overall rating; ties -> most recent visit. */
  bestRoom: (WrapVisit & { score: number }) | null
  /** Escaped visits only, minimum known time; ties -> higher overall rating. */
  fastestEscape: (WrapVisit & { minutes: number }) | null
  /** All puzzle types seen, most common first (ties by memorable count, then canonical order). */
  puzzleTypes: Array<{ type: PuzzleType; count: number; memorable: number }>
  favouritePuzzleType: { type: PuzzleType; count: number; memorable: number } | null
  /** Every puzzle logged in the period (sum of `puzzleTypes` counts). */
  totalPuzzles: number
  /** Cities with visit counts, most visited first (ties alphabetical). */
  cities: Array<{ city: string; count: number }>
  /** Sum of known escapeTimeMinutes. */
  totalMinutes: number
  /** Genres with visit counts, most common first (ties alphabetical). */
  genres: Array<{ genre: Genre; count: number }>
  /** A memorable puzzle from the best-rated visit that has one (ties -> most recent). */
  mostMemorablePuzzle: { puzzle: Puzzle; room: Room; review: Review } | null
  /** Most visits attended; ties alphabetical. */
  crewMvp: { name: string; count: number } | null
  /** Crew members with attendance, most first. */
  crew: Array<{ name: string; count: number }>
  /** Longest run of consecutive escapes in date order. */
  longestEscapeStreak: number
  /** First / last visit date in the period (ISO), or null. */
  firstDate: string | null
  lastDate: string | null
}

/** "A, B +2 more": the first `max` city names, then how many are left. */
export function cityListLabel(cities: Array<{ city: string }>, max = 2): string {
  if (cities.length === 0) return ''
  const shown = cities.slice(0, max).map((c) => c.city).join(', ')
  const rest = cities.length - max
  return rest > 0 ? `${shown} +${rest} more` : shown
}

const yearOf = (date: string) => Number(date.slice(0, 4))

/** Distinct years that have at least one review, newest first. */
export function availableYears(reviews: Review[]): number[] {
  const years = new Set<number>()
  for (const r of reviews) {
    const y = yearOf(r.date)
    if (Number.isFinite(y)) years.add(y)
  }
  return [...years].sort((a, b) => b - a)
}

/** Default selection: most recent year with data, or 'all' when there is none. */
export function defaultWrapYear(reviews: Review[]): WrapYear {
  return availableYears(reviews)[0] ?? 'all'
}

function countBy<K>(items: K[]): Map<K, number> {
  const m = new Map<K, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

export function computeWrap(rooms: Room[], reviews: Review[], year: WrapYear): WrapStats {
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const visits: WrapVisit[] = []
  for (const review of reviews) {
    if (year !== 'all' && yearOf(review.date) !== year) continue
    const room = roomById.get(review.roomId)
    if (room) visits.push({ room, review })
  }
  // Chronological (stable for same-day visits by id).
  visits.sort((a, b) => a.review.date.localeCompare(b.review.date) || a.review.id.localeCompare(b.review.id))

  const roomsDone = visits.length
  const escapes = visits.filter((v) => v.review.escaped).length

  let bestRoom: WrapStats['bestRoom'] = null
  let fastestEscape: WrapStats['fastestEscape'] = null
  let totalMinutes = 0
  let streak = 0
  let longestEscapeStreak = 0
  for (const v of visits) {
    const score = v.review.ratings.overall.score
    // Later visits win ties because visits are in date order and we use >=.
    if (!bestRoom || score >= bestRoom.score) bestRoom = { ...v, score }
    const mins = v.review.escapeTimeMinutes
    if (mins != null) totalMinutes += mins
    if (v.review.escaped && mins != null) {
      if (
        !fastestEscape ||
        mins < fastestEscape.minutes ||
        (mins === fastestEscape.minutes && score > fastestEscape.review.ratings.overall.score)
      ) {
        fastestEscape = { ...v, minutes: mins }
      }
    }
    streak = v.review.escaped ? streak + 1 : 0
    longestEscapeStreak = Math.max(longestEscapeStreak, streak)
  }

  // Puzzle types
  const typeStats = new Map<PuzzleType, { count: number; memorable: number }>()
  for (const v of visits) {
    for (const p of v.review.puzzles) {
      const s = typeStats.get(p.type) ?? { count: 0, memorable: 0 }
      s.count++
      if (p.memorable) s.memorable++
      typeStats.set(p.type, s)
    }
  }
  const puzzleTypes = [...typeStats.entries()]
    .map(([type, s]) => ({ type, ...s }))
    .sort(
      (a, b) =>
        b.count - a.count || b.memorable - a.memorable || PUZZLE_TYPES.indexOf(a.type) - PUZZLE_TYPES.indexOf(b.type),
    )

  const cities = [...countBy(visits.map((v) => v.room.city)).entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))

  const genres = [...countBy(visits.map((v) => v.room.genre)).entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))

  // Most memorable puzzle: memorable puzzle from the highest-rated visit that has one.
  let mostMemorablePuzzle: WrapStats['mostMemorablePuzzle'] = null
  let mmScore = -1
  for (const v of visits) {
    const p = v.review.puzzles.find((x) => x.memorable)
    if (!p) continue
    const s = v.review.ratings.puzzles.score
    if (s >= mmScore) {
      mmScore = s
      mostMemorablePuzzle = { puzzle: p, room: v.room, review: v.review }
    }
  }

  const crew = [
    ...countBy(
      visits.flatMap((v) => [...new Set(v.review.crew.map((n) => n.trim()).filter(Boolean))]),
    ).entries(),
  ]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return {
    year,
    roomsDone,
    uniqueRooms: new Set(visits.map((v) => v.room.id)).size,
    escapes,
    escapeRate: roomsDone ? escapes / roomsDone : 0,
    bestRoom,
    fastestEscape,
    puzzleTypes,
    favouritePuzzleType: puzzleTypes[0] ?? null,
    totalPuzzles: puzzleTypes.reduce((a, t) => a + t.count, 0),
    cities,
    totalMinutes,
    genres,
    mostMemorablePuzzle,
    crewMvp: crew[0] ?? null,
    crew,
    longestEscapeStreak,
    firstDate: visits[0]?.review.date ?? null,
    lastDate: visits[visits.length - 1]?.review.date ?? null,
  }
}

export { PUZZLE_TYPE_LABELS } from '@/contracts/types'
