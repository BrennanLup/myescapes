/**
 * Red string on the bulletin board: ties together photos that share a group under the
 * active sort, sags a little, follows the live pin heads every frame, and unties /
 * re-ties itself with a staggered animation when the sort changes.
 * Owned by workstream 7: Red String.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bus } from '@/contracts/events'
import { runtime } from '@/contracts/runtime'
import { PALETTE } from '@/contracts/style'
import { useStore } from '@/state/store'
import { getMaterial } from '@/world/materials'
import { MAX_LINKS } from './links'
import { StringGeometry } from './geometry'
import { StringController } from './controller'

/** Base string radius (metres) when seen up close. */
const MIN_RADIUS = 0.005
/** Grow the radius with camera distance so the string stays about 1.5 px wide from across the room. */
const RADIUS_PER_METRE = 0.0013
const MAX_RADIUS = 0.02
/** Board surface z (north wall), for the distance estimate. */
const BOARD_Z = -7.9

function makeMaterial(transparent: boolean) {
  const m = getMaterial('redString').clone()
  m.side = THREE.DoubleSide
  m.transparent = transparent
  m.depthWrite = !transparent
  const std = m as THREE.MeshStandardMaterial
  if (std.emissive && std.emissive.getHex() === 0) {
    // A touch of self-light so the thin string still reads as red in the warm, dim room.
    std.emissive.set(PALETTE.redString)
    std.emissiveIntensity = 0.3
  }
  return m
}

export function RedString() {
  const parts = useMemo(() => {
    const liveGeo = new StringGeometry(MAX_LINKS)
    const oldGeo = new StringGeometry(MAX_LINKS)
    const liveMat = makeMaterial(false)
    const oldMat = makeMaterial(true)
    const liveMesh = new THREE.Mesh(liveGeo.geometry, liveMat)
    const oldMesh = new THREE.Mesh(oldGeo.geometry, oldMat)
    liveMesh.name = 'red-string'
    oldMesh.name = 'red-string-untying'
    for (const mesh of [liveMesh, oldMesh]) {
      mesh.frustumCulled = false
      mesh.raycast = () => {} // never steal clicks from the photos
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
    oldMesh.renderOrder = 1
    const controller = new StringController(liveGeo, oldGeo, useStore.getState().boardSort, {
      emitSfx: () => bus.emit('sfx', { name: 'string' }),
    })
    return { liveGeo, oldGeo, liveMat, oldMat, liveMesh, oldMesh, controller }
  }, [])

  useEffect(() => {
    const { controller } = parts
    const now = () => performance.now() / 1000
    const s0 = useStore.getState()
    controller.setPins(s0.boardPins, s0.boardSort, now())
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.boardPins !== prev.boardPins) controller.setPins(s.boardPins, s.boardSort, now())
      else if (s.boardSort !== prev.boardSort) controller.sortChanged(s.boardSort, now())
    })
    const offSort = bus.on('sort:changed', ({ sort }) => controller.sortChanged(sort, now()))
    const offSaved = bus.on('entry:saved', ({ entry }) => controller.markFresh(entry.room.id))
    return () => {
      unsubStore()
      offSort()
      offSaved()
    }
  }, [parts])

  useEffect(
    () => () => {
      parts.liveGeo.dispose()
      parts.oldGeo.dispose()
      parts.liveMat.dispose()
      parts.oldMat.dispose()
    },
    [parts],
  )

  useFrame(({ camera }) => {
    const now = performance.now() / 1000
    const dist = Math.max(0, camera.position.z - BOARD_Z)
    const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, dist * RADIUS_PER_METRE))
    parts.controller.update(now, runtime.pinPositions, radius)
    const a = parts.controller.oldAlpha(now)
    parts.oldMat.opacity = a
    parts.oldMesh.visible = parts.controller.oldCount > 0 && a > 0.01
    parts.liveMesh.visible = parts.controller.liveCount > 0
  })

  return (
    <group name="red-string">
      <primitive object={parts.liveMesh} />
      <primitive object={parts.oldMesh} />
    </group>
  )
}
