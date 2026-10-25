/**
 * Lighting workstream: warm lamp pools, teal LED strips, dusk window fill,
 * one soft shadow caster and the app's only EffectComposer (bloom, tone mapping, vignette).
 * The rig itself is described by the pure `lightRig(quality)` in `rig.ts`.
 */
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useStore } from '@/state/store'
import { LedStrips } from './LedStrips'
import { PostFx } from './PostFx'
import { lightRig, type LightSpec, type SpotLightSpec, type DirectionalLightSpec } from './rig'

export { lightRig, shadowCasterCount } from './rig'
export type { LightRig, LightSpec } from './rig'

function TargetedSpot({ spec }: { spec: SpotLightSpec }) {
  const target = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    target.position.set(...spec.target)
    target.updateMatrixWorld()
  }, [target, spec.target])
  return (
    <>
      <primitive object={target} />
      <spotLight
        name={`light:${spec.id}`}
        position={spec.position}
        target={target}
        color={spec.color}
        intensity={spec.intensity}
        distance={spec.distance}
        decay={spec.decay}
        angle={spec.angle}
        penumbra={spec.penumbra}
        castShadow={spec.castShadow}
        shadow-mapSize-width={spec.shadowMapSize}
        shadow-mapSize-height={spec.shadowMapSize}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-near={0.5}
        shadow-camera-far={9}
      />
    </>
  )
}

function TargetedDirectional({ spec }: { spec: DirectionalLightSpec }) {
  const target = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    target.position.set(...spec.target)
    target.updateMatrixWorld()
  }, [target, spec.target])
  return (
    <>
      <primitive object={target} />
      <directionalLight name={`light:${spec.id}`} position={spec.position} target={target} color={spec.color} intensity={spec.intensity} />
    </>
  )
}

function RigLight({ spec }: { spec: LightSpec }) {
  switch (spec.kind) {
    case 'hemisphere':
      return <hemisphereLight name={`light:${spec.id}`} args={[spec.skyColor, spec.groundColor, spec.intensity]} />
    case 'point':
      return (
        <pointLight
          name={`light:${spec.id}`}
          position={spec.position}
          color={spec.color}
          intensity={spec.intensity}
          distance={spec.distance}
          decay={spec.decay}
        />
      )
    case 'spot':
      return <TargetedSpot spec={spec} />
    case 'directional':
      return <TargetedDirectional spec={spec} />
  }
}

/** Keeps renderer settings consistent with the preset (shadow filter, tone mapping when no composer). */
function RendererSettings({ postEnabled }: { postEnabled: boolean }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    // Without the composer the renderer tone maps; with it, the ToneMapping effect does
    // (the composer forces NoToneMapping on the renderer while mounted).
    if (!postEnabled) gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1
  }, [gl, postEnabled])
  // three 0.186 removed PCFSoftShadowMap (R3F still requests it); PCFShadowMap + shadow.radius is the soft path.
  useFrame(() => {
    if (gl.shadowMap.type === THREE.PCFSoftShadowMap) {
      gl.shadowMap.type = THREE.PCFShadowMap
      gl.shadowMap.needsUpdate = true
    }
  })
  return null
}

export function Lighting() {
  const quality = useStore((s) => s.settings.quality)
  const rig = useMemo(() => lightRig(quality), [quality])
  return (
    <group name="lighting">
      {rig.lights.map((l) => (
        <RigLight key={`${quality}:${l.id}`} spec={l} />
      ))}
      <LedStrips emissiveIntensity={rig.ledEmissiveIntensity} />
      <RendererSettings postEnabled={rig.post.enabled} />
      {rig.post.enabled && <PostFx spec={rig.post} />}
    </group>
  )
}
