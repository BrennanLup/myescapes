/**
 * Procedural geometry kit for the furniture: soft (rounded, deformable) boxes, lathe profiles,
 * parametric surfaces (leaves, blades, throws), chamfered slabs and smooth normals.
 * Everything returns plain BufferGeometry with position/normal/uv so the builders can merge it.
 */
import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'

export type V2 = [number, number]

/**
 * Smooth normals that ignore UV seams: face normals (area weighted) are averaged over every vertex
 * that shares a position, so deformed spheres/boxes shade smoothly without welding the UVs.
 */
export function smoothNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const slot = new Int32Array(n)
  // Weld key: positions quantised to 0.2 mm, packed into one number while they fit (|v| < 3.2 m).
  const ids = new Map<number | string, number>()
  const q = (v: number) => Math.round(v * 5e3)
  const LIM = 16384
  for (let i = 0; i < n; i++) {
    const x = q(pos.getX(i))
    const y = q(pos.getY(i))
    const z = q(pos.getZ(i))
    const k =
      Math.abs(x) < LIM && Math.abs(y) < LIM && Math.abs(z) < LIM ? ((x + LIM) * 32768 + (y + LIM)) * 32768 + (z + LIM) : `${x},${y},${z}`
    let id = ids.get(k)
    if (id === undefined) ids.set(k, (id = ids.size))
    slot[i] = id
  }
  const acc = new Float32Array(ids.size * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const idx = geo.index
  const tris = idx ? idx.count / 3 : n / 3
  for (let t = 0; t < tris; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(pos, ia)
    b.fromBufferAttribute(pos, ib)
    c.fromBufferAttribute(pos, ic)
    c.sub(b)
    a.sub(b)
    c.cross(a)
    for (const i of [ia, ib, ic]) {
      const s = slot[i] * 3
      acc[s] += c.x
      acc[s + 1] += c.y
      acc[s + 2] += c.z
    }
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const s = slot[i] * 3
    a.set(acc[s], acc[s + 1], acc[s + 2])
    if (a.lengthSq() < 1e-20) a.set(0, 1, 0)
    a.normalize()
    out[i * 3] = a.x
    out[i * 3 + 1] = a.y
    out[i * 3 + 2] = a.z
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3))
  return geo
}

/** Cheap deterministic 3D "noise" (sum of seeded sines), roughly in [-1, 1]. */
export function waves(seed: number, freq = 1): (x: number, y: number, z: number) => number {
  let s = seed * 9301 + 49297
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  const terms = Array.from({ length: 4 }, (_, i) => {
    const f = freq * (1 + i * 0.83)
    return { kx: (r() * 2 - 1) * f, ky: (r() * 2 - 1) * f, kz: (r() * 2 - 1) * f, p: r() * Math.PI * 2, w: 1 / (1 + i * 0.6) }
  })
  const norm = terms.reduce((acc, t) => acc + t.w, 0)
  return (x, y, z) => terms.reduce((acc, t) => acc + Math.sin(t.kx * x + t.ky * y + t.kz * z + t.p) * t.w, 0) / norm
}

export interface SoftBoxOpts {
  /** Corner/edge radius. */
  radius: number
  /** Segments across each rounded edge (default 3). */
  edgeSeg?: number
  /** Segments across the flat middle of each axis (default derived from the size). */
  seg?: [number, number, number]
  /** Called with the rounded position (mutable) and its normalised coordinates in [-1, 1]^3. */
  deform?: (p: THREE.Vector3, u: THREE.Vector3) => void
}

/**
 * Rounded box built from a subdivided box: corners are pushed onto spheres of `radius`, so the
 * whole thing is one watertight smooth surface that can then be deformed (sag, puff, wrinkles).
 */
