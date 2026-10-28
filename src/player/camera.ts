/**
 * Pure third-person camera maths (no three.js, no React; unit-tested in camera.test.ts).
 *
 * The camera looks the same way the player looks (yaw/pitch from the mouse or touch drag), from a
 * point behind, above and slightly to the right of the character's head (over the shoulder, so
 * the centre of the screen is never blocked by your own head). When a wall or a piece of furniture
 * is between the head and that point, the camera pulls in in front of it; it eases back out.
 *
 * Conventions match movement.ts: Y up, yaw 0 looks towards -Z, positive yaw turns left,
 * positive pitch looks up.
 */
import type { AABB } from '@/contracts/colliders'
import { HALF_D, HALF_W, ROOM, type Vec3 } from '@/contracts/scene'

export type CameraMode = 'first' | 'third'

export const THIRD_PERSON = {
  /** Distance behind the head (metres). */
  distance: 2.6,
  /** Over-the-shoulder offset to the right. */
  side: 0.45,
  /** Extra height above the head pivot. */
  up: 0.25,
  /** The head pivot sits this far below the eye. */
  pivotDrop: 0.05,
  /** Never closer than this to the pivot (below it the character is hidden). */
  minDistance: 0.25,
  /** Gap kept between the camera and anything it would clip into. */
  margin: 0.18,
  /** Easing rate (1/s) when the camera moves back out after a wall pulled it in. */
  easeOutRate: 5,
  /** Rate (1/s) at which the pivot follows the character (a light, smooth follow). */
  followRate: 16,
  /** Seconds to blend between first and third person. */
  blendSeconds: 0.35,
  /** Below this camera-to-pivot distance the local character is hidden (camera inside the head). */
  hideBelow: 0.55,
} as const

/** Camera forward vector for a yaw/pitch. */
export function lookVector(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]
}

/** Camera right vector (horizontal) for a yaw. */
export function rightVector(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)]
}

/**
 * Unit direction from the pivot to the ideal third-person camera spot (behind, up and to the
 * side), plus its length. Scale with `distance` (blended) to get the wanted offset.
 */
export function thirdPersonOffset(yaw: number, pitch: number, distance: number = THIRD_PERSON.distance, side: number = THIRD_PERSON.side, up: number = THIRD_PERSON.up): Vec3 {
  const f = lookVector(yaw, pitch)
  const r = rightVector(yaw)
  return [-f[0] * distance + r[0] * side, -f[1] * distance + up, -f[2] * distance + r[2] * side]
}

/** Room interior the camera must stay inside (walls have window openings, so colliders alone leak). */
export interface Interior {
  min: Vec3
  max: Vec3
}

export const ROOM_INTERIOR: Interior = { min: [-HALF_W, 0, -HALF_D], max: [HALF_W, ROOM.height, HALF_D] }

/**
 * First fraction t in [0, 1] of the segment from -> to that enters `box` grown by `pad`
 * (slab test). Returns null when it never does, or when `from` already starts inside (the head
 * is inside something: ignore that box rather than snapping the camera into the face).
 */
export function segmentBoxT(from: Vec3, to: Vec3, box: { min: Vec3; max: Vec3 }, pad = 0): number | null {
  let tMin = 0
  let tMax = 1
  let inside = true
  for (let a = 0; a < 3; a++) {
    const lo = box.min[a] - pad
    const hi = box.max[a] + pad
    const p = from[a]
    if (p < lo || p > hi) inside = false
    const d = to[a] - p
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null
      continue
    }
    let t0 = (lo - p) / d
    let t1 = (hi - p) / d
    if (t0 > t1) [t0, t1] = [t1, t0]
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return null
  }
  if (inside) return null
  return tMin
}

/** Largest t in [0, 1] such that from + t (to - from) stays inside the interior shrunk by `margin`. */
export function interiorT(from: Vec3, to: Vec3, interior: Interior = ROOM_INTERIOR, margin = 0): number {
  let t = 1
  for (let a = 0; a < 3; a++) {
    const lo = interior.min[a] + margin
    const hi = interior.max[a] - margin
    const d = to[a] - from[a]
    if (d > 0 && to[a] > hi) t = Math.min(t, Math.max(0, (hi - from[a]) / d))
    if (d < 0 && to[a] < lo) t = Math.min(t, Math.max(0, (lo - from[a]) / d))
  }
  return t
}

/**
 * How far along `offset` (from `pivot`) the camera may go before it would clip into a collider
 * or leave the room, as a distance in metres (|offset| when nothing is in the way).
 */
export function clearDistance(pivot: Vec3, offset: Vec3, boxes: readonly Pick<AABB, 'min' | 'max'>[], margin: number = THIRD_PERSON.margin, interior: Interior = ROOM_INTERIOR): number {
  const len = Math.hypot(offset[0], offset[1], offset[2])
  if (len < 1e-6) return 0
  const to: Vec3 = [pivot[0] + offset[0], pivot[1] + offset[1], pivot[2] + offset[2]]
  let t = interiorT(pivot, to, interior, margin)
  for (const b of boxes) {
    const hit = segmentBoxT(pivot, to, b, margin)
    if (hit !== null && hit < t) t = hit
  }
  return Math.max(0, t * len)
}

/**
 * Next camera distance: pull in at once when something is in the way (never clip), ease back
 * out when the way clears.
 */
export function followDistance(current: number, allowed: number, dt: number, rate: number = THIRD_PERSON.easeOutRate): number {
  if (allowed <= current) return allowed
  return current + (allowed - current) * (1 - Math.exp(-rate * Math.max(0, dt)))
}

/** Exponential approach of a value towards a target. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * Math.max(0, dt))
}

/** Smoothstep easing for the first/third person blend. */
export function easeBlend(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Yaw that faces along a floor-plane velocity (vx, vz), matching the yaw convention. */
export function yawOfVelocity(vx: number, vz: number): number {
  return Math.atan2(-vx, -vz)
}

/**
 * The character's body yaw: turns smoothly towards where it is walking; stands still otherwise.
 * In first person the body simply follows the look yaw.
 */
export function stepBodyYaw(current: number, vel: [number, number], lookYaw: number, mode: CameraMode, dt: number, rate = 12): number {
  if (mode === 'first') return lookYaw
  const speed = Math.hypot(vel[0], vel[1])
  if (speed < 0.2) return current
  const target = yawOfVelocity(vel[0], vel[1])
  const k = 1 - Math.exp(-rate * Math.max(0, dt))
  return current + angleDelta(current, target) * k
}

/**
 * Distance along the camera's view ray to the point nearest the player's eye. The interaction
 * ray starts there in third person, so reach is measured from the character, not the camera,
 * and the character never blocks its own reticle.
 */
export function rayStartDistance(camera: Vec3, forward: Vec3, eye: Vec3): number {
  const d = (eye[0] - camera[0]) * forward[0] + (eye[1] - camera[1]) * forward[1] + (eye[2] - camera[2]) * forward[2]
  return Math.max(0, d)
}
