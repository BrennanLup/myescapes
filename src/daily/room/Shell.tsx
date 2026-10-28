/**
 * The puzzle room's shell: floor, walls, ceiling, the lit corridor behind the exit door, the door
 * itself, the lights, and the exit watcher that takes you home once you walk out.
 * Simple boxes and planes with the shared materials (no edits to them), light enough for phones.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useColliders } from '@/contracts/colliders'
import { interactable } from '@/contracts/interaction'
import { runtime } from '@/contracts/runtime'
import { LIGHT, PALETTE } from '@/contracts/style'
import { useStore } from '@/state/store'
import { getMaterial } from '@/world/materials'
import { DOOR_HINGE, DOOR_LEAF_T, DR, isThroughExit, roomColliders } from './layout'
import { MergeStatic } from './MergeStatic'
import { useRoomPlay } from './playStore'

const W = DR.maxX - DR.minX
const D = DR.maxZ - DR.minZ
const CZ = (DR.minZ + DR.maxZ) / 2
const H = DR.height
const T = DR.wall

function Box({ position, size, material, rotation }: { position: [number, number, number]; size: [number, number, number]; material: THREE.Material; rotation?: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation} material={material}>
      <boxGeometry args={size} />
    </mesh>
  )
}

export function RoomShell() {
  const plaster = getMaterial('plaster')
  const accent = getMaterial('plasterAccent')
  const base = getMaterial('baseboard')
  const floor = getMaterial('woodFloor')
  const ceiling = getMaterial('ceiling')
  const woodDark = getMaterial('woodDark')
  const half = DR.doorW / 2
  const cw = DR.corridorHalfW
  const corridorLen = DR.minZ - T - DR.corridorEndZ
  const corridorMidZ = (DR.minZ - T + DR.corridorEndZ) / 2
  const sideW = (W - DR.doorW) / 2

  return (
    // Never moves: one draw per material (MergeStatic). HomeGlow's material is its own, so it stays live.
    <MergeStatic>
      {/* Floor and ceiling */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, CZ]} material={floor} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, CZ]} material={ceiling}>
        <planeGeometry args={[W, D]} />
      </mesh>

      {/* Walls (outside the interior, like the colliders) */}
      <Box position={[0, H / 2, DR.maxZ + T / 2]} size={[W + 2 * T, H, T]} material={plaster} />
      <Box position={[DR.minX - T / 2, H / 2, CZ]} size={[T, H, D + 2 * T]} material={plaster} />
      <Box position={[DR.maxX + T / 2, H / 2, CZ]} size={[T, H, D + 2 * T]} material={plaster} />
      <Box position={[DR.minX + sideW / 2 - T / 2, H / 2, DR.minZ - T / 2]} size={[sideW + T, H, T]} material={plaster} />
      <Box position={[DR.maxX - sideW / 2 + T / 2, H / 2, DR.minZ - T / 2]} size={[sideW + T, H, T]} material={plaster} />
      <Box position={[0, (DR.doorH + H) / 2, DR.minZ - T / 2]} size={[DR.doorW, H - DR.doorH, T]} material={plaster} />

      {/* Wainscot band and baseboards */}
      {(
        [
          [[0, 0.45, DR.maxZ - 0.01], [W, 0.9, 0.02]],
          [[DR.minX + 0.01, 0.45, CZ], [0.02, 0.9, D]],
          [[DR.maxX - 0.01, 0.45, CZ], [0.02, 0.9, D]],
          [[DR.minX + sideW / 2, 0.45, DR.minZ + 0.01], [sideW, 0.9, 0.02]],
          [[DR.maxX - sideW / 2, 0.45, DR.minZ + 0.01], [sideW, 0.9, 0.02]],
        ] as Array<[[number, number, number], [number, number, number]]>
      ).map(([p, s], i) => (
        <Box key={`w${i}`} position={p} size={s} material={accent} />
      ))}
      {(
        [
          [[0, 0.06, DR.maxZ - 0.03], [W, 0.12, 0.04]],
          [[DR.minX + 0.03, 0.06, CZ], [0.04, 0.12, D]],
          [[DR.maxX - 0.03, 0.06, CZ], [0.04, 0.12, D]],
          [[DR.minX + sideW / 2, 0.06, DR.minZ + 0.03], [sideW, 0.12, 0.04]],
          [[DR.maxX - sideW / 2, 0.06, DR.minZ + 0.03], [sideW, 0.12, 0.04]],
          [[0, 0.92, DR.maxZ - 0.025], [W, 0.04, 0.05]],
          [[DR.minX + 0.025, 0.92, CZ], [0.05, 0.04, D]],
          [[DR.maxX - 0.025, 0.92, CZ], [0.05, 0.04, D]],
          [[DR.minX + sideW / 2, 0.92, DR.minZ + 0.025], [sideW, 0.04, 0.05]],
          [[DR.maxX - sideW / 2, 0.92, DR.minZ + 0.025], [sideW, 0.04, 0.05]],
        ] as Array<[[number, number, number], [number, number, number]]>
      ).map(([p, s], i) => (
        <Box key={`b${i}`} position={p} size={s} material={base} />
      ))}

      {/* Door casing */}
      <Box position={[-half - 0.07, DR.doorH / 2 + 0.05, DR.minZ + 0.04]} size={[0.14, DR.doorH + 0.1, 0.1]} material={woodDark} />
      <Box position={[half + 0.07, DR.doorH / 2 + 0.05, DR.minZ + 0.04]} size={[0.14, DR.doorH + 0.1, 0.1]} material={woodDark} />
      <Box position={[0, DR.doorH + 0.12, DR.minZ + 0.05]} size={[DR.doorW + 0.42, 0.2, 0.12]} material={woodDark} />

      {/* Corridor: floor runner, walls, ceiling and the warm glow of home at the end */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, corridorMidZ]} material={floor}>
        <planeGeometry args={[2 * cw, corridorLen + T]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, corridorMidZ - 0.2]}>
        <planeGeometry args={[0.9, corridorLen - 0.6]} />
        <meshStandardMaterial color={PALETTE.rug} roughness={0.95} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, corridorMidZ]} material={ceiling}>
        <planeGeometry args={[2 * cw, corridorLen + T]} />
      </mesh>
      <Box position={[-cw - T / 2, H / 2, corridorMidZ]} size={[T, H, corridorLen + T]} material={plaster} />
      <Box position={[cw + T / 2, H / 2, corridorMidZ]} size={[T, H, corridorLen + T]} material={plaster} />
      <HomeGlow />
    </MergeStatic>
  )
}

