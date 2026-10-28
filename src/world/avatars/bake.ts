/**
 * Bakes a character's many small meshes into a few: one merged mesh per joint and finish, coloured
 * per vertex. `Character.tsx` keeps describing the look as ordinary JSX meshes (easy to read and
 * edit); after each render with a new look, `bakeCharacter` hides those meshes and adds the merged
 * ones under the same joints, so the animation still moves them. A character goes from about 40
 * draw calls to about 12, which is what lets a full home of 12 people run on a phone.
 *
 * - Meshes are grouped by their nearest joint (`joints`), or the root when none is above them.
 * - Within a joint they are grouped by finish (`matte`, `satin`, `metal`): roughness and metalness
 *   are rounded to three shared vertex-colour materials. Flat-shaded parts get face normals.
 * - Meshes with an emissive glow, a texture or transparency stay as they are (a lantern, the
 *   headphone accent): there are only a couple and they need their own material.
 * - Small details (a group flagged `userData.detail`) are baked twice where a joint has them:
 *   a "near" mesh with them and a "far" one without, so far-away people skip them for free.
 *
 * Pure three.js (no React), unit-tested in bake.test.ts.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Finish = 'matte' | 'satin' | 'metal'

const FINISH: Record<Finish, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.82, metalness: 0 },
  satin: { roughness: 0.4, metalness: 0.05 },
  metal: { roughness: 0.36, metalness: 0.6 },
}

/** Which shared finish a material is baked into, or null to keep it as its own mesh. */
export function finishOf(material: THREE.Material | THREE.Material[]): Finish | null {
  if (Array.isArray(material)) return null
  const m = material as THREE.MeshStandardMaterial
  if (!m.isMeshStandardMaterial || m.transparent || m.map || m.alphaTest > 0) return null
  if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) return null
  if (m.metalness >= 0.3) return 'metal'
  if (m.roughness < 0.6) return 'satin'
  return 'matte'
}

const baked = new Map<Finish, THREE.MeshStandardMaterial>()

/** The shared vertex-colour material for a finish (one per finish for every character). */
export function bakedMaterial(finish: Finish): THREE.MeshStandardMaterial {
  let m = baked.get(finish)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, ...FINISH[finish] })
    m.name = `avatar:baked:${finish}`
    m.userData.baked = finish
    baked.set(finish, m)
  }
  return m
}

/** What a bake added: the merged meshes, and which ones to show near or far. */
export interface Baked {
  meshes: THREE.Mesh[]
  /** Shown only near (they include the small details). */
  near: THREE.Mesh[]
  /** Shown only far (the same joint without the details). */
  far: THREE.Mesh[]
}

export const EMPTY_BAKE: Baked = { meshes: [], near: [], far: [] }

interface Part {
  mesh: THREE.Mesh
  segment: THREE.Object3D
  detail: boolean
  finish: Finish
}

const tmpInv = new THREE.Matrix4()
const tmpRel = new THREE.Matrix4()
const tmpColor = new THREE.Color()

/** Removes a previous bake (and frees its geometry). */
export function unbake(b: Baked): void {
  for (const m of b.meshes) {
    m.removeFromParent()
    m.geometry.dispose()
  }
}

/**
 * Merges the meshes under `root` (see the file comment). `previous` is removed first. Returns the
 * new bake; the original meshes are left in place but hidden.
 */
