/** Pure collider for the cork board (no React/three), shared by the component and the reach test. */
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { ANCHORS } from '@/contracts/scene'

export function boardColliders(): AABB[] {
  const [x, y, z] = ANCHORS.bulletinBoard.position
  const [w, h, d] = ANCHORS.bulletinBoard.size
  return [boxFromCenter('board:north', [x, y, z + d / 2], [w, h, d])]
}
