import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mergeStatic } from './MergeStatic'

describe('mergeStatic', () => {
  it('draws one mesh per shared material, in the same place, and leaves one-offs alone', () => {
    const root = new THREE.Group()
    root.position.set(5, 0, 0)
    const wood = new THREE.MeshStandardMaterial()
    const glow = new THREE.MeshBasicMaterial()
    const parent = new THREE.Group()
    parent.position.set(0, 1, 0)
    parent.rotation.y = 0.5
    root.add(parent)
    const boxes = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wood)
      m.position.set(i * 2, 0, 0)
      parent.add(m)
      return m
    })
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2), glow)
    root.add(lamp)
    const before = new THREE.Box3().setFromObject(root)

    const { merged, hidden } = mergeStatic(root)
    expect(merged).toHaveLength(1)
    expect(hidden).toEqual(boxes)
    expect(boxes.every((b) => !b.visible)).toBe(true)
    expect(lamp.visible).toBe(true)
    expect(merged[0].material).toBe(wood)
    expect(merged[0].geometry.getAttribute('position').count).toBe(24 * 3)

    root.updateMatrixWorld(true)
    const after = new THREE.Box3()
    for (const m of [...merged, lamp]) after.expandByObject(m, true)
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-4)
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-4)
  })
})
