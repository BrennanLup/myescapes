import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RIM_OPEN_AXIS } from './logic'
import { OutlineHulls } from './outline'

type HullMat = THREE.ShaderMaterial

function hullMaterials(o: OutlineHulls): HullMat[] {
  return o.group.children.map((c) => (c as THREE.Mesh).material as HullMat)
}

describe('OutlineHulls', () => {
  it('skips soft decals and draws flat meshes as a rim around their footprint', () => {
    const root = new THREE.Group()
    const slate = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, 0.03), new THREE.MeshStandardMaterial())
    const writing = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.7), new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false }))
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.2), new THREE.MeshStandardMaterial())
    root.add(slate, writing, photo)
    const o = new OutlineHulls()
    o.setTarget(root)
    const mats = hullMaterials(o)
    expect(mats).toHaveLength(2)
    const [box, plane] = mats
    expect(box.side).toBe(THREE.BackSide)
    expect(box.uniforms.uRim.value).toBe(0)
    expect(plane.uniforms.uRim.value).toBe(1)
    const hole = plane.uniforms.uHole.value as THREE.Vector3
    expect(hole.x).toBeCloseTo(0.5)
    expect(hole.y).toBeCloseTo(0.6)
    expect(hole.z).toBe(RIM_OPEN_AXIS)
    o.clear()
    expect(o.group.children).toHaveLength(0)
  })

  it('still outlines a target made only of decals', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })))
    const o = new OutlineHulls()
    o.setTarget(root)
    expect(hullMaterials(o)).toHaveLength(1)
  })
})
