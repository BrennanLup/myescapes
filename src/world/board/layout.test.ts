import { describe, expect, it } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { GENRES, SORT_KEYS, type Review, type Room, type SortKey } from '@/contracts/types'
import { groupKeyFor, layoutBoard, slotBounds, type BoardLayout } from './layout'

const W = 8.5
const H = 2.36

const CITIES = ['Toronto', 'San Francisco', 'Montreal', 'Berlin', 'Tokyo', 'Austin', 'Lisbon', 'Seattle']
const BRANDS = ['Puzzle Parlour', 'Escape Hatch', 'Lockbox', 'Clue HQ', 'The Riddler', 'Mystery Mansion']

function makeData(n: number, seed = 1): { rooms: Room[]; reviews: Review[] } {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const rooms: Room[] = []
  const reviews: Review[] = []
  const base = FIXTURE_DATASET.reviews[0]
  for (let i = 0; i < n; i++) {
    const id = `room_${i}`
    rooms.push({
      id,
      name: `Room ${i}`,
      company: BRANDS[Math.floor(rnd() * BRANDS.length)],
      city: CITIES[Math.floor(rnd() * CITIES.length)],
      genre: GENRES[Math.floor(rnd() * GENRES.length)],
      address: '',
      website: '',
      photos: [],
    })
    if (i % 17 === 5) continue // some rooms have no review
    const score = 40 + Math.floor(rnd() * 61)
    const escaped = rnd() > 0.2
    const time = rnd() > 0.1 ? 30 + Math.floor(rnd() * 31) : null
    const year = 2019 + Math.floor(rnd() * 7)
    reviews.push({
      ...base,
      id: `rev_${i}`,
      roomId: id,
      date: `${year}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`,
      ratings: { ...base.ratings, overall: { score, comment: '' } },
      escaped,
      escapeTimeMinutes: time,
    })
  }
  return { rooms, reviews }
}

function overlaps(a: ReturnType<typeof slotBounds>, b: ReturnType<typeof slotBounds>) {
  const e = 1e-6
  return a.minX < b.maxX - e && b.minX < a.maxX - e && a.minY < b.maxY - e && b.minY < a.maxY - e
}

function checkFits(layout: BoardLayout, n: number) {
  expect(layout.slots).toHaveLength(n)
  const boxes = layout.slots.map(slotBounds)
  const labels = layout.groups.map((g) => ({
    minX: g.labelX - g.labelW / 2,
    maxX: g.labelX + g.labelW / 2,
    minY: g.labelY - g.labelH / 2,
    maxY: g.labelY + g.labelH / 2,
  }))
  for (const b of [...boxes, ...labels]) {
    expect(b.minX).toBeGreaterThanOrEqual(-W / 2 - 1e-6)
    expect(b.maxX).toBeLessThanOrEqual(W / 2 + 1e-6)
    expect(b.minY).toBeGreaterThanOrEqual(-H / 2 - 1e-6)
    expect(b.maxY).toBeLessThanOrEqual(H / 2 + 1e-6)
  }
  const all = [...boxes, ...labels]
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false)
  // orders are a permutation
  expect(new Set(layout.slots.map((s) => s.order)).size).toBe(n)
  expect(new Set(layout.slots.map((s) => s.roomId)).size).toBe(n)
}

