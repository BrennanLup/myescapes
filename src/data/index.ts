/**
 * Small client-side data helpers. Client code talks to the server via
 * `apiClient` (src/contracts/api.ts). Server-side repositories live in
 * src/data/server/ and must not be imported from browser code.
 */
import { latestReviewFor, type Review, type Room, type SortKey } from '@/contracts/types'

export interface SortedRoom {
  room: Room
  /** Newest review of the room (rooms can be replayed). */
  review: Review | undefined
  /** Group label under the sort, e.g. "Toronto", "2024", "90+", "Didn't escape". */
  group: string
}

/** "52 min", "1 h 15 min", "Didn't escape (60 min)", or "—" when unknown. */
export function formatEscapeTime(minutes: number | null | undefined, escaped = true): string {
  if (minutes === null || minutes === undefined) return escaped ? '—' : "Didn't escape"
  const m = Math.round(minutes)
  const t = m >= 60 && m % 60 !== 0 ? `${Math.floor(m / 60)} h ${m % 60} min` : m >= 60 ? `${m / 60} h` : `${m} min`
  return escaped ? t : `Didn't escape (${t})`
}

export function ratingBucket(score: number | undefined): string {
  if (score === undefined) return 'Unrated'
  if (score >= 90) return '90+'
  if (score < 60) return 'Under 60'
  const lo = Math.floor(score / 10) * 10
  return `${lo}-${lo + 9}`
}

export function escapeTimeBucket(review: Review | undefined): string {
  if (!review) return 'Unknown'
  if (!review.escaped) return "Didn't escape"
  const t = review.escapeTimeMinutes
  if (t === null) return 'Unknown'
  if (t < 45) return 'Under 45 min'
  if (t < 55) return '45-54 min'
  return '55+ min'
}

export function groupFor(room: Room, review: Review | undefined, key: SortKey): string {
  switch (key) {
    case 'city': return room.city
    case 'brand': return room.company
    case 'genre': return room.genre
    case 'date': return review ? review.date.slice(0, 4) : 'Undated'
    case 'rating': return ratingBucket(review?.ratings.overall.score)
    case 'escapeTime': return escapeTimeBucket(review)
  }
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/**
 * Rooms in board order for a sort key, each with its newest review and group label.
 * city/brand/genre: alphabetical groups, then name. date: newest first.
 * rating: highest first. escapeTime: fastest escape first, failed and unknown last.
 */
export function roomsForSort(rooms: Room[], reviews: Review[], key: SortKey): SortedRoom[] {
  const items: SortedRoom[] = rooms.map((room) => {
    const review = latestReviewFor(room.id, reviews)
    return { room, review, group: groupFor(room, review, key) }
  })
  const time = (r: Review | undefined) =>
    !r ? 3e9 : !r.escaped ? 2e9 + (r.escapeTimeMinutes ?? 0) : r.escapeTimeMinutes ?? 1e9
  const cmp: Record<SortKey, (a: SortedRoom, b: SortedRoom) => number> = {
    city: (a, b) => byText(a.group, b.group),
    brand: (a, b) => byText(a.group, b.group),
    genre: (a, b) => byText(a.group, b.group),
    date: (a, b) => (b.review?.date ?? '').localeCompare(a.review?.date ?? ''),
    rating: (a, b) => (b.review?.ratings.overall.score ?? 0) - (a.review?.ratings.overall.score ?? 0),
    escapeTime: (a, b) => time(a.review) - time(b.review),
  }
  return items.sort((a, b) => cmp[key](a, b) || byText(a.room.name, b.room.name))
}
