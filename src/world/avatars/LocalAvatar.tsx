/**
 * Your own character in the 3D room. Follows the player controller every frame (playerView) and
 * shows only in third person, once the camera is far enough out not to sit inside your head.
 * Mounted once by World.tsx.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { THIRD_PERSON } from '@/player/camera'
import { playerView } from '@/player/view'
import { useWardrobe } from '@/ui/wardrobe/store'
import { Character, type CharacterMotion } from './Character'

export function LocalAvatar() {
  const outfit = useWardrobe((s) => s.outfit)
  const root = useRef<THREE.Group>(null)
  const motion = useMemo<CharacterMotion>(() => ({ speed: 0, action: 'idle', lookPitch: 0 }), [])

  useFrame(() => {
    const g = root.current
    if (!g) return
    const v = playerView
    const show = v.blend > 0 && v.cameraDistance > THIRD_PERSON.hideBelow
    g.visible = show
    if (!show) return
    g.position.set(v.feet[0], v.feet[1], v.feet[2])
    g.rotation.y = v.bodyYaw
    motion.speed = v.speed
    motion.lookPitch = v.lookPitch
  })

  return (
    <group ref={root} visible={false} userData={{ raycastIgnore: true }} name="local-avatar">
      <Character outfit={outfit} motion={motion} />
    </group>
  )
}
