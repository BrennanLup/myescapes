/**
 * Plant generators: monstera (split leaves), snake plant (twisted blades), leafy bush,
 * hanging pothos (curving vines with heart leaves), succulent and cactus. Leaves are smooth curved
 * parametric surfaces (no alpha), pots are turned profiles with a rim and soil.
 */
import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'
import type { LivingMat, PartsBuilder } from './builder'
import { deform, lathe, smoothstep, surface, waves, type V2 } from './geo'
import { rng } from './random'

const leafTone = (i: number): LivingMat => (i % 2 ? 'leaf' : 'leafDark')

/**
 * Monstera leaf in its own frame: midrib along +X from the petiole (x = 0), blade across Z, Y up.
 * Each side is a fan of lobes that touch near the midrib and split apart towards the edge.
 */
function monsteraLeaf(L: number, W: number, seed: number): THREE.BufferGeometry {
  const rand = rng(seed)
  const K = 6
  const geos: THREE.BufferGeometry[] = []
  const width = (t: number) => (W / 2) * Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)), 0.62) * (1.08 - 0.3 * t)
  const droop = 0.18 + rand() * 0.12
  const cup = 0.12 + rand() * 0.06
  for (const side of [-1, 1])
    for (let j = 0; j < K; j++) {
      const gap = (0.11 + rand() * 0.05) / K
      const slant = 0.16 + rand() * 0.05
      geos.push(
        surface(4, 5, (q, s, o) => {
          const split = smoothstep(0.38, 1, s)
          const lo = j / K + (j > 0 ? gap * split : 0)
          const hi = (j + 1) / K - (j < K - 1 ? gap * split : 0)
          const tm = lo + (hi - lo) * q
          const t = Math.min(1, tm + slant * s * (1 - tm))
          const x = (t - 0.12) * L
          const z = side * s * width(t)
          const y = cup * W * s * s - droop * L * Math.pow(Math.max(0, t), 2) - 0.03 * L * s * s
          o.set(x, y, z)
        }),
      )
    }
  // Merge the lobes (they share material and frame).
  const merged = mergeIndexed(geos)
  return merged
}

/** Concatenate indexed geometries (position/normal/uv only). */
function mergeIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = []
  const N: number[] = []
  const U: number[] = []
  const I: number[] = []
  let base = 0
  for (const g of geos) {
    const p = g.attributes.position.array
    const n = g.attributes.normal.array
    const u = g.attributes.uv.array
    for (let i = 0; i < p.length; i++) P.push(p[i])
    for (let i = 0; i < n.length; i++) N.push(n[i])
    for (let i = 0; i < u.length; i++) U.push(u[i])
    const idx = g.index!.array
    for (let i = 0; i < idx.length; i++) I.push(idx[i] + base)
    base += g.attributes.position.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
  out.setIndex(I)
  return out
}

/** Heart-shaped pothos/philodendron leaf: base at the origin, pointing +X, folded along the midrib. */
function heartLeaf(L: number, W: number, fold = 0.18): THREE.BufferGeometry {
  return surface(5, 4, (t, v, o) => {
    const s = v * 2 - 1
    const tt = t * 1.08 - 0.08
    const w = (W / 2) * Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)), 0.55) * (1.15 - 0.55 * t)
    o.set(tt * L, Math.abs(s) * w * fold * 2 - 0.12 * L * t * t, s * w)
  })
}

/** Simple pointed oval leaf, cupped (bushes, succulents). */
function ovalLeaf(L: number, W: number, cup = 0.25, curl = 0.1): THREE.BufferGeometry {
  return surface(4, 2, (t, v, o) => {
    const s = v * 2 - 1
    const w = (W / 2) * Math.pow(Math.sin(Math.PI * t), 0.7)
    o.set(t * L, s * s * w * cup - curl * L * t * t, s * w)
  })
}

/** Add a leaf geometry whose base sits at `at`, pointing out at `angle` (around Y), pitched down by `tilt`. */
function placeLeaf(b: PartsBuilder, mat: LivingMat, geo: THREE.BufferGeometry, at: Vec3, angle: number, tilt: number, roll = 0) {
  b.add(mat, geo, at, { rot: [roll, -angle, -tilt] })
}

