/**
 * Furniture of the puzzle room. It is always there (so every day's room feels lived in); on a
 * "Search the room" day each piece is a hiding spot: look under it with E / click / tap. The part
 * you move (cushion, lid, books...) lifts while it is looked at this round, and a found brass key,
 * star or heart stays out, glowing softly.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { boxFromCenter, useColliders, type AABB } from '@/contracts/colliders'
import { interactable } from '@/contracts/interaction'
import { PALETTE } from '@/contracts/style'
import { getMaterial } from '@/world/materials'
import type { SearchSymbol } from '../../gate/generators'
import { useRoomPlay } from './playStore'
import { HIDING_SPOTS, type HidingSpot, type SpotKind } from './search'

/** Solid furniture the player bumps into (world-space AABBs). */
export function furnitureColliders(): AABB[] {
  const at = (id: string) => HIDING_SPOTS.find((s) => s.id === id)!.position
  return [
    boxFromCenter('daily:armchair', [at('cushion')[0], 0.45, at('cushion')[2]], [1.05, 0.9, 1.05]),
    boxFromCenter('daily:shelf', [-3.78, 0.5, -1.6], [0.44, 1.0, 1.5]),
    boxFromCenter('daily:pot', [at('pot')[0], 0.4, at('pot')[2]], [0.6, 0.8, 0.6]),
    boxFromCenter('daily:crate', [at('crate')[0], 0.4, at('crate')[2]], [0.72, 0.8, 0.72]),
    boxFromCenter('daily:chest', [at('chest')[0], 0.3, at('chest')[2]], [0.95, 0.6, 0.7]),
    boxFromCenter('daily:side-table', [at('vase')[0], 0.4, at('vase')[2]], [0.6, 0.8, 0.6]),
    boxFromCenter('daily:basket', [at('basket')[0], 0.25, at('basket')[2]], [0.66, 0.5, 0.66]),
    boxFromCenter('daily:hatbox', [at('hatbox')[0], 0.15, at('hatbox')[2]], [0.46, 0.3, 0.46]),
    boxFromCenter('daily:lamp', [at('lamp')[0], 0.8, at('lamp')[2]], [0.45, 1.6, 0.45]),
  ]
}

export function Furniture({ searchSymbol }: { searchSymbol: SearchSymbol | null }) {
  const boxes = useMemo(() => furnitureColliders(), [])
  useColliders(boxes)
  return (
    <group>
      <StaticDecor />
      {HIDING_SPOTS.map((spot) => (
        <Spot key={spot.id} spot={spot} symbol={searchSymbol} />
      ))}
    </group>
  )
}

