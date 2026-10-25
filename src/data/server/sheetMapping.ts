/**
 * Pure mapping between Google Sheet rows and app entities. No I/O.
 *
 * Every tab has a header row; columns are matched by header name, so the crew
 * can reorder columns or add their own extra columns in the sheet.
 * Nested values: ratings are flat columns (`overall`, `overallComment`, ...);
 * `crew` and `toolsUsed` are JSON arrays (a plain comma-separated cell is also
 * accepted on read); `photos` is a JSON array of {url, caption}.
 */
import {
  CrewMemberSchema,
  GENRES,
  PuzzleSchema,
  RATING_KEYS,
  ReviewSchema,
  RoomSchema,
  WishlistItemSchema,
  type CrewMember,
  type Dataset,
  type Entry,
  type Photo,
  type Puzzle,
  type Review,
  type Room,
  type WishlistItem,
} from '../../contracts/types'

export type Cell = string | number | boolean | null
export type Row = Cell[]
export type RowRecord = Record<string, Cell>

export const TABS = {
  Rooms: ['id', 'name', 'company', 'city', 'genre', 'address', 'website', 'photos'],
  Reviews: [
    'id', 'roomId', 'date', 'crew',
    ...RATING_KEYS.flatMap((k) => [k, `${k}Comment`]),
    'escaped', 'escapeTimeMinutes', 'visibleTimer', 'multiRoom', 'flashlights', 'liveActors',
    'toolsUsed', 'voiceTranscript', 'photos',
  ],
  Puzzles: ['id', 'reviewId', 'description', 'type', 'memorable'],
  Wishlist: ['id', 'name', 'city', 'link', 'addedBy', 'priority', 'done'],
  Crew: ['id', 'name', 'userId', 'email'],
} as const satisfies Record<string, readonly string[]>

export type TabName = keyof typeof TABS
export const TAB_NAMES = Object.keys(TABS) as TabName[]

/** Google Sheets rejects cells longer than 50,000 characters. */
export const MAX_CELL = 50_000

// ---------------------------------------------------------------------------
// Cell readers
// ---------------------------------------------------------------------------

export function str(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export function num(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export function bool(v: Cell | undefined): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return ['true', 'yes', 'y', '1', 'x', '✓'].includes(str(v).toLowerCase())
}

export function list(v: Cell | undefined): string[] {
  const s = str(v)
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(s)
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
    } catch {
      /* fall through to splitting */
    }
  }
  return s.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean)
}

export function photos(v: Cell | undefined): Photo[] {
  const s = str(v)
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(s)
      if (Array.isArray(arr)) {
        return arr.flatMap((p): Photo[] => {
          if (typeof p === 'string' && p) return [{ url: p }]
          if (p && typeof p === 'object' && typeof (p as Photo).url === 'string' && (p as Photo).url) {
            const { url, caption } = p as Photo
            return [caption ? { url, caption } : { url }]
          }
          return []
        })
      }
    } catch {
      /* fall through */
    }
  }
  // A plain list of URLs, one per line.
  return s.split(/\n/).map((u) => u.trim()).filter(Boolean).map((url) => ({ url }))
}

