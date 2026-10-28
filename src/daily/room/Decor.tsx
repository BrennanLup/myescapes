/**
 * Dressing for the puzzle room's back (south) and side walls, so turning around still feels like a
 * little escape room: a string of Edison bulbs along the top of three walls, a coat rack with a hat
 * and coat, a wall shelf of decoys (books, an hourglass, a spare padlock, a candle), a key cabinet,
 * and a wall clock that runs with your time.
 *
 * Everything but the clock's face and hands is static and uses shared materials, so it is drawn
 * inside the furniture's `MergeStatic`: one draw per material that piece did not have yet (brass,
 * dark metal, the warm bulb glow, cream fabric), plus three for the clock, about seven in all. None of it is interactable: decoys
 * are just decoys. Pure positions live here too (`DECOR`, `decorColliders`) for the layout tests.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { PALETTE, UI } from '@/contracts/style'
import type { Vec3 } from '@/contracts/scene'
import { getMaterial } from '@/world/materials'
import { DR } from './layout'
import { useRoomPlay } from './playStore'
import { canvasFontsReady, canvasTexture } from './textures'

/** Where the dressing stands (world space). The south wall is z = DR.maxZ; things on it face north (-Z). */
export const DECOR = {
  /** Wall clock centre, on the south wall above the shelf, behind the spawn. */
  clock: { position: [0, 2.3, DR.maxZ - 0.03] as Vec3, radius: 0.27 },
  /** Wall shelf (centre of the board) on the south wall. */
  shelf: { position: [-0.95, 1.42, DR.maxZ - 0.11] as Vec3, width: 1.2, depth: 0.2 },
  /** Coat rack (floor point), in front of the south wall, west of the shelf. */
  coatRack: [-2.15, 0, DR.maxZ - 0.42] as Vec3,
  /** Key cabinet (centre) on the east wall, between the floor lamp and the plant pot. */
  keyCabinet: [DR.maxX - 0.04, 1.55, 3.45] as Vec3,
  /** Bulb strings hang this far below the ceiling at their hooks. */
  bulbTop: DR.height - 0.2,
} as const

/** The coat rack is the only piece you can bump into; the wall pieces sit inside the player's radius of the wall. */
export function decorColliders(): AABB[] {
  const [x, , z] = DECOR.coatRack
  return [boxFromCenter('daily:coat-rack', [x, 0.9, z], [0.5, 1.8, 0.5])]
}

/** One festoon string: from `a` to `b` along a wall, sagging between hooks, with a bulb at each hook. */
export function festoonPoints(a: Vec3, b: Vec3, hooks: number, sag = 0.16): { cord: Vec3[]; bulbs: Vec3[] } {
  const cord: Vec3[] = []
  const bulbs: Vec3[] = []
  const per = 6
  for (let i = 0; i <= hooks * per; i++) {
    const t = i / (hooks * per)
    const local = (i % per) / per
    // A shallow catenary-ish dip between hooks (parabola), with the hooks on the line a-b.
    const dip = sag * 4 * local * (1 - local)
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - dip, a[2] + (b[2] - a[2]) * t]
    cord.push(p)
    // Bulbs hang in the middle of each sag, where a real festoon's sockets are.
    if (i % per === per / 2) bulbs.push([p[0], p[1] - 0.06, p[2]])
  }
  return { cord, bulbs }
}

const UP = new THREE.Vector3(0, 1, 0)

/** A thin rod from `a` to `b` (cords, hooks, rack arms). */
function Rod({ a, b, r, material }: { a: Vec3; b: Vec3; r: number; material: THREE.Material }) {
  const { position, quaternion, length } = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const length = dir.length()
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
    return { position: va.add(vb).multiplyScalar(0.5), quaternion, length }
  }, [a, b])
  return (
    <mesh position={position} quaternion={quaternion} material={material}>
      <cylinderGeometry args={[r, r, length, 5]} />
    </mesh>
  )
}

