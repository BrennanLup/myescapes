/** Pure collider for the chalkboard (no React/three), shared by the component and the reach test. */
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { ANCHORS } from '@/contracts/scene'

export function wishlistColliders(): AABB[] {
  const a = ANCHORS.wishlistBoard
  const [w, h] = a.size
  // Board hangs on the east wall facing -X; reserve a thin slab in front of it.
  return [boxFromCenter('wishlist:board', [a.position[0] - 0.15, a.position[1], a.position[2]], [0.3, h + 0.1, w + 0.1])]
}
