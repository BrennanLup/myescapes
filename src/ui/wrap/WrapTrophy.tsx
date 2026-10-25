/**
 * Wall-mounted trophy shelf on the west wall: three low-poly brass trophies, a
 * hanging medal and a wall calendar (canvas texture) above. Clicking it opens the
 * Year in Escape Rooms overlay. Brass glows softly while hovered.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Anchor } from '@/world/Anchor'
import { getMaterial } from '@/world/materials'
import { interactable } from '@/contracts/interaction'
import { useColliders } from '@/contracts/colliders'
import { useStore } from '@/state/store'
import { LIGHT, PALETTE } from '@/contracts/style'
import { CAL_H, CAL_W, drawCalendar } from './calendarTexture'
import { SHELF_DEPTH, SHELF_W, SHELF_Y, WALL_Z, wrapColliders } from './colliders'

export const WRAP_TROPHY_ID = 'wrap:trophy'

/** Brass always glows a touch so it reads as gold in dim corners; hover adds more. */
const BASE_GLOW = 0.08

function standard(id: Parameters<typeof getMaterial>[0]): THREE.MeshStandardMaterial {
  const base = getMaterial(id)
  const m = base instanceof THREE.MeshStandardMaterial ? base.clone() : new THREE.MeshStandardMaterial({ color: PALETTE.brass })
  return m
}

/** Lathe profile for a classic cup (radius, height pairs). */
function cupGeometry(scale: number) {
  const pts = [
    [0.0, 0.0],
    [0.03, 0.0],
    [0.032, 0.02],
    [0.05, 0.06],
    [0.075, 0.12],
    [0.09, 0.19],
    [0.095, 0.2],
    [0.088, 0.2],
  ].map(([r, y]) => new THREE.Vector2(r * scale, y * scale))
  const g = new THREE.LatheGeometry(pts, 9)
  g.computeVertexNormals()
  return g
}

function starGeometry(r: number) {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    const x = Math.cos(a) * rr
    const y = Math.sin(a) * rr
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 })
  g.translate(0, 0, -0.0125)
  return g
}

function useCalendarTexture() {
  const reviews = useStore((s) => s.reviews)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CAL_W
    canvas.height = CAL_H
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [])
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let alive = true
    const draw = () => {
      if (!alive) return
      drawCalendar(ctx, new Date(), reviews.map((r) => r.date))
      texture.needsUpdate = true
    }
    draw()
    // Redraw once web fonts are in so the year uses the display face.
    document.fonts?.ready.then(draw).catch(() => {})
    return () => {
      alive = false
    }
  }, [reviews, texture])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function Cup({ x, scale, brass, wood }: { x: number; scale: number; brass: THREE.Material; wood: THREE.Material }) {
  const cup = useMemo(() => cupGeometry(scale), [scale])
  const z = WALL_Z + SHELF_DEPTH * 0.5
  const baseH = 0.06 * scale
  const stemH = 0.07 * scale
  return (
    <group position={[x, SHELF_Y + 0.025, z]}>
      <mesh material={wood} position={[0, baseH / 2, 0]} castShadow>
        <boxGeometry args={[0.15 * scale, baseH, 0.15 * scale]} />
      </mesh>
      <mesh material={brass} position={[0, baseH + 0.008 * scale, 0]} castShadow>
        <cylinderGeometry args={[0.045 * scale, 0.055 * scale, 0.016 * scale, 8]} />
      </mesh>
      <mesh material={brass} position={[0, baseH + 0.016 * scale + stemH / 2, 0]}>
        <cylinderGeometry args={[0.014 * scale, 0.024 * scale, stemH, 6]} />
      </mesh>
      <mesh material={brass} geometry={cup} position={[0, baseH + 0.016 * scale + stemH, 0]} castShadow />
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          material={brass}
          position={[side * 0.085 * scale, baseH + stemH + 0.13 * scale, 0]}
          rotation={[0, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2]}
        >
          <torusGeometry args={[0.04 * scale, 0.009 * scale, 4, 8, Math.PI]} />
        </mesh>
      ))}
    </group>
  )
}

