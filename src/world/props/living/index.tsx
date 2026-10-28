/**
 * Furniture Set A (living): rug, couch, bean bags, coffee table, side table,
 * floor lamp, two ceiling pendants, the east-wall bookshelf with trinkets, and
 * plants around the room. All geometry is merged per (material, shadow) bucket, plus three
 * instanced meshes for book covers, page blocks and record sleeves.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useColliders } from '@/contracts/colliders'
import { PALETTE } from '@/contracts/style'
import { getMaterial } from '@/world/materials'
import type { LivingMat } from './builder'
import { LIVING_COLLIDERS } from './layout'
import { buildLivingSet } from './set'
import { bookCoverGeometry, bookPagesGeometry, type BookInstance } from './shelf'

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
  // Instance colours multiply the material colour, so start from white. Vertex colours darken the spine bands.
  const m = tinted('paper', 'books', '#ffffff') as THREE.MeshStandardMaterial
  m.vertexColors = true
  return m
}

/** One InstancedMesh per kind: book covers, their page blocks (cream paper) and record sleeves. */
function useInstanced(name: string, items: BookInstance[], geometry: () => THREE.BufferGeometry, material: () => THREE.Material, colour: boolean, castShadow: boolean) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry(), material(), items.length)
    const c = new THREE.Color()
    items.forEach((bk, i) => {
      m.setMatrixAt(i, bk.matrix)
      if (colour) m.setColorAt(i, c.set(bk.color))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.castShadow = castShadow
    m.receiveShadow = true
    m.name = name
    m.computeBoundingSphere()
    return m
  }, [name, items, geometry, material, colour, castShadow])
  useEffect(() => () => mesh.geometry.dispose(), [mesh])
  return mesh
}

const pagesMaterial = () => tinted('paper', 'pages', '#efe4cc')
const sleeveMaterial = () => tinted('paper', 'sleeves', '#ffffff')
const sleeveGeometry = () => new THREE.BoxGeometry(1, 1, 1)

export function LivingProps() {
  const set = useMemo(() => buildLivingSet(), [])
  useColliders(LIVING_COLLIDERS)
  useEffect(() => () => set.parts.forEach((p) => p.geometry.dispose()), [set])
  const bookList = useMemo(() => set.books.filter((bk) => bk.kind !== 'record'), [set])
  const recordList = useMemo(() => set.books.filter((bk) => bk.kind === 'record'), [set])
  const covers = useInstanced('living:books', bookList, bookCoverGeometry, bookMaterial, true, true)
  const pages = useInstanced('living:book-pages', bookList, bookPagesGeometry, pagesMaterial, false, false)
  const sleeves = useInstanced('living:records', recordList, sleeveGeometry, sleeveMaterial, true, true)
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
      <primitive object={covers} />
      <primitive object={pages} />
      <primitive object={sleeves} />
    </group>
  )
}
