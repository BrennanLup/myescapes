/**
 * Pure bulletin-board layout. Groups rooms by the active sort key, orders them,
 * and packs the groups as label-topped clusters onto the board area, scaling the
 * polaroid size down until everything fits. No three.js, no React: unit tested.
 *
 * Coordinates: board-area local, metres, origin at the centre of the area,
 * +X right, +Y up. A slot's (x, y) is the centre of its (untilted) polaroid.
 */
import { type Review, type Room, type SortKey } from '@/contracts/types'

/** Polaroid paper aspect (width / height); matches the 256x300 canvas texture. */
export const PHOTO_ASPECT = 256 / 300
/** Largest polaroid width in metres (few rooms). */
export const MAX_PHOTO_W = 0.8
/** Smallest polaroid width we will try. */
export const MIN_PHOTO_W = 0.04
/** Max tilt in radians (about 5.2 degrees). The cell padding below leaves room for it. */
export const MAX_TILT = 0.09
/** Cell padding as a fraction of the photo size. */
const PAD_X = 0.2
const PAD_Y = 0.16
/** Pin head position inside the photo, in photo-width units from the photo centre. */
export const PIN_LOCAL_Y = 0.5 / PHOTO_ASPECT - 0.07
export const PIN_LOCAL_Z = 0.03

export interface LayoutSlot {
  roomId: string
  group: string
  /** Index in the whole sorted sequence (0-based). */
  order: number
  /** Index within its group. */
  indexInGroup: number
  x: number
  y: number
  w: number
  h: number
  /** Rotation about the board normal (radians), seeded by room id. */
  tilt: number
  /** Washi tape on one top corner (seeded), or none. */
  tape: 'left' | 'right' | null
  /** Seeded value in [0, 1) for per-photo variety (tape colour etc.). */
  seed: number
}

export interface LayoutGroup {
  key: string
  label: string
  count: number
  /** Index of the group in display order. */
  index: number
  /** Block bounds (label + photos). */
  x: number
  y: number
  w: number
  h: number
  /** Label card centre and size. */
  labelX: number
  labelY: number
  labelW: number
  labelH: number
}

