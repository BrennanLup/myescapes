/**
 * Dev-only material showcase: one sphere + one box per material id on a
 * floor swatch, lit by its own warm key light and teal rim. Not mounted by
 * World.tsx; drop `<MaterialShowcase />` into a scene to review the look.
 */
import { MATERIAL_IDS } from '@/contracts/materials'
import { LIGHT } from '@/contracts/style'
import { useEffect } from 'react'
import { getMaterial, getTiledMaterial, textureGenerationMs, textureTimings } from './index'

const COLS = 9
const GAP = 0.62

export function MaterialShowcase({ position = [0, 0, 0] as [number, number, number] }) {
  const rows = Math.ceil(MATERIAL_IDS.length / COLS)
  useEffect(() => {
    ;(window as unknown as { __MATERIALS_MS?: unknown }).__MATERIALS_MS = { total: textureGenerationMs(), ...textureTimings() }
  }, [])
  return (
    <group name="material-showcase" position={position}>
      <directionalLight
        position={[2.5, 4, 3]}
        intensity={2.2}
        color={LIGHT.lampWarm}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <pointLight position={[-3, 1.5, 1]} intensity={6} distance={8} color={LIGHT.ledTeal} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -0.6]} material={getTiledMaterial('woodFloor', 5.5, 3.6)} receiveShadow>
        <planeGeometry args={[COLS * GAP + 1, rows * GAP + 2.4]} />
      </mesh>
      <mesh position={[0, 1.2, -1.8 - rows * 0.1]} material={getTiledMaterial('plaster', 2, 1)} receiveShadow>
        <planeGeometry args={[COLS * GAP + 1, 2.4]} />
      </mesh>
      {MATERIAL_IDS.map((id, i) => {
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const x = (col - (COLS - 1) / 2) * GAP
        const z = -row * GAP * 1.1
        const y = 0.02 + row * 0.42
        const mat = getMaterial(id)
        return (
          <group key={id} name={`swatch:${id}`} position={[x, y, z]}>
            <mesh position={[0, 0.12, 0]} material={mat} castShadow receiveShadow>
              <boxGeometry args={[0.36, 0.24, 0.36]} />
            </mesh>
            <mesh position={[0, 0.42, 0]} material={mat} castShadow>
              <icosahedronGeometry args={[0.17, 2]} />
            </mesh>
          </group>
        )
      })}
      {/* Risers so back rows are visible. */}
      {Array.from({ length: rows - 1 }, (_, r) => (
        <mesh key={r} position={[0, (0.02 + (r + 1) * 0.42) / 2, -(r + 1) * GAP * 1.1]} material={getMaterial('woodDark')} receiveShadow castShadow>
          <boxGeometry args={[COLS * GAP, 0.02 + (r + 1) * 0.42, 0.5]} />
        </mesh>
      ))}
    </group>
  )
}
