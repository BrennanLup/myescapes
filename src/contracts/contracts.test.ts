import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from './events'
import { anchorToWorld, ANCHORS, HALF_D, HALF_W, PLAYER } from './scene'
import { ReviewDraftSchema, RoomSchema } from './types'

describe('event bus', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const bus = createEventBus()
    const fn = vi.fn()
    const off = bus.on('review:open', fn)
    bus.emit('review:open', { roomId: 'r1' })
    off()
    bus.emit('review:open', { roomId: 'r2' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ roomId: 'r1' })
  })
})

describe('scene', () => {
  it('room allows 10+ steps from spawn-ish centre in every direction', () => {
    const steps = (d: number) => (d - PLAYER.radius) / PLAYER.stepLength
    expect(steps(HALF_W)).toBeGreaterThanOrEqual(10)
    expect(steps(HALF_D)).toBeGreaterThanOrEqual(10)
  })
  it('anchorToWorld maps local +Z into the room', () => {
    const p = anchorToWorld('wishlistBoard', [0, 0, 1])
    expect(p[0]).toBeCloseTo(ANCHORS.wishlistBoard.position[0] - 1)
    const q = anchorToWorld('desk', [0, 0, 1])
    expect(q[0]).toBeCloseTo(ANCHORS.desk.position[0] + 1)
  })
})

describe('schemas', () => {
  it('room defaults', () => {
    const r = RoomSchema.parse({ id: 'a', name: 'n', company: 'c', city: 'x', genre: 'horror' })
    expect(r.photos).toEqual([])
  })
  it('draft accepts nulls', () => {
    const e = { score: null, comment: '' }
    const ok = ReviewDraftSchema.safeParse({
      room: { name: null, company: null, city: null, genre: null, address: null, website: null },
      review: { date: null, ratings: { overall: e, puzzles: e, setting: e, storyline: e, difficulty: e }, escaped: null,
        escapeTimeMinutes: null, visibleTimer: null, multiRoom: null, flashlights: null, liveActors: null },
      mode: 'mock',
    })
    expect(ok.success).toBe(true)
  })
})