function Festoon({ a, b, hooks }: { a: Vec3; b: Vec3; hooks: number }) {
  const { cord, bulbs } = useMemo(() => festoonPoints(a, b, hooks), [a, b, hooks])
  const wire = getMaterial('metalDark')
  const glow = getMaterial('emissiveWarm')
  return (
    <group>
      {cord.slice(1).map((p, i) => (
        <Rod key={i} a={cord[i]} b={p} r={0.006} material={wire} />
      ))}
      {bulbs.map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.045, 0]} material={wire}>
            <cylinderGeometry args={[0.014, 0.014, 0.04, 6]} />
          </mesh>
          <mesh material={glow}>
            <sphereGeometry args={[0.035, 8, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Bulb strings along the top of the south, west and east walls (the north wall has the banner). */
function BulbStrings() {
  const y = DECOR.bulbTop
  const inset = 0.08
  const south = DR.maxZ - inset
  const west = DR.minX + inset
  const east = DR.maxX - inset
  const n = DR.minZ + 0.6
  return (
    <group>
      <Festoon a={[west, y, south]} b={[east, y, south]} hooks={8} />
      <Festoon a={[west, y, n]} b={[west, y, south]} hooks={7} />
      <Festoon a={[east, y, n]} b={[east, y, south]} hooks={7} />
    </group>
  )
}

function CoatRack() {
  const wood = getMaterial('woodDark')
  const brass = getMaterial('brass')
  const [x, , z] = DECOR.coatRack
  return (
    <group position={[x, 0, z]} rotation={[0, 0.35, 0]}>
      {/* Pole and crossed feet */}
      <mesh position={[0, 0.9, 0]} material={wood}>
        <cylinderGeometry args={[0.025, 0.03, 1.76, 8]} />
      </mesh>
      {[0, Math.PI / 2].map((r) => (
        <mesh key={r} position={[0, 0.03, 0]} rotation={[0, r, 0]} material={wood}>
          <boxGeometry args={[0.48, 0.05, 0.06]} />
        </mesh>
      ))}
      <mesh position={[0, 1.8, 0]} material={brass}>
        <sphereGeometry args={[0.04, 10, 8]} />
      </mesh>
      {/* Four brass hooks near the top */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4
        const tip: Vec3 = [Math.cos(a) * 0.17, 1.72, Math.sin(a) * 0.17]
        return <Rod key={i} a={[0, 1.6, 0]} b={tip} r={0.01} material={brass} />
      })}
      {/* A teal hat on one hook */}
      <group position={[0.13, 1.72, 0.13]} rotation={[0.25, 0, -0.2]}>
        <mesh material={getMaterial('fabricTeal')}>
          <cylinderGeometry args={[0.16, 0.16, 0.015, 16]} />
        </mesh>
        <mesh position={[0, 0.07, 0]} material={getMaterial('fabricTeal')}>
          <cylinderGeometry args={[0.085, 0.1, 0.13, 14]} />
        </mesh>
        <mesh position={[0, 0.025, 0]} material={getMaterial('fabricPlum')}>
          <cylinderGeometry args={[0.102, 0.102, 0.03, 14]} />
        </mesh>
      </group>
      {/* A long orange coat on the hook facing the room */}
      <group position={[-0.12, 1.66, -0.12]} rotation={[0, Math.PI / 4, 0]}>
        <mesh position={[0, -0.05, 0]} material={getMaterial('fabricOrange')}>
          <boxGeometry args={[0.36, 0.12, 0.12]} />
        </mesh>
        <mesh position={[0, -0.5, 0.01]} rotation={[0.04, 0, 0]} material={getMaterial('fabricOrange')}>
          <cylinderGeometry args={[0.16, 0.24, 0.84, 10]} />
        </mesh>
      </group>
    </group>
  )
}

function WallShelf() {
  const wood = getMaterial('woodLight')
  const dark = getMaterial('woodDark')
  const brass = getMaterial('brass')
  const { position, width, depth } = DECOR.shelf
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      {/* In local space +Z faces the room (north). */}
      <mesh material={wood}>
        <boxGeometry args={[width, 0.04, depth]} />
      </mesh>
      {[-width / 2 + 0.12, width / 2 - 0.12].map((x) => (
        <mesh key={x} position={[x, -0.09, -depth / 2 + 0.04]} material={dark}>
          <boxGeometry args={[0.03, 0.16, 0.08]} />
        </mesh>
      ))}
      {/* Books, one leaning */}
      {[
        [-0.48, 0.24, 'fabricPlum', 0],
        [-0.43, 0.2, 'fabricTeal', 0],
        [-0.37, 0.22, 'fabricOrange', 0],
        [-0.28, 0.19, 'fabricCream', 0.3],
      ].map(([x, h, m, tilt]) => (
        <mesh
          key={x as number}
          position={[x as number, 0.02 + (h as number) / 2, 0]}
          rotation={[0, 0, tilt as number]}
          material={getMaterial(m as 'fabricPlum' | 'fabricTeal' | 'fabricOrange' | 'fabricCream')}
        >
          <boxGeometry args={[0.045, h as number, 0.15]} />
        </mesh>
      ))}
      {/* Hourglass */}
      <group position={[-0.02, 0.02, 0]}>
        {[0, 0.2].map((y) => (
          <mesh key={y} position={[0, y + 0.01, 0]} material={dark}>
            <cylinderGeometry args={[0.06, 0.06, 0.02, 12]} />
          </mesh>
        ))}
        <mesh position={[0, 0.065, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.012, 0.045, 0.09, 10]} />
        </mesh>
        <mesh position={[0, 0.155, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.045, 0.012, 0.09, 10]} />
        </mesh>
        <mesh position={[0, 0.04, 0]} material={getMaterial('fabricOrange')}>
          <coneGeometry args={[0.035, 0.035, 10]} />
        </mesh>
      </group>
      {/* A spare padlock */}
      <group position={[0.22, 0.02, 0.02]}>
        <mesh position={[0, 0.05, 0]} material={brass}>
          <boxGeometry args={[0.1, 0.09, 0.04]} />
        </mesh>
        <mesh position={[0, 0.11, 0]} rotation={[0, 0, 0]} material={getMaterial('metalDark')}>
          <torusGeometry args={[0.032, 0.008, 6, 12, Math.PI]} />
        </mesh>
      </group>
      {/* A candle on a brass dish */}
      <group position={[0.45, 0.02, 0]}>
        <mesh position={[0, 0.01, 0]} material={brass}>
          <cylinderGeometry args={[0.06, 0.06, 0.015, 12]} />
        </mesh>
        <mesh position={[0, 0.08, 0]} material={getMaterial('fabricCream')}>
          <cylinderGeometry args={[0.025, 0.025, 0.13, 10]} />
        </mesh>
        <mesh position={[0, 0.16, 0]} material={getMaterial('emissiveWarm')}>
          <coneGeometry args={[0.012, 0.035, 6]} />
        </mesh>
      </group>
    </group>
  )
}

