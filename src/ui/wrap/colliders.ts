/** Pure layout + collider for the wrap trophy shelf (no React/three), shared by the component and the reach test. */
import type { AABB } from '@/contracts/colliders'
import { anchorToWorld, ANCHORS, type Vec3 } from '@/contracts/scene'

/** Wall surface in anchor-local Z (anchor sits 0.25 m in front of the west wall). */
export const WALL_Z = -(ANCHORS.wrapTrophy.position[0] + 10)
export const SHELF_Y = 1.1
export const SHELF_DEPTH = 0.34
export const SHELF_W = 1.5

export function wrapColliders(): AABB[] {
  const a = anchorToWorld('wrapTrophy', [-SHELF_W / 2 - 0.03, SHELF_Y - 0.12, WALL_Z])
  const b = anchorToWorld('wrapTrophy', [SHELF_W / 2 + 0.03, SHELF_Y + 0.6, WALL_Z + SHELF_DEPTH + 0.02])
  const min: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]
  const max: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]
  return [{ id: 'wrap:shelf', min, max }]
}
