/** Pure collider layout for the gate door (no React/three), so tests can register the real boxes. */
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { anchorToWorld } from '@/contracts/scene'

export const DOOR_W = 1.1
export const DOOR_T = 0.08
/** Leaf hinge offset from the wall (anchor-local z). */
export const HINGE_Z = 0.06
/**
 * Open swing: a right angle, so the leaf stands flat on its hinge side (anchor-local x = -DOOR_W/2)
 * instead of sweeping across the doorway and the room's centre line.
 */
export const OPEN_ANGLE = -Math.PI / 2
/** Depth of the wall-hugging doorway slab (casing and closed leaf), anchor-local z from the wall. */
export const FRAME_DEPTH = 0.12

/**
 * Colliders for the door: a thin slab across the doorway that hugs the wall, plus (when open) a narrow
 * box around the leaf standing out from its hinge. Both stay clear of the x = 0 line, so the player can
 * walk straight south from the room centre up to the wall.
 */
export function gateColliders(open: boolean): AABB[] {
  const frame = boxFromCenter('gate:door', anchorToWorld('gateDoor', [0, 1.25, FRAME_DEPTH / 2]), [DOOR_W + 0.42, 2.5, FRAME_DEPTH])
  if (!open) return [frame]
  const leaf = boxFromCenter(
    'gate:door-leaf',
    anchorToWorld('gateDoor', [-DOOR_W / 2, 1.1, HINGE_Z + DOOR_W / 2]),
    [DOOR_T + 0.06, 2.2, DOOR_W + 0.04],
  )
  return [frame, leaf]
}
