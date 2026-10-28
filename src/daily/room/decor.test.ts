import { describe, expect, it } from 'vitest'
import { PLAYER } from '@/contracts/scene'
import { clockHands, DECOR, decorColliders, festoonPoints, runElapsed } from './Decor'
import { furnitureColliders } from './Furniture'
import { DR, SPAWN } from './layout'
import { HIDING_SPOTS } from './search'

describe('puzzle room dressing', () => {
  it('the clock runs with your time and stops when you finish', () => {
    expect(runElapsed(null, 5000)).toBe(0)
    expect(runElapsed({ startedAt: null, finishedAt: null }, 5000)).toBe(0)
    expect(runElapsed({ startedAt: 1000, finishedAt: null }, 31_000)).toBe(30_000)
    expect(runElapsed({ startedAt: 1000, finishedAt: 61_000 }, 999_999)).toBe(60_000)
    expect(clockHands(0)).toEqual({ seconds: 0, minutes: 0 })
    expect(clockHands(15_000).seconds).toBeCloseTo(Math.PI / 2)
    // Half past one minute: the seconds hand points down, the minutes hand just past "1".
    const h = clockHands(90_000)
    expect(h.seconds).toBeCloseTo(Math.PI)
    expect(h.minutes).toBeCloseTo((1.5 / 60) * Math.PI * 2)
  })

  it('bulb strings sag between hooks and stay under the ceiling, clear of heads', () => {
    const { cord, bulbs } = festoonPoints([-3, DECOR.bulbTop, 4.9], [3, DECOR.bulbTop, 4.9], 6)
    expect(bulbs).toHaveLength(6)
    expect(cord[0]).toEqual([-3, DECOR.bulbTop, 4.9])
    expect(cord[cord.length - 1][0]).toBeCloseTo(3)
    for (const p of [...cord, ...bulbs]) {
      expect(p[1]).toBeLessThan(DR.height)
      expect(p[1]).toBeGreaterThan(PLAYER.eyeHeight + 0.8)
    }
  })

  it('wall pieces are on the walls and the coat rack keeps clear of the hiding spots and the spawn', () => {
    expect(DECOR.clock.position[2]).toBeGreaterThan(DR.maxZ - 0.1)
    expect(DECOR.shelf.position[2] + DECOR.shelf.depth / 2).toBeLessThanOrEqual(DR.maxZ)
    expect(DECOR.keyCabinet[0]).toBeGreaterThan(DR.maxX - 0.1)
    const [rack] = decorColliders()
    expect(furnitureColliders().map((b) => b.id)).toContain(rack.id)
    for (const s of HIDING_SPOTS) {
      const inside = s.position[0] > rack.min[0] - 0.3 && s.position[0] < rack.max[0] + 0.3 && s.position[2] > rack.min[2] - 0.3 && s.position[2] < rack.max[2] + 0.3
      expect(inside, s.id).toBe(false)
    }
    expect(Math.hypot(SPAWN.position[0] - DECOR.coatRack[0], SPAWN.position[2] - DECOR.coatRack[2])).toBeGreaterThan(2)
  })
})
