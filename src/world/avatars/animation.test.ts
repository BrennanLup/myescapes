import { describe, expect, it } from 'vitest'
import { PLAYER } from '@/contracts/scene'
import { advancePhase, CHARACTER_ACTIONS, locomotionAction, poseAt, STRIDE, walkAmount } from './animation'

describe('walk cycle', () => {
  it('advances one full cycle per stride walked, independent of frame rate', () => {
    let a = 0
    for (let i = 0; i < 60; i++) a = advancePhase(a, STRIDE / 2, 1 / 60)
    let b = 0
    for (let i = 0; i < 20; i++) b = advancePhase(b, STRIDE / 2, 1 / 20)
    expect(a).toBeCloseTo(Math.PI, 5)
    expect(b).toBeCloseTo(Math.PI, 5)
    expect(advancePhase(1, 0, 1)).toBe(1)
    expect(advancePhase(1, -5, 1)).toBe(1)
  })

  it('walkAmount scales with speed and is capped', () => {
    expect(walkAmount(0)).toBe(0)
    expect(walkAmount(PLAYER.walkSpeed)).toBe(1)
    expect(walkAmount(100)).toBe(1.5)
  })

  it('standing still barely moves the legs; walking swings them in opposition', () => {
    const still = poseAt({ time: 1, phase: Math.PI / 2, speed: 0 })
    expect(Math.abs(still.hipL)).toBeLessThan(1e-9)
    const walk = poseAt({ time: 1, phase: Math.PI / 2, speed: PLAYER.walkSpeed })
    expect(walk.hipL).toBeGreaterThan(0.4)
    expect(walk.hipR).toBeCloseTo(-walk.hipL)
    // Arms swing opposite to the leg on the same side.
    expect(Math.sign(walk.shoulderL)).toBe(-Math.sign(walk.hipL))
    expect(walk.lean).toBeGreaterThan(0)
  })

  it('every action gives finite numbers', () => {
    for (const action of CHARACTER_ACTIONS) {
      for (const speed of [0, 2, 6]) {
        const p = poseAt({ time: 3.3, phase: 1.1, speed, action, lookPitch: 0.5 })
        for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })

  it('emotes raise the arms', () => {
    expect(poseAt({ time: 0, phase: 0, speed: 0, action: 'wave' }).armOutR).toBeGreaterThan(2)
    const cheer = poseAt({ time: 0.2, phase: 0, speed: 0, action: 'cheer' })
    expect(cheer.armOutL).toBeGreaterThan(2)
    expect(cheer.armOutR).toBeGreaterThan(2)
  })

  it('the head follows the look pitch, within limits', () => {
    expect(poseAt({ time: 0, phase: 0, speed: 0, lookPitch: -1.4 }).headPitch).toBeLessThanOrEqual(0.4)
    expect(poseAt({ time: 0, phase: 0, speed: 0, lookPitch: 1.4 }).headPitch).toBeGreaterThanOrEqual(-0.35)
  })

  it('locomotionAction', () => {
    expect(locomotionAction(0)).toBe('idle')
    expect(locomotionAction(2)).toBe('walk')
  })
})