describe('layoutBoard', () => {
  it('handles zero rooms', () => {
    const l = layoutBoard([], [], 'city', W, H)
    expect(l.slots).toEqual([])
    expect(l.groups).toEqual([])
  })

  for (const n of [1, 3, 12, 60, 200]) {
    for (const sort of SORT_KEYS) {
      it(`fits ${n} rooms without overlaps (sort=${sort})`, () => {
        const { rooms, reviews } = makeData(n, n + 7)
        checkFits(layoutBoard(rooms, reviews, sort, W, H), n)
      })
    }
  }

  it('fits 200 rooms that each sit in their own group', () => {
    const { rooms, reviews } = makeData(200, 3)
    const unique = rooms.map((r, i) => ({ ...r, company: `Brand ${String(i).padStart(3, '0')}` }))
    const l = layoutBoard(unique, reviews, 'brand', W, H)
    expect(l.groups).toHaveLength(200)
    checkFits(l, 200)
  })

  it('uses big photos for few rooms and smaller ones for many', () => {
    const few = makeData(3)
    const many = makeData(200)
    const a = layoutBoard(few.rooms, few.reviews, 'city', W, H)
    const b = layoutBoard(many.rooms, many.reviews, 'city', W, H)
    expect(a.photoW).toBeGreaterThan(0.4)
    expect(b.photoW).toBeLessThan(a.photoW)
    expect(b.photoW).toBeGreaterThan(0.15)
  })

  it('is deterministic', () => {
    const { rooms, reviews } = makeData(80, 11)
    for (const sort of SORT_KEYS) {
      expect(layoutBoard(rooms, reviews, sort, W, H)).toEqual(layoutBoard(rooms, reviews, sort, W, H))
    }
    // tilt is seeded by room id, independent of sort
    const a = layoutBoard(rooms, reviews, 'city', W, H)
    const b = layoutBoard(rooms, reviews, 'rating', W, H)
    const tiltA = new Map(a.slots.map((s) => [s.roomId, s.tilt]))
    for (const s of b.slots) expect(s.tilt).toBe(tiltA.get(s.roomId))
  })

  it('groups every slot by the key of its sort', () => {
    const { rooms, reviews } = makeData(60, 5)
    const latest = new Map<string, Review>()
    for (const r of reviews) latest.set(r.roomId, r)
    for (const sort of SORT_KEYS) {
      const l = layoutBoard(rooms, reviews, sort, W, H)
      const byId = new Map(rooms.map((r) => [r.id, r]))
      for (const s of l.slots) expect(s.group).toBe(groupKeyFor(sort, byId.get(s.roomId)!, latest.get(s.roomId)))
      // groups are contiguous in the order
      const seq = [...l.slots].sort((a, b) => a.order - b.order).map((s) => s.group)
      const seen = new Set<string>()
      for (let i = 0; i < seq.length; i++) {
        if (i > 0 && seq[i] !== seq[i - 1]) expect(seen.has(seq[i])).toBe(false)
        seen.add(seq[i])
      }
      expect(l.groups.map((g) => g.key)).toEqual([...new Set(seq)])
    }
  })

  const expectedKeys: Record<SortKey, (r: Room, rv: Review | undefined) => string> = {
    city: (r) => r.city,
    brand: (r) => r.company,
    genre: (r) => r.genre,
    date: (_r, rv) => (rv ? rv.date.slice(0, 4) : 'Undated'),
    rating: (_r, rv) => {
      const s = rv?.ratings.overall.score
      return s == null ? 'Unrated' : s >= 90 ? '90+' : s >= 80 ? '80-89' : s >= 70 ? '70-79' : '<70'
    },
    escapeTime: (_r, rv) =>
      !rv ? 'Unknown' : !rv.escaped ? "Didn't escape" : rv.escapeTimeMinutes == null ? 'Unknown' : rv.escapeTimeMinutes < 45 ? 'Under 45 min' : rv.escapeTimeMinutes < 55 ? '45-54 min' : '55+ min',
  }

  it('fixture: each sort key groups correctly and in sensible order', () => {
    const { rooms, reviews } = FIXTURE_DATASET
    const keysOf = (sort: SortKey) => layoutBoard(rooms, reviews, sort, W, H).groups.map((g) => g.key)
    expect(keysOf('city')).toEqual(['San Francisco', 'Toronto'])
    expect(keysOf('brand')).toEqual(['Escape Hatch', 'Puzzle Parlour'])
    expect(keysOf('genre')).toEqual(['horror', 'mystery', 'sci-fi'])
    expect(keysOf('date')).toEqual(['2024', '2025'])
    expect(keysOf('rating')).toEqual(['90+', '80-89', '70-79'])
    expect(keysOf('escapeTime')).toEqual(['45-54 min', "Didn't escape"])
    for (const sort of SORT_KEYS) {
      const l = layoutBoard(rooms, reviews, sort, W, H)
      for (const s of l.slots) {
        const room = rooms.find((r) => r.id === s.roomId)!
        expect(s.group).toBe(expectedKeys[sort](room, reviews.find((r) => r.roomId === room.id)))
      }
    }
    // within a city, chronological
    const sf = layoutBoard(rooms, reviews, 'city', W, H).slots.filter((s) => s.group === 'San Francisco').sort((a, b) => a.order - b.order)
    expect(sf.map((s) => s.roomId)).toEqual(['room_fx_1', 'room_fx_3'])
    // escape time: faster first
    const et = layoutBoard(rooms, reviews, 'escapeTime', W, H).slots.sort((a, b) => a.order - b.order)
    expect(et.map((s) => s.roomId)).toEqual(['room_fx_3', 'room_fx_1', 'room_fx_2'])
  })

  it('orders ratings high to low within a bucket', () => {
    const { rooms, reviews } = makeData(120, 9)
    const l = layoutBoard(rooms, reviews, 'rating', W, H)
    const score = new Map(reviews.map((r) => [r.roomId, r.ratings.overall.score]))
    const seq = [...l.slots].sort((a, b) => a.order - b.order).map((s) => score.get(s.roomId) ?? -1)
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1])
  })
})