/** Pieces that hold the hiding spots: the armchair, the bookshelf, the side table, the rug. */
function StaticDecor() {
  const plum = getMaterial('fabricPlum')
  const woodDark = getMaterial('woodDark')
  const woodLight = getMaterial('woodLight')
  const chair = HIDING_SPOTS.find((s) => s.id === 'cushion')!
  const vase = HIDING_SPOTS.find((s) => s.id === 'vase')!
  return (
    <group>
      {/* Armchair */}
      <group position={[chair.position[0], 0, chair.position[2]]} rotation={[0, chair.rotationY, 0]}>
        <mesh position={[0, 0.22, 0]} material={plum}>
          <boxGeometry args={[0.9, 0.36, 0.85]} />
        </mesh>
        <mesh position={[0, 0.62, -0.36]} material={plum}>
          <boxGeometry args={[0.9, 0.62, 0.16]} />
        </mesh>
        {[-0.42, 0.42].map((x) => (
          <mesh key={x} position={[x, 0.5, 0.02]} material={plum}>
            <boxGeometry args={[0.14, 0.26, 0.8]} />
          </mesh>
        ))}
      </group>
      {/* Low bookshelf against the west wall */}
      <group position={[-3.78, 0, -1.6]}>
        <mesh position={[0, 0.5, -0.73]} material={woodDark}>
          <boxGeometry args={[0.38, 1.0, 0.04]} />
        </mesh>
        <mesh position={[0, 0.5, 0.73]} material={woodDark}>
          <boxGeometry args={[0.38, 1.0, 0.04]} />
        </mesh>
        {[0.04, 0.5, 0.98].map((y) => (
          <mesh key={y} position={[0, y, 0]} material={woodLight}>
            <boxGeometry args={[0.38, 0.04, 1.46]} />
          </mesh>
        ))}
        {/* A few fixed books on the lower shelf */}
        {[-0.5, -0.38, -0.27, 0.3, 0.42].map((z, i) => (
          <mesh key={z} position={[0.02, 0.22, z]} material={getMaterial(i % 2 ? 'fabricTeal' : 'fabricOrange')}>
            <boxGeometry args={[0.24, 0.32 - (i % 3) * 0.03, 0.09]} />
          </mesh>
        ))}
      </group>
      {/* Side table for the vase */}
      <group position={[vase.position[0], 0, vase.position[2]]}>
        <mesh position={[0, 0.68, 0]} material={woodLight}>
          <cylinderGeometry args={[0.28, 0.28, 0.04, 18]} />
        </mesh>
        <mesh position={[0, 0.34, 0]} material={woodDark}>
          <cylinderGeometry args={[0.035, 0.05, 0.66, 8]} />
        </mesh>
        <mesh position={[0, 0.02, 0]} material={woodDark}>
          <cylinderGeometry args={[0.18, 0.2, 0.04, 14]} />
        </mesh>
      </group>
      {/* Rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.8]} material={getMaterial('rug')}>
        <planeGeometry args={[2.6, 1.8]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0.8]}>
        <ringGeometry args={[0.55, 0.62, 28]} />
        <meshStandardMaterial color={PALETTE.brass} roughness={0.9} />
      </mesh>
    </group>
  )
}

/** One hiding spot: the movable part, the token (if found) and, on search days, the interactable. */
function Spot({ spot, symbol }: { spot: HidingSpot; symbol: SearchSymbol | null }) {
  const assignment = useRoomPlay((s) => s.assignment)
  const round = useRoomPlay((s) => s.round)
  const searching = symbol !== null
  const target = searching ? assignment.get(spot.id) ?? null : null
  const found = !!target && round.found.includes(target)
  const lookedNow = round.looked.includes(spot.id)
  const lifted = searching && (found || lookedNow)
  const showToken = searching && !!target && (found || lookedNow)
  const lift = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    const g = lift.current
    if (!g) return
    const k = 1 - Math.exp(-dt * 6)
    const pose = LIFT[spot.kind]
    const t = lifted ? 1 : 0
    g.position.y += (pose.y * t - g.position.y) * k
    g.position.z += (pose.z * t - g.position.z) * k
    g.position.x += (pose.x * t - g.position.x) * k
    g.rotation.x += (pose.rx * t - g.rotation.x) * k
    g.rotation.z += (pose.rz * t - g.rotation.z) * k
  })
  const label = !searching ? '' : found ? 'Found here ✓' : lookedNow ? 'Already looked this round' : spot.label
  const body = (
    <group position={spot.position} rotation={[0, spot.rotationY, 0]}>
      <SpotBase kind={spot.kind} />
      <group ref={lift}>
        <SpotCover kind={spot.kind} />
      </group>
      {showToken && symbol && <Token symbol={symbol} y={TOKEN_Y[spot.kind]} />}
      {searching && (
        // Generous invisible hit box: small objects are easy to aim at, even on a phone.
        <mesh position={[0, HIT[spot.kind][1] / 2, 0]} visible={false}>
          <boxGeometry args={HIT[spot.kind]} />
        </mesh>
      )}
    </group>
  )
  if (!searching) return body
  return <group {...interactable({ id: `daily:spot:${spot.id}`, kind: 'prop', label, maxDistance: 3.2 })}>{body}</group>
}

const LIFT: Record<SpotKind, { x: number; y: number; z: number; rx: number; rz: number }> = {
  cushion: { x: 0, y: 0.32, z: 0.18, rx: -0.7, rz: 0 },
  books: { x: 0, y: 0.12, z: 0.32, rx: 0, rz: 0.25 },
  jar: { x: 0, y: 0.14, z: 0, rx: 0, rz: 0.4 },
  pot: { x: 0.22, y: 0.04, z: 0, rx: 0, rz: -0.35 },
  crate: { x: 0, y: 0.04, z: -0.2, rx: -1.1, rz: 0 },
  hatbox: { x: 0, y: 0.22, z: 0.1, rx: -0.4, rz: 0 },
  chest: { x: 0, y: 0.05, z: -0.18, rx: -1.2, rz: 0 },
  rug: { x: 0, y: 0.03, z: 0, rx: -0.9, rz: 0 },
  frame: { x: 0.18, y: 0, z: 0.08, rx: 0, rz: -0.35 },
  vase: { x: 0.18, y: 0.08, z: 0, rx: 0, rz: -0.6 },
  basket: { x: 0, y: 0.18, z: 0.08, rx: -0.5, rz: 0 },
  lamp: { x: 0.25, y: 0.03, z: 0, rx: 0, rz: -0.12 },
}

/** Where a found token floats, in the spot's local space. */
const TOKEN_Y: Record<SpotKind, number> = {
  cushion: 0.06,
  books: 0.08,
  jar: 0.12,
  pot: 0.55,
  crate: 0.66,
  hatbox: 0.3,
  chest: 0.5,
  rug: 0.08,
  frame: 0,
  vase: 0.38,
  basket: 0.42,
  lamp: 0.12,
}

const HIT: Record<SpotKind, [number, number, number]> = {
  cushion: [0.7, 0.3, 0.7],
  books: [0.36, 0.34, 0.5],
  jar: [0.36, 0.34, 0.4],
  pot: [0.6, 0.9, 0.6],
  crate: [0.7, 0.62, 0.7],
  hatbox: [0.5, 0.36, 0.5],
  chest: [0.9, 0.6, 0.62],
  rug: [0.8, 0.12, 0.6],
  frame: [0.8, 0.7, 0.12],
  vase: [0.36, 0.5, 0.36],
  basket: [0.66, 0.5, 0.66],
  lamp: [0.5, 1.7, 0.5],
}

/** The fixed part of a spot. */
function SpotBase({ kind }: { kind: SpotKind }) {
  switch (kind) {
    case 'pot':
      return (
        <mesh position={[0, 0.2, 0]} material={getMaterial('pot')}>
          <cylinderGeometry args={[0.24, 0.18, 0.4, 14]} />
        </mesh>
      )
    case 'crate':
      return (
        <group>
          <mesh position={[0, 0.29, 0]} material={getMaterial('woodLight')}>
            <boxGeometry args={[0.6, 0.58, 0.6]} />
          </mesh>
          {[0.12, 0.29, 0.46].map((y) => (
            <mesh key={y} position={[0, y, 0.302]} material={getMaterial('woodDark')}>
              <boxGeometry args={[0.6, 0.03, 0.01]} />
            </mesh>
          ))}
        </group>
      )
    case 'hatbox':
      return (
        <mesh position={[0, 0.1, 0]} material={getMaterial('fabricTeal')}>
          <cylinderGeometry args={[0.2, 0.2, 0.2, 18]} />
        </mesh>
      )
    case 'chest':
      return (
        <group>
          <mesh position={[0, 0.2, 0]} material={getMaterial('woodDark')}>
            <boxGeometry args={[0.82, 0.4, 0.52]} />
          </mesh>
          {[-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, 0.2, 0]} material={getMaterial('brass')}>
              <boxGeometry args={[0.05, 0.41, 0.53]} />
            </mesh>
          ))}
        </group>
      )
    case 'jar':
      return (
        <mesh position={[0, 0.11, 0]} material={getMaterial('ceramic')}>
          <cylinderGeometry args={[0.08, 0.08, 0.2, 12]} />
        </mesh>
      )
    case 'vase':
      return null
    case 'basket':
      return (
        <mesh position={[0, 0.17, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.3, 0.24, 0.34, 16, 1, true]} />
        </mesh>
      )
    case 'lamp':
      return (
        <group>
          <mesh position={[0, 0.78, 0]} material={getMaterial('metalDark')}>
            <cylinderGeometry args={[0.015, 0.015, 1.5, 6]} />
          </mesh>
          <mesh position={[0, 1.5, 0]} material={getMaterial('fabricCream')}>
            <cylinderGeometry args={[0.14, 0.22, 0.26, 16, 1, true]} />
          </mesh>
          <mesh position={[0, 1.45, 0]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshBasicMaterial color="#ffd9b0" toneMapped={false} />
          </mesh>
        </group>
      )
    case 'frame':
      return null
    default:
      return null
  }
}

