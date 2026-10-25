import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'

/** Cross-section of an LED strip (metres). */
export const STRIP_THICKNESS = 0.035

export interface StripTransform {
  position: Vec3
  quaternion: THREE.Quaternion
  /** Unit box scaled: x = thickness, y = thickness, z = length. */
  scale: Vec3
}

/** Turn line segments into transforms for a unit box stretched along local Z. */
export function stripTransforms(segments: Array<{ from: Vec3; to: Vec3 }>): StripTransform[] {
  const zAxis = new THREE.Vector3(0, 0, 1)
  return segments.map(({ from, to }) => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    const length = dir.length()
    const q = length > 0 ? new THREE.Quaternion().setFromUnitVectors(zAxis, dir.normalize()) : new THREE.Quaternion()
    const mid = a.add(b).multiplyScalar(0.5)
    return { position: [mid.x, mid.y, mid.z], quaternion: q, scale: [STRIP_THICKNESS, STRIP_THICKNESS, length] }
  })
}