/** Turned pot with a lip, inner wall and a soil surface. `pos`-relative, base at y = 0. */
export function pot(b: PartsBuilder, r: number, h: number, mat: LivingMat = 'pot', opts: { bowl?: boolean; seed?: number } = {}) {
  const prof: V2[] = opts.bowl
    ? [
        [0, -h * 0.55],
        [r * 0.35, -h * 0.55],
        [r * 0.75, -h * 0.4],
        [r * 0.97, -h * 0.1],
        [r, h * 0.2],
        [r * 1.04, h * 0.32],
        [r * 1.04, h * 0.4],
        [r * 0.97, h * 0.42],
        [r * 0.93, h * 0.3],
      ]
    : [
        [0, 0],
        [r * 0.74, 0],
        [r * 0.78, 0.008],
        [r * 0.8, 0.02],
        [r * 0.97, h - 0.045],
        [r * 1.07, h - 0.04],
        [r * 1.09, h - 0.02],
        [r * 1.08, h],
        [r * 1.02, h + 0.004],
        [r * 0.96, h - 0.004],
        [r * 0.94, h - 0.05],
      ]
  b.lathe(mat, prof, [0, 0, 0], { seg: 32 })
  const soilY = opts.bowl ? h * 0.3 : h - 0.035
  const n = waves(opts.seed ?? 3, 40)
  const soil = deform(lathe([[r * (opts.bowl ? 0.94 : 0.95), soilY - 0.004], [r * 0.6, soilY + 0.004], [0, soilY + 0.008]], 24), (p) => {
    p.y += n(p.x, 0, p.z) * 0.004
  })
  b.add('woodDark', soil, [0, 0, 0], { shadow: false })
}

export function monstera(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    const potH = 0.42 * scale
    pot(b, 0.26 * scale, potH, 'ceramic', { seed })
    b.torus('fabricTeal', 0.262 * scale, 0.022, [0, potH * 0.36, 0], { rot: [Math.PI / 2, 0, 0], seg: 40 })
    const n = 10
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.5
      const reach = (0.2 + rand() * 0.28) * scale
      const hgt = potH + (0.32 + rand() * 0.7) * scale
      const tip: Vec3 = [Math.cos(a) * reach, hgt, Math.sin(a) * reach]
      const base: Vec3 = [Math.cos(a) * 0.03, potH - 0.03, Math.sin(a) * 0.03]
      const mid: Vec3 = [Math.cos(a) * reach * 0.35, potH + (hgt - potH) * 0.6, Math.sin(a) * reach * 0.35]
      b.tube('leafDark', [base, mid, tip], 0.009 * scale, { seg: 10, radial: 5 })
      const len = (0.4 + rand() * 0.2) * scale
      const wide = (0.36 + rand() * 0.12) * scale
      placeLeaf(b, leafTone(i), monsteraLeaf(len, wide, seed + i * 13), tip, a, 0.2 + rand() * 0.4, (rand() - 0.5) * 0.4)
    }
  })
}

/** Snake plant blade: long pointed strap, V-folded, twisting as it rises. Base at the origin, up +Y. */
function snakeBlade(h: number, w: number, twist: number, bend: number, seed: number): THREE.BufferGeometry {
  const n = waves(seed, 3)
  return surface(3, 12, (v, u, o) => {
    const s = v * 2 - 1
    const half = (w / 2) * Math.pow(1 - u, 0.55) * (0.7 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.6 + 0.1)) * 0.5)
    const a = twist * u + n(u * 2, 0, 0) * 0.3
    const lx = s * half
    const lz = Math.abs(s) * half * 0.4
    o.set(lx * Math.cos(a) - lz * Math.sin(a) + bend * u * u * h, u * h, lx * Math.sin(a) + lz * Math.cos(a))
  })
}

