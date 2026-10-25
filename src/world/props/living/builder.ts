/**
 * Tiny geometry "kit-bash" builder. Every primitive is transformed into world
 * space and bucketed by (material, castShadow); `build()` merges each bucket into
 * one BufferGeometry so the whole living set costs one draw call per material.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MaterialId } from '@/contracts/materials'
import type { Vec3 } from '@/contracts/scene'

/** Shared material ids plus a few local tints (cloned from shared materials). */
export type LivingMat = MaterialId | 'leafDark' | 'vinyl'

export interface PartOpts {
  /** Euler rotation (XYZ order), radians. */
  rot?: Vec3
  scale?: Vec3
  /** Cast shadows (default true). */
  shadow?: boolean
}

export interface BuiltPart {
  key: string
  mat: LivingMat
  castShadow: boolean
  geometry: THREE.BufferGeometry
}

const KEEP = new Set(['position', 'normal', 'uv'])

function normalise(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name)
  g.clearGroups()
  return g
}

export class PartsBuilder {
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  private buckets = new Map<string, { mat: LivingMat; castShadow: boolean; geos: THREE.BufferGeometry[] }>()
  /** Named world-space points (e.g. lamp shade centres) for tests and wiring. */
  readonly marks = new Map<string, Vec3>()

  private get top() {
    return this.stack[this.stack.length - 1]
  }

  /** Run `fn` inside a local frame translated to `pos` and rotated by `rotY` (and optional full Euler). */
  group(pos: Vec3, rotY: number, fn: () => void, rot?: Vec3) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, rotY, 0]))),
      new THREE.Vector3(1, 1, 1),
    )
    this.stack.push(this.top.clone().multiply(m))
    try {
      fn()
    } finally {
      this.stack.pop()
    }
  }

  /** Current local -> world matrix (copy). */
  matrix(): THREE.Matrix4 {
    return this.top.clone()
  }

  mark(name: string, pos: Vec3) {
    const v = new THREE.Vector3(...pos).applyMatrix4(this.top)
    this.marks.set(name, [v.x, v.y, v.z])
  }

  add(mat: LivingMat, geo: THREE.BufferGeometry, pos: Vec3, opts: PartOpts = {}) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(opts.scale ?? [1, 1, 1])),
    )
    const g = normalise(geo)
    g.applyMatrix4(this.top.clone().multiply(local))
    const castShadow = opts.shadow ?? true
    const key = `${mat}|${castShadow ? 's' : 'n'}`
    let b = this.buckets.get(key)
    if (!b) this.buckets.set(key, (b = { mat, castShadow, geos: [] }))
    b.geos.push(g)
  }

  /** Box of full `size`, centred at `pos`. `radius` > 0 makes a chunky rounded box. */
  box(mat: LivingMat, size: Vec3, pos: Vec3, opts: PartOpts & { radius?: number } = {}) {
    const r = Math.min(opts.radius ?? 0, Math.min(...size) / 2 - 0.001)
    const geo = r > 0.002 ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, r) : new THREE.BoxGeometry(...size)
    this.add(mat, geo, pos, opts)
  }

  /** Cylinder (or cone when rTop = 0) of height `h`, centred at `pos`. */
  cyl(mat: LivingMat, rTop: number, rBot: number, h: number, pos: Vec3, opts: PartOpts & { seg?: number } = {}) {
    this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, opts.seg ?? 10, 1), pos, opts)
  }

  /** Low-poly sphere (use `scale` to squash). */
  sphere(mat: LivingMat, r: number, pos: Vec3, opts: PartOpts & { w?: number; h?: number } = {}) {
    this.add(mat, new THREE.SphereGeometry(r, opts.w ?? 10, opts.h ?? 7), pos, opts)
  }

  /** Faceted blob (icosahedron), nice for foliage. */
  blob(mat: LivingMat, r: number, pos: Vec3, opts: PartOpts & { detail?: number } = {}) {
    this.add(mat, new THREE.IcosahedronGeometry(r, opts.detail ?? 1), pos, opts)
  }

  torus(mat: LivingMat, r: number, tube: number, pos: Vec3, opts: PartOpts & { arc?: number } = {}) {
    this.add(mat, new THREE.TorusGeometry(r, tube, 6, 14, opts.arc ?? Math.PI * 2), pos, opts)
  }

  /** Thin cylinder between two local points. */
  rod(mat: LivingMat, from: Vec3, to: Vec3, radius: number, opts: { shadow?: boolean; seg?: number } = {}) {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    const e = new THREE.Euler().setFromQuaternion(q)
    this.cyl(mat, radius, radius, len, [mid.x, mid.y, mid.z], { rot: [e.x, e.y, e.z], seg: opts.seg ?? 6, shadow: opts.shadow })
  }

  build(): BuiltPart[] {
    const out: BuiltPart[] = []
    for (const [key, b] of this.buckets) {
      const geometry = mergeGeometries(b.geos, false)
      b.geos.forEach((g) => g.dispose())
      if (!geometry) continue
      geometry.computeBoundingSphere()
      geometry.computeBoundingBox()
      out.push({ key, mat: b.mat, castShadow: b.castShadow, geometry })
    }
    return out
  }
}
