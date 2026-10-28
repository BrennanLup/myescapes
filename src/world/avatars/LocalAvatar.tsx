/**
 * Your own character in the 3D room. Follows the player controller every frame (playerView) and
 * shows only in third person, once the camera is far enough out not to sit inside your head.
 * When it stands in the way of what you aim at (the centre view ray) or of another player you
 * are looking at, it fades to see-through (`FADE_OPACITY`). Mounted once by World.tsx.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { damp, hideDistance } from '@/player/camera'
import { playerView } from '@/player/view'
import { useWardrobe } from '@/ui/wardrobe/store'
import { activeLocalEmote } from '@/net/session'
import { Character, type CharacterMotion } from './Character'
import { blocksPlayer, blocksView, FADE_OPACITY, type V3 } from './occlusion'
import { remoteRoots } from './RemotePlayers'

/** How fast the fade follows (1/s): quick, but not a flicker. */
const FADE_RATE = 10

const forward = new THREE.Vector3()

export function LocalAvatar() {
  const outfit = useWardrobe((s) => s.outfit)
  const root = useRef<THREE.Group>(null)
  const motion = useMemo<CharacterMotion>(() => ({ speed: 0, action: 'idle', lookPitch: 0, opacity: 1 }), [])

  useFrame(({ camera }, delta) => {
    const g = root.current
    if (!g) return
    const v = playerView
    const show = v.blend > 0 && v.cameraDistance > hideDistance(v.crane)
    g.visible = show
    if (!show) {
      motion.opacity = v.avatarOpacity = 1
      return
    }
    g.position.set(v.feet[0], v.feet[1], v.feet[2])
    g.rotation.y = v.bodyYaw
    motion.speed = v.speed
    motion.lookPitch = v.lookPitch
    // An emote you sent to the room (workstream C) plays while you stand still.
    const emote = v.speed < 0.6 ? activeLocalEmote() : null
    motion.action = emote ?? 'idle'

    // In the way of the reticle or of someone you look at: fade, so you can see past yourself.
    const cam: V3 = [camera.position.x, camera.position.y, camera.position.z]
    camera.getWorldDirection(forward)
    let inWay = blocksView(cam, [forward.x, forward.y, forward.z], v.feet)
    if (!inWay) {
      for (const r of remoteRoots) {
        if (r.visible && blocksPlayer(cam, v.feet, [r.position.x, r.position.y, r.position.z])) {
          inWay = true
          break
        }
      }
    }
    const o = damp(motion.opacity ?? 1, inWay ? FADE_OPACITY : 1, FADE_RATE, Math.min(delta, 0.1))
    motion.opacity = o > 0.995 ? 1 : o
    v.avatarOpacity = motion.opacity
  })

  return (
    <group ref={root} visible={false} userData={{ raycastIgnore: true }} name="local-avatar">
      <Character outfit={outfit} motion={motion} />
    </group>
  )
}