export function snakePlant(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    const potH = 0.32 * scale
    const r = 0.19 * scale
    // Tall cylindrical planter with a chunky rim.
    b.lathe('ceramic', [
      [0, 0],
      [r * 0.92, 0],
      [r, 0.012],
      [r, potH - 0.02],
      [r * 1.02, potH - 0.008],
      [r, potH],
      [r * 0.92, potH],
      [r * 0.9, potH - 0.05],
    ], [0, 0, 0], { seg: 32 })
    b.lathe('woodDark', [[r * 0.91, potH - 0.035], [0, potH - 0.028]], [0, 0, 0], { seg: 20, shadow: false })
    const n = 9
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.4
      const rr = 0.065 * scale * (i === 0 ? 0 : 1) * (0.6 + rand() * 0.5)
      const h = (0.55 + rand() * 0.45) * scale
      const w = (0.075 + rand() * 0.03) * scale
      const blade = snakeBlade(h, w, (rand() - 0.5) * 2.2, 0.05 + rand() * 0.12, seed + i)
      b.add(leafTone(i), blade, [Math.cos(a) * rr, potH - 0.04, Math.sin(a) * rr], {
        rot: [Math.sin(a) * 0.06, -a, -Math.cos(a) * 0.06],
      })
    }
  })
}

export function bush(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, 0, () => {
    const potH = 0.3 * scale
    pot(b, 0.22 * scale, potH, 'pot', { seed })
    // Soft inner mass so the leaf cover never shows gaps, then dozens of cupped leaves.
    const n = waves(seed, 9)
    const core = deform(new THREE.IcosahedronGeometry(1, 3), (p) => {
      const k = 1 + n(p.x, p.y, p.z) * 0.12
      p.set(p.x * 0.2 * scale * k, p.y * 0.16 * scale * k, p.z * 0.2 * scale * k)
    })
    const cy = potH + 0.16 * scale
    b.add('leafDark', core, [0, cy, 0])
    const leaves = 70
    for (let i = 0; i < leaves; i++) {
      // Fibonacci-ish spread over the upper part of an ellipsoid.
      const y = 1 - (i / (leaves - 1)) * 1.3
      const rr = Math.sqrt(Math.max(0, 1 - y * y))
      const a = i * 2.399 + rand() * 0.3
      const at: Vec3 = [Math.cos(a) * rr * 0.19 * scale, cy + y * 0.15 * scale, Math.sin(a) * rr * 0.19 * scale]
      const len = (0.1 + rand() * 0.05) * scale
      placeLeaf(b, leafTone(i), ovalLeaf(len, len * 0.55), at, a, -y * 0.9 + 0.1 + rand() * 0.3, (rand() - 0.5) * 0.8)
    }
  })
}

/** Trailing vine: a curving stem with heart leaves along it. `start` local, `dir` = outward heading. */
export function vine(b: PartsBuilder, rand: () => number, start: Vec3, dir: number, length: number, opts: { out?: number; leaf?: number } = {}) {
  const pts: Vec3[] = [start]
  let [x, y, z] = start
  const steps = Math.max(3, Math.round(length / 0.09))
  const out = opts.out ?? 0.05
  for (let k = 1; k <= steps; k++) {
    const t = k / steps
    const reach = out * (1 - t) + 0.008
    x += Math.cos(dir) * reach + Math.sin(t * 7 + dir) * 0.012
    z += Math.sin(dir) * reach + Math.cos(t * 6 + dir) * 0.012
    y -= (length / steps) * (0.4 + 0.6 * t)
    pts.push([x, y, z])
  }
  b.tube('leafDark', pts, 0.0035, { seg: steps * 4, radial: 4, shadow: false })
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)))
  const nLeaves = Math.round(length / 0.065)
  const size = opts.leaf ?? 0.075
  for (let k = 0; k < nLeaves; k++) {
    const t = 0.04 + (k / nLeaves) * 0.96
    const p = curve.getPoint(t)
    const side = k % 2 ? 1 : -1
    const ang = dir + side * (0.9 + rand() * 0.6)
    const s = size * (1 - t * 0.35) * (0.8 + rand() * 0.35)
    placeLeaf(b, k % 3 ? 'leaf' : 'leafDark', heartLeaf(s, s * 0.8), [p.x, p.y, p.z], ang, 0.6 + rand() * 0.6, (rand() - 0.5) * 0.6)
  }
}

