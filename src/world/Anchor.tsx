/**
 * Mounts children at a named anchor from `src/contracts/scene.ts`.
 * Children are built in anchor-local space (+Z out of the wall, +Y up).
 * Owned by the orchestrator.
 */
import type { ReactNode } from 'react'
import { ANCHORS, type AnchorName } from '@/contracts/scene'

export function Anchor({ name, children }: { name: AnchorName; children?: ReactNode }) {
  const a = ANCHORS[name]
  return (
    <group name={`anchor:${name}`} position={a.position} rotation={[0, a.rotationY, 0]}>
      {children}
    </group>
  )
}

/** Wireframe box showing an anchor's reserved footprint (used by placeholders). */
export function AnchorPlaceholder({ name, color = '#2de2d0' }: { name: AnchorName; color?: string }) {
  const a = ANCHORS[name]
  const [w, h, d] = a.size
  return (
    <Anchor name={name}>
      <mesh position={[0, a.position[1] > 0.5 ? 0 : h / 2, d / 2]}>
        <boxGeometry args={[Math.max(w, 0.1), Math.max(h, 0.1), Math.max(d, 0.1)]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
    </Anchor>
  )
}