export function softBox(size: Vec3, o: SoftBoxOpts): THREE.BufferGeometry {
  const half = size.map((s) => s / 2)
  const r = Math.max(0.001, Math.min(o.radius, Math.min(...half) - 0.0005))
  const k = o.edgeSeg ?? 3
  const inner = half.map((h) => h - r)
  const mids = o.seg ?? (size.map((s) => Math.max(1, Math.min(8, Math.round((s - 2 * r) / 0.12)))) as [number, number, number])
  const N = mids.map((m) => m + 2 * k)
  const samples = [0, 1, 2].map((ax) => {
    const H = half[ax]
    const I = inner[ax]
    const n = N[ax]
    const m = mids[ax]
    return Array.from({ length: n + 1 }, (_, i) => {
      if (i <= k) return -H + (r * i) / k
      if (i >= n - k) return H - (r * (n - i)) / k
      return -I + (2 * I * (i - k)) / m
    })
  })
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2], N[0], N[1], N[2])
  geo.deleteAttribute('normal')
  const pos = geo.attributes.position as THREE.BufferAttribute
  const p = new THREE.Vector3()
  const c = new THREE.Vector3()
  const u = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const v = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    for (let ax = 0; ax < 3; ax++) {
      const t = Math.round((v[ax] / size[ax] + 0.5) * N[ax])
      v[ax] = samples[ax][Math.max(0, Math.min(N[ax], t))]
    }
    p.set(v[0], v[1], v[2])
    c.set(
      THREE.MathUtils.clamp(p.x, -inner[0], inner[0]),
      THREE.MathUtils.clamp(p.y, -inner[1], inner[1]),
      THREE.MathUtils.clamp(p.z, -inner[2], inner[2]),
    )
    const d = p.clone().sub(c)
    if (d.lengthSq() > 1e-12) p.copy(c).add(d.normalize().multiplyScalar(r))
    if (o.deform) {
      u.set(p.x / half[0], p.y / half[1], p.z / half[2])
      o.deform(p, u)
    }
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  return smoothNormals(geo)
}

export interface CushionOpts {
  /** Top crown (m) the middle of the top face rises by. */
  crown?: number
  /** Dip in the middle of the top (m), e.g. where someone sat. */
  sag?: number
  /** How far the four side faces bulge outward (m). */
  bulge?: number
  /** Extra bulge of the +Z face only (back cushions). */
  front?: number
  /** Pinch the four vertical edges in (pillows), 0..1. */
  pinch?: number
  /** Wrinkle amplitude (m). */
  wrinkle?: number
  seed?: number
}

/** Deform function for upholstery: crown, sag, bulging sides, pinched pillow corners, wrinkles. */
export function cushion(o: CushionOpts): (p: THREE.Vector3, u: THREE.Vector3) => void {
  const n = waves(o.seed ?? 1, 9)
  const n2 = waves((o.seed ?? 1) + 7, 23)
  return (p, u) => {
    const fx = Math.max(0, 1 - u.x * u.x)
    const fy = Math.max(0, 1 - u.y * u.y)
    const fz = Math.max(0, 1 - u.z * u.z)
    if (u.y > 0) p.y += ((o.crown ?? 0) - (o.sag ?? 0) * fx * fz) * fx * fz * Math.min(1, u.y * 1.5)
    if (o.bulge) {
      p.x += Math.sign(u.x) * o.bulge * fy * fz * Math.abs(u.x)
      p.z += Math.sign(u.z) * o.bulge * fy * fx * Math.abs(u.z)
    }
    if (o.front && u.z > 0) p.z += o.front * fx * fy * u.z
    if (o.pinch) {
      // Pillow: thickness collapses towards the corners.
      const edge = 1 - fx * fz
      p.z *= 1 - o.pinch * edge * 0.85
    }
    if (o.wrinkle) {
      const w = n(p.x, p.y, p.z) * 0.6 + n2(p.x, p.y, p.z) * 0.4
      const len = Math.hypot(u.x, u.y, u.z) || 1
      p.x += (u.x / len) * w * o.wrinkle
      p.y += (u.y / len) * w * o.wrinkle
      p.z += (u.z / len) * w * o.wrinkle
    }
  }
}

