/**
 * Furniture Set A (living): rug, couch, bean bags, coffee table, side table,
 * floor lamp, two ceiling pendants, the east-wall bookshelf with trinkets, and
 * plants around the room. All geometry is merged per material (30 draw calls).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useColliders } from '@/contracts/colliders'
import { PALETTE } from '@/contracts/style'
import { getMaterial } from '@/world/materials'
import type { LivingMat } from './builder'
import { LIVING_COLLIDERS } from './layout'
import { buildLivingSet } from './set'
import type { BookInstance } from './shelf'

const localMats = new Map<string, THREE.Material>()

function tinted(base: Parameters<typeof getMaterial>[0], key: string, color: string): THREE.Material {
  let m = localMats.get(key)
  if (!m) {
    m = getMaterial(base).clone()
    const c = (m as THREE.MeshStandardMaterial).color
    if (c) c.set(color)
    localMats.set(key, m)
  }
  return m
}

function resolveMaterial(id: LivingMat): THREE.Material {
  if (id === 'leafDark') return tinted('leaf', 'leafDark', PALETTE.leafDark)
  if (id === 'vinyl') return tinted('metalDark', 'vinyl', '#1c1a1f')
  return getMaterial(id)
}

function bookMaterial(): THREE.Material {
  // Instance colours multiply the material colour, so start from white.
  return tinted('paper', 'books', '#ffffff')
}

function useBooksMesh(books: BookInstance[]) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const m = new THREE.InstancedMesh(geo, bookMaterial(), books.length)
    const c = new THREE.Color()
    books.forEach((bk, i) => {
      m.setMatrixAt(i, bk.matrix)
      m.setColorAt(i, c.set(bk.color))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.castShadow = true
    m.receiveShadow = true
    m.name = 'living:books'
    m.computeBoundingSphere()
    return m
  }, [books])
  useEffect(() => () => mesh.geometry.dispose(), [mesh])
  return mesh
}

export function LivingProps() {
  const set = useMemo(() => buildLivingSet(), [])
  useColliders(LIVING_COLLIDERS)
  useEffect(() => () => set.parts.forEach((p) => p.geometry.dispose()), [set])
  const books = useBooksMesh(set.books)
  return (
    <group name="living">
      {set.parts.map((p) => (
        <mesh
          key={p.key}
          name={`living:${p.key}`}
          geometry={p.geometry}
          material={resolveMaterial(p.mat)}
          castShadow={p.castShadow}
          receiveShadow
        />
      ))}
      <primitive object={books} />
    </group>
  )
}
