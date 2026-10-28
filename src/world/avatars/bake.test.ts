import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bakeCharacter, bakedMaterial, baseMaterial, disposeFades, fadeCharacter, finishOf, showDetail, unbake } from './bake'
import { G, M } from './kit'

/** A tiny "character": a body with an arm joint, a head joint with face details, and a glow. */
function rig() {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  body.add(new THREE.Mesh(G.capsule(0.17, 0.2), M('#ff0000', { flat: true })))
  body.add(new THREE.Mesh(G.box(0.1, 0.1, 0.1), M('#00ff00')))
  const arm = new THREE.Group()
  arm.position.set(0.3, 1.2, 0)
  arm.rotation.set(0.7, 0, 0.3)
  body.add(arm)
  const sleeve = new THREE.Mesh(G.capsule(0.05, 0.2), M('#0000ff'))
  sleeve.position.set(0, -0.15, 0)
  sleeve.scale.set(1, 1.1, 0.8)
  arm.add(sleeve)
  arm.add(new THREE.Mesh(G.torus(0.05, 0.01), M('#d4a24c', { metalness: 0.6, roughness: 0.35 })))
  const glow = new THREE.Mesh(G.cylinder(0.03, 0.03, 0.08), M('#ffc27a', { emissive: '#ffc27a', emissiveIntensity: 1.6 }))
  arm.add(glow)
  const head = new THREE.Group()
  head.position.set(0, 1.6, 0)
  body.add(head)
  head.add(new THREE.Mesh(G.sphere(0.155), M('#e0b090')))
  const face = new THREE.Group()
  face.userData.detail = true
  face.add(new THREE.Mesh(G.sphere(0.02), M('#2a1d1a', { roughness: 0.4 })))
  face.add(new THREE.Mesh(G.sphere(0.02, 8, 6), M('#e0b090')))
  head.add(face)
  return { root, body, arm, head, glow, joints: new Set<THREE.Object3D>([body, arm, head]) }
}

function worldBox(root: THREE.Object3D, pick: (m: THREE.Mesh) => boolean) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && pick(m)) box.expandByObject(m, true)
  })
  return box
}

const visibleMeshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

describe('baking a character into a few meshes', () => {
  it('sorts materials into shared finishes, keeping glows apart', () => {
    expect(finishOf(M('#123456'))).toBe('matte')
    expect(finishOf(M('#123456', { roughness: 0.4 }))).toBe('satin')
    expect(finishOf(M('#123456', { metalness: 0.6, roughness: 0.35 }))).toBe('metal')
    expect(finishOf(M('#123456', { emissive: '#ffffff', emissiveIntensity: 1 }))).toBeNull()
    expect(finishOf(new THREE.MeshBasicMaterial())).toBeNull()
    expect(bakedMaterial('matte')).toBe(bakedMaterial('matte'))
    expect(bakedMaterial('matte').vertexColors).toBe(true)
  })

  it('draws one mesh per joint and finish, in the same place as before', () => {
    const r = rig()
    const before = worldBox(r.root, () => true)
    const originals = visibleMeshes(r.root).length
    const b = bakeCharacter(r.root, r.joints, true)
    const shown = visibleMeshes(r.root)
    // body: matte · arm: matte + metal + the glow · head (near): matte + satin
    expect(originals).toBe(8)
    expect(shown.length).toBe(6)
    expect(shown).toContain(r.glow)
    expect(shown.every((m) => m.castShadow)).toBe(true)
    const after = worldBox(r.root, (m) => m.visible || m.userData.baked)
    for (const k of ['min', 'max'] as const) {
      expect(after[k].x).toBeCloseTo(before[k].x, 3)
      expect(after[k].y).toBeCloseTo(before[k].y, 3)
      expect(after[k].z).toBeCloseTo(before[k].z, 3)
    }
    // Baked meshes hang under their joint, so the animation still moves them.
    expect(b.meshes.filter((m) => m.parent === r.arm)).toHaveLength(2)
    // Per-vertex colour from the original material.
    const body = b.meshes.find((m) => m.parent === r.body)!
    const col = body.geometry.getAttribute('color')
    const red = new THREE.Color('#ff0000')
    expect(col.getX(0)).toBeCloseTo(red.r)
    expect(col.getY(0)).toBeCloseTo(red.g)
  })

  it('skips the small details far away', () => {
    const r = rig()
    const b = bakeCharacter(r.root, r.joints, false)
    expect(b.near.length).toBe(2) // head matte + satin (eyes)
    expect(b.far.length).toBe(1) // head matte only
    const near = visibleMeshes(r.root).length
    showDetail(b, false)
    expect(visibleMeshes(r.root).length).toBe(near - 1)
    const farHead = b.far[0].geometry.getAttribute('position').count
    const nearHead = b.near.find((m) => m.material === bakedMaterial('matte'))!.geometry.getAttribute('position').count
    expect(farHead).toBeLessThan(nearHead)
  })

  it('rebakes cleanly for a new look', () => {
    const r = rig()
    const first = bakeCharacter(r.root, r.joints, true)
    const extra = new THREE.Mesh(G.box(0.2, 0.2, 0.2), M('#00ff00'))
    r.head.add(extra)
    const second = bakeCharacter(r.root, r.joints, true, first)
    for (const m of first.meshes) expect(m.parent).toBeNull()
    expect(extra.visible).toBe(false)
    expect(second.meshes.length).toBe(first.meshes.length)
    unbake(second)
    let baked = 0
    r.root.traverse((o) => (baked += o.userData.baked ? 1 : 0))
    expect(baked).toBe(0)
  })

  it('fades with private copies and comes back to the shared materials', () => {
    const r = rig()
    bakeCharacter(r.root, r.joints, true)
    const cache = new Map<THREE.Material, THREE.Material>()
    fadeCharacter(r.root, 0.4, cache)
    const shown = visibleMeshes(r.root)
    for (const m of shown) {
      const mat = m.material as THREE.Material
      expect(mat.transparent).toBe(true)
      expect(mat.opacity).toBeCloseTo(0.4)
      expect(baseMaterial(mat)).not.toBe(mat)
    }
    // The shared materials are untouched.
    expect(bakedMaterial('matte').transparent).toBe(false)
    // A rebake while faded still reads the shared materials.
    const again = bakeCharacter(r.root, r.joints, true)
    expect(again.meshes.every((m) => m.material === bakedMaterial((m.name.split(':')[1]) as 'matte'))).toBe(true)
    fadeCharacter(r.root, 1, cache)
    for (const m of visibleMeshes(r.root)) expect((m.material as THREE.Material).transparent).toBe(false)
    disposeFades(cache)
    expect(cache.size).toBe(0)
  })
})