/** The part you move to look. */
function SpotCover({ kind }: { kind: SpotKind }): ReactNode {
  switch (kind) {
    case 'cushion':
      return (
        <mesh position={[0, 0.06, 0.04]} material={getMaterial('fabricOrange')}>
          <boxGeometry args={[0.62, 0.12, 0.6]} />
        </mesh>
      )
    case 'books':
      return (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 0.04 + i * 0.07, 0]} rotation={[0, (i - 1) * 0.15, 0]} material={getMaterial(i === 1 ? 'fabricPlum' : i ? 'fabricTeal' : 'fabricOrange')}>
              <boxGeometry args={[0.28, 0.065, 0.36]} />
            </mesh>
          ))}
        </group>
      )
    case 'jar':
      return (
        <mesh position={[0, 0.225, 0]} material={getMaterial('woodDark')}>
          <cylinderGeometry args={[0.085, 0.085, 0.03, 12]} />
        </mesh>
      )
    case 'pot':
      return (
        <group position={[0, 0.4, 0]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.cos(i * 1.3) * 0.08, 0.22, Math.sin(i * 1.3) * 0.08]} rotation={[Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4]} material={getMaterial('leaf')}>
              <coneGeometry args={[0.1, 0.5, 6]} />
            </mesh>
          ))}
        </group>
      )
    case 'crate':
      return (
        <group position={[0, 0.59, 0.3]}>
          <mesh position={[0, 0, -0.3]} material={getMaterial('woodLight')}>
            <boxGeometry args={[0.62, 0.04, 0.62]} />
          </mesh>
        </group>
      )
    case 'hatbox':
      return (
        <mesh position={[0, 0.22, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.215, 0.215, 0.05, 18]} />
        </mesh>
      )
    case 'chest':
      return (
        <group position={[0, 0.4, 0.26]}>
          <mesh position={[0, 0.06, -0.26]} rotation={[0, 0, Math.PI / 2]} material={getMaterial('woodDark')}>
            <cylinderGeometry args={[0.26, 0.26, 0.82, 12, 1, false, 0, Math.PI]} />
          </mesh>
          <mesh position={[0, 0.02, 0.005]} material={getMaterial('brass')}>
            <boxGeometry args={[0.1, 0.1, 0.02]} />
          </mesh>
        </group>
      )
    case 'rug':
      // A loose corner of the rug, hinged on its inner edge.
      return (
        <group position={[-0.12, 0.003, -0.12]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.12, 0, 0.12]} material={getMaterial('rug')}>
            <planeGeometry args={[0.36, 0.36]} />
          </mesh>
        </group>
      )
    case 'frame':
      return (
        <group position={[0, 0, 0.02]}>
          <mesh material={getMaterial('woodDark')}>
            <boxGeometry args={[0.72, 0.56, 0.03]} />
          </mesh>
          <mesh position={[0, 0, 0.017]}>
            <planeGeometry args={[0.62, 0.46]} />
            <meshStandardMaterial color={PALETTE.fabricTeal} roughness={0.9} />
          </mesh>
          <mesh position={[0.1, -0.06, 0.019]}>
            <circleGeometry args={[0.12, 12]} />
            <meshStandardMaterial color={PALETTE.sky} roughness={0.9} />
          </mesh>
        </group>
      )
    case 'vase':
      return (
        <group>
          <mesh position={[0, 0.16, 0]} material={getMaterial('ceramic')}>
            <cylinderGeometry args={[0.07, 0.11, 0.32, 14]} />
          </mesh>
          <mesh position={[0, 0.38, 0]} material={getMaterial('leaf')}>
            <coneGeometry args={[0.08, 0.2, 6]} />
          </mesh>
        </group>
      )
    case 'basket':
      return (
        <mesh position={[0, 0.35, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.31, 0.31, 0.04, 16]} />
        </mesh>
      )
    case 'lamp':
      return (
        <mesh position={[0, 0.03, 0]} material={getMaterial('metalDark')}>
          <cylinderGeometry args={[0.2, 0.22, 0.06, 16]} />
        </mesh>
      )
  }
}