/** ISO date from a string, or from a Sheets date serial (days since 1899-12-30). */
export function isoDate(v: Cell | undefined): string {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  const s = str(v)
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

/** JSON-encodes photos, dropping inline data: URLs if the cell would be too big for Sheets. */
export function photosCell(p: Photo[]): string {
  if (p.length === 0) return ''
  const json = JSON.stringify(p)
  if (json.length < MAX_CELL) return json
  const kept = p.filter((x) => !x.url.startsWith('data:'))
  if (kept.length < p.length) console.warn(`[data] Dropped ${p.length - kept.length} inline photo(s) too large for a sheet cell`)
  const trimmed = JSON.stringify(kept)
  return trimmed.length < MAX_CELL ? (kept.length ? trimmed : '') : ''
}

// ---------------------------------------------------------------------------
// Rows <-> records
// ---------------------------------------------------------------------------

export function rowToRecord(headers: readonly string[], row: Row): RowRecord {
  const rec: RowRecord = {}
  headers.forEach((h, i) => {
    if (h) rec[h] = row[i] ?? null
  })
  return rec
}

export function recordToRow(headers: readonly string[], rec: RowRecord): Row {
  return headers.map((h) => (h in rec ? rec[h] : ''))
}

/** Splits a tab's values (header row first) into records, skipping blank rows. */
export function tabRecords(values: Row[] | undefined): RowRecord[] {
  if (!values || values.length === 0) return []
  const headers = values[0].map((h) => str(h))
  return values
    .slice(1)
    .filter((row) => row.some((c) => str(c) !== ''))
    .map((row) => rowToRecord(headers, row))
}

// ---------------------------------------------------------------------------
// Entities -> records
// ---------------------------------------------------------------------------

export function roomToRecord(r: Room): RowRecord {
  return { id: r.id, name: r.name, company: r.company, city: r.city, genre: r.genre, address: r.address, website: r.website, photos: photosCell(r.photos) }
}

export function reviewToRecord(r: Review): RowRecord {
  const rec: RowRecord = { id: r.id, roomId: r.roomId, date: r.date, crew: JSON.stringify(r.crew) }
  for (const k of RATING_KEYS) {
    rec[k] = r.ratings[k].score
    rec[`${k}Comment`] = r.ratings[k].comment
  }
  Object.assign(rec, {
    escaped: r.escaped,
    escapeTimeMinutes: r.escapeTimeMinutes,
    visibleTimer: r.visibleTimer,
    multiRoom: r.multiRoom,
    flashlights: r.flashlights,
    liveActors: r.liveActors,
    toolsUsed: JSON.stringify(r.toolsUsed),
    voiceTranscript: r.voiceTranscript.slice(0, MAX_CELL - 1),
    photos: photosCell(r.photos),
  })
  return rec
}

export function puzzleToRecord(p: Puzzle): RowRecord {
  return { id: p.id, reviewId: p.reviewId, description: p.description, type: p.type, memorable: p.memorable }
}

export function wishlistToRecord(w: WishlistItem): RowRecord {
  return { id: w.id, name: w.name, city: w.city, link: w.link, addedBy: w.addedBy, priority: w.priority, done: w.done }
}

export function crewToRecord(c: CrewMember): RowRecord {
  return { id: c.id, name: c.name, userId: c.userId ?? '', email: c.email ?? '' }
}

// ---------------------------------------------------------------------------
// Records -> entities (validated; return null for unusable rows)
// ---------------------------------------------------------------------------

export function recordToRoom(rec: RowRecord): Room | null {
  const g = str(rec.genre).toLowerCase()
  // Unknown or blank genre: keep the room as "other" rather than dropping it.
  const genre = (GENRES as readonly string[]).includes(g) ? g : 'other'
  const r = RoomSchema.safeParse({
    id: str(rec.id), name: str(rec.name), company: str(rec.company), city: str(rec.city),
    genre, address: str(rec.address), website: str(rec.website), photos: photos(rec.photos),
  })
  return r.success ? r.data : null
}

export function recordToPuzzle(rec: RowRecord): Puzzle | null {
  const r = PuzzleSchema.safeParse({
    id: str(rec.id), reviewId: str(rec.reviewId), description: str(rec.description),
    type: str(rec.type).toLowerCase(), memorable: bool(rec.memorable),
  })
  return r.success ? r.data : null
}

export function recordToReview(rec: RowRecord, puzzles: Puzzle[] = []): Review | null {
  const ratings: Record<string, { score: number | null; comment: string }> = {}
  for (const k of RATING_KEYS) {
    const n = num(rec[k])
    ratings[k] = { score: n === null ? null : Math.min(100, Math.max(1, Math.round(n))), comment: str(rec[`${k}Comment`]) }
  }
  const r = ReviewSchema.safeParse({
    id: str(rec.id), roomId: str(rec.roomId), date: isoDate(rec.date), crew: list(rec.crew), ratings,
    puzzles, escaped: bool(rec.escaped), escapeTimeMinutes: num(rec.escapeTimeMinutes),
    visibleTimer: bool(rec.visibleTimer), multiRoom: bool(rec.multiRoom), flashlights: bool(rec.flashlights),
    liveActors: bool(rec.liveActors), toolsUsed: list(rec.toolsUsed), voiceTranscript: str(rec.voiceTranscript),
    photos: photos(rec.photos),
  })
  return r.success ? r.data : null
}

export function recordToWishlist(rec: RowRecord, index = 0): WishlistItem | null {
  const r = WishlistItemSchema.safeParse({
    id: str(rec.id) || `wish_row${index + 1}`, name: str(rec.name), city: str(rec.city), link: str(rec.link),
    addedBy: str(rec.addedBy), priority: Math.round(num(rec.priority) ?? index + 1), done: bool(rec.done),
  })
  return r.success ? r.data : null
}

export function recordToCrew(rec: RowRecord): CrewMember | null {
  const userId = str(rec.userId), email = str(rec.email), name = str(rec.name)
  const r = CrewMemberSchema.safeParse({
    id: str(rec.id) || `crew_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name,
    ...(userId ? { userId } : {}), ...(email ? { email } : {}),
  })
  return r.success ? r.data : null
}

// ---------------------------------------------------------------------------
// Whole dataset
// ---------------------------------------------------------------------------

export type TabValues = Partial<Record<TabName, Row[]>>

/** Builds a dataset from raw tab values. Invalid rows are skipped and reported in `skipped`. */
export function valuesToDataset(tabs: TabValues): { dataset: Dataset; skipped: string[] } {
  const skipped: string[] = []
  const take = <T>(tab: TabName, fn: (rec: RowRecord, i: number) => T | null): T[] =>
    tabRecords(tabs[tab]).flatMap((rec, i) => {
      const v = fn(rec, i)
      if (v === null) skipped.push(`${tab} row ${i + 2}`)
      return v === null ? [] : [v]
    })

  const puzzles = take('Puzzles', recordToPuzzle)
  const byReview = new Map<string, Puzzle[]>()
  for (const p of puzzles) byReview.set(p.reviewId, [...(byReview.get(p.reviewId) ?? []), p])

  const dataset: Dataset = {
    source: 'google-sheet',
    rooms: take('Rooms', recordToRoom),
    reviews: take('Reviews', (rec) => recordToReview(rec, byReview.get(str(rec.id)) ?? [])),
    wishlist: take('Wishlist', recordToWishlist).sort((a, b) => a.priority - b.priority),
    crew: take('Crew', recordToCrew),
  }
  return { dataset, skipped }
}

/** Records for one saved entry, per tab. */
export function entryToRecords(e: Entry): { Rooms: RowRecord[]; Reviews: RowRecord[]; Puzzles: RowRecord[] } {
  return {
    Rooms: [roomToRecord(e.room)],
    Reviews: [reviewToRecord(e.review)],
    Puzzles: e.review.puzzles.map(puzzleToRecord),
  }
}

/** All rows (header first) for a full dataset, e.g. to populate a new sheet. */
export function datasetToValues(d: Dataset): Record<TabName, Row[]> {
  const rows = (tab: TabName, recs: RowRecord[]) => [[...TABS[tab]], ...recs.map((r) => recordToRow(TABS[tab], r))]
  return {
    Rooms: rows('Rooms', d.rooms.map(roomToRecord)),
    Reviews: rows('Reviews', d.reviews.map(reviewToRecord)),
    Puzzles: rows('Puzzles', d.reviews.flatMap((r) => r.puzzles.map(puzzleToRecord))),
    Wishlist: rows('Wishlist', d.wishlist.map(wishlistToRecord)),
    Crew: rows('Crew', d.crew.map(crewToRecord)),
  }
}