/** A small key cabinet: a shallow box, its door open, with spare keys on brass hooks. */
function KeyCabinet() {
  const wood = getMaterial('woodDark')
  const light = getMaterial('woodLight')
  const brass = getMaterial('brass')
  return (
    <group position={DECOR.keyCabinet} rotation={[0, -Math.PI / 2, 0]}>
      {/* Local +Z faces the room (west). */}
      <mesh position={[0, 0, 0.03]} material={wood}>
        <boxGeometry args={[0.5, 0.6, 0.06]} />
      </mesh>
      <mesh position={[0, 0, 0.061]} material={light}>
        <boxGeometry args={[0.42, 0.52, 0.004]} />
      </mesh>
      {/* Open door, hinged on the left */}
      <mesh position={[-0.27, 0, 0.22]} rotation={[0, 1.25, 0]} material={wood}>
        <boxGeometry args={[0.38, 0.6, 0.025]} />
      </mesh>
      {[0.12, -0.1].map((y) =>
        [-0.14, -0.05, 0.05, 0.14].map((x, i) => (
          <group key={`${y}:${x}`} position={[x, y, 0.07]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} material={brass}>
              <cylinderGeometry args={[0.006, 0.006, 0.03, 5]} />
            </mesh>
            {/* Not every hook holds a key */}
            {(i + (y > 0 ? 0 : 1)) % 3 !== 2 && (
              <group position={[0, -0.05, 0.012]}>
                <mesh position={[0, 0.03, 0]} material={brass}>
                  <torusGeometry args={[0.015, 0.005, 5, 10]} />
                </mesh>
                <mesh position={[0, -0.015, 0]} material={brass}>
                  <boxGeometry args={[0.008, 0.06, 0.006]} />
                </mesh>
              </group>
            )}
          </group>
        )),
      )}
    </group>
  )
}

/** Static dressing (merged with the furniture: one draw per shared material). */
export function DecorStatic() {
  return (
    <group>
      <BulbStrings />
      <CoatRack />
      <WallShelf />
      <KeyCabinet />
    </group>
  )
}

/** Hand angle (radians, clockwise from 12) for an elapsed time: the long hand counts seconds, the short one minutes. */
export function clockHands(elapsedMs: number): { seconds: number; minutes: number } {
  const s = Math.max(0, elapsedMs) / 1000
  return { seconds: ((s % 60) / 60) * Math.PI * 2, minutes: (((s / 60) % 60) / 60) * Math.PI * 2 }
}