/** A found brass key, star or heart, spinning slowly. */
function Token({ symbol, y }: { symbol: SearchSymbol; y: number }) {
  const g = useRef<THREE.Group>(null)
  const mat = useMemo(() => {
    const m = (getMaterial('brass') as THREE.MeshStandardMaterial).clone()
    m.emissive.set('#ffb36b')
    m.emissiveIntensity = 0.6
    m.metalness = 0.35
    m.roughness = 0.35
    return m
  }, [])
  useEffect(() => () => mat.dispose(), [mat])
  const shape = useMemo(() => (symbol === 'key' ? null : symbol === 'star' ? starShape() : heartShape()), [symbol])
  const geo = useMemo(() => (shape ? new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }) : null), [shape])
  useEffect(() => () => geo?.dispose(), [geo])
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 1.6
  })
  return (
    <group ref={g} position={[0, y + 0.1, 0]} userData={{ raycastIgnore: true }}>
      {symbol === 'key' ? (
        <group rotation={[0, 0, Math.PI / 2]} scale={1.3}>
          <mesh position={[0, 0.06, 0]} material={mat}>
            <torusGeometry args={[0.03, 0.01, 6, 14]} />
          </mesh>
          <mesh position={[0, -0.02, 0]} material={mat}>
            <cylinderGeometry args={[0.008, 0.008, 0.11, 6]} />
          </mesh>
          <mesh position={[0.016, -0.065, 0]} material={mat}>
            <boxGeometry args={[0.025, 0.012, 0.01]} />
          </mesh>
          <mesh position={[0.012, -0.04, 0]} material={mat}>
            <boxGeometry args={[0.018, 0.01, 0.01]} />
          </mesh>
        </group>
      ) : (
        geo && <mesh geometry={geo} material={mat} position={[0, 0, -0.01]} />
      )}
    </group>
  )
}

function starShape() {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.035 : 0.085
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

function heartShape() {
  const s = new THREE.Shape()
  const k = 0.0085
  s.moveTo(0, -6 * k)
  s.bezierCurveTo(-10 * k, 1 * k, -6 * k, 9 * k, 0, 4 * k)
  s.bezierCurveTo(6 * k, 9 * k, 10 * k, 1 * k, 0, -6 * k)
  return s
}