function StarTrophy({ x, brass, wood }: { x: number; brass: THREE.Material; wood: THREE.Material }) {
  const star = useMemo(() => starGeometry(0.075), [])
  const z = WALL_Z + SHELF_DEPTH * 0.5
  return (
    <group position={[x, SHELF_Y + 0.025, z]}>
      <mesh material={wood} position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[0.13, 0.06, 0.13]} />
      </mesh>
      <mesh material={wood} position={[0, 0.075, 0]}>
        <boxGeometry args={[0.1, 0.03, 0.1]} />
      </mesh>
      <mesh material={brass} position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.022, 0.16, 6]} />
      </mesh>
      <mesh material={brass} geometry={star} position={[0, 0.31, 0]} rotation={[0, 0, 0.12]} castShadow />
    </group>
  )
}

function Medal({ x, y, brass }: { x: number; y: number; brass: THREE.Material }) {
  const ribbonA = useMemo(() => new THREE.MeshStandardMaterial({ color: PALETTE.fabricTeal, roughness: 0.85 }), [])
  const ribbonB = useMemo(() => new THREE.MeshStandardMaterial({ color: PALETTE.pinRed, roughness: 0.85 }), [])
  useEffect(
    () => () => {
      ribbonA.dispose()
      ribbonB.dispose()
    },
    [ribbonA, ribbonB],
  )
  const z = WALL_Z + 0.02
  const len = 0.26
  return (
    <group position={[x, y, z]}>
      {/* peg */}
      <mesh material={getMaterial('woodDark')} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.01]}>
        <cylinderGeometry args={[0.012, 0.012, 0.05, 6]} />
      </mesh>
      {/* V ribbon */}
      <mesh material={ribbonA} position={[-0.035, -len / 2, 0.004]} rotation={[0, 0, -0.28]}>
        <boxGeometry args={[0.045, len, 0.006]} />
      </mesh>
      <mesh material={ribbonB} position={[0.035, -len / 2, 0.008]} rotation={[0, 0, 0.28]}>
        <boxGeometry args={[0.045, len, 0.006]} />
      </mesh>
      {/* medal disc */}
      <group position={[0, -len - 0.04, 0.016]} rotation={[0, 0, 0.08]}>
        <mesh material={brass} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.065, 0.014, 10]} />
        </mesh>
        <mesh material={brass} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.009]}>
          <cylinderGeometry args={[0.04, 0.045, 0.006, 10]} />
        </mesh>
      </group>
    </group>
  )
}

function Calendar({ x, y }: { x: number; y: number }) {
  const map = useCalendarTexture()
  const paper = useMemo(() => {
    const m = standard('paper')
    m.color.set('#ffffff')
    m.map = map
    m.roughness = 0.9
    return m
  }, [map])
  useEffect(() => () => paper.dispose(), [paper])
  const w = 0.48
  const h = (w * CAL_H) / CAL_W
  const z = WALL_Z + 0.012
  return (
    <group position={[x, y, z]}>
      {/* nail + string */}
      <mesh material={getMaterial('metalDark')} position={[0, h / 2 + 0.07, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.03, 5]} />
      </mesh>
      <mesh material={getMaterial('metalDark')} position={[-0.05, h / 2 + 0.035, 0.004]} rotation={[0, 0, -0.95]}>
        <boxGeometry args={[0.004, 0.09, 0.004]} />
      </mesh>
      <mesh material={getMaterial('metalDark')} position={[0.05, h / 2 + 0.035, 0.004]} rotation={[0, 0, 0.95]}>
        <boxGeometry args={[0.004, 0.09, 0.004]} />
      </mesh>
      {/* card backing */}
      <mesh material={getMaterial('woodDark')} position={[0, 0, -0.004]}>
        <boxGeometry args={[w + 0.02, h + 0.02, 0.006]} />
      </mesh>
      <mesh material={paper} receiveShadow>
        <planeGeometry args={[w, h]} />
      </mesh>
      {/* binding rings */}
      {[-0.15, 0, 0.15].map((rx) => (
        <mesh key={rx} material={getMaterial('metal')} position={[rx, h / 2 - 0.012, 0.006]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.014, 0.003, 4, 10]} />
        </mesh>
      ))}
    </group>
  )
}

