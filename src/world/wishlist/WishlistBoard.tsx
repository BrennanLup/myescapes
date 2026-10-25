/**
 * The in-world chalkboard on the east wall listing the crew's wish list.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Anchor } from '@/world/Anchor'
import { getMaterial } from '@/world/materials'
import { ANCHORS } from '@/contracts/scene'
import { useColliders } from '@/contracts/colliders'
import { interactable } from '@/contracts/interaction'
import { LIGHT } from '@/contracts/style'
import { useStore } from '@/state/store'
import { CANVAS_H, CANVAS_W, drawChalkList } from './chalkTexture'
import { wishlistColliders } from './colliders'

export const BOARD_ID = 'wishlist:board'

const [W, H] = ANCHORS.wishlistBoard.size
const FRAME = 0.12
const SURFACE_W = W - FRAME * 2
const SURFACE_H = H - FRAME * 2
const FRAME_DEPTH = 0.09

const INTERACT = interactable({
  id: BOARD_ID,
  kind: 'wishlist',
  label: 'Open the wish list',
  event: { type: 'wishlist:open', payload: {} },
})

function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts?.load) return
    Promise.all([fonts.load("700 150px 'Caveat'"), fonts.load("500 96px 'Caveat'")])
      .catch(() => undefined)
      .then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])
  return ready
}

/** Canvas texture with the chalk list; redrawn only when the list (or font availability) changes. */
function useChalkTexture() {
  const wishlist = useStore((s) => s.wishlist)
  const fontsReady = useFontsReady()
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return { canvas, texture }
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawChalkList(ctx, wishlist)
    texture.needsUpdate = true
  }, [canvas, texture, wishlist, fontsReady])
  return texture
}

function useGlowTexture() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.6, 'rgba(255,255,255,0.45)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 128, 128)
    }
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function ChalkTray() {
  const mats = useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: '#f6f2e6', roughness: 1 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#ffe08a', roughness: 1 }),
      pink: new THREE.MeshStandardMaterial({ color: '#ffb0a6', roughness: 1 }),
      felt: new THREE.MeshStandardMaterial({ color: '#5a5a5e', roughness: 1 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const wood = getMaterial('woodDark')
  const eraserBack = getMaterial('woodLight')
  // Shelf sticks out in front of the bottom frame rail.
  const trayY = -H / 2 + FRAME / 2
  const top = trayY + 0.025
  const z = FRAME_DEPTH + 0.07
  return (
    <group>
      {/* tray shelf + front lip */}
      <mesh material={wood} position={[0, trayY, FRAME_DEPTH + 0.07]} castShadow receiveShadow>
        <boxGeometry args={[W - 0.2, 0.05, 0.14]} />
      </mesh>
      <mesh material={wood} position={[0, top + 0.012, FRAME_DEPTH + 0.13]} castShadow>
        <boxGeometry args={[W - 0.2, 0.025, 0.02]} />
      </mesh>
      {/* chalk sticks */}
      <mesh material={mats.white} position={[0.55, top + 0.014, z - 0.01]} rotation={[0, 0.25, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.09, 8]} />
      </mesh>
      <mesh material={mats.yellow} position={[0.72, top + 0.014, z - 0.02]} rotation={[0, -0.15, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.06, 8]} />
      </mesh>
      <mesh material={mats.pink} position={[-1.05, top + 0.014, z]} rotation={[0, 0.6, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.075, 8]} />
      </mesh>
      {/* eraser */}
      <group position={[-0.55, top, z - 0.01]} rotation={[0, 0.08, 0]}>
        <mesh material={eraserBack} position={[0, 0.03, 0]} castShadow>
          <boxGeometry args={[0.17, 0.035, 0.065]} />
        </mesh>
        <mesh material={mats.felt} position={[0, 0.0065, 0]}>
          <boxGeometry args={[0.17, 0.013, 0.065]} />
        </mesh>
      </group>
    </group>
  )
}

export function WishlistBoard() {
  const texture = useChalkTexture()
  const glowTex = useGlowTexture()
  const lift = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshBasicMaterial>(null)
  const hovered = useStore((s) => s.hoveredId === BOARD_ID)

  const chalkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: texture,
        emissiveIntensity: 0.18,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [texture],
  )
  useEffect(() => () => chalkMat.dispose(), [chalkMat])

  const boxes = useMemo(() => wishlistColliders(), [])
  useColliders(boxes)

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 10)
    if (lift.current) lift.current.position.z += ((hovered ? 0.03 : 0) - lift.current.position.z) * k
    if (glow.current) glow.current.opacity += ((hovered ? 0.4 : 0) - glow.current.opacity) * k
  })

  const frame = getMaterial('woodLight')
  const frameInner = getMaterial('woodDark')
  const board = getMaterial('chalkboard')

  return (
    <Anchor name="wishlistBoard">
      {/* warm halo on the wall when hovered */}
      <mesh position={[0, 0, 0.004]} renderOrder={-1}>
        <planeGeometry args={[W + 0.7, H + 0.6]} />
        <meshBasicMaterial
          ref={glow}
          map={glowTex}
          color={LIGHT.lampWarm}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <group ref={lift} {...INTERACT}>
        {/* slate */}
        <mesh material={board} position={[0, 0, 0.02]} receiveShadow>
          <boxGeometry args={[SURFACE_W + 0.02, SURFACE_H + 0.02, 0.03]} />
        </mesh>
        {/* chalk writing */}
        <mesh material={chalkMat} position={[0, 0, 0.0365]} renderOrder={1}>
          <planeGeometry args={[SURFACE_W, SURFACE_H]} />
        </mesh>
        {/* chunky frame */}
        <mesh material={frame} position={[0, H / 2 - FRAME / 2, FRAME_DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[W, FRAME, FRAME_DEPTH]} />
        </mesh>
        <mesh material={frame} position={[0, -H / 2 + FRAME / 2, FRAME_DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[W, FRAME, FRAME_DEPTH]} />
        </mesh>
        <mesh material={frame} position={[-W / 2 + FRAME / 2, 0, FRAME_DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[FRAME, H - FRAME * 2, FRAME_DEPTH]} />
        </mesh>
        <mesh material={frame} position={[W / 2 - FRAME / 2, 0, FRAME_DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[FRAME, H - FRAME * 2, FRAME_DEPTH]} />
        </mesh>
        {/* lighter inner bevel strip */}
        {[
          [0, SURFACE_H / 2 + 0.01, SURFACE_W + 0.04, 0.02],
          [0, -SURFACE_H / 2 - 0.01, SURFACE_W + 0.04, 0.02],
          [-SURFACE_W / 2 - 0.01, 0, 0.02, SURFACE_H],
          [SURFACE_W / 2 + 0.01, 0, 0.02, SURFACE_H],
        ].map(([x, y, w, h], i) => (
          <mesh key={i} material={frameInner} position={[x, y, 0.05]}>
            <boxGeometry args={[w, h, 0.02]} />
          </mesh>
        ))}
        {/* corner pegs */}
        {[
          [-1, 1],
          [1, 1],
          [-1, -1],
          [1, -1],
        ].map(([sx, sy], i) => (
          <mesh key={`peg${i}`} material={getMaterial('brass')} position={[sx * (W / 2 - FRAME / 2), sy * (H / 2 - FRAME / 2), FRAME_DEPTH + 0.005]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.012, 10]} />
          </mesh>
        ))}
        <ChalkTray />
      </group>
    </Anchor>
  )
}