export interface BoardLayout {
  sort: SortKey
  photoW: number
  photoH: number
  groups: LayoutGroup[]
  slots: LayoutSlot[]
}

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function seededRandom(seed: string): () => number {
  let a = hashString(seed) || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export const RATING_BUCKETS = ['90+', '80-89', '70-79', '<70', 'Unrated'] as const
export const TIME_BUCKETS = ['Under 45 min', '45-54 min', '55+ min', "Didn't escape", 'Unknown'] as const

export function ratingBucket(score: number | null | undefined): string {
  if (score == null) return 'Unrated'
  if (score >= 90) return '90+'
  if (score >= 80) return '80-89'
  if (score >= 70) return '70-79'
  return '<70'
}

export function timeBucket(review: Review | undefined): string {
  if (!review) return 'Unknown'
  if (!review.escaped) return "Didn't escape"
  const t = review.escapeTimeMinutes
  if (t == null) return 'Unknown'
  if (t < 45) return 'Under 45 min'
  if (t < 55) return '45-54 min'
  return '55+ min'
}

function clean(s: string | undefined, fallback: string): string {
  const t = (s ?? '').trim()
  return t.length ? t : fallback
}

/** Group key of a room under a sort. */
export function groupKeyFor(sort: SortKey, room: Room, review: Review | undefined): string {
  switch (sort) {
    case 'city':
      return clean(room.city, 'Unknown')
    case 'brand':
      return clean(room.company, 'Unknown')
    case 'genre':
      return room.genre
    case 'date':
      return review ? review.date.slice(0, 4) : 'Undated'
    case 'rating':
      return ratingBucket(review?.ratings.overall.score)
    case 'escapeTime':
      return timeBucket(review)
  }
}

/** Display label of a group key. */
export function groupLabel(sort: SortKey, key: string): string {
  if (sort === 'genre') return key === 'sci-fi' ? 'Sci-Fi' : key.charAt(0).toUpperCase() + key.slice(1)
  return key
}

function fixedRank(list: readonly string[], key: string): number {
  const i = list.indexOf(key)
  return i < 0 ? list.length : i
}

function textCompare(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la < lb) return -1
  if (la > lb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function compareGroups(sort: SortKey, a: string, b: string): number {
  switch (sort) {
    case 'rating':
      return fixedRank(RATING_BUCKETS, a) - fixedRank(RATING_BUCKETS, b)
    case 'escapeTime':
      return fixedRank(TIME_BUCKETS, a) - fixedRank(TIME_BUCKETS, b)
    case 'date': {
      if (a === b) return 0
      if (a === 'Undated') return 1
      if (b === 'Undated') return -1
      return textCompare(a, b)
    }
    default: {
      if (a === b) return 0
      if (a === 'Unknown') return 1
      if (b === 'Unknown') return -1
      return textCompare(a, b)
    }
  }
}

interface Item {
  room: Room
  review: Review | undefined
  group: string
}

function compareItems(sort: SortKey, a: Item, b: Item): number {
  const da = a.review?.date ?? '9999-99-99'
  const db = b.review?.date ?? '9999-99-99'
  const sa = a.review?.ratings.overall.score ?? -1
  const sb = b.review?.ratings.overall.score ?? -1
  let c = 0
  if (sort === 'rating') {
    c = sb - sa || (da < db ? -1 : da > db ? 1 : 0)
  } else if (sort === 'escapeTime') {
    const ta = a.review?.escapeTimeMinutes ?? Infinity
    const tb = b.review?.escapeTimeMinutes ?? Infinity
    c = (ta === tb ? 0 : ta < tb ? -1 : 1) || sb - sa
  } else {
    c = da < db ? -1 : da > db ? 1 : 0
  }
  return c || textCompare(a.room.name, b.room.name) || textCompare(a.room.id, b.room.id)
}

/** Groups and orders rooms (no geometry). */
export function groupRooms(rooms: Room[], reviews: Review[], sort: SortKey): Array<{ key: string; items: Item[] }> {
  const latest = new Map<string, Review>()
  for (const r of reviews) {
    const cur = latest.get(r.roomId)
    if (!cur || r.date > cur.date) latest.set(r.roomId, r)
  }
  const map = new Map<string, Item[]>()
  for (const room of rooms) {
    const review = latest.get(room.id)
    const group = groupKeyFor(sort, room, review)
    let list = map.get(group)
    if (!list) map.set(group, (list = []))
    list.push({ room, review, group })
  }
  const keys = [...map.keys()].sort((a, b) => compareGroups(sort, a, b))
  return keys.map((key) => ({ key, items: map.get(key)!.sort((a, b) => compareItems(sort, a, b)) }))
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

interface Block {
  key: string
  n: number
  cols: number
  rows: number
  w: number
  h: number
}

interface Fit {
  photoW: number
  photoH: number
  cellW: number
  cellH: number
  labelH: number
  groupGap: number
  shelfGap: number
  shelves: Block[][]
}

function tryFit(counts: Array<{ key: string; n: number }>, photoW: number, maxRowsPerGroup: number, W: number, H: number): Fit | null {
  const photoH = photoW / PHOTO_ASPECT
  const cellW = photoW * (1 + PAD_X)
  const cellH = photoH * (1 + PAD_Y)
  const labelH = Math.min(0.17, Math.max(0.035, photoH * 0.24))
  const groupGap = cellW * 0.3
  const shelfGap = cellH * 0.12
  const shelves: Block[][] = []
  let cur: Block[] = []
  let curW = 0
  for (const { key, n } of counts) {
    const rowsCap = Math.max(1, Math.min(n, maxRowsPerGroup))
    const cols = Math.ceil(n / rowsCap)
    const rows = Math.ceil(n / cols)
    const b: Block = { key, n, cols, rows, w: cols * cellW, h: labelH + rows * cellH }
    if (b.w > W + 1e-9) return null
    const need = cur.length ? curW + groupGap + b.w : b.w
    if (need > W + 1e-9) {
      shelves.push(cur)
      cur = [b]
      curW = b.w
    } else {
      cur.push(b)
      curW = need
    }
  }
  if (cur.length) shelves.push(cur)
  let total = 0
  for (const s of shelves) total += Math.max(...s.map((b) => b.h))
  total += shelfGap * Math.max(0, shelves.length - 1)
  if (total > H + 1e-9) return null
  return { photoW, photoH, cellW, cellH, labelH, groupGap, shelfGap, shelves }
}

function findFit(counts: Array<{ key: string; n: number }>, W: number, H: number): Fit {
  for (let w = MAX_PHOTO_W; w >= MIN_PHOTO_W; w *= 0.975) {
    const photoH = w / PHOTO_ASPECT
    const cellH = photoH * (1 + PAD_Y)
    const labelH = Math.min(0.17, Math.max(0.035, photoH * 0.24))
    const maxRows = Math.floor((H - labelH) / cellH)
    if (maxRows < 1) continue
    for (let r = maxRows; r >= 1; r--) {
      const fit = tryFit(counts, w, r, W, H)
      if (fit) return fit
    }
  }
  // Absurd input (thousands of rooms): fall back to the smallest size, single rows.
  return tryFit(counts, MIN_PHOTO_W, 1, Infinity, Infinity)!
}

/**
 * Lays out every room on a board area of boardW x boardH metres.
 * Deterministic: same input, same output.
 */
export function layoutBoard(rooms: Room[], reviews: Review[], sort: SortKey, boardW: number, boardH: number): BoardLayout {
  const grouped = groupRooms(rooms, reviews, sort)
  if (!grouped.length) return { sort, photoW: MAX_PHOTO_W, photoH: MAX_PHOTO_W / PHOTO_ASPECT, groups: [], slots: [] }
  const fit = findFit(
    grouped.map((g) => ({ key: g.key, n: g.items.length })),
    boardW,
    boardH,
  )
  const byKey = new Map(grouped.map((g) => [g.key, g.items]))
  const groups: LayoutGroup[] = []
  const slots: LayoutSlot[] = []

  const shelfHeights = fit.shelves.map((s) => Math.max(...s.map((b) => b.h)))
  const totalH = shelfHeights.reduce((a, b) => a + b, 0) + fit.shelfGap * (fit.shelves.length - 1)
  // Spread shelves a little when there is spare height, but keep the cluster centred.
  const spareH = boardH - totalH
  const shelfGap = fit.shelves.length > 1 ? fit.shelfGap + Math.min(spareH / (fit.shelves.length - 1), fit.cellH * 0.25) : 0
  const usedH = shelfHeights.reduce((a, b) => a + b, 0) + shelfGap * (fit.shelves.length - 1)
  let top = usedH / 2

  let order = 0
  let groupIndex = 0
  fit.shelves.forEach((shelf, si) => {
    const sumW = shelf.reduce((a, b) => a + b.w, 0)
    const k = shelf.length
    const gap = k > 1 ? Math.min(fit.groupGap * 2.5, Math.max(fit.groupGap, (boardW - sumW) / (k - 1))) : 0
    const rowW = sumW + gap * (k - 1)
    let left = -rowW / 2
    for (const b of shelf) {
      const items = byKey.get(b.key)!
      const labelW = Math.min(b.w - fit.cellW * 0.08, Math.max(b.w * 0.9, fit.cellW * 0.92))
      groups.push({
        key: b.key,
        label: groupLabel(sort, b.key),
        count: b.n,
        index: groupIndex++,
        x: left + b.w / 2,
        y: top - b.h / 2,
        w: b.w,
        h: b.h,
        labelX: left + b.w / 2,
        labelY: top - fit.labelH / 2,
        labelW,
        labelH: fit.labelH * 0.86,
      })
      items.forEach((it, i) => {
        const row = Math.floor(i / b.cols)
        const col = i % b.cols
        const inRow = row === b.rows - 1 ? b.n - row * b.cols : b.cols
        const offset = ((b.cols - inRow) * fit.cellW) / 2
        const rnd = seededRandom(it.room.id)
        const tilt = (rnd() * 2 - 1) * MAX_TILT
        const t = rnd()
        const seed = rnd()
        slots.push({
          roomId: it.room.id,
          group: b.key,
          order: order++,
          indexInGroup: i,
          x: left + offset + (col + 0.5) * fit.cellW,
          y: top - fit.labelH - (row + 0.5) * fit.cellH,
          w: fit.photoW,
          h: fit.photoH,
          tilt,
          tape: t < 0.18 ? 'left' : t < 0.36 ? 'right' : null,
          seed,
        })
      })
      left += b.w + gap
    }
    top -= shelfHeights[si] + shelfGap
  })
  return { sort, photoW: fit.photoW, photoH: fit.photoH, groups, slots }
}

/** Pin head position of a slot in board-area local space (x, y, z offset from the photo plane). */
export function slotPinLocal(x: number, y: number, w: number, tilt: number): [number, number, number] {
  const py = PIN_LOCAL_Y * w
  return [x - Math.sin(tilt) * py, y + Math.cos(tilt) * py, PIN_LOCAL_Z * w]
}

/** Axis-aligned bounds of a tilted slot (used by tests and hit checks). */
export function slotBounds(s: Pick<LayoutSlot, 'x' | 'y' | 'w' | 'h' | 'tilt'>): { minX: number; maxX: number; minY: number; maxY: number } {
  const c = Math.abs(Math.cos(s.tilt))
  const sn = Math.abs(Math.sin(s.tilt))
  const hw = (s.w * c + s.h * sn) / 2
  const hh = (s.w * sn + s.h * c) / 2
  return { minX: s.x - hw, maxX: s.x + hw, minY: s.y - hh, maxY: s.y + hh }
}