/** Elapsed time of today's run, as the HUD's timer counts it. */
export function runElapsed(progress: { startedAt: number | null; finishedAt: number | null } | null, now: number): number {
  if (!progress?.startedAt) return 0
  return Math.max(0, (progress.finishedAt ?? now) - progress.startedAt)
}

function drawClockFace(g: CanvasRenderingContext2D, w: number) {
  const c = w / 2
  g.fillStyle = PALETTE.paper
  g.beginPath()
  g.arc(c, c, c - 2, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = UI.ink
  g.lineCap = 'round'
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const major = i % 5 === 0
    const r0 = c * (major ? 0.8 : 0.86)
    g.lineWidth = major ? 6 : 2
    g.beginPath()
    g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
    g.lineTo(c + Math.sin(a) * c * 0.92, c - Math.cos(a) * c * 0.92)
    g.stroke()
  }
  g.fillStyle = UI.ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `600 ${Math.round(w * 0.075)}px 'Fredoka', 'Nunito', system-ui, sans-serif`
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    g.fillText(String(i * 5), c + Math.sin(a) * c * 0.66, c - Math.cos(a) * c * 0.66)
  }
  g.fillStyle = UI.accent
  g.font = `700 ${Math.round(w * 0.06)}px 'Fredoka', 'Nunito', system-ui, sans-serif`
  g.fillText('YOUR TIME', c, c + c * 0.36)
}

/**
 * A stopwatch-style wall clock on the south wall: its hands show today's run time (the same clock as
 * the HUD timer), so it stops when you finish. Three small draws (face, two hands); the rim merges.
 */
export function RunClock() {
  const face = useFaceTexture()
  const sec = useRef<THREE.Group>(null)
  const min = useRef<THREE.Group>(null)
  const handMat = useMemo(() => ({ sec: new THREE.MeshBasicMaterial({ color: UI.accent }), min: new THREE.MeshBasicMaterial({ color: UI.ink }) }), [])
  useEffect(() => () => Object.values(handMat).forEach((m) => m.dispose()), [handMat])
  useFrame(() => {
    const { seconds, minutes } = clockHands(runElapsed(useRoomPlay.getState().progress, Date.now()))
    // Facing north (rotated half a turn), so a clockwise hand turns about local +Z by a negative angle.
    if (sec.current) sec.current.rotation.z = -seconds
    if (min.current) min.current.rotation.z = -minutes
  })
  const { position, radius: r } = DECOR.clock
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      <mesh position={[0, 0, 0.027]}>
        <circleGeometry args={[r, 32]} />
        {face ? <meshStandardMaterial map={face} roughness={0.8} /> : <meshStandardMaterial color={PALETTE.paper} roughness={0.8} />}
      </mesh>
      <group ref={min} position={[0, 0, 0.032]}>
        <mesh position={[0, r * 0.26, 0]} material={handMat.min}>
          <planeGeometry args={[0.032, r * 0.5]} />
        </mesh>
      </group>
      <group ref={sec} position={[0, 0, 0.036]}>
        <mesh position={[0, r * 0.3, 0]} material={handMat.sec}>
          <planeGeometry args={[0.018, r * 0.82]} />
        </mesh>
      </group>
    </group>
  )
}

/** The clock's rim and pin: static, merged with the decor. */
export function ClockRim() {
  const { position, radius: r } = DECOR.clock
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      {/* Wooden back, brass bezel just proud of the face, and the centre pin over the hands */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={getMaterial('woodDark')}>
        <cylinderGeometry args={[r + 0.02, r + 0.02, 0.04, 32]} />
      </mesh>
      <mesh position={[0, 0, 0.026]} material={getMaterial('brass')}>
        <torusGeometry args={[r + 0.006, 0.016, 6, 40]} />
      </mesh>
      <mesh position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]} material={getMaterial('metalDark')}>
        <cylinderGeometry args={[0.014, 0.014, 0.012, 10]} />
      </mesh>
    </group>
  )
}

/** The clock face texture, drawn again once the web fonts are in (like the room's other drawings). */
function useFaceTexture(): THREE.Texture | null {
  const tex = useMemo(() => canvasTexture(256, 256, (g, w) => drawClockFace(g, w)), [])
  useEffect(() => {
    if (!tex) return
    let live = true
    void canvasFontsReady().then((ok) => {
      if (!live || !ok) return
      const img = tex.image as HTMLCanvasElement
      const g = img.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, img.width, img.height)
      drawClockFace(g, img.width)
      tex.needsUpdate = true
    })
    return () => {
      live = false
      tex.dispose()
    }
  }, [tex])
  return tex
}
