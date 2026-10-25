/**
 * Room shell (workstream 1): floor with plank seams, beamed ceiling, two-tone
 * plaster walls with windows cut as wall segments, wooden window frames,
 * glass, a dusk skyline outside, baseboards, chair rail, crown moulding and
 * LED strip channels. Registers the four wall colliders.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useColliders } from '@/contracts/colliders'
import type { MaterialId } from '@/contracts/materials'
import { getMaterial } from '@/world/materials'
import { buildRoomGeometry, type Bucket } from './geometry'
import { wallColliders } from './layout'
import { SKY, createSkyTexture } from './sky'

const BUCKET_MATERIAL: Record<Exclude<Bucket, 'grooves' | 'glass'>, MaterialId> = {
  plaster: 'plaster',
  plasterAccent: 'plasterAccent',
  baseboard: 'baseboard',
  trim: 'woodLight',
  beams: 'woodDark',
  floor: 'woodFloor',
  ceiling: 'ceiling',
  housing: 'metalDark',
}

const SHADOW_RECEIVERS = new Set<Bucket>(['plaster', 'plasterAccent', 'floor', 'grooves', 'baseboard', 'trim', 'ceiling'])
const SHADOW_CASTERS = new Set<Bucket>(['beams', 'trim'])

function makeGrooveMaterial(): THREE.Material {
  const m = getMaterial('woodDark').clone()
  m.transparent = true
  m.opacity = 0.45
  m.depthWrite = false
  m.polygonOffset = true
  m.polygonOffsetFactor = -2
  m.polygonOffsetUnits = -2
  return m
}

function makeGlassMaterial(): THREE.Material {
  const m = getMaterial('glass').clone()
  // Force a see-through pane whatever the shared glass looks like.
  if (!m.transparent || m.opacity > 0.35) m.opacity = 0.16
  m.transparent = true
  m.depthWrite = false
  m.side = THREE.DoubleSide
  return m
}

export function Room() {
  const geoms = useMemo(() => buildRoomGeometry(), [])
  const extra = useMemo(() => ({ grooves: makeGrooveMaterial(), glass: makeGlassMaterial() }), [])
  const sky = useMemo(() => {
    const map = createSkyTexture()
    const mat = new THREE.MeshBasicMaterial({
      map,
      color: map ? '#ffffff' : '#7a5a86',
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    })
    const h = SKY.top - SKY.bottom
    const geo = new THREE.CylinderGeometry(SKY.radius, SKY.radius, h, 48, 1, true)
    geo.translate(0, SKY.bottom + h / 2, 0)
    return { mat, geo, map }
  }, [])
  const boxes = useMemo(() => wallColliders(), [])
  useColliders(boxes)

  useEffect(
    () => () => {
      geoms.forEach((g) => g.dispose())
      extra.grooves.dispose()
      extra.glass.dispose()
      sky.geo.dispose()
      sky.mat.dispose()
      sky.map?.dispose()
    },
    [geoms, extra, sky],
  )

  return (
    <group name="room">
      <mesh name="room:sky" geometry={sky.geo} material={sky.mat} renderOrder={-10} />
      {[...geoms.entries()].map(([bucket, geo]) => {
        const material =
          bucket === 'grooves' ? extra.grooves : bucket === 'glass' ? extra.glass : getMaterial(BUCKET_MATERIAL[bucket])
        return (
          <mesh
            key={bucket}
            name={`room:${bucket}`}
            geometry={geo}
            material={material}
            receiveShadow={SHADOW_RECEIVERS.has(bucket)}
            castShadow={SHADOW_CASTERS.has(bucket)}
            renderOrder={bucket === 'glass' ? 1 : 0}
          />
        )
      })}
    </group>
  )
}
