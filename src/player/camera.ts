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
  distance: 3.1,
  /** Over-the-shoulder offset to the right (keeps your head off the reticle). */
  side: 0.6,
  /** Extra height above the head pivot. */
  up: 0.3,
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
  /**
   * Below this camera-to-pivot distance the local character is hidden: closer than this it would
   * fill the screen (camera pulled in by a wall) or sit inside your head.
   */
  hideBelow: 0.9,
  /** Look pitch limits in third person (radians): steeper looks only make sense from your eyes. */
  maxPitchUp: (50 * Math.PI) / 180,
  maxPitchDown: (55 * Math.PI) / 180,
  /** The camera never drops more than this below the head pivot (no worm's-eye view from the floor). */
  minBelowPivot: 0.3,
} as const

/** Where the third-person camera sits relative to the head pivot. */
export interface CameraRig {
  distance: number
  side: number
  up: number
  /** The camera looks this much (radians) below your look pitch (0 = straight along it). */
  tilt: number
}

/** Mouse and keyboard: over the right shoulder, so your head never covers the reticle. */
export const DESKTOP_RIG: CameraRig = { distance: THIRD_PERSON.distance, side: THIRD_PERSON.side, up: THIRD_PERSON.up, tilt: 0 }

/**
 * Touch: centred (a portrait screen is too narrow for a shoulder offset), further back, well
 * above the head and looking a little down (about 10 degrees), so the character stands in the
 * lower third of the screen, under the reticle and the door or friend you walk up to, and the
 * ceiling takes less of the screen. (A phone screen is tall: at 70 degrees vertical field of view
 * the head lands about 65% of the way down, the feet about 90%.)
 */
export const TOUCH_RIG: CameraRig = { distance: THIRD_PERSON.distance + 0.5, side: 0, up: 1.45, tilt: 0.17 }

/** Where the centre of the screen sits (from 0 at the top to 1 at the bottom) for a point seen at `angle` radians below the view direction. */
export function screenY(angleBelow: number, fovDeg = 70): number {
  return 0.5 + Math.tan(angleBelow) / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

/**
 * Look pitch limits while blending into third person (`third` from 0 to 1): from the first-person
 * limit `firstMax` down to the third-person ones, so entering third person tilts smoothly.
 */
export function pitchLimits(third: number, firstMax: number, out: [number, number] = [0, 0]): [number, number] {
  const t = Math.min(1, Math.max(0, third))
  out[0] = -(firstMax + (THIRD_PERSON.maxPitchDown - firstMax) * t)
  out[1] = firstMax + (THIRD_PERSON.maxPitchUp - firstMax) * t
  return out
}

/**
 * The pitch used to place the camera around the pivot (the camera still looks along the real
 * pitch). Looking up would swing the camera under your feet, and looking down through the
 * ceiling would pull it into your head; so the orbit stops where the camera would go lower
 * than `minBelowPivot` under the pivot, or closer than `margin` to the ceiling, and from there
 * on the camera only tilts.
 */
export function orbitPitch(pitch: number, pivotY: number, rig: CameraRig, ceiling: number = ROOM.height, margin: number = THIRD_PERSON.margin): number {
  if (rig.distance < 1e-6) return pitch
  const asinSafe = (x: number) => Math.asin(Math.min(1, Math.max(-1, x)))
  // Camera height above the pivot is up - sin(orbit) * distance.
  const maxUp = asinSafe((rig.up + THIRD_PERSON.minBelowPivot) / rig.distance)
  const rise = ceiling - margin - pivotY
  const maxDown = rise > rig.up ? asinSafe((rise - rig.up) / rig.distance) : 0
  return Math.min(maxUp, Math.max(-maxDown, pitch))
}

/** Camera forward vector for a yaw/pitch (written into `out` when given, to avoid allocations). */
export function lookVector(yaw: number, pitch: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const cp = Math.cos(pitch)
  out[0] = -Math.sin(yaw) * cp
  out[1] = Math.sin(pitch)
  out[2] = -Math.cos(yaw) * cp
  return out
}

/** Camera right vector (horizontal) for a yaw. */
export function rightVector(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)]
}

/**
 * Unit direction from the pivot to the ideal third-person camera spot (behind, up and to the
 * side), plus its length. Scale with `distance` (blended) to get the wanted offset.
 */
export function thirdPersonOffset(
  yaw: number,
  pitch: number,
  distance: number = THIRD_PERSON.distance,
  side: number = THIRD_PERSON.side,
  up: number = THIRD_PERSON.up,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  const cp = Math.cos(pitch)
  const fx = -Math.sin(yaw) * cp
  const fy = Math.sin(pitch)
  const fz = -Math.cos(yaw) * cp
  // Right vector: (cos yaw, 0, -sin yaw).
  out[0] = -fx * distance + Math.cos(yaw) * side
  out[1] = -fy * distance + up
  out[2] = -fz * distance - Math.sin(yaw) * side
  return out
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

/** Scratch end point for clearDistance (it runs every frame; no garbage). */
const SEGMENT_END: Vec3 = [0, 0, 0]

/**
 * How far along `offset` (from `pivot`) the camera may go before it would clip into a collider
 * or leave the room, as a distance in metres (|offset| when nothing is in the way).
 */
export function clearDistance(pivot: Vec3, offset: Vec3, boxes: readonly Pick<AABB, 'min' | 'max'>[], margin: number = THIRD_PERSON.margin, interior: Interior = ROOM_INTERIOR): number {
  const len = Math.hypot(offset[0], offset[1], offset[2])
  if (len < 1e-6) return 0
  const to = SEGMENT_END
  to[0] = pivot[0] + offset[0]
  to[1] = pivot[1] + offset[1]
  to[2] = pivot[2] + offset[2]
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
