import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { interactable, DEFAULT_INTERACT_DISTANCE } from '@/contracts/interaction'
import {
  desktopPrompt,
  findInteractable,
  hullScale,
  isTap,
  isTapSurface,
  moveTap,
  outlineThickness,
  resolveTarget,
  startTap,
  touchPrompt,
} from './logic'

function tree() {
  const root = new THREE.Group()
  Object.assign(root.userData, interactable({ id: 'photo:a', kind: 'photo', label: 'Read review' }).userData)
  const frame = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry())
  root.add(frame)
  frame.add(mesh)
  const wall = new THREE.Mesh(new THREE.BoxGeometry())
  return { root, frame, mesh, wall }
}

describe('findInteractable', () => {
  it('walks up the parent chain to the first spec', () => {
    const { root, mesh } = tree()
    const found = findInteractable(mesh)
    expect(found?.spec.id).toBe('photo:a')
    expect(found?.root).toBe(root)
  })
  it('prefers the nearest spec when nested', () => {
    const { frame, mesh } = tree()
    frame.userData.interactable = { id: 'inner', kind: 'prop', label: 'Poke' }
    expect(findInteractable(mesh)?.spec.id).toBe('inner')
  })
  it('returns null without a spec', () => {
    expect(findInteractable(new THREE.Mesh())).toBeNull()
    expect(findInteractable(null)).toBeNull()
  })
})

describe('resolveTarget', () => {
  it('accepts an interactable within the default distance', () => {
    const { mesh } = tree()
    expect(resolveTarget([{ object: mesh, distance: 2 }])?.spec.id).toBe('photo:a')
  })
  it('filters by distance (default and per-spec)', () => {
    const { mesh, root } = tree()
    expect(resolveTarget([{ object: mesh, distance: DEFAULT_INTERACT_DISTANCE + 0.01 }])).toBeNull()
    root.userData.interactable.maxDistance = 8
    expect(resolveTarget([{ object: mesh, distance: 7 }])?.distance).toBe(7)
    root.userData.interactable.maxDistance = 1
    expect(resolveTarget([{ object: mesh, distance: 1.5 }])).toBeNull()
  })
  it('a solid mesh in front blocks', () => {
    const { mesh, wall } = tree()
    expect(resolveTarget([{ object: wall, distance: 1 }, { object: mesh, distance: 2 }])).toBeNull()
  })
  it('a thin occluder just in front does not block', () => {
    const { mesh, wall } = tree()
    expect(resolveTarget([{ object: wall, distance: 2 }, { object: mesh, distance: 2.05 }])?.spec.id).toBe('photo:a')
  })
  it('empty hits -> null', () => {
    expect(resolveTarget([])).toBeNull()
  })
})

describe('tap detection', () => {
  it('short and still is a tap', () => {
    const t = startTap(100, 100, 0)
    expect(isTap(t, 104, 103, 200)).toBe(true)
  })
  it('too long is not a tap', () => {
    expect(isTap(startTap(0, 0, 0), 0, 0, 300)).toBe(false)
  })
  it('moving away and back is not a tap', () => {
    let t = startTap(0, 0, 0)
    t = moveTap(t, 30, 0)
    expect(isTap(t, 1, 0, 100)).toBe(false)
  })
  it('moving 12px or more on release is not a tap', () => {
    expect(isTap(startTap(0, 0, 0), 12, 0, 50)).toBe(false)
  })
  it('only the canvas or a look surface counts', () => {
    const canvas = document.createElement('canvas')
    const surface = document.createElement('div')
    surface.setAttribute('data-look-surface', '')
    const inner = document.createElement('span')
    surface.appendChild(inner)
    const button = document.createElement('button')
    expect(isTapSurface(canvas, canvas)).toBe(true)
    expect(isTapSurface(inner, canvas)).toBe(true)
    expect(isTapSurface(button, canvas)).toBe(false)
    expect(isTapSurface(null, canvas)).toBe(false)
  })
})

describe('prompt text', () => {
  it('desktop', () => {
    expect(desktopPrompt('Read review')).toBe('[E] Read review')
    expect(desktopPrompt('  Sit down ')).toBe('[E] Sit down')
  })
  it('touch', () => {
    expect(touchPrompt('Read review')).toBe('Tap to read review')
    expect(touchPrompt('')).toBe('Tap')
  })
})

describe('outline sizing', () => {
  it('grows each axis by the thickness', () => {
    const { scale, flat } = hullScale([0.5, 0.25, 1], [1, 2, 1], 0.05)
    expect(flat).toBe(false)
    expect(scale[0]).toBeCloseTo(1.1)
    expect(scale[1]).toBeCloseTo(1.1)
    expect(scale[2]).toBeCloseTo(1.05)
  })
  it('flat axes keep scale 1', () => {
    const { scale, flat } = hullScale([0.5, 0.5, 0], [1, 1, 1], 0.05)
    expect(flat).toBe(true)
    expect(scale[2]).toBe(1)
  })
  it('thickness is clamped', () => {
    expect(outlineThickness(0)).toBeCloseTo(0.006)
    expect(outlineThickness(100)).toBeCloseTo(0.03)
  })
})
