import { describe, expect, it } from 'vitest'
import { computeLinks, MAX_LINKS } from './links'
import { MAX_DROP, sagCurve, sagDrop } from './sag'
import { TAUT, TIMING, drawProgress, fadeAlpha, retractProgress, staggerDelay, twangFactor } from './timing'
import { StringGeometry, INDICES_PER_LINK } from './geometry'
import { StringController } from './controller'
import type { BoardPin } from '@/state/store'

const pin = (roomId: string, group: string, order: number, x = order, y = 2): BoardPin => ({ roomId, group, order, target: [x, y, -7.9] })

describe('computeLinks', () => {
  it('chains pins within a group in order and never links across groups', () => {
    const pins = [pin('c', 'A', 2), pin('a', 'A', 0), pin('x', 'B', 1), pin('b', 'A', 4), pin('y', 'B', 3)]
    const links = computeLinks(pins, { timeline: false })
    expect(links.map((l) => [l.a, l.b])).toEqual([
      ['a', 'c'],
      ['c', 'b'],
      ['x', 'y'],
    ])
    const groupOf = new Map(pins.map((p) => [p.roomId, p.group]))
    for (const l of links) expect(groupOf.get(l.a)).toBe(groupOf.get(l.b))
    expect(links.map((l) => l.index)).toEqual([0, 1, 2])
  })

  it('adds a timeline thread between the first pins of consecutive groups', () => {
    const pins = [pin('a', 'A', 0), pin('b', 'A', 1), pin('x', 'B', 2), pin('z', 'C', 3)]
    const links = computeLinks(pins)
    const tl = links.filter((l) => l.kind === 'timeline').map((l) => [l.a, l.b])
    expect(tl).toEqual([
      ['a', 'x'],
      ['x', 'z'],
    ])
    expect(links.filter((l) => l.kind === 'group')).toHaveLength(1)
  })

  it('handles empty, single, duplicate and large inputs', () => {
    expect(computeLinks([])).toEqual([])
    expect(computeLinks([pin('a', 'A', 0)])).toEqual([])
    expect(computeLinks([pin('a', 'A', 0), pin('a', 'A', 1)])).toEqual([])
    const many = Array.from({ length: 200 }, (_, i) => pin(`r${i}`, `g${i % 7}`, i))
    const links = computeLinks(many)
    expect(links.length).toBeLessThanOrEqual(MAX_LINKS)
    expect(links.filter((l) => l.kind === 'group')).toHaveLength(200 - 7)
    expect(new Set(links.map((l) => l.key)).size).toBe(links.length)
  })
})

describe('sag curve', () => {
  it('keeps endpoints exact and hangs lowest in the middle', () => {
    const a = [-1, 2, -7.9]
    const b = [1, 2.4, -7.9]
    const drop = sagDrop(Math.hypot(2, 0.4))
    const pts = sagCurve(a, b, 11, drop)
    expect(pts[0]).toEqual(a)
    expect(pts[10][0]).toBeCloseTo(1, 12)
    expect(pts[10][1]).toBeCloseTo(2.4, 12)
    expect(pts[5][1]).toBeCloseTo((2 + 2.4) / 2 - drop, 12)
    expect(pts[5][1]).toBeLessThan(2.2)
    for (const p of pts) expect(p[2]).toBeCloseTo(-7.9, 12)
  })

  it('sags proportionally to length, capped', () => {
    expect(sagDrop(0)).toBe(0)
    expect(sagDrop(1)).toBeGreaterThan(sagDrop(0.5))
    expect(sagDrop(100)).toBe(MAX_DROP)
    expect(sagDrop(1, 0.5)).toBeCloseTo(sagDrop(1) / 2)
  })
})

