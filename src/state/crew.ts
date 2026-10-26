/**
 * Crew in the 3D room (workstream 37): who played each visit, as avatar stickers for the
 * polaroids, the "Crew" board grouping and the wrap's teammate card. Pure: no React, no DOM.
 *
 * Sources, best first:
 *   1. `GET /api/logs` rows (signed in): participants with account ids, pictures and status.
 *   2. The Phase 1 `Review.crew` names (signed-out seed demo, or when /api/logs is unavailable).
 * Review ids in the 3D room are visit ids (server/db/dataset.ts), so rows join on `visitId`.
 */
import type { LogRow, Participant } from '@/contracts/models'
import { SORT_KEYS, SORT_LABELS, type Review, type SortKey } from '@/contracts/types'

/** Board grouping: the Phase 1 sort keys plus "crew" (who you played with). */
export type BoardSortKey = SortKey | 'crew'
export const BOARD_SORT_KEYS: readonly BoardSortKey[] = [...SORT_KEYS, 'crew']
export const BOARD_SORT_LABELS: Record<BoardSortKey, string> = { ...SORT_LABELS, crew: 'Crew' }

export interface CrewSticker {
  /** Stable identity: `u:<userId>` for people with accounts, `g:<lowercased name>` for guests. */
  key: string
  name: string
  initials: string
  /** Sticker background colour, seeded by `key`. */
  color: string
  /** Profile picture URL (friends with accounts), or null. */
  image: string | null
  userId: string | null
  handle: string | null
  /** Tagged but has not accepted yet: drawn faded. */
  pending: boolean
}

/** Crew per review id (= visit id). The viewer is never in their own list. */
export type CrewIndex = Record<string, CrewSticker[]>

export const STICKER_COLORS = ['#e07b39', '#2fa39a', '#6d3b5c', '#d4a24c', '#e8433a', '#5b7fc7', '#7a9a3a', '#b8503f'] as const

export function hashKey(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function stickerColor(key: string): string {
  return STICKER_COLORS[hashKey(key) % STICKER_COLORS.length]
}

/** "Mia" -> "M", "Mia Wong" -> "MW", "@bob" -> "B", "" -> "?". Unicode-safe. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[@_.-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const first = (w: string) => Array.from(w)[0] ?? ''
  const out = words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1])
  return out.toLocaleUpperCase() || '?'
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ')

export function guestSticker(name: string, pending = false): CrewSticker {
  const n = normName(name) || 'Guest'
  const key = 'g:' + n.toLowerCase()
  return { key, name: n, initials: initialsOf(n), color: stickerColor(key), image: null, userId: null, handle: null, pending }
}

/** A visit participant as a sticker. Declined participants are not crew. */
export function participantSticker(p: Participant): CrewSticker | null {
  if (p.status === 'declined') return null
  const pending = p.status === 'pending'
  if (p.user) {
    const name = normName(p.user.displayName) || (p.user.handle ? '@' + p.user.handle : 'Friend')
    const key = 'u:' + p.user.id
    return {
      key,
      name,
      initials: initialsOf(name),
      color: stickerColor(key),
      image: safeImageUrl(p.user.image),
      userId: p.user.id,
      handle: p.user.handle,
      pending,
    }
  }
  return guestSticker(p.guestName ?? 'Guest', pending)
}

/** Only http(s) and same-origin paths may be drawn (no javascript:, no data: blobs from elsewhere). */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const u = url.trim()
  if (/^https:\/\//i.test(u) || /^http:\/\/localhost[:/]/i.test(u) || /^\/(?!\/)/.test(u)) return u
  return null
}

function dedupe(list: CrewSticker[]): CrewSticker[] {
  const seen = new Set<string>()
  const out: CrewSticker[] = []
  for (const s of list) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s)
  }
  return out
}

/**
 * Crew for every review. Rows from `/api/logs` win for the visits they cover; other reviews
 * use their plain crew names. `selfNames` (lowercased) are dropped from name lists so the
 * viewer never appears as their own teammate.
 */
export function buildCrewIndex(reviews: readonly Review[], rows: readonly LogRow[] | null = null, selfNames: readonly string[] = []): CrewIndex {
  const self = new Set(selfNames.map((n) => normName(n).toLowerCase()).filter(Boolean))
  const byVisit = new Map<string, LogRow>()
  for (const r of rows ?? []) byVisit.set(r.visitId, r)
  const out: CrewIndex = {}
  for (const review of reviews) {
    const row = byVisit.get(review.id)
    const list = row
      ? row.crew.map(participantSticker).filter((s): s is CrewSticker => s !== null)
      : review.crew.filter((n) => normName(n) && !self.has(normName(n).toLowerCase())).map((n) => guestSticker(n))
    out[review.id] = dedupe(list)
  }
  return out
}

/** How often each person appears across the given reviews (once per visit). */
export function crewFrequency(reviews: readonly Review[], crew: CrewIndex): Map<string, number> {
  const freq = new Map<string, number>()
  for (const r of reviews) for (const s of crew[r.id] ?? []) freq.set(s.key, (freq.get(s.key) ?? 0) + 1)
  return freq
}

export const SOLO_LABEL = 'Solo'

/**
 * Board group label for a visit's crew: "Solo", "With Mia", "With Mia & Bob",
 * "With Mia, Bob & Sam", "With Mia, Bob & 2 more". Names go most frequent teammate first
 * (then alphabetical) so the same crew always gets the same label.
 */
export function crewLabel(stickers: readonly CrewSticker[], freq: ReadonlyMap<string, number> = new Map()): string {
  if (!stickers.length) return SOLO_LABEL
  const names = [...stickers]
    .sort((a, b) => (freq.get(b.key) ?? 0) - (freq.get(a.key) ?? 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
    .map((s) => s.name)
  if (names.length === 1) return `With ${names[0]}`
  if (names.length === 2) return `With ${names[0]} & ${names[1]}`
  if (names.length === 3) return `With ${names[0]}, ${names[1]} & ${names[2]}`
  return `With ${names[0]}, ${names[1]} & ${names.length - 2} more`
}

export interface Teammate {
  key: string
  name: string
  image: string | null
  handle: string | null
  /** Visits together. */
  count: number
  /** Escapes on those visits. */
  escapes: number
  /** escapes / count, 0..1. */
  escapeRate: number
}

/** Teammates ranked by visits together (ties: more escapes, then alphabetical). */
export function rankTeammates(reviews: readonly Review[], crew: CrewIndex): Teammate[] {
  const map = new Map<string, Teammate>()
  for (const r of reviews) {
    for (const s of crew[r.id] ?? []) {
      if (s.pending) continue
      let t = map.get(s.key)
      if (!t) map.set(s.key, (t = { key: s.key, name: s.name, image: s.image, handle: s.handle, count: 0, escapes: 0, escapeRate: 0 }))
      t.count++
      if (r.escaped) t.escapes++
      if (!t.image && s.image) t.image = s.image
    }
  }
  return [...map.values()]
    .map((t) => ({ ...t, escapeRate: t.count ? t.escapes / t.count : 0 }))
    .sort((a, b) => b.count - a.count || b.escapes - a.escapes || a.name.localeCompare(b.name))
}
