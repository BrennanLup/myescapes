import { describe, expect, it } from 'vitest'
import type { AABB } from '@/contracts/colliders'
import { boxFromCenter } from '@/contracts/colliders'
import { HALF_D, HALF_W, PLAYER, ROOM } from '@/contracts/scene'
import {
  applyLook,
  COLLISION_RADIUS,
  forwardVector,
  headBobOffset,
  MAX_PITCH,
  resolveCollisions,
  speedOf,
  stepMovement,
  type Bounds,
  type MoveInput,
  type MoveState,
} from './movement'

const T = ROOM.wallThickness
/** The four room walls as the room shell would register them (outside the interior). */
const WALLS: AABB[] = [
  { id: 'wall:north', min: [-HALF_W - T, 0, -HALF_D - T], max: [HALF_W + T, ROOM.height, -HALF_D] },
  { id: 'wall:south', min: [-HALF_W - T, 0, HALF_D], max: [HALF_W + T, ROOM.height, HALF_D + T] },
  { id: 'wall:west', min: [-HALF_W - T, 0, -HALF_D - T], max: [-HALF_W, ROOM.height, HALF_D + T] },
  { id: 'wall:east', min: [HALF_W, 0, -HALF_D - T], max: [HALF_W + T, ROOM.height, HALF_D + T] },
]

const state = (x = 0, z = 0, yaw = 0): MoveState => ({ pos: [x, z], vel: [0, 0], yaw, pitch: 0, bobPhase: 0 })
const fwd: MoveInput = { forward: 1, strafe: 0, run: false }

function walk(s: MoveState, input: MoveInput, seconds: number, boxes: AABB[], dt = 1 / 60, bounds?: Bounds) {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) s = stepMovement(s, input, dt, { boxes, bounds })
  return s
}

const NO_BOUNDS = { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 }

describe('directions', () => {
  it('yaw 0 looks -Z, yaw PI/2 looks -X', () => {
    const a = forwardVector(0)
    expect(a[0]).toBeCloseTo(0)
    expect(a[1]).toBeCloseTo(-1)
    const b = forwardVector(Math.PI / 2)
    expect(b[0]).toBeCloseTo(-1)
    expect(b[1]).toBeCloseTo(0)
  })
  it('strafe right at yaw 0 moves +X', () => {
    const s = walk(state(), { forward: 0, strafe: 1, run: false }, 0.5, [])
    expect(s.pos[0]).toBeGreaterThan(0.5)
    expect(Math.abs(s.pos[1])).toBeLessThan(1e-6)
  })
})

describe('resolveCollisions', () => {
  const box = boxFromCenter('b', [0, 1, 0], [2, 2, 2])
  it('pushes a circle out of a box face', () => {
    const p = resolveCollisions([1.1, 0], 0.35, [box], null)
    expect(p[0]).toBeCloseTo(1.35, 4)
    expect(p[1]).toBeCloseTo(0)
  })
  it('pushes out from a centre that ended up inside the box', () => {
    const p = resolveCollisions([0.9, 0.1], 0.35, [box], null)
    expect(p[0]).toBeGreaterThanOrEqual(1.35)
  })
  it('ignores boxes outside the body height band', () => {
    const rug = boxFromCenter('rug', [0, 0.02, 0], [2, 0.04, 2])
    const shelf = boxFromCenter('shelf', [0, 3, 0], [2, 0.2, 2])
    expect(resolveCollisions([0.5, 0.5], 0.35, [rug, shelf], null)).toEqual([0.5, 0.5])
  })
  it('clamps inside the room bounds', () => {
    const p = resolveCollisions([50, -50], 0.35, [])
    expect(p[0]).toBeCloseTo(HALF_W - 0.35)
    expect(p[1]).toBeCloseTo(-HALF_D + 0.35)
  })
})

describe('stepMovement', () => {
  it('accelerates smoothly and reaches walk speed', () => {
    const s1 = stepMovement(state(), fwd, 1 / 60)
    expect(speedOf(s1)).toBeGreaterThan(0)
    expect(speedOf(s1)).toBeLessThan(PLAYER.walkSpeed * 0.5)
    const s2 = walk(state(), fwd, 1, [])
    expect(speedOf(s2)).toBeCloseTo(PLAYER.walkSpeed, 1)
    const run = walk(state(), { ...fwd, run: true }, 1, [])
    expect(speedOf(run)).toBeCloseTo(PLAYER.runSpeed, 1)
  })
  it('decelerates to a stop', () => {
    let s = walk(state(), fwd, 1, [])
    s = walk(s, { forward: 0, strafe: 0, run: false }, 1, [])
    expect(speedOf(s)).toBe(0)
  })
  it('is frame-rate independent', () => {
    const a = walk(state(), fwd, 1, [], 1 / 30)
    const b = walk(state(), fwd, 1, [], 1 / 144)
    expect(Math.abs(a.pos[1] - b.pos[1])).toBeLessThan(0.08)
  })
  it('diagonal input is not faster', () => {
    const s = walk(state(), { forward: 1, strafe: 1, run: false }, 1, [])
    expect(speedOf(s)).toBeLessThanOrEqual(PLAYER.walkSpeed + 1e-6)
  })
})