export function bakeCharacter(root: THREE.Object3D, joints: ReadonlySet<THREE.Object3D>, castShadow: boolean, previous: Baked = EMPTY_BAKE): Baked {
  unbake(previous)
  root.updateMatrixWorld(true)
  const parts: Part[] = []
  const walk = (o: THREE.Object3D, segment: THREE.Object3D, detail: boolean) => {
    if (o.userData.baked) return
    const seg = o !== root && joints.has(o) ? o : segment
    const det = detail || !!o.userData.detail
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      // A faded or lifted copy (see fadeCharacter, RemotePlayers) bakes as the material it came from.
      if (!Array.isArray(mesh.material)) mesh.material = baseMaterial(mesh.material)
      const finish = mesh.geometry.attributes.position ? finishOf(mesh.material) : null
      if (finish) {
        parts.push({ mesh, segment: seg, detail: det, finish })
        mesh.visible = false
      } else {
        // Kept as is (glows): still shown, still part of the shadow pass.
        mesh.visible = true
        mesh.castShadow = castShadow
      }
    }
    for (const c of o.children) walk(c, seg, det)
  }
  walk(root, root, false)

  const out: Baked = { meshes: [], near: [], far: [] }
  const bySegment = new Map<THREE.Object3D, Part[]>()
  for (const p of parts) {
    const list = bySegment.get(p.segment)
    if (list) list.push(p)
    else bySegment.set(p.segment, [p])
  }
  for (const [segment, list] of bySegment) {
    const hasDetail = list.some((p) => p.detail)
    const variants: Array<{ parts: Part[]; kind: 'all' | 'near' | 'far' }> = hasDetail
      ? [
          { parts: list, kind: 'near' },
          { parts: list.filter((p) => !p.detail), kind: 'far' },
        ]
      : [{ parts: list, kind: 'all' }]
    tmpInv.copy(segment.matrixWorld).invert()
    for (const v of variants) {
      for (const finish of ['matte', 'satin', 'metal'] as const) {
        const group = v.parts.filter((p) => p.finish === finish)
        if (!group.length) continue
        const geometry = mergeParts(group)
        if (!geometry) continue
        const mesh = new THREE.Mesh(geometry, bakedMaterial(finish))
        mesh.name = `baked:${finish}:${v.kind}`
        mesh.userData.baked = true
        mesh.castShadow = castShadow
        if (v.kind === 'far') mesh.visible = false
        segment.add(mesh)
        out.meshes.push(mesh)
        if (v.kind === 'near') out.near.push(mesh)
        if (v.kind === 'far') out.far.push(mesh)
      }
    }
  }
  return out
}

/** The shared material behind a faded (`fadeSource`) or lifted (`source`) copy. */
export function baseMaterial(m: THREE.Material): THREE.Material {
  let out = m
  for (let i = 0; i < 4; i++) {
    const next = (out.userData.fadeSource ?? out.userData.source) as THREE.Material | undefined
    if (!next) break
    out = next
  }
  return out
}

/** One geometry for parts that share a joint (`tmpInv` = the joint's inverse world matrix). */
function mergeParts(parts: Part[]): THREE.BufferGeometry | null {
  const geoms: THREE.BufferGeometry[] = []
  for (const { mesh } of parts) {
    const src = mesh.geometry
    const g = src.index ? src.toNonIndexed() : src.clone()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.morphAttributes = {}
    g.clearGroups()
    tmpRel.multiplyMatrices(tmpInv, mesh.matrixWorld)
    g.applyMatrix4(tmpRel)
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat.flatShading || !g.attributes.normal) g.computeVertexNormals() // non-indexed: one normal per face
    const n = g.attributes.position.count
    const colors = new Float32Array(n * 3)
    tmpColor.copy(mat.color)
    for (let i = 0; i < n; i++) {
      colors[i * 3] = tmpColor.r
      colors[i * 3 + 1] = tmpColor.g
      colors[i * 3 + 2] = tmpColor.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geoms.push(g)
  }
  const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false)
  if (geoms.length > 1) for (const g of geoms) g.dispose()
  if (!merged) return null
  merged.computeBoundingSphere()
  return merged
}

/** Shows the near or far version of each joint that has small details. */
export function showDetail(b: Baked, near: boolean): void {
  for (const m of b.near) m.visible = near
  for (const m of b.far) m.visible = !near
}

/**
 * Fades every visible mesh under `root` to `opacity` with private transparent copies of its
 * materials (kept in `cache`, so the shared materials and other characters are untouched).
 * At 1 the shared materials come back.
 */
export function fadeCharacter(root: THREE.Object3D, opacity: number, cache: Map<THREE.Material, THREE.Material>): void {
  const solid = opacity >= 0.999
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const current = mesh.material
    const source = (current.userData.fadeSource as THREE.Material | undefined) ?? current
    if (solid) {
      if (current !== source) mesh.material = source
      return
    }
    // Hidden meshes (the originals behind a bake) keep their shared material: the bake reads it.
    if (!mesh.visible) return
    let copy = cache.get(source)
    if (!copy) {
      copy = source.clone()
      copy.transparent = true
      copy.userData = { ...source.userData, fadeSource: source }
      copy.name = `${source.name}:faded`
      cache.set(source, copy)
    }
    copy.opacity = (source.opacity ?? 1) * opacity
    if (current !== copy) mesh.material = copy
  })
}

/** Frees the private faded copies made by `fadeCharacter`. */
export function disposeFades(cache: Map<THREE.Material, THREE.Material>): void {
  for (const m of cache.values()) m.dispose()
  cache.clear()
}
