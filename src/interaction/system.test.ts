import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus, type AppEvent } from '@/contracts/events'
import { interactable } from '@/contracts/interaction'
import { useStore } from '@/state/store'
import { collectRaycastables } from './InteractionSystem'
import { interactWith, setHoveredSpec } from './controller'

const spec = interactable({ id: 'desk', kind: 'desk', label: 'Record a room', event: { type: 'record:open', payload: {} } })
  .userData.interactable

afterEach(() => {
  useStore.setState({ overlay: null, worldReady: false, hoveredId: null })
  setHoveredSpec(null)
})

describe('collectRaycastables', () => {
  it('collects visible meshes and hit boxes, skips hidden groups and ghosts', () => {
    const scene = new THREE.Scene()
    const wall = new THREE.Mesh(new THREE.BoxGeometry())
    const beam = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))
    const hidden = new THREE.Group()
    hidden.visible = false
    hidden.add(new THREE.Mesh(new THREE.BoxGeometry()))
    const inter = new THREE.Group()
    Object.assign(inter.userData, { interactable: { ...spec, maxDistance: 9 } })
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry())
    hitbox.visible = false
    inter.add(hitbox)
    scene.add(wall, beam, hidden, inter)
    const c = collectRaycastables(scene)
    expect(c.meshes).toEqual([wall, hitbox])
    expect(c.maxFar).toBe(9)
    expect(c.interactables).toBe(1)
  })
})

describe('interactWith', () => {
  it('emits the spec event, interact and sfx when enabled', () => {
    useStore.setState({ worldReady: true, overlay: null })
    const seen: AppEvent[] = []
    const off = bus.onAny((e) => seen.push(e))
    expect(interactWith(spec)).toBe(true)
    off()
    expect(seen.map((e) => e.type)).toEqual(['record:open', 'interact', 'sfx'])
    expect(seen[1].payload).toEqual({ id: 'desk', kind: 'desk' })
  })
  it('does nothing when an overlay is open or the world is not ready', () => {
    useStore.setState({ worldReady: false })
    expect(interactWith(spec)).toBe(false)
    useStore.setState({ worldReady: true, overlay: { kind: 'wrap' } })
    expect(interactWith(spec)).toBe(false)
  })
})

describe('setHoveredSpec', () => {
  it('writes the store and emits hover:changed only on change', () => {
    const seen: unknown[] = []
    const off = bus.on('hover:changed', (p) => seen.push(p))
    setHoveredSpec(spec)
    setHoveredSpec(spec)
    setHoveredSpec(null)
    off()
    expect(seen).toEqual([{ id: 'desk', kind: 'desk' }, { id: null, kind: null }])
    expect(useStore.getState().hoveredId).toBeNull()
  })
})
