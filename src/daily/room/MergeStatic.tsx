/**
 * Draws static, never-moving meshes as one mesh per material: after mount, every mesh below that
 * shares a material (and shadow flags) with another is merged into a single geometry, and the
 * originals are hidden. Meshes with a material of their own are left alone. A wall of ten boxes
 * becomes one draw call, which matters on phones.
 *
 * Only for decoration: nothing below may move, be interactable or change after mount (the merge
 * runs once). Keep interactables and animated parts outside it.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Merges the meshes under `root` by material: the merged meshes (added under `root`) and the hidden originals. */
export function mergeStatic(root: THREE.Object3D): { merged: THREE.Mesh[]; hidden: THREE.Mesh[] } {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map<string, THREE.Mesh[]>()
  const keyOf = (m: THREE.Mesh) => {
    const attrs = Object.keys(m.geometry.attributes).sort().join(',')
    return `${(m.material as THREE.Material).uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.geometry.index ? 'i' : 'n'}|${attrs}`
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.visible || Array.isArray(m.material) || m.userData.merged || m.userData.interactable) return
    const k = keyOf(m)
    const list = groups.get(k)
    if (list) list.push(m)
    else groups.set(k, [m])
  })
  const out: THREE.Mesh[] = []
  const hidden: THREE.Mesh[] = []
  const rel = new THREE.Matrix4()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const geoms = list.map((m) => {
      const g = m.geometry.clone()
      g.clearGroups()
      g.morphAttributes = {}
      rel.multiplyMatrices(inv, m.matrixWorld)
      g.applyMatrix4(rel)
      return g
    })
    const merged = mergeGeometries(geoms, false)
    for (const g of geoms) g.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const first = list[0]
    const mesh = new THREE.Mesh(merged, first.material)
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.userData.merged = true
    mesh.name = `merged:${(first.material as THREE.Material).name || 'material'}`
    root.add(mesh)
    out.push(mesh)
    for (const m of list) m.visible = false
    hidden.push(...list)
  }
  return { merged: out, hidden }
}

export function MergeStatic({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (!g) return
    const { merged, hidden } = mergeStatic(g)
    return () => {
      for (const m of merged) {
        m.removeFromParent()
        m.geometry.dispose()
      }
      for (const m of hidden) m.visible = true
    }
  }, [])
  return <group ref={ref}>{children}</group>
}
