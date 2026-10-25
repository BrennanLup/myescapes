import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { interactable, DEFAULT_INTERACT_DISTANCE } from '@/contracts/interaction'
import {
  desktopPrompt,
  findInteractable,
  hullScale,
  armClickSwallow,
  insideRimHole,
  rimHalfExtents,
  RIM_OPEN_AXIS,
  shouldSwallowClick,
  CLICK_SWALLOW_MS,
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

describe('flat hull rim', () => {
  it('opens the flat axis and keeps the footprint on the others', () => {
    expect(rimHalfExtents([0.5, 0.25, 0], [2, 2, 2])).toEqual([0.5, 0.25, RIM_OPEN_AXIS])
    expect(rimHalfExtents([0.5, 0.25, 0.1], [1, 1, 1])).toEqual([0.5, 0.25, 0.1])
  })
  it('discards the interior (the chalk writing / photo face) and keeps the rim', () => {
    const hole = rimHalfExtents([1.4, 0.85, 0], [1, 1, 1])
    expect(insideRimHole([0, 0, 0.001], [0, 0, 0], hole)).toBe(true)
    expect(insideRimHole([1.39, -0.84, 0], [0, 0, 0], hole)).toBe(true)
    expect(insideRimHole([1.41, 0, 0], [0, 0, 0], hole)).toBe(false)
    expect(insideRimHole([0, -0.86, 0], [0, 0, 0], hole)).toBe(false)
  })
})

describe('ghost-click guard', () => {
  it('swallows a click near the tap inside the window only', () => {
    const s = armClickSwallow(1000, [100, 200])
    expect(shouldSwallowClick(s, 1100, 104, 197)).toBe(true)
    expect(shouldSwallowClick(s, 1100, 300, 200)).toBe(false)
    expect(shouldSwallowClick(s, 1000 + CLICK_SWALLOW_MS + 1, 100, 200)).toBe(false)
    expect(shouldSwallowClick(null, 1000, 100, 200)).toBe(false)
  })
  it('a position-less swallow (pointer lock) eats any click in the window', () => {
    const s = armClickSwallow(0, null)
    expect(shouldSwallowClick(s, 10, 900, 10)).toBe(true)
  })
})