/** Hanging pothos: bowl on three cords from the ceiling with trailing vines. `pos` = pot centre. */
export function hangingPlant(b: PartsBuilder, pos: Vec3, ceiling: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    pot(b, 0.16, 0.24, 'ceramic', { bowl: true, seed })
    const top = ceiling - pos[1]
    const rimY = 0.24 * 0.4
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const cx = Math.cos(a) * 0.168
      const cz = Math.sin(a) * 0.168
      // Cords: under the bowl lip, up to a brass ring.
      b.tube('woodLight', [[cx * 0.9, -0.04, cz * 0.9], [cx * 1.04, rimY, cz * 1.04], [cx * 0.6, 0.3, cz * 0.6], [0, top - 0.32, 0]], 0.0035, {
        seg: 20,
        radial: 4,
        shadow: false,
      })
    }
    b.torus('brass', 0.018, 0.004, [0, top - 0.31, 0], { seg: 14, radial: 5, shadow: false })
    b.cyl('woodLight', 0.004, 0.004, 0.27, [0, top - 0.165, 0], { seg: 6, shadow: false })
    b.lathe('brass', [[0, top - 0.025], [0.03, top - 0.025], [0.04, top - 0.01], [0.04, top], [0, top]], [0, 0, 0], { seg: 20, shadow: false })
    // Leafy crown.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3
      const rr = 0.03 + rand() * 0.1
      placeLeaf(b, leafTone(i), heartLeaf(0.085, 0.07), [Math.cos(a) * rr, rimY + 0.01, Math.sin(a) * rr], a, -0.3 - rand() * 0.5, (rand() - 0.5) * 0.8)
    }
    // Trailing vines.
    const vines = 7
    for (let v = 0; v < vines; v++) {
      const a = (v / vines) * Math.PI * 2 + rand() * 0.4
      vine(b, rand, [Math.cos(a) * 0.15, rimY, Math.sin(a) * 0.15], a, 0.35 + rand() * 0.55)
    }
  })
}

/** Small table-top succulent rosette. `pos` = base of the pot. */
export function tinyPlant(b: PartsBuilder, pos: Vec3, seed: number, potMat: LivingMat = 'pot') {
  const rand = rng(seed)
  b.group(pos, 0, () => {
    pot(b, 0.065, 0.09, potMat, { seed })
    for (let ring = 0; ring < 3; ring++) {
      const count = 7 - ring * 2
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + ring * 0.5 + rand() * 0.2
        const L = 0.07 - ring * 0.015
        placeLeaf(b, ring % 2 ? 'leaf' : 'leafDark', ovalLeaf(L, L * 0.55, 0.45, -0.15), [0, 0.07 + ring * 0.006, 0], a, -0.35 - ring * 0.35)
      }
    }
  })
}

/** Ribbed cactus (turned with flutes) with an arm and a flower. */
export function cactus(b: PartsBuilder, pos: Vec3) {
  const ribbed = (r: number, h: number) =>
    deform(
      lathe(
        Array.from({ length: 10 }, (_, i): V2 => {
          const t = i / 9
          return [t < 0.7 ? r * (1 - 0.05 * t) : r * Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2)), t * h]
        }),
        32,
      ),
      (p) => {
        const rr = Math.hypot(p.x, p.z)
        if (rr < 1e-5) return
        const k = 1 + 0.12 * Math.abs(Math.cos(Math.atan2(p.z, p.x) * 4))
        p.x *= k
        p.z *= k
      },
    )
  b.group(pos, 0.4, () => {
    pot(b, 0.06, 0.08)
    b.add('leafDark', ribbed(0.036, 0.17), [0, 0.07, 0])
    b.add('leafDark', ribbed(0.017, 0.07), [0.06, 0.13, 0])
    b.tube('leafDark', [[0.02, 0.13, 0], [0.05, 0.13, 0], [0.06, 0.14, 0]], 0.014, { seg: 6, radial: 8 })
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      b.sphere('fabricOrange', 0.008, [Math.cos(a) * 0.008, 0.245, Math.sin(a) * 0.008], { w: 8, h: 6, scale: [1, 0.5, 1], shadow: false })
    }
    b.sphere('brass', 0.005, [0, 0.247, 0], { w: 6, h: 4, shadow: false })
  })
}
