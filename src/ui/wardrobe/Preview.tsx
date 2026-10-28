/**
 * Live 3D preview of the look you are trying on: a small second canvas with the same Character
 * the room uses. Drag (mouse or finger) or the arrow keys turn it; it waves when you change
 * something. Without WebGL (tests, very old devices) it shows a calm placeholder instead.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { useStore } from '@/state/store'
import { Character, type CharacterMotion } from '@/world/avatars/Character'
import type { Outfit } from '@/world/avatars/catalog'
import { IconHanger } from './icons'

function hasWebGL(): boolean {
  if (typeof window === 'undefined' || typeof WebGLRenderingContext === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const TURN_STEP = Math.PI / 8

export function Preview({ outfit, describe }: { outfit: Outfit; describe: string }) {
  const [webgl] = useState(hasWebGL)
  const quality = useStore((s) => s.settings.quality)
  const turn = useRef({ yaw: 0.35, target: 0.35, drag: null as null | { id: number; x: number } })
  const motion = useMemo<CharacterMotion>(() => ({ speed: 0, action: 'idle' }), [])

  // Wave for a moment whenever the look changes.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    motion.action = 'wave'
    const t = setTimeout(() => (motion.action = 'idle'), 1300)
    return () => clearTimeout(t)
  }, [outfit, motion])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    turn.current.drag = { id: e.pointerId, x: e.clientX }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = turn.current.drag
    if (!d || d.id !== e.pointerId) return
    turn.current.target += (e.clientX - d.x) * 0.012
    d.x = e.clientX
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (turn.current.drag?.id === e.pointerId) turn.current.drag = null
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') turn.current.target -= TURN_STEP
    else if (e.key === 'ArrowRight') turn.current.target += TURN_STEP
    else return
    e.preventDefault()
  }

  return (
    <div
      data-testid="wardrobe-preview"
      role="img"
      tabIndex={0}
      aria-label={`${describe}. Drag, or use the left and right arrow keys, to turn your character.`}
      className="relative h-full w-full cursor-grab touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-inset active:cursor-grabbing"
      style={{ background: 'radial-gradient(circle at 50% 38%, #fff3e2 0%, #f6dcc0 55%, #e9c39c 100%)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {webgl ? (
        <Canvas
          dpr={quality === 'low' ? [0.75, 1] : [1, 1.75]}
          gl={{ antialias: quality !== 'low', alpha: true, powerPreference: 'low-power' }}
          camera={{ fov: 30, near: 0.1, far: 20, position: [0, 1.15, 4.1] }}
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        >
          <PreviewScene outfit={outfit} motion={motion} turn={turn} />
        </Canvas>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-soft">
          <IconHanger width={48} height={48} />
          <span className="px-6 text-center text-sm">{describe}</span>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-panel/80 px-2.5 py-0.5 text-[11px] font-bold text-ink-soft">
        Drag to turn
      </span>
    </div>
  )
}

function PreviewScene({ outfit, motion, turn }: { outfit: Outfit; motion: CharacterMotion; turn: RefObject<{ yaw: number; target: number; drag: unknown }> }) {
  const camera = useThree((s) => s.camera)
  const spin = useRef<THREE.Group>(null)
  useEffect(() => {
    camera.lookAt(0, 0.92, 0)
  }, [camera])
  useFrame((_, delta) => {
    const t = turn.current
    if (!t) return
    t.yaw += (t.target - t.yaw) * (1 - Math.exp(-10 * Math.min(delta, 0.1)))
    if (spin.current) spin.current.rotation.y = t.yaw
  })
  return (
    <>
      <hemisphereLight args={['#fff4e4', '#8a5a3c', 1.1]} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.9} color="#ffe2c2" />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#9fd8d2" />
      <group ref={spin}>
        {/* The character faces -Z; turn it to face the camera. */}
        <Character outfit={outfit} motion={motion} rotation-y={Math.PI} shadows={false} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <circleGeometry args={[0.75, 32]} />
        <meshStandardMaterial color="#d9a679" roughness={1} />
      </mesh>
    </>
  )
}
