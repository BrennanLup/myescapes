// PLACEHOLDER (orchestrator). Owned by workstream 1: Room Shell.
import { ROOM } from '@/contracts/scene'
import { getMaterial } from '@/world/materials'

export function Room() {
  return (
    <group name="room">
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={getMaterial('woodFloor')} receiveShadow>
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
      </mesh>
      <mesh position={[0, ROOM.height / 2, -ROOM.depth / 2]} material={getMaterial('plaster')}>
        <planeGeometry args={[ROOM.width, ROOM.height]} />
      </mesh>
    </group>
  )
}
