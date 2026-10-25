/**
 * Pure, frame-rate independent movement, look and collision maths for the
 * first-person player. No three.js or React here so it is easy to unit test.
 *
 * Conventions (see src/contracts/scene.ts): Y up, yaw 0 looks towards -Z,
 * positive yaw turns left (towards -X), positive pitch looks up.
 */
import type { AABB } from '@/contracts/colliders'
import { HALF_D, HALF_W, PLAYER } from '@/contracts/scene'

/** Horizontal point on the floor plane: [x, z]. */
export type Vec2 = [number, number]

/** The player's body overlaps colliders whose Y range intersects this band. */
export const BODY_Y_MIN = 0.1
export const BODY_Y_MAX = 1.8

/** Never smaller than this so the camera near plane can't poke into walls. */
export const MIN_RADIUS = 0.3
export const COLLISION_RADIUS = Math.max(PLAYER.radius, MIN_RADIUS)

/** Pitch is clamped to +-85 degrees. */
export const MAX_PITCH = (85 * Math.PI) / 180

/** Radians per pixel at sensitivity 1. */
export const MOUSE_LOOK_RAD_PER_PX = 0.0022
export const TOUCH_LOOK_RAD_PER_PX = 0.0045

/** Exponential smoothing rates (1/s) for speeding up and slowing down. */
export const ACCEL_RATE = 11
export const DECEL_RATE = 9

/** Largest sub-step (seconds). Keeps per-step travel well under the radius (no tunnelling). */
export const MAX_SUBSTEP = 1 / 60
/** Frames longer than this are treated as this long (tab switches, hitches). */
export const MAX_FRAME_DT = 0.25

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Room interior. */
export const ROOM_BOUNDS: Bounds = { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }

export interface MoveState {
  /** Floor-plane position [x, z]. */
  pos: Vec2
  /** Horizontal velocity [vx, vz] in m/s. */
  vel: Vec2
  yaw: number
  pitch: number
  /** Head-bob phase in radians (advances with distance walked). */
  bobPhase: number
}

export interface MoveInput {
  /** -1..1, positive = forward (where the camera looks). */
  forward: number
  /** -1..1, positive = strafe right. */
  strafe: number
  run: boolean
}

export interface MoveOptions {
  boxes?: readonly AABB[]
  radius?: number
  bounds?: Bounds
  walkSpeed?: number
  runSpeed?: number
}

export const NO_INPUT: MoveInput = { forward: 0, strafe: 0, run: false }

/** Unit forward vector on the floor plane for a yaw. */
export function forwardVector(yaw: number): Vec2 {
  return [-Math.sin(yaw), -Math.cos(yaw)]
}

/** Unit right vector on the floor plane for a yaw. */
export function rightVector(yaw: number): Vec2 {
  return [Math.cos(yaw), -Math.sin(yaw)]
}

export function clampPitch(p: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p))
}

/** Apply a look delta (pixels) to yaw/pitch. Dragging/mousing right turns right, up looks up. */
export function applyLook(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  radPerPx: number,
  sensitivity = 1,
  invertY = false,
): { yaw: number; pitch: number } {
  const k = radPerPx * sensitivity
  let y = yaw - dx * k
  // keep yaw in (-PI, PI] so numbers stay small
  if (y > Math.PI || y <= -Math.PI) y = Math.atan2(Math.sin(y), Math.cos(y))
  const p = clampPitch(pitch + (invertY ? dy : -dy) * k)
  return { yaw: y, pitch: p }
}

/** Boxes that intersect the player's body height. */
export function relevantBoxes(boxes: readonly AABB[]): AABB[] {
  return boxes.filter((b) => b.max[1] > BODY_Y_MIN && b.min[1] < BODY_Y_MAX)
}

/**
 * Push a circle out of every AABB (XZ plane) it overlaps, iterating so corners
 * and neighbouring boxes resolve too, then hard-clamp inside the bounds.
 * Pushing out along the contact normal makes the player slide along surfaces.
 * Boxes should already be filtered by height (see relevantBoxes); unfiltered
 * boxes are filtered here as well.
 */