describe('walls', () => {
  it('cannot pass through any wall, even at run speed with long frames', () => {
    const run = { forward: 1, strafe: 0, run: true }
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, 2.4]) {
      for (const dt of [1 / 60, 1 / 10, 0.5]) {
        const s = walk(state(0, 0, yaw), run, 8, WALLS, dt, NO_BOUNDS)
        expect(s.pos[0]).toBeGreaterThanOrEqual(-HALF_W + COLLISION_RADIUS - 1e-3)
        expect(s.pos[0]).toBeLessThanOrEqual(HALF_W - COLLISION_RADIUS + 1e-3)
        expect(s.pos[1]).toBeGreaterThanOrEqual(-HALF_D + COLLISION_RADIUS - 1e-3)
        expect(s.pos[1]).toBeLessThanOrEqual(HALF_D - COLLISION_RADIUS + 1e-3)
      }
    }
  })
  it('cannot pass through a thin interior wall', () => {
    const thin = boxFromCenter('thin', [0, 1, -2], [6, 2, 0.05])
    const s = walk(state(0, 0, 0), { forward: 1, strafe: 0, run: true }, 3, [thin], 1 / 10, NO_BOUNDS)
    expect(s.pos[1]).toBeGreaterThan(-2)
  })
  it('slides along a wall when walking into it at an angle', () => {
    // Facing north-west into the north wall: should keep moving west along it.
    let s = state(0, -HALF_D + 1, Math.PI / 4)
    s = walk(s, fwd, 1, WALLS, 1 / 60, NO_BOUNDS)
    const x0 = s.pos[0]
    expect(s.pos[1]).toBeCloseTo(-HALF_D + COLLISION_RADIUS, 2)
    s = walk(s, fwd, 1, WALLS, 1 / 60, NO_BOUNDS)
    expect(s.pos[0]).toBeLessThan(x0 - 1.2)
    expect(s.pos[1]).toBeCloseTo(-HALF_D + COLLISION_RADIUS, 2)
  })
  it('slides around furniture instead of sticking', () => {
    const crate = boxFromCenter('crate', [0, 0.5, -3], [1, 1, 1])
    // Clipping the crate's corner deflects the player sideways past it.
    let s = state(0.75, 0, 0)
    s = walk(s, fwd, 3, [crate])
    expect(s.pos[1]).toBeLessThan(-4) // got past it
    expect(s.pos[0]).toBeGreaterThan(0.75)
  })
  it('stays inside the room bounds with no colliders at all', () => {
    for (const yaw of [0, 1, 2, 3, -1, -2]) {
      const s = walk(state(0, 0, yaw), { forward: 1, strafe: 0, run: true }, 6, [])
      expect(Math.abs(s.pos[0])).toBeLessThanOrEqual(HALF_W - COLLISION_RADIUS + 1e-9)
      expect(Math.abs(s.pos[1])).toBeLessThanOrEqual(HALF_D - COLLISION_RADIUS + 1e-9)
    }
  })
  it('can walk at least 10 steps (7.5 m) in every direction from the centre', () => {
    const need = 10 * PLAYER.stepLength
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2
      const s = walk(state(0, 0, yaw), fwd, 4, WALLS)
      expect(Math.hypot(s.pos[0], s.pos[1])).toBeGreaterThanOrEqual(need)
    }
  })
})

describe('look', () => {
  it('turns right on positive dx and looks up on negative dy', () => {
    const r = applyLook(0, 0, 100, -100, 0.002)
    expect(r.yaw).toBeLessThan(0)
    expect(r.pitch).toBeGreaterThan(0)
  })
  it('invertY flips pitch and sensitivity scales', () => {
    const a = applyLook(0, 0, 0, -100, 0.002, 1, true)
    expect(a.pitch).toBeLessThan(0)
    const b = applyLook(0, 0, 10, 0, 0.002, 2)
    expect(b.yaw).toBeCloseTo(-0.04)
  })
  it('clamps pitch to about 85 degrees', () => {
    expect(applyLook(0, 0, 0, -1e6, 0.002).pitch).toBeCloseTo(MAX_PITCH)
    expect(applyLook(0, 0, 0, 1e6, 0.002).pitch).toBeCloseTo(-MAX_PITCH)
    expect(MAX_PITCH).toBeCloseTo((85 * Math.PI) / 180)
  })
})

describe('head bob', () => {
  it('is zero when standing still', () => {
    expect(headBobOffset(1.2, 0)).toBe(0)
  })
  it('advances phase while walking', () => {
    const s = walk(state(), fwd, 1, [])
    expect(s.bobPhase).toBeGreaterThan(0)
  })
})
