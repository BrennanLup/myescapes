/**
 * Room shell (workstream 1): honey plank floor, beamed ceiling, two-tone
 * plaster walls with windows cut as wall segments, wooden window frames,
 * glass, a dusk skyline outside, baseboards, chair rail, crown moulding and
 * LED strip channels. Registers the four wall colliders.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useColliders } from '@/contracts/colliders'
import type { MaterialId } from '@/contracts/materials'
import { getMaterial, getTiledMaterial } from '@/world/materials'
import { UV_PER_METRE, buildRoomGeometry, type Bucket } from './geometry'
import { wallColliders } from './layout'
import { SKY, createSkyTexture } from './sky'

const BUCKET_MATERIAL: Record<Exclude<Bucket, 'glass'>, MaterialId> = {
  plaster: 'plaster',
  plasterAccent: 'plasterAccent',
  baseboard: 'baseboard',
  trim: 'woodLight',
  beams: 'woodLight',
  floor: 'woodFloor',
  ceiling: 'ceiling',
  housing: 'metalDark',
}

/**
 * Metres covered by one texture tile per bucket. The shell's UVs are world-planar
 * (UV_PER_METRE), so the shared materials' default repeats (meant for 0..1 UVs)
 * would tile far too often; these tiled clones put the detail at real-world scale.
 */
const TILE_METRES: Partial<Record<Bucket, [number, number]>> = {
  // 2.5 m along the planks (east-west) x 1.25 m across: 4 planks ~0.31 m wide, 0.8-1.7 m long.
  floor: [2.5, 1.25],
  plaster: [1.6, 1.6],
  plasterAccent: [1.6, 1.6],
  ceiling: [2.4, 2.4],
  beams: [2, 2],
  trim: [2, 2],
}

function bucketMaterial(bucket: Exclude<Bucket, 'glass'>): THREE.Material {
  const id = BUCKET_MATERIAL[bucket]
  const tile = TILE_METRES[bucket]
  if (!tile) return getMaterial(id)
  return getTiledMaterial(id, 1 / (tile[0] * UV_PER_METRE), 1 / (tile[1] * UV_PER_METRE))
}

const SHADOW_RECEIVERS = new Set<Bucket>(['plaster', 'plasterAccent', 'floor', 'baseboard', 'trim', 'ceiling'])
const SHADOW_CASTERS = new Set<Bucket>(['beams', 'trim'])

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
  const extra = useMemo(() => ({ glass: makeGlassMaterial() }), [])
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
        const material = bucket === 'glass' ? extra.glass : bucketMaterial(bucket)
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
