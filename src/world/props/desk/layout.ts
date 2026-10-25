/**
 * Desk layout in anchor-local space (+Z out of the west wall into the room, +Y up)
 * plus helpers to convert to world space for colliders and the lamp bulb.
 * Pure: no React, no three.js, so it is unit-testable.
 */
import { ANCHORS, LAMPS, type Vec3 } from '@/contracts/scene'
import type { AABB } from '@/contracts/colliders'

const DESK = ANCHORS.desk

/** Anchor-local -> world. */
export function deskLocalToWorld([x, y, z]: Vec3): Vec3 {
  const c = Math.cos(DESK.rotationY)
  const s = Math.sin(DESK.rotationY)
  return [DESK.position[0] + x * c + z * s, DESK.position[1] + y, DESK.position[2] - x * s + z * c]
}

/** World -> anchor-local (inverse of `deskLocalToWorld`). */
export function deskWorldToLocal([wx, wy, wz]: Vec3): Vec3 {
  const c = Math.cos(DESK.rotationY)
  const s = Math.sin(DESK.rotationY)
  const dx = wx - DESK.position[0]
  const dz = wz - DESK.position[2]
  return [dx * c - dz * s, wy - DESK.position[1], dx * s + dz * c]
}

/** World AABB enclosing an anchor-local axis-aligned box. */
export function localBoxToWorld(id: string, min: Vec3, max: Vec3): AABB {
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const p = deskLocalToWorld([x, y, z])
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], p[i])
          hi[i] = Math.max(hi[i], p[i])
        }
      }
  const r = (v: number) => Math.round(v * 1e6) / 1e6
  return { id, min: lo.map(r) as Vec3, max: hi.map(r) as Vec3 }
}

/** Main dimensions (local space, metres). */
export const D = {
  topY: 0.78,
  topT: 0.07,
  width: 2.2,
  /** Desk top spans z in [backZ, frontZ]. */
  backZ: -0.47,
  frontZ: 0.4,
  /** Main monitor centre + size. */
  mainMonitor: { pos: [0.12, 1.2, -0.2] as Vec3, w: 0.84, h: 0.5, rotY: 0 },
  sideMonitor: { pos: [-0.6, 1.13, -0.12] as Vec3, w: 0.5, h: 0.32, rotY: 0.42 },
  chair: { pos: [-0.62, 0, 1.0] as Vec3, rotY: -2.2 },
} as const

/** Desk lamp bulb in local space: derived from the world-space contract so it lines up exactly. */
export const LAMP_BULB_LOCAL: Vec3 = deskWorldToLocal(LAMPS.deskLamp)

/** Colliders (world space). The chair box covers its rotated footprint loosely. */
export function deskColliders(): AABB[] {
  const { chair } = D
  return [
    localBoxToWorld('desk:desk', [-D.width / 2 - 0.02, 0, D.backZ - 0.05], [D.width / 2 + 0.02, D.topY, D.frontZ]),
    localBoxToWorld(
      'desk:chair',
      [chair.pos[0] - 0.34, 0, chair.pos[2] - 0.34],
      [chair.pos[0] + 0.34, 1.3, chair.pos[2] + 0.34],
    ),
  ]
}