export function resolveCollisions(
  pos: Vec2,
  radius: number,
  boxes: readonly AABB[],
  bounds: Bounds | null = ROOM_BOUNDS,
  iterations = 4,
): Vec2 {
  let x = pos[0]
  let z = pos[1]
  for (let it = 0; it < iterations; it++) {
    let moved = false
    for (const b of boxes) {
      if (!(b.max[1] > BODY_Y_MIN && b.min[1] < BODY_Y_MAX)) continue
      const minX = b.min[0]
      const maxX = b.max[0]
      const minZ = b.min[2]
      const maxZ = b.max[2]
      // quick reject
      if (x + radius <= minX || x - radius >= maxX || z + radius <= minZ || z - radius >= maxZ) continue
      const cx = Math.max(minX, Math.min(x, maxX))
      const cz = Math.max(minZ, Math.min(z, maxZ))
      const dx = x - cx
      const dz = z - cz
      const d2 = dx * dx + dz * dz
      if (d2 > 1e-12) {
        if (d2 >= radius * radius) continue
        const d = Math.sqrt(d2)
        const push = radius - d + 1e-6
        x += (dx / d) * push
        z += (dz / d) * push
        moved = true
      } else {
        // Centre inside the box: leave along the shallowest face.
        const left = x - minX
        const right = maxX - x
        const back = z - minZ
        const front = maxZ - z
        const m = Math.min(left, right, back, front)
        if (m === left) x = minX - radius - 1e-6
        else if (m === right) x = maxX + radius + 1e-6
        else if (m === back) z = minZ - radius - 1e-6
        else z = maxZ + radius + 1e-6
        moved = true
      }
    }
    if (!moved) break
  }
  if (bounds) {
    x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, x))
    z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, z))
  }
  return [x, z]
}

/** Target horizontal velocity for an input at a yaw. */
export function targetVelocity(input: MoveInput, yaw: number, walkSpeed: number = PLAYER.walkSpeed, runSpeed: number = PLAYER.runSpeed): Vec2 {
  let f = input.forward
  let s = input.strafe
  const m = Math.hypot(f, s)
  if (m > 1) {
    f /= m
    s /= m
  }
  const speed = input.run ? runSpeed : walkSpeed
  const fw = forwardVector(yaw)
  const rt = rightVector(yaw)
  return [(fw[0] * f + rt[0] * s) * speed, (fw[1] * f + rt[1] * s) * speed]
}

/**
 * Advance the player by dt seconds: smooth acceleration towards the input's
 * target velocity, integrate, and resolve collisions. Long frames are split
 * into sub-steps so the result barely depends on the frame rate.
 */
export function stepMovement(state: MoveState, input: MoveInput, dt: number, opts: MoveOptions = {}): MoveState {
  const radius = Math.max(opts.radius ?? COLLISION_RADIUS, MIN_RADIUS)
  const bounds = opts.bounds ?? ROOM_BOUNDS
  const boxes = relevantBoxes(opts.boxes ?? [])
  const total = Math.max(0, Math.min(dt, MAX_FRAME_DT))
  const target = targetVelocity(input, state.yaw, opts.walkSpeed, opts.runSpeed)
  const accelerating = target[0] !== 0 || target[1] !== 0
  const rate = accelerating ? ACCEL_RATE : DECEL_RATE

  let [x, z] = state.pos
  let [vx, vz] = state.vel
  let bob = state.bobPhase
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP))
  const h = total / steps
  const blend = 1 - Math.exp(-rate * h)
  for (let i = 0; i < steps; i++) {
    vx += (target[0] - vx) * blend
    vz += (target[1] - vz) * blend
    if (!accelerating && Math.hypot(vx, vz) < 0.01) {
      vx = 0
      vz = 0
    }
    const px = x
    const pz = z
    ;[x, z] = resolveCollisions([x + vx * h, z + vz * h], radius, boxes, bounds)
    // Velocity follows what actually happened, so pushing into a wall doesn't build up speed.
    if (h > 0) {
      const ax = (x - px) / h
      const az = (z - pz) / h
      // keep the component along the surface (sliding), drop the blocked part
      if (Math.abs(ax - vx) > 1e-6) vx = ax
      if (Math.abs(az - vz) > 1e-6) vz = az
    }
    bob += Math.hypot(x - px, z - pz) * HEAD_BOB_RAD_PER_M
  }
  if (!total) [x, z] = resolveCollisions([x, z], radius, boxes, bounds)
  return { pos: [x, z], vel: [vx, vz], yaw: state.yaw, pitch: state.pitch, bobPhase: bob % (Math.PI * 4) }
}

/** Head bob: radians of phase per metre walked (one full cycle = two steps). */
export const HEAD_BOB_RAD_PER_M = (2 * Math.PI) / (PLAYER.stepLength * 2)
export const HEAD_BOB_AMPLITUDE = 0.045

/** Vertical camera offset for head bob, faded by current speed. */
export function headBobOffset(phase: number, speed: number): number {
  const fade = Math.min(1, speed / PLAYER.walkSpeed)
  return Math.abs(Math.sin(phase)) * HEAD_BOB_AMPLITUDE * fade - HEAD_BOB_AMPLITUDE * 0.5 * fade
}

export function speedOf(state: MoveState): number {
  return Math.hypot(state.vel[0], state.vel[1])
}