export function WrapTrophy() {
  const hovered = useStore((s) => s.hoveredId === WRAP_TROPHY_ID)

  const brass = useMemo(() => {
    const m = standard('brass')
    m.color.set(PALETTE.brass)
    m.metalness = 0.75
    m.roughness = 0.32
    m.emissive.set(LIGHT.lampWarm)
    m.emissiveIntensity = BASE_GLOW
    m.flatShading = true
    // Double-sided so the inside of the lathe cups shows.
    m.side = THREE.DoubleSide
    return m
  }, [])
  const gold = useMemo(() => {
    const m = brass.clone()
    m.color.set('#e8b93a')
    return m
  }, [brass])
  const wood = getMaterial('woodDark')
  const shelfWood = getMaterial('woodLight')
  const felt = useMemo(() => {
    const m = standard('fabricPlum')
    m.emissive.set(LIGHT.lampWarm)
    m.emissiveIntensity = 0
    return m
  }, [])
  useEffect(
    () => () => {
      brass.dispose()
      gold.dispose()
      felt.dispose()
    },
    [brass, gold, felt],
  )

  const glow = useRef(0)
  useFrame((_, dt) => {
    const target = hovered ? 1 : 0
    const k = 1 - Math.exp(-dt * 8)
    const next = glow.current + (target - glow.current) * k
    if (Math.abs(next - glow.current) < 1e-4) return
    glow.current = next
    brass.emissiveIntensity = BASE_GLOW + next * 0.4
    gold.emissiveIntensity = BASE_GLOW + next * 0.4
    felt.emissiveIntensity = next * 0.05
  })

  const boxes = useMemo(() => wrapColliders(), [])
  useColliders(boxes)

  const shelfZ = WALL_Z + SHELF_DEPTH / 2
  const backH = 0.6
  return (
    <Anchor name="wrapTrophy">
      <group
        name="wrap-trophy"
        {...interactable({
          id: WRAP_TROPHY_ID,
          kind: 'wrap',
          label: 'Your year in escape rooms',
          event: { type: 'wrap:open', payload: {} },
        })}
      >
        {/* felt backboard with a wood frame */}
        <mesh material={wood} position={[0, SHELF_Y + backH / 2, WALL_Z + 0.01]} receiveShadow>
          <boxGeometry args={[SHELF_W + 0.06, backH + 0.06, 0.02]} />
        </mesh>
        <mesh material={felt} position={[0, SHELF_Y + backH / 2, WALL_Z + 0.022]} receiveShadow>
          <boxGeometry args={[SHELF_W - 0.04, backH - 0.04, 0.006]} />
        </mesh>
        {/* shelf board */}
        <mesh material={shelfWood} position={[0, SHELF_Y, shelfZ]} castShadow receiveShadow>
          <boxGeometry args={[SHELF_W, 0.05, SHELF_DEPTH]} />
        </mesh>
        {/* front lip */}
        <mesh material={wood} position={[0, SHELF_Y + 0.005, WALL_Z + SHELF_DEPTH + 0.008]}>
          <boxGeometry args={[SHELF_W, 0.06, 0.016]} />
        </mesh>
        {/* brass brackets */}
        {[-0.55, 0.55].map((bx) => (
          <group key={bx} position={[bx, SHELF_Y - 0.025, WALL_Z]}>
            <mesh material={brass} position={[0, -0.09, 0.012]}>
              <boxGeometry args={[0.025, 0.18, 0.024]} />
            </mesh>
            <mesh material={brass} position={[0, -0.075, 0.11]} rotation={[-Math.PI / 4.6, 0, 0]}>
              <boxGeometry args={[0.022, 0.025, 0.27]} />
            </mesh>
          </group>
        ))}
        {/* trophies */}
        <StarTrophy x={-0.46} brass={gold} wood={wood} />
        <Cup x={0.02} scale={1.45} brass={brass} wood={wood} />
        <Cup x={0.46} scale={1.0} brass={gold} wood={wood} />
        {/* calendar + medal above */}
        <Calendar x={-0.12} y={2.12} />
        <Medal x={0.48} y={2.3} brass={gold} />
      </group>
    </Anchor>
  )
}
