import { describe, expect, it } from 'vitest'
import type { PlayerState } from '@/contracts/realtime'
import { GAP_MS, INTERP_DELAY_MS, lerpAngle, MAX_EXTRAPOLATE_MS, MAX_SNAPSHOTS, PoseBuffer, wrapAngle } from './interpolation'

const st = (x: number, z = 0, yaw = 0, extra: Partial<PlayerState> = {}): PlayerState => ({ p: [x, 0, z], yaw, pitch: 0, cam: 'first', anim: 'walk', v: 1.4, ...extra })

describe('angles', () => {
  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(0)).toBe(0)
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI)
  })

  it('takes the short way round', () => {
    // From just below +PI to just above -PI is a small step, not almost a full turn.
    const a = Math.PI - 0.1
    const b = -Math.PI + 0.1
    const mid = lerpAngle(a, b, 0.5)
    expect(wrapAngle(mid)).toBeCloseTo(Math.PI)
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25)
    expect(lerpAngle(0, 2 * Math.PI + 0.4, 0.5)).toBeCloseTo(0.2)
  })
})

describe('PoseBuffer', () => {
  it('is empty until a pose arrives', () => {
    expect(new PoseBuffer().sample(1000)).toBeNull()
  })

  it('lerps position and slerps yaw between two poses', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0, 0, Math.PI - 0.2))
    b.push(1100, st(1, 2, -Math.PI + 0.2))
    const s = b.sample(1050)!
    expect(s.p[0]).toBeCloseTo(0.5)
    expect(s.p[2]).toBeCloseTo(1)
    expect(Math.abs(wrapAngle(s.yaw))).toBeCloseTo(Math.PI)
    expect(s.anim).toBe('walk')
  })

  it('holds the first pose before it and drops old segments as time moves on', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0))
    b.push(1100, st(1))
    b.push(1200, st(2))
    expect(b.sample(900)!.p[0]).toBe(0)
    expect(b.sample(1150)!.p[0]).toBeCloseTo(1.5)
    expect(b.size).toBe(2)
  })

  it('ignores out-of-order poses and lets the newest message win on equal stamps', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0))
    b.push(1100, st(1))
    b.push(1050, st(9))
    expect(b.size).toBe(2)
    b.push(1100, st(1.5))
    expect(b.latest()!.s.p[0]).toBe(1.5)
  })

  it('snaps on a teleport instead of sliding across the room', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0))
    b.push(1100, st(8))
    expect(b.size).toBe(1)
    expect(b.sample(1050)!.p[0]).toBe(8)
  })

  it('anchors a pose that follows a pause, so the walk starts when it really did', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0, 0, 0, { anim: 'idle', v: 0 }))
    // Stood still for 5 s, then took a step.
    b.push(6000, st(0.14))
    // Halfway through the pause the player is still where they stood.
    expect(b.sample(3500)!.p[0]).toBe(0)
    expect(b.sample(6000 - 100)!.p[0]).toBe(0)
    expect(b.sample(5950)!.p[0]).toBeCloseTo(0.07)
  })

  it('extrapolates briefly past the newest pose while moving, then holds', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0))
    b.push(1100, st(0.14))
    const ahead = b.sample(1150)!
    expect(ahead.p[0]).toBeCloseTo(0.21)
    const far = b.sample(1100 + MAX_EXTRAPOLATE_MS * 4)!
    expect(far.p[0]).toBeCloseTo(0.14 + 0.14 * (MAX_EXTRAPOLATE_MS / 100))
  })

  it('does not extrapolate a player who stopped', () => {
    const b = new PoseBuffer()
    b.push(1000, st(0))
    b.push(1100, st(0.1, 0, 0, { v: 0, anim: 'idle' }))
    expect(b.sample(1300)!.p[0]).toBeCloseTo(0.1)
  })

  it('keeps a bounded history', () => {
    const b = new PoseBuffer()
    for (let i = 0; i < MAX_SNAPSHOTS * 3; i++) b.push(1000 + i * 100, st(i * 0.01))
    expect(b.size).toBe(MAX_SNAPSHOTS)
  })

  it('moves smoothly at a steady 10 Hz with the render delay', () => {
    const b = new PoseBuffer()
    // Walking at 1.4 m/s, a pose every 100 ms.
    for (let i = 0; i <= 10; i++) b.push(i * 100, st(i * 0.14))
    let prev = -Infinity
    for (let t = 200; t <= 1000; t += 16) {
      const x = b.sample(t - INTERP_DELAY_MS)!.p[0]
      expect(x).toBeGreaterThanOrEqual(prev)
      prev = x
    }
    expect(GAP_MS).toBeGreaterThan(100)
  })
})