/** The far end of the corridor: a bright warm doorway that brightens once the exit door opens. */
function HomeGlow() {
  const open = useRoomPlay((s) => s.doorOpen)
  const light = useRef<THREE.PointLight>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffe2b8', toneMapped: false }), [])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 2)
    if (light.current) light.current.intensity += ((open ? 7 : 1.2) - light.current.intensity) * k
    const target = open ? 1.25 : 0.75
    mat.color.setRGB(1 * target, 0.886 * target, 0.722 * target)
  })
  return (
    <group position={[0, 0, DR.corridorEndZ + 0.01]}>
      <mesh position={[0, H / 2, 0]} material={mat}>
        <planeGeometry args={[2 * DR.corridorHalfW, H]} />
      </mesh>
      <pointLight ref={light} position={[0, 2.2, 0.8]} color={LIGHT.fillWarm} intensity={1.2} distance={6} decay={2} />
    </group>
  )
}

/** Exit door: a wooden leaf hinged on the west side of the opening, swinging out into the corridor. */
export function ExitDoor() {
  const open = useRoomPlay((s) => s.doorOpen)
  const leaf = useRef<THREE.Group>(null)
  const boxes = useMemo(() => roomColliders(open), [open])
  useColliders(boxes)
  const door = useMemo(() => (getMaterial('woodLight') as THREE.MeshStandardMaterial).clone(), [])
  useEffect(() => () => door.dispose(), [door])
  const woodDark = getMaterial('woodDark')
  const brass = getMaterial('brass')
  // Already open on load: no swing.
  const first = useRef(true)
  useFrame((_, dt) => {
    const g = leaf.current
    if (!g) return
    const target = open ? Math.PI / 2 - 0.08 : 0
    if (first.current) {
      first.current = false
      g.rotation.y = target
      return
    }
    g.rotation.y += (target - g.rotation.y) * (1 - Math.exp(-dt * 2.2))
  })
  const w = DR.doorW - 0.02
  const h = DR.doorH - 0.02
  return (
    <group
      {...interactable({ id: 'daily:door', kind: 'gate', label: open ? 'Walk through to go home' : 'Locked: open it with the lock', maxDistance: 3.5 })}
    >
      <group ref={leaf} position={DOOR_HINGE}>
        <group position={[w / 2, 0, 0]}>
          <mesh position={[0, h / 2, 0]} material={door}>
            <boxGeometry args={[w, h, DOOR_LEAF_T]} />
          </mesh>
          {[
            [-0.24, 1.62, 0.36, 0.7],
            [0.24, 1.62, 0.36, 0.7],
            [-0.24, 0.52, 0.36, 0.7],
            [0.24, 0.52, 0.36, 0.7],
          ].map(([x, y, pw, ph], i) => (
            <mesh key={i} position={[x, y, DOOR_LEAF_T / 2 + 0.012]} material={woodDark}>
              <boxGeometry args={[pw, ph, 0.025]} />
            </mesh>
          ))}
          <mesh position={[0.4, 1.0, DOOR_LEAF_T / 2 + 0.04]} material={brass}>
            <sphereGeometry args={[0.045, 12, 10]} />
          </mesh>
          <mesh position={[0, 2.0, DOOR_LEAF_T / 2 + 0.008]} material={brass}>
            <boxGeometry args={[w - 0.06, 0.04, 0.015]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export function RoomLights() {
  const quality = useStore((s) => s.settings.quality)
  return (
    <>
      <hemisphereLight args={[LIGHT.hemiSky, LIGHT.hemiGround, quality === 'low' ? 1.5 : 1.35]} />
      <pointLight position={[0, H - 1.0, CZ - 0.5]} color={LIGHT.fillWarm} intensity={14} distance={10} decay={2} />
      <pointLight position={[DR.minX + 1.2, 2.5, CZ]} color={LIGHT.lampWarm} intensity={6} distance={7} decay={2} />
      {quality !== 'low' && <pointLight position={[DR.maxX - 1.0, 2.4, 0.6]} color={LIGHT.ledTeal} intensity={1.4} distance={5} decay={2} />}
      {quality !== 'low' && <pointLight position={[0, 2.5, DR.minZ + 0.8]} color={LIGHT.lampWarm} intensity={3} distance={4} decay={2} />}
      <PendantLamp />
    </>
  )
}

function PendantLamp() {
  const shade = getMaterial('fabricOrange')
  return (
    <group position={[0, H, CZ - 0.5]}>
      <mesh position={[0, -0.35, 0]} material={getMaterial('metalDark')}>
        <cylinderGeometry args={[0.008, 0.008, 0.7, 6]} />
      </mesh>
      <mesh position={[0, -0.8, 0]} material={shade}>
        <coneGeometry args={[0.32, 0.3, 18, 1, true]} />
      </mesh>
      <mesh position={[0, -0.88, 0]}>
        <sphereGeometry args={[0.07, 12, 10]} />
        <meshBasicMaterial color={LIGHT.lampWarm} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Watches the player's position; once they are through the open door, calls `onExit` (once). */
export function ExitWatcher({ onExit }: { onExit(): void }) {
  const fired = useRef(false)
  const cb = useRef(onExit)
  cb.current = onExit
  useFrame(() => {
    if (fired.current) return
    const open = useRoomPlay.getState().doorOpen
    if (isThroughExit(runtime.player.position, open)) {
      fired.current = true
      cb.current()
    }
  })
  return null
}
