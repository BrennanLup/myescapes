import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import type { Review, Room } from '@/contracts/types'
import { buildCrewIndex, SOLO_LABEL } from '@/state/crew'
import { friend, logRow, user } from '@/state/testRows'
import { clearAvatarCache, loadAvatar, loadAvatars } from './avatars'
import { groupKeyFor, groupRooms, layoutBoard, slotBounds } from './layout'
import { MAX_STICKERS, POLAROID_H, POLAROID_W, stickerSlots, STICKER_R } from './textures'

const W = 8.5
const H = 2.36
const baseRoom = FIXTURE_DATASET.rooms[0]
const baseReview = FIXTURE_DATASET.reviews[0]

function data(crews: string[][]): { rooms: Room[]; reviews: Review[] } {
  const rooms = crews.map((_, i) => ({ ...baseRoom, id: `room_${i}`, name: `Room ${i}` }))
  const reviews = crews.map((crew, i) => ({ ...baseReview, id: `vis_${i}`, roomId: `room_${i}`, date: `2025-0${(i % 9) + 1}-10`, crew }))
  return { rooms, reviews }
}

describe('crew sort on the board', () => {
  const { rooms, reviews } = data([['Mia'], ['Mia'], [], ['Mia', 'Bob'], ['Bob', 'Mia'], ['Sam'], [], ['Mia']])
  const crew = buildCrewIndex(reviews)

  it('groups rooms by who played them, biggest crew group first and Solo last', () => {
    const groups = groupRooms(rooms, reviews, 'crew', crew)
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['With Mia', 3],
      ['With Mia & Bob', 2],
      ['With Sam', 1],
      [SOLO_LABEL, 2],
    ])
    // Chronological inside a group.
    expect(groups[0].items.map((i) => i.room.id)).toEqual(['room_0', 'room_1', 'room_7'])
  })

  it('labels the same crew the same way whatever order the names were typed', () => {
    expect(groupKeyFor('crew', rooms[3], reviews[3], crew)).toBe(groupKeyFor('crew', rooms[4], reviews[4], crew))
  })

  it('rooms without a review are Solo', () => {
    expect(groupKeyFor('crew', rooms[0], undefined, crew)).toBe(SOLO_LABEL)
  })

  it('a friend and an unclaimed guest with the same name share one group', () => {
    const mia = user('usr_mia', 'Mia')
    // Visits 0 and 1 come from /api/logs with Mia's account; visit 7 still has the guest name.
    const rows = [logRow('vis_0', 'room_0', [friend(mia)]), logRow('vis_1', 'room_1', [friend(mia)])]
    const idx = buildCrewIndex(reviews, rows)
    expect(idx.vis_0[0].key).toBe('u:usr_mia')
    expect(idx.vis_7[0].key).toBe('g:mia')
    const groups = groupRooms(rooms, reviews, 'crew', idx)
    const withMia = groups.filter((g) => g.key === 'With Mia')
    expect(withMia).toHaveLength(1)
    expect(withMia[0].items.map((i) => i.room.id)).toEqual(['room_0', 'room_1', 'room_7'])
  })

  it('lays out without overlaps and publishes crew groups', () => {
    const layout = layoutBoard(rooms, reviews, 'crew', W, H, crew)
    expect(layout.sort).toBe('crew')
    expect(layout.slots).toHaveLength(rooms.length)
    expect(new Set(layout.slots.map((s) => s.group))).toEqual(new Set(['With Mia', 'With Mia & Bob', 'With Sam', SOLO_LABEL]))
    const boxes = layout.slots.map(slotBounds)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        expect(a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minY < b.maxY - 1e-6 && b.minY < a.maxY - 1e-6).toBe(false)
      }
  })

  it('without a crew index every room is Solo (nothing crashes)', () => {
    const layout = layoutBoard(rooms, reviews, 'crew', W, H)
    expect(new Set(layout.slots.map((s) => s.group))).toEqual(new Set([SOLO_LABEL]))
  })

  it('an empty room lays out to nothing for every sort', () => {
    for (const sort of ['city', 'crew'] as const) expect(layoutBoard([], [], sort, W, H, {})).toMatchObject({ groups: [], slots: [] })
  })
})

describe('sticker slots', () => {
  it('none for a solo visit', () => {
    expect(stickerSlots(0)).toEqual([])
  })

  it('one per teammate up to the limit, inside the polaroid', () => {
    for (let n = 1; n <= MAX_STICKERS; n++) {
      const slots = stickerSlots(n, 'seed')
      expect(slots).toHaveLength(n)
      expect(slots.map((s) => s.index)).toEqual([...Array(n).keys()])
      for (const s of slots) {
        expect(s.x - s.r - 3).toBeGreaterThanOrEqual(0)
        expect(s.x + s.r + 3).toBeLessThanOrEqual(POLAROID_W)
        expect(s.y + s.r + 4).toBeLessThanOrEqual(POLAROID_H)
        expect(s.r).toBe(STICKER_R)
      }
    }
  })

  it('a bigger crew shows the first three and a "+N" sticker', () => {
    const slots = stickerSlots(7, 'x')
    expect(slots).toHaveLength(MAX_STICKERS)
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2, -1])
    expect(slots[3].more).toBe(4)
  })

  it('is deterministic per seed', () => {
    expect(stickerSlots(3, 'a')).toEqual(stickerSlots(3, 'a'))
  })
})

describe('avatar loading', () => {
  afterEach(() => clearAvatarCache())

  class FakeImage {
    crossOrigin = ''
    decoding = ''
    referrerPolicy = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 96
    private _src = ''
    static made = 0
    constructor() {
      FakeImage.made++
    }
    set src(v: string) {
      this._src = v
      queueMicrotask(() => (v.includes('broken') ? this.onerror?.() : this.onload?.()))
    }
    get src() {
      return this._src
    }
  }
  const make = () => new FakeImage() as unknown as HTMLImageElement

  it('loads with CORS and no referrer, once per URL', async () => {
    FakeImage.made = 0
    const a = await loadAvatar('https://x/a', make)
    const b = await loadAvatar('https://x/a', make)
    expect(a).toBe(b)
    expect(FakeImage.made).toBe(1)
    expect(a?.crossOrigin).toBe('anonymous')
    expect(a?.referrerPolicy).toBe('no-referrer')
  })

  it('drops pictures that fail so the sticker keeps its initials', async () => {
    const m = await loadAvatars(['https://x/ok', 'https://x/broken', 'https://x/ok'], make)
    expect([...m.keys()]).toEqual(['https://x/ok'])
  })
})
