/**
 * Pure wish-list operations. Every operation takes the current list, returns a
 * new list (never mutates) sorted by priority with priorities renumbered 1..N.
 */
import { makeId, type WishlistItem } from '@/contracts/types'

export interface NewWishInput {
  name: string
  city?: string
  link?: string
  addedBy?: string
}

/** Stable sort by priority (ties keep their incoming order). */
export function sortByPriority(items: readonly WishlistItem[]): WishlistItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.priority - b.item.priority || a.i - b.i)
    .map((x) => x.item)
}

/** Give items priorities 1..N in their array order. Returns new objects only where the priority changed. */
export function renumber(items: readonly WishlistItem[]): WishlistItem[] {
  return items.map((item, i) => (item.priority === i + 1 ? item : { ...item, priority: i + 1 }))
}

/** Sort by priority then renumber; the canonical shape every op returns. */
export function normalize(items: readonly WishlistItem[]): WishlistItem[] {
  return renumber(sortByPriority(items))
}

/** Append a new wish at the bottom. Returns the list unchanged when the name is blank. */
export function addItem(items: readonly WishlistItem[], input: NewWishInput, id: string = makeId('wish')): WishlistItem[] {
  const name = input.name.trim()
  const list = normalize(items)
  if (!name) return list
  const item: WishlistItem = {
    id,
    name,
    city: (input.city ?? '').trim(),
    link: (input.link ?? '').trim(),
    addedBy: (input.addedBy ?? '').trim(),
    priority: list.length + 1,
    done: false,
  }
  return [...list, item]
}

/** Move an item to a position (0-based, clamped) in the priority order. */
export function moveToIndex(items: readonly WishlistItem[], id: string, index: number): WishlistItem[] {
  const list = sortByPriority(items)
  const from = list.findIndex((x) => x.id === id)
  if (from < 0) return renumber(list)
  const to = Math.max(0, Math.min(list.length - 1, Math.round(index)))
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  return renumber(list)
}

export function moveUp(items: readonly WishlistItem[], id: string): WishlistItem[] {
  const list = sortByPriority(items)
  const i = list.findIndex((x) => x.id === id)
  return i <= 0 ? renumber(list) : moveToIndex(list, id, i - 1)
}

export function moveDown(items: readonly WishlistItem[], id: string): WishlistItem[] {
  const list = sortByPriority(items)
  const i = list.findIndex((x) => x.id === id)
  return i < 0 || i >= list.length - 1 ? renumber(list) : moveToIndex(list, id, i + 1)
}

export interface RemoveResult {
  items: WishlistItem[]
  removed: WishlistItem | null
  /** Index the item had in priority order (for undo), or -1. */
  index: number
}

export function removeItem(items: readonly WishlistItem[], id: string): RemoveResult {
  const list = sortByPriority(items)
  const index = list.findIndex((x) => x.id === id)
  if (index < 0) return { items: renumber(list), removed: null, index: -1 }
  const [removed] = list.splice(index, 1)
  return { items: renumber(list), removed, index }
}

/** Put an item back at an index (undo of remove). Replaces an existing item with the same id. */
export function insertAt(items: readonly WishlistItem[], item: WishlistItem, index: number): WishlistItem[] {
  const list = sortByPriority(items).filter((x) => x.id !== item.id)
  const at = Math.max(0, Math.min(list.length, index))
  list.splice(at, 0, item)
  return renumber(list)
}

export function toggleDone(items: readonly WishlistItem[], id: string): WishlistItem[] {
  return normalize(items.map((x) => (x.id === id ? { ...x, done: !x.done } : x)))
}

/**
 * Turn a typed link into a safe href: adds https:// when no scheme is given and
 * rejects anything that is not http(s). Returns '' when unusable.
 */
export function safeHref(link: string): string {
  const raw = link.trim()
  if (!raw) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

/** Which items the board shows: up to `max` lines, the last one replaced by "+N more" when overflowing. */
export function boardLines(items: readonly WishlistItem[], max = 12): { shown: WishlistItem[]; more: number } {
  const list = sortByPriority(items)
  if (list.length <= max) return { shown: list, more: 0 }
  const shown = list.slice(0, max - 1)
  return { shown, more: list.length - shown.length }
}
