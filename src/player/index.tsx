// PLACEHOLDER (orchestrator). Owned by workstream 8: Player Controller.
import { useFrame } from '@react-three/fiber'
import { runtime } from '@/contracts/runtime'

export function PlayerController() {
  useFrame(({ camera }) => {
    const p = runtime.player
    camera.position.set(p.position[0], p.position[1], p.position[2])
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ')
  })
  return null
}

/** DOM overlay: virtual joystick + drag-look (touch only). */
export function MobileControls() {
  return null
}
