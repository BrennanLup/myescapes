/** The in-world daily-lock door on the south wall. */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Anchor } from '@/world/Anchor'
import { getMaterial } from '@/world/materials'
import { interactable } from '@/contracts/interaction'
import { useColliders } from '@/contracts/colliders'
import { LIGHT, PALETTE } from '@/contracts/style'
import { useStore } from '@/state/store'
import { useGateSession } from './session'
import { DOOR_T, DOOR_W, HINGE_Z, OPEN_ANGLE, gateColliders } from './colliders'

const DOOR_H = 2.2
export const GATE_DOOR_ID = 'gate:door'

function makeHallwayTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 512
  const g = c.getContext('2d')
  if (!g) return null
  const W = 256
  const H = 512
  // Vanishing box
  const bx0 = 88, bx1 = 168, by0 = 170, by1 = 330
  // Ceiling
  g.fillStyle = '#f1e4d1'
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(bx1, by0); g.lineTo(bx0, by0); g.closePath(); g.fill()
  // Side walls
  g.fillStyle = '#d9b48f'
  g.beginPath(); g.moveTo(0, 0); g.lineTo(bx0, by0); g.lineTo(bx0, by1); g.lineTo(0, H); g.closePath(); g.fill()
  g.fillStyle = '#cfa47e'
  g.beginPath(); g.moveTo(W, 0); g.lineTo(bx1, by0); g.lineTo(bx1, by1); g.lineTo(W, H); g.closePath(); g.fill()
  // Floor
  g.fillStyle = '#a96a3f'
  g.beginPath(); g.moveTo(0, H); g.lineTo(bx0, by1); g.lineTo(bx1, by1); g.lineTo(W, H); g.closePath(); g.fill()
  // Floorboards
  g.strokeStyle = 'rgba(90,50,25,0.35)'
  g.lineWidth = 2
  for (let i = -4; i <= 4; i++) {
    g.beginPath(); g.moveTo(128 + i * 9, by1); g.lineTo(128 + i * 40, H); g.stroke()
  }
  // Runner rug
  g.fillStyle = '#b8503f'
  g.beginPath(); g.moveTo(70, H); g.lineTo(116, by1 + 4); g.lineTo(140, by1 + 4); g.lineTo(186, H); g.closePath(); g.fill()
  g.fillStyle = '#e8b93a'
  g.beginPath(); g.moveTo(84, H); g.lineTo(119, by1 + 4); g.lineTo(122, by1 + 4); g.lineTo(92, H); g.closePath(); g.fill()
  g.beginPath(); g.moveTo(172, H); g.lineTo(137, by1 + 4); g.lineTo(134, by1 + 4); g.lineTo(164, H); g.closePath(); g.fill()
  // Back wall with warm glow
  const grad = g.createRadialGradient(128, 225, 5, 128, 250, 110)
  grad.addColorStop(0, '#ffe2b8')
  grad.addColorStop(1, '#e9c39a')
  g.fillStyle = grad
  g.fillRect(bx0, by0, bx1 - bx0, by1 - by0)
  // Far door
  g.fillStyle = '#7a4a2b'
  g.fillRect(112, 240, 32, 90)
  g.fillStyle = '#d4a24c'
  g.beginPath(); g.arc(138, 288, 2.5, 0, Math.PI * 2); g.fill()
  // Wall lamp glow
  const lamp = g.createRadialGradient(128, 205, 1, 128, 205, 34)
  lamp.addColorStop(0, 'rgba(255,200,130,1)')
  lamp.addColorStop(1, 'rgba(255,179,107,0)')
  g.fillStyle = lamp
  g.fillRect(90, 170, 76, 70)
  // Picture frames on side walls
  g.fillStyle = '#7a4a2b'
  g.beginPath(); g.moveTo(22, 150); g.lineTo(58, 168); g.lineTo(58, 228); g.lineTo(22, 236); g.closePath(); g.fill()
  g.fillStyle = '#2f8f8a'
  g.beginPath(); g.moveTo(27, 158); g.lineTo(53, 171); g.lineTo(53, 223); g.lineTo(27, 229); g.closePath(); g.fill()
  // Plant on the right
  g.fillStyle = '#c0603f'
  g.fillRect(196, 410, 28, 34)
  g.fillStyle = '#5a9a4b'
  for (let i = 0; i < 6; i++) {
    g.beginPath(); g.ellipse(210 + (i - 2.5) * 6, 395 - (i % 2) * 10, 7, 22, (i - 2.5) * 0.3, 0, Math.PI * 2); g.fill()
  }
  // Soft vignette
  const v = g.createLinearGradient(0, 0, 0, H)
  v.addColorStop(0, 'rgba(60,30,20,0.25)')
  v.addColorStop(0.5, 'rgba(60,30,20,0)')
  v.addColorStop(1, 'rgba(60,30,20,0.25)')
  g.fillStyle = v
  g.fillRect(0, 0, W, H)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeSignTexture(solved: boolean): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = PALETTE.paper
  g.fillRect(0, 0, 512, 160)
  g.strokeStyle = PALETTE.woodDark
  g.lineWidth = 10
  g.strokeRect(5, 5, 502, 150)
  g.fillStyle = solved ? '#4f9d5a' : '#3b2a26'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = "600 64px 'Fredoka', 'Nunito', sans-serif"
  g.fillText(solved ? 'SOLVED TODAY' : 'DAILY LOCK', 256, 62)
  g.font = "600 44px 'Caveat', 'Nunito', cursive"
  g.fillStyle = '#7a6258'
  g.fillText(solved ? 'come back tomorrow' : 'crack it to enter', 256, 120)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function GateDoor() {
  const solved = useGateSession((s) => s.solvedToday)
  const hovered = useStore((s) => s.hoveredId === GATE_DOOR_ID)
  const doorRef = useRef<THREE.Group>(null)
  const shackleRef = useRef<THREE.Group>(null)

  const hallway = useMemo(() => makeHallwayTexture(), [])
  const sign = useMemo(() => makeSignTexture(solved), [solved])
  useEffect(() => () => hallway?.dispose(), [hallway])
  useEffect(() => () => sign?.dispose(), [sign])

  const mats = useMemo(() => {
    const brass = (getMaterial('brass') as THREE.MeshStandardMaterial).clone()
    brass.metalness = 0.25
    brass.roughness = 0.4
    const door = (getMaterial('woodLight') as THREE.MeshStandardMaterial).clone()
    return { brass, door }
  }, [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  useEffect(() => {
    mats.brass.emissive.set(hovered ? '#ffb36b' : '#000000')
    mats.brass.emissiveIntensity = hovered ? 0.35 : 0
  }, [hovered, mats])

  const boxes = useMemo(() => gateColliders(solved), [solved])
  useColliders(boxes)

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3)
    if (doorRef.current) doorRef.current.rotation.y += ((solved ? OPEN_ANGLE : 0) - doorRef.current.rotation.y) * k
    if (shackleRef.current) {
      const s = shackleRef.current
      s.position.y += ((solved ? 0.06 : 0) - s.position.y) * k
      s.rotation.y += ((solved ? 1.2 : 0) - s.rotation.y) * k
    }
  })

  const spec = interactable({
    id: GATE_DOOR_ID,
    kind: 'gate',
    label: solved ? 'Solved today ✓' : "Today's lock",
    event: { type: 'gate:open', payload: {} },
  })

  const woodDark = getMaterial('woodDark')
  const metalDark = getMaterial('metalDark')

  return (
    <Anchor name="gateDoor">
      <group {...spec}>
        {/* Painted hallway behind the door so an open door never shows the void. */}
        <mesh position={[0, DOOR_H / 2, 0.012]}>
          <planeGeometry args={[DOOR_W, DOOR_H]} />
          {hallway ? <meshBasicMaterial map={hallway} toneMapped={false} /> : <meshBasicMaterial color="#e9c39a" />}
        </mesh>

        {/* Casing */}
        <mesh position={[-DOOR_W / 2 - 0.07, 1.17, 0.06]} material={woodDark} castShadow>
          <boxGeometry args={[0.14, 2.34, 0.12]} />
        </mesh>
        <mesh position={[DOOR_W / 2 + 0.07, 1.17, 0.06]} material={woodDark} castShadow>
          <boxGeometry args={[0.14, 2.34, 0.12]} />
        </mesh>
        <mesh position={[0, DOOR_H + 0.1, 0.07]} material={woodDark} castShadow>
          <boxGeometry args={[DOOR_W + 0.42, 0.2, 0.14]} />
        </mesh>
        <mesh position={[0, 0.01, 0.1]} material={woodDark}>
          <boxGeometry args={[DOOR_W + 0.1, 0.02, 0.2]} />
        </mesh>

        {/* Door leaf, hinged on the left edge (local -X). */}
        <group ref={doorRef} position={[-DOOR_W / 2, 0, HINGE_Z]}>
          <group position={[DOOR_W / 2, 0, 0]}>
            <mesh position={[0, DOOR_H / 2, 0]} material={mats.door} castShadow receiveShadow>
              <boxGeometry args={[DOOR_W - 0.02, DOOR_H - 0.02, DOOR_T]} />
            </mesh>
            {/* Raised panels */}
            {[
              [-0.24, 1.72, 0.36, 0.62],
              [0.24, 1.72, 0.36, 0.62],
              [-0.24, 0.5, 0.36, 0.62],
              [0.24, 0.5, 0.36, 0.62],
            ].map(([x, y, w, h], i) => (
              <mesh key={i} position={[x, y, DOOR_T / 2 + 0.012]} material={woodDark}>
                <boxGeometry args={[w, h, 0.025]} />
              </mesh>
            ))}
            {/* Brass bands */}
            {[0.18, 2.02].map((y) => (
              <mesh key={y} position={[0, y, DOOR_T / 2 + 0.008]} material={mats.brass}>
                <boxGeometry args={[DOOR_W - 0.04, 0.05, 0.016]} />
              </mesh>
            ))}
            {/* Hinges */}
            {[0.4, 1.8].map((y) => (
              <mesh key={y} position={[-DOOR_W / 2 + 0.02, y, DOOR_T / 2 + 0.01]} material={metalDark}>
                <boxGeometry args={[0.07, 0.16, 0.02]} />
              </mesh>
            ))}

            {/* Safe dial plate */}
            <group position={[0, 1.12, DOOR_T / 2]}>
              <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} material={metalDark}>
                <cylinderGeometry args={[0.2, 0.2, 0.024, 28]} />
              </mesh>
              <mesh position={[0, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]} material={mats.brass}>
                <cylinderGeometry args={[0.15, 0.16, 0.03, 28]} />
              </mesh>
              <mesh position={[0, 0, 0.06]} rotation={[Math.PI / 2, 0, 0]} material={mats.brass}>
                <cylinderGeometry args={[0.06, 0.07, 0.04, 16]} />
              </mesh>
              {Array.from({ length: 12 }, (_, i) => {
                const a = (i / 12) * Math.PI * 2
                return (
                  <mesh key={i} position={[Math.sin(a) * 0.12, Math.cos(a) * 0.12, 0.052]} rotation={[0, 0, -a]} material={metalDark}>
                    <boxGeometry args={[0.008, i % 3 ? 0.02 : 0.035, 0.004]} />
                  </mesh>
                )
              })}
              {/* Pointer */}
              <mesh position={[0, 0.18, 0.028]} material={mats.brass}>
                <coneGeometry args={[0.018, 0.035, 3]} />
              </mesh>
            </group>

            {/* Keypad */}
            <group position={[0.38, 1.12, DOOR_T / 2]}>
              <mesh position={[0, 0, 0.012]} material={metalDark}>
                <boxGeometry args={[0.13, 0.18, 0.024]} />
              </mesh>
              <mesh position={[0, 0.06, 0.026]}>
                <boxGeometry args={[0.09, 0.03, 0.004]} />
                <meshBasicMaterial color={solved ? '#7fe08a' : LIGHT.ledTeal} toneMapped={false} />
              </mesh>
              {Array.from({ length: 9 }, (_, i) => (
                <mesh key={i} position={[(i % 3 - 1) * 0.032, -0.005 - Math.floor(i / 3) * 0.032, 0.027]} material={mats.brass}>
                  <boxGeometry args={[0.022, 0.022, 0.008]} />
                </mesh>
              ))}
            </group>

            {/* Lever handle */}
            <group position={[0.42, 0.92, DOOR_T / 2]}>
              <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} material={mats.brass}>
                <cylinderGeometry args={[0.025, 0.025, 0.06, 12]} />
              </mesh>
              <mesh position={[-0.06, 0, 0.06]} material={mats.brass}>
                <boxGeometry args={[0.14, 0.03, 0.03]} />
              </mesh>
            </group>

            {/* Padlock on a hasp at the latch edge */}
            <group position={[DOOR_W / 2 - 0.08, 1.45, DOOR_T / 2 + 0.03]} scale={1.6}>
              <mesh position={[0.02, 0.06, -0.01]} material={metalDark}>
                <boxGeometry args={[0.1, 0.03, 0.02]} />
              </mesh>
              <mesh position={[0, -0.06, 0]} material={mats.brass} castShadow>
                <boxGeometry args={[0.12, 0.1, 0.05]} />
              </mesh>
              <mesh position={[0, -0.06, 0.026]} material={metalDark}>
                <cylinderGeometry args={[0.01, 0.01, 0.004, 8]} />
              </mesh>
              <group ref={shackleRef}>
                <group position={[-0.035, -0.01, 0]}>
                  <mesh position={[0.035, 0.03, 0]} material={getMaterial('metal')}>
                    <torusGeometry args={[0.035, 0.009, 8, 16, Math.PI]} />
                  </mesh>
                  <mesh position={[0, 0.0, 0]} material={getMaterial('metal')}>
                    <cylinderGeometry args={[0.009, 0.009, 0.06, 8]} />
                  </mesh>
                  <mesh position={[0.07, 0.0, 0]} material={getMaterial('metal')}>
                    <cylinderGeometry args={[0.009, 0.009, 0.06, 8]} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* "Daily lock" sign */}
        <group position={[0, DOOR_H + 0.42, 0.1]} rotation={[-0.05, 0, 0]}>
          <mesh material={woodDark} position={[0, 0, -0.012]}>
            <boxGeometry args={[0.86, 0.3, 0.02]} />
          </mesh>
          <mesh position={[0, 0, 0.001]}>
            <planeGeometry args={[0.8, 0.25]} />
            {sign ? <meshStandardMaterial map={sign} roughness={0.9} /> : <meshStandardMaterial color={PALETTE.paper} />}
          </mesh>
        </group>

        {/* Warm sconce above */}
        <group position={[0, 3.0, 0.12]}>
          <mesh material={mats.brass}>
            <boxGeometry args={[0.18, 0.04, 0.18]} />
          </mesh>
          <mesh position={[0, -0.08, 0.04]}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshBasicMaterial color={LIGHT.lampWarm} toneMapped={false} />
          </mesh>
          <pointLight position={[0, -0.12, 0.3]} color={LIGHT.lampWarm} intensity={2.2} distance={3.5} decay={2} />
        </group>
      </group>
    </Anchor>
  )
}