describe('animation timing', () => {
  it('staggers the draw so every string finishes within the window', () => {
    const n = 12
    expect(staggerDelay(0, n)).toBe(0)
    expect(staggerDelay(n - 1, n) + TIMING.segment).toBeCloseTo(TIMING.drawTotal)
    for (let i = 1; i < n; i++) expect(staggerDelay(i, n)).toBeGreaterThan(staggerDelay(i - 1, n))
    expect(drawProgress(0, 0, n)).toBe(0)
    expect(drawProgress(TIMING.drawTotal, n - 1, n)).toBe(1)
    expect(drawProgress(0.1, 5, n)).toBe(0)
    const total = TIMING.drawDelay + TIMING.drawTotal
    expect(total).toBeGreaterThanOrEqual(1)
    expect(total).toBeLessThanOrEqual(1.5)
  })

  it('retracts and fades from 1 to 0 over the retract window', () => {
    expect(retractProgress(0)).toBe(1)
    expect(retractProgress(TIMING.retract)).toBe(0)
    expect(retractProgress(TIMING.retract / 3)).toBeGreaterThan(retractProgress(TIMING.retract / 2))
    expect(fadeAlpha(0)).toBe(1)
    expect(fadeAlpha(TIMING.retract)).toBe(0)
  })

  it('twangs: starts taut, overshoots, settles to full sag', () => {
    expect(twangFactor(0)).toBe(TAUT)
    const samples = Array.from({ length: 60 }, (_, i) => twangFactor(i / 60))
    expect(Math.max(...samples)).toBeGreaterThan(1.05)
    expect(twangFactor(2)).toBeCloseTo(1, 3)
  })
})

describe('StringController', () => {
  const setup = () => {
    const live = new StringGeometry(MAX_LINKS)
    const old = new StringGeometry(MAX_LINKS)
    let sfx = 0
    const c = new StringController(live, old, 'city', { emitSfx: () => sfx++ })
    return { c, live, old, sfx: () => sfx }
  }
  const empty = new Map<string, [number, number, number]>()

  it('draws, then on re-sort unties the old strings and ties the new ones with one sfx', () => {
    const { c, live, old, sfx } = setup()
    c.setPins([pin('a', 'A', 0), pin('b', 'A', 1), pin('c', 'A', 2)], 'city', 0)
    c.update(0, empty, 0.004)
    expect(sfx()).toBe(1)
    c.update(5, empty, 0.004)
    expect(live.geometry.drawRange.count).toBe(2 * INDICES_PER_LINK)

    c.sortChanged('genre', 10)
    c.setPins([pin('a', 'X', 0), pin('c', 'X', 1), pin('b', 'Y', 2)], 'genre', 10.01)
    c.update(10.1, empty, 0.004)
    expect(old.geometry.drawRange.count).toBe(2 * INDICES_PER_LINK)
    expect(live.geometry.drawRange.count).toBe(0)
    expect(sfx()).toBe(1)
    c.update(10 + TIMING.drawDelay + 0.05, empty, 0.004)
    expect(sfx()).toBe(2)
    c.update(12, empty, 0.004)
    expect(old.geometry.drawRange.count).toBe(0)
    expect(c.liveCount).toBe(2) // a-c group link + a-b timeline
    expect(live.geometry.drawRange.count).toBe(2 * INDICES_PER_LINK)
  })

  it('waits for a freshly saved pin to land before drawing its string', () => {
    const { c, live } = setup()
    c.setPins([pin('a', 'A', 0), pin('b', 'A', 1)], 'city', 0)
    c.update(5, empty, 0.004)
    c.markFresh('n')
    c.setPins([pin('a', 'A', 0), pin('b', 'A', 1), pin('n', 'A', 2, 3)], 'city', 6)
    const flying = new Map<string, [number, number, number]>([['n', [0, 0, -5]]])
    c.update(7, flying, 0.004)
    expect(live.geometry.drawRange.count).toBe(1 * INDICES_PER_LINK)
    flying.set('n', [3, 2, -7.9])
    c.update(7.5, flying, 0.004)
    c.update(8.5, flying, 0.004)
    expect(live.geometry.drawRange.count).toBe(2 * INDICES_PER_LINK)
  })

  it('redraws the current layout if the board publishes nothing after a re-sort', () => {
    const { c } = setup()
    c.setPins([pin('a', 'A', 0), pin('b', 'A', 1)], 'city', 0)
    c.update(3, empty, 0.004)
    c.sortChanged('rating', 4)
    c.update(4.1, empty, 0.004)
    expect(c.liveCount).toBe(0)
    c.update(4 + TIMING.pinsTimeout + 0.1, empty, 0.004)
    expect(c.liveCount).toBe(1)
  })
})