/** Lathe from a radius/height profile (bottom to top for an outward-facing surface). */
export function lathe(points: V2[], seg = 24): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    seg,
  )
}

/** Smooth tube through local points. */
export function tube(points: Vec3[], radius: number, seg = 24, radial = 6, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
    'centripetal',
  )
  return new THREE.TubeGeometry(curve, seg, radius, radial, closed)
}

/** Helix (springs) along +Y from y0 to y1. */
export function helix(r: number, y0: number, y1: number, turns: number, wire: number, seg = 64): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const a = t * turns * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + (y1 - y0) * t, Math.sin(a) * r))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, wire, 4, false)
}

/**
 * Parametric surface: `fn(u, v, out)` for u, v in [0, 1]. Returns an indexed grid with smooth normals.
 * `thick` > 0 adds a back face offset along the normal (two-sided sheets with a real thickness).
 */
export function surface(nu: number, nv: number, fn: (u: number, v: number, out: THREE.Vector3) => void, thick = 0): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3()
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, p)
      pos.push(p.x, p.y, p.z)
      uv.push(i / nu, j / nv)
    }
  const row = nu + 1
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * row + i
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row)
    }
  let geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  if (thick > 0) geo = thicken(geo, thick)
  return geo
}

/** Adds a reversed copy of an indexed sheet offset by `t` against its normals. */
export function thicken(geo: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nrm = geo.attributes.normal as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const idx = geo.index!
  const n = pos.count
  const P = new Float32Array(n * 6)
  const N = new Float32Array(n * 6)
  const U = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const pv = pos.array[i * 3 + k]
      const nv = nrm.array[i * 3 + k]
      P[i * 3 + k] = pv
      N[i * 3 + k] = nv
      P[(n + i) * 3 + k] = pv - nv * t
      N[(n + i) * 3 + k] = -nv
    }
    U[i * 2] = uv.array[i * 2]
    U[i * 2 + 1] = uv.array[i * 2 + 1]
    U[(n + i) * 2] = uv.array[i * 2]
    U[(n + i) * 2 + 1] = uv.array[i * 2 + 1]
  }
  const I: number[] = Array.from(idx.array as ArrayLike<number>)
  const m = I.length
  for (let i = 0; i < m; i += 3) I.push(I[i] + n, I[i + 2] + n, I[i + 1] + n)
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(P, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2))
  out.setIndex(I)
  geo.dispose()
  return out
}

/** Rounded-rectangle shape centred on the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  r = Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005)
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/**
 * A horizontal slab (table top, desk top, shelf board) of footprint w x d and thickness t, with
 * rounded plan corners `r` and a bevelled edge `bevel`. Centred on the origin.
 */
export function slab(w: number, t: number, d: number, r: number, bevel: number, bevelSeg = 2): THREE.BufferGeometry {
  const bv = Math.min(bevel, t / 2 - 0.0005)
  const geo = new THREE.ExtrudeGeometry(roundedRect(w - bv * 2, d - bv * 2, Math.max(0.001, r - bv)), {
    depth: t - bv * 2,
    bevelEnabled: true,
    bevelThickness: bv,
    bevelSize: bv,
    bevelSegments: bevelSeg,
    curveSegments: 4,
  })
  // Extruded along +Z: lay it flat (shape y -> -z) and centre it.
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, -(t - bv * 2) / 2, 0)
  // Area-weighted smoothing keeps the big top flat while the thin bevel strips round off.
  return smoothNormals(geo)
}

/** Deform every vertex of a geometry (then recompute smooth normals). */
export function deform(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const p = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    fn(p)
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  return smoothNormals(geo)
}

/** Scale a geometry's UVs (e.g. so a fabric weave is not stretched over a big bean bag). */
export function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return geo
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Total triangle count of a list of geometries. */
export function triangles(geos: THREE.BufferGeometry[]): number {
  return geos.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count) / 3, 0)
}
