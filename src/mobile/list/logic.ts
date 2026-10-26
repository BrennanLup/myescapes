/**
 * Pure helpers for the mobile rooms table (workstream 15): search, crew filter, sorting, labels.
 */
import type { LogRow, Participant } from '../../contracts/models'

export type SortKey = 'date' | 'name' | 'score'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

/** A crew filter value: a friend's user id (`u:<id>`) or a guest name (`g:<name>`). */
export interface CrewOption {
  value: string
  label: string
  count: number
}

export type CrewFilter = { mode: 'all' } | { mode: 'with' | 'without'; value: string }

/** Other people on a visit who count as crew (declined tags are not crew). */
export function crewOf(row: Pick<LogRow, 'crew'>): Participant[] {
  return row.crew.filter((p) => p.status !== 'declined')
}

export function participantKey(p: Participant): string | null {
  if (p.user) return `u:${p.user.id}`
  if (p.guestName) return `g:${p.guestName.trim().toLowerCase()}`
  return null
}

export function participantName(p: Participant): string {
  return p.user?.displayName ?? p.guestName ?? 'Someone'
}

/** "With Mia, Bob" / "Solo". Pending tags show by name only. */
export function crewLabel(row: Pick<LogRow, 'crew'>): string {
  const names = crewOf(row).map(participantName)
  return names.length ? names.join(', ') : 'Solo'
}

/** People I played with, most frequent first: feeds the "with Mia / without Mia" filter. */
export function crewOptions(rows: readonly LogRow[]): CrewOption[] {
  const map = new Map<string, CrewOption>()
  for (const r of rows) {
    const seen = new Set<string>()
    for (const p of crewOf(r)) {
      const key = participantKey(p)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const cur = map.get(key)
      if (cur) cur.count++
      else map.set(key, { value: key, label: participantName(p), count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function hasCrewMember(row: LogRow, value: string): boolean {
  return crewOf(row).some((p) => participantKey(p) === value)
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Matches the search box against game, venue, city and crew names. Every word must match. */
export function matchesQuery(row: LogRow, q: string): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm([row.game.name, row.venue.name, row.venue.city, row.date, ...crewOf(row).map(participantName)].join(' '))
  return words.every((w) => hay.includes(w))
}

export function overallScore(row: LogRow): number | null {
  return row.myReview?.ratings.overall.score ?? null
}

export function sortRows(rows: readonly LogRow[], sort: Sort): LogRow[] {
  const mul = sort.dir === 'asc' ? 1 : -1
  const byDate = (a: LogRow, b: LogRow) => a.date.localeCompare(b.date)
  return [...rows].sort((a, b) => {
    let c = 0
    if (sort.key === 'name') c = a.game.name.localeCompare(b.game.name, undefined, { sensitivity: 'base' })
    else if (sort.key === 'score') {
      const sa = overallScore(a)
      const sb = overallScore(b)
      // Unscored rows always sink to the bottom.
      if (sa === null && sb === null) c = 0
      else if (sa === null) return 1
      else if (sb === null) return -1
      else c = sa - sb
    } else c = byDate(a, b)
    if (c === 0) c = byDate(a, b) || a.visitId.localeCompare(b.visitId)
    return c * mul
  })
}

export function applyFilters(rows: readonly LogRow[], q: string, crew: CrewFilter, sort: Sort): LogRow[] {
  const filtered = rows.filter((r) => {
    if (!matchesQuery(r, q)) return false
    if (crew.mode === 'with') return hasCrewMember(r, crew.value)
    if (crew.mode === 'without') return !hasCrewMember(r, crew.value)
    return true
  })
  return sortRows(filtered, sort)
}

/** Clicking a header: same key flips direction; a new key starts at its natural direction. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'name' ? 'asc' : 'desc' }
}

export function escapedLabel(escaped: boolean | null, minutes: number | null): string {
  if (escaped === null) return '–'
  if (!escaped) return 'No'
  return minutes != null ? `Yes · ${Math.round(minutes)}m` : 'Yes'
}

export function encodeCrewFilter(f: CrewFilter): string {
  return f.mode === 'all' ? 'all' : `${f.mode}|${f.value}`
}

export function decodeCrewFilter(s: string): CrewFilter {
  const i = s.indexOf('|')
  if (i < 0) return { mode: 'all' }
  const mode = s.slice(0, i)
  const value = s.slice(i + 1)
  return (mode === 'with' || mode === 'without') && value ? { mode, value } : { mode: 'all' }
}

export function summary(rows: readonly LogRow[]): { count: number; escaped: number; rate: number | null } {
  const known = rows.filter((r) => r.escaped !== null)
  const escaped = known.filter((r) => r.escaped).length
  return { count: rows.length, escaped, rate: known.length ? escaped / known.length : null }
}
