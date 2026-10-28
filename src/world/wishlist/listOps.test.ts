import { describe, expect, it } from 'vitest'
import type { WishlistItem } from '@/contracts/types'
import {
  addItem,
  boardLines,
  insertAt,
  moveDown,
  moveToIndex,
  moveUp,
  normalize,
  removeItem,
  renumber,
  safeHref,
  sortByPriority,
  toggleDone,
} from './listOps'

const w = (id: string, priority: number, extra: Partial<WishlistItem> = {}): WishlistItem => ({
  id,
  name: id.toUpperCase(),
  city: '',
  link: '',
  addedBy: '',
  priority,
  done: false,
  ...extra,
})

const ids = (items: WishlistItem[]) => items.map((x) => x.id)
const prios = (items: WishlistItem[]) => items.map((x) => x.priority)

describe('wishlist list ops', () => {
  const base = [w('c', 7), w('a', 2), w('b', 5)]

  it('sorts by priority and renumbers 1..N', () => {
    expect(ids(sortByPriority(base))).toEqual(['a', 'b', 'c'])
    expect(prios(renumber(sortByPriority(base)))).toEqual([1, 2, 3])
    expect(normalize([])).toEqual([])
  })

  it('does not mutate the input', () => {
    const copy = JSON.parse(JSON.stringify(base))
    moveUp(base, 'c')
    removeItem(base, 'a')
    toggleDone(base, 'b')
    expect(base).toEqual(copy)
  })

  it('adds an item at the bottom with trimmed fields', () => {
    const next = addItem(base, { name: '  Sky Pirates ', city: ' SF ', addedBy: 'Maya' }, 'new')
    expect(ids(next)).toEqual(['a', 'b', 'c', 'new'])
    expect(next[3]).toEqual({ id: 'new', name: 'Sky Pirates', city: 'SF', link: '', addedBy: 'Maya', priority: 4, done: false })
    expect(prios(next)).toEqual([1, 2, 3, 4])
  })

  it('ignores a blank name', () => {
    expect(ids(addItem(base, { name: '   ' }))).toEqual(['a', 'b', 'c'])
  })

  it('generates an id when none is given', () => {
    const next = addItem([], { name: 'X' })
    expect(next[0].id).toMatch(/^wish_/)
  })

  it('moves up and down, clamped at the ends', () => {
    expect(ids(moveUp(base, 'b'))).toEqual(['b', 'a', 'c'])
    expect(ids(moveUp(base, 'a'))).toEqual(['a', 'b', 'c'])
    expect(ids(moveDown(base, 'a'))).toEqual(['b', 'a', 'c'])
    expect(ids(moveDown(base, 'c'))).toEqual(['a', 'b', 'c'])
    expect(prios(moveDown(base, 'a'))).toEqual([1, 2, 3])
    expect(ids(moveUp(base, 'missing'))).toEqual(['a', 'b', 'c'])
  })

  it('moves to an index', () => {
    expect(ids(moveToIndex(base, 'c', 0))).toEqual(['c', 'a', 'b'])
    expect(ids(moveToIndex(base, 'a', 2))).toEqual(['b', 'c', 'a'])
    expect(ids(moveToIndex(base, 'a', 99))).toEqual(['b', 'c', 'a'])
    expect(ids(moveToIndex(base, 'c', -4))).toEqual(['c', 'a', 'b'])
    expect(prios(moveToIndex(base, 'c', 0))).toEqual([1, 2, 3])
  })

  it('removes and undoes at the original index', () => {
    const r = removeItem(base, 'b')
    expect(ids(r.items)).toEqual(['a', 'c'])
    expect(prios(r.items)).toEqual([1, 2])
    expect(r.index).toBe(1)
    expect(r.removed?.id).toBe('b')
    const back = insertAt(r.items, r.removed!, r.index)
    expect(ids(back)).toEqual(['a', 'b', 'c'])
    expect(prios(back)).toEqual([1, 2, 3])
    expect(removeItem(base, 'nope')).toMatchObject({ removed: null, index: -1 })
  })

  it('toggles done', () => {
    const once = toggleDone(base, 'b')
    expect(once.find((x) => x.id === 'b')?.done).toBe(true)
    expect(toggleDone(once, 'b').find((x) => x.id === 'b')?.done).toBe(false)
  })

  it('makes safe hrefs', () => {
    expect(safeHref('escape.com/vault')).toBe('https://escape.com/vault')
    expect(safeHref('http://x.org')).toBe('http://x.org/')
    expect(safeHref('javascript:alert(1)')).toBe('')
    expect(safeHref('  ')).toBe('')
    expect(safeHref('/games/the-vault')).toBe('/games/the-vault')
    expect(safeHref('//evil.example/x')).toBe('https://evil.example/x')
  })

  it('caps board lines with a "+N more" count', () => {
    const many = Array.from({ length: 20 }, (_, i) => w(`i${i}`, i + 1))
    expect(boardLines(many, 12)).toMatchObject({ more: 9 })
    expect(boardLines(many, 12).shown).toHaveLength(11)
    expect(boardLines(many.slice(0, 12), 12)).toMatchObject({ more: 0 })
    expect(boardLines(many.slice(0, 12), 12).shown).toHaveLength(12)
  })
})
