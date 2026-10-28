/**
 * In-Canvas interaction system: centre-screen raycast (~30 Hz), hover state,
 * inverted-hull highlight and click / E / tap handling.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { DEFAULT_INTERACT_DISTANCE } from '@/contracts/interaction'
import { playerView } from '@/player/view'
import { selectControlsEnabled, useStore } from '@/state/store'
import { setHoveredSpec } from './controller'
import { attachInteractionInput } from './input'
import { OutlineHulls } from './outline'
import { findInteractable, resolveTarget, type ResolvedTarget } from './logic'

const TICK = 1 / 30
const RECOLLECT = 0.5

/** Meshes worth raycasting: everything visible (occluders) plus hitboxes under interactables. */
export function collectRaycastables(scene: THREE.Object3D): { meshes: THREE.Mesh[]; maxFar: number; interactables: number } {
  const meshes: THREE.Mesh[] = []
  let maxFar = DEFAULT_INTERACT_DISTANCE
  let interactables = 0
  const walk = (o: THREE.Object3D, inside: boolean) => {
    const ud = o.userData
    if (ud.interactionIgnore || ud.raycastIgnore || ud.noRaycast) return
    const spec = ud.interactable as { maxDistance?: number } | undefined
    const here = inside || !!spec
    if (spec) {
      interactables++
      if (spec.maxDistance && spec.maxDistance > maxFar) maxFar = spec.maxDistance
    }
    const mesh = o as THREE.Mesh
    if (!o.visible) {
      // Hidden groups vanish entirely; a hidden mesh inside an interactable is a hit box.
      if (!(mesh.isMesh && here)) return
    }
    if (mesh.isMesh && mesh.geometry?.attributes?.position) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined
      // Glows / light beams (transparent, no depth write) never block or catch rays.
      const ghost = !!mat && mat.transparent && !mat.depthWrite
      if (here || !ghost) meshes.push(mesh)
    }
    for (const c of o.children) walk(c, here)
  }
  walk(scene, false)
  return { meshes, maxFar, interactables }
}

function attachedToScene(o: THREE.Object3D, scene: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o
  while (cur) {
    if (cur === scene) return true
    cur = cur.parent
  }
  return false
}

export function InteractionSystem() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const outline = useMemo(() => new OutlineHulls(), [])
  const state = useRef({
    acc: TICK,
    sinceCollect: RECOLLECT,
    childCount: -1,
    meshes: [] as THREE.Mesh[],
    maxFar: DEFAULT_INTERACT_DISTANCE,
    target: null as ResolvedTarget<THREE.Object3D> | null,
  })
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  // Outline group lives at the scene root (its hulls copy source world matrices).
  useEffect(() => {
    scene.add(outline.group)
    return () => {
      outline.clear()
      scene.remove(outline.group)
      setHoveredSpec(null)
    }
  }, [scene, outline])

  /** Raycast from NDC (x, y) and resolve the interactable target (or null). */
  const castRef = useRef<(ndc: THREE.Vector2) => ResolvedTarget<THREE.Object3D> | null>(() => null)
  castRef.current = (ndc) => {
    const st = state.current
    raycaster.setFromCamera(ndc, camera)
    // Third person: start at the character (reach is from you, and your own body never blocks).
    if (playerView.rayStart > 0) raycaster.ray.origin.addScaledVector(raycaster.ray.direction, playerView.rayStart)
    raycaster.near = 0
    raycaster.far = st.maxFar + 0.5
    const ray = raycaster.ray
    const sphere = _sphere
    const candidates: THREE.Mesh[] = []
    for (const m of st.meshes) {
      const g = m.geometry
      if (!g.boundingSphere) g.computeBoundingSphere()
      if (!g.boundingSphere) continue
      sphere.copy(g.boundingSphere).applyMatrix4(m.matrixWorld)
      // Cheap reject: sphere misses the ray, or starts beyond the reach.
      if (ray.origin.distanceTo(sphere.center) - sphere.radius > raycaster.far) continue
      if (!ray.intersectsSphere(sphere)) continue
      candidates.push(m)
    }
    if (candidates.length === 0) return null
    _hits.length = 0
    raycaster.intersectObjects(candidates, false, _hits)
    _hits.sort((a, b) => a.distance - b.distance)
    return resolveTarget(_hits)
  }

  const applyTarget = (t: ResolvedTarget<THREE.Object3D> | null) => {
    state.current.target = t
    outline.setTarget(t?.root ?? null)
    setHoveredSpec(t?.spec ?? null)
  }

  useFrame((_, delta) => {
    const st = state.current
    const enabled = selectControlsEnabled(useStore.getState())
    st.sinceCollect += delta
    if (st.sinceCollect >= RECOLLECT || scene.children.length !== st.childCount) {
      st.sinceCollect = 0
      st.childCount = scene.children.length
      const c = collectRaycastables(scene)
      st.meshes = c.meshes
      st.maxFar = c.maxFar
    }
    if (!enabled) {
      if (st.target) applyTarget(null)
      return
    }
    // A target that was unmounted or re-labelled must not linger.
    if (st.target && !attachedToScene(st.target.root, scene)) applyTarget(null)
    st.acc += delta
    if (st.acc >= TICK) {
      st.acc = 0
      const t = castRef.current(_centre)
      const live = t ? findInteractable(t.root) : null
      if (t && live) t.spec = live.spec
      if (t?.root !== st.target?.root || t?.spec !== st.target?.spec) applyTarget(t)
      else st.target = t
    }
    outline.update(camera.position, performance.now() / 1000)
  })

  // Input: mouse click while pointer-locked, E key, touch tap on the canvas / look surfaces.
  useEffect(
    () =>
      attachInteractionInput(gl.domElement, (x, y) => {
        _ndc.set(x, y)
        return castRef.current(_ndc)?.spec ?? null
      }),
    [gl],
  )

  return null
}

const _centre = new THREE.Vector2(0, 0)
const _ndc = new THREE.Vector2()
const _sphere = new THREE.Sphere()
const _hits: THREE.Intersection<THREE.Object3D>[] = []
