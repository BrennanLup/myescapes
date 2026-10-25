import type { BoardPin } from '@/state/store'
import type { Photo, PuzzleType, RatingKey, Review, Room } from '@/contracts/types'
import { GENRE_COLORS } from '@/contracts/style'

/** Room ids in board order: board pins sorted by `order`, else the rooms array order. */
export function boardOrder(pins: BoardPin[], rooms: Room[]): string[] {
  const known = new Set(rooms.map((r) => r.id))
  const fromPins = [...pins]
    .sort((a, b) => a.order - b.order)
    .map((p) => p.roomId)
    .filter((id, i, arr) => known.has(id) && arr.indexOf(id) === i)
  if (fromPins.length === 0) return rooms.map((r) => r.id)
  // Rooms not (yet) on the board go at the end so they stay reachable.
  const seen = new Set(fromPins)
  return [...fromPins, ...rooms.map((r) => r.id).filter((id) => !seen.has(id))]
}

/** Previous / next room id (wrapping). Null when there is nothing else to go to. */
export function neighbours(order: string[], roomId: string): { prev: string | null; next: string | null } {
  const n = order.length
  const i = order.indexOf(roomId)
  if (n === 0 || (n === 1 && i === 0)) return { prev: null, next: null }
  if (i < 0) return { prev: order[n - 1], next: order[0] }
  return { prev: order[(i - 1 + n) % n], next: order[(i + 1) % n] }
}

export const RATING_LABELS: Record<RatingKey, string> = {
  overall: 'Overall',
  puzzles: 'Puzzles',
  setting: 'Setting',
  storyline: 'Storyline',
  difficulty: 'Difficulty',
}

export const PUZZLE_TYPE_LABELS: Record<PuzzleType, string> = {
  'lock-and-key': 'Lock & key',
  logic: 'Logic',
  math: 'Math',
  physical: 'Physical',
  search: 'Search',
  'audio-visual': 'Audio-visual',
}

export function genreLabel(genre: string): string {
  if (genre === 'sci-fi') return 'Sci-fi'
  return genre.charAt(0).toUpperCase() + genre.slice(1)
}

export function genreColor(genre: string): string {
  return GENRE_COLORS[genre] ?? GENRE_COLORS.other
}

/** "14 March 2025" (dates are calendar dates, so format in UTC to avoid off-by-one). */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function formatMinutes(min: number | null): string | null {
  if (min === null || min === undefined) return null
  return `${Math.round(min)} min`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ['#e07b39', '#2f8f8a', '#6d3b5c', '#5b5fa8', '#5a9a4b', '#c4513f', '#d4a24c', '#b5579b']
export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function galleryPhotos(room: Room | undefined, review: Review | undefined): Photo[] {
  const out: Photo[] = []
  const seen = new Set<string>()
  for (const p of [...(room?.photos ?? []), ...(review?.photos ?? [])]) {
    if (seen.has(p.url)) continue
    seen.add(p.url)
    out.push(p)
  }
  return out
}

/** Only allow http(s) links out of user data. */
export function safeUrl(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u)) return `https://${u}`
  return null
}

export function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function mapsUrl(address: string, city: string): string {
  const q = [address, city].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** Short mood word for a 1-100 score. */
export function scoreWord(score: number): string {
  if (score >= 90) return 'legendary'
  if (score >= 80) return 'great'
  if (score >= 65) return 'good'
  if (score >= 50) return 'okay'
  return 'meh'
}
