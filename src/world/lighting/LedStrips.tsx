import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { LED_STRIPS } from '@/contracts/scene'
import { LIGHT } from '@/contracts/style'
import { getMaterial } from '@/world/materials'
import { stripTransforms } from './strips'

/** Clone the shared emissiveTeal material and make sure it actually glows in HDR. */
function makeLedMaterial(intensity: number): THREE.Material {
  const m = getMaterial('emissiveTeal').clone()
  if (m instanceof THREE.MeshStandardMaterial) {
    m.emissive.set(LIGHT.ledTeal)
    m.emissiveIntensity = intensity
    m.color.set(LIGHT.ledTeal)
  } else if (m instanceof THREE.MeshBasicMaterial) {
    m.color.set(LIGHT.ledTeal).multiplyScalar(intensity)
  }
  return m
}

const geometry = new THREE.BoxGeometry(1, 1, 1)

export function LedStrips({ emissiveIntensity }: { emissiveIntensity: number }) {
  const material = useMemo(() => makeLedMaterial(emissiveIntensity), [emissiveIntensity])
  useEffect(() => () => material.dispose(), [material])
  const strips = useMemo(() => stripTransforms(LED_STRIPS), [])
  return (
    <group name="lighting:led-strips">
      {strips.map((s, i) => (
        <mesh key={i} name={`led-strip-${i}`} geometry={geometry} material={material} position={s.position} quaternion={s.quaternion} scale={s.scale} />
      ))}
    </group>
  )
}
