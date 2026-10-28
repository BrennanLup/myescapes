/** Living-area furniture: rug, couch, bean bags, pouf, coffee table, side table, lamps. */
import * as THREE from 'three'
import { ROOM, LAMPS, type Vec3 } from '@/contracts/scene'
import type { LivingMat, PartsBuilder } from './builder'
import { cushion, deform, lathe, scaleUv, smoothstep, surface, waves, type V2 } from './geo'
import { BEAN_BAGS, COFFEE_TABLE, COUCH, FLOOR_LAMP, POUF, RUG, SIDE_TABLE } from './layout'
import { tinyPlant } from './plants'
import { rng } from './random'

export function rug(b: PartsBuilder) {
  const [w, d] = RUG.size
  b.group(RUG.center, 0, () => {
    const layer = (mat: LivingMat, sw: number, sd: number, h: number) =>
      b.box(mat, [sw, h, sd], [0, h / 2, 0], { shadow: false, radius: Math.min(0.009, h / 2 - 0.001), seg: 1 })
    layer('rug', w, d, 0.02)
    layer('fabricCream', w - 0.25, d - 0.25, 0.024)
    layer('rug', w - 0.4, d - 0.4, 0.028)
    layer('fabricCream', w - 1.3, d - 1.2, 0.032)
    layer('fabricOrange', w - 1.45, d - 1.35, 0.036)
    // Woven stripes across the inner field.
    const stripes: LivingMat[] = ['fabricTeal', 'fabricPlum', 'fabricTeal']
    stripes.forEach((m, i) => b.box(m, [w - 1.45, 0.04, 0.07], [0, 0.02, (i - 1) * 0.42], { shadow: false }))
    // Diamond motifs in the border.
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * ((w - 0.6) / 6)
      for (const z of [-(d / 2 - 0.32), d / 2 - 0.32]) {
        b.box('fabricCream', [0.12, 0.032, 0.12], [x, 0.016, z], { rot: [0, Math.PI / 4, 0], shadow: false })
      }
    }
    // Twisted fringe tassels on the short ends, each a little curved strand.
    const rand = rng(77)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 22; i++) {
        const z = -d / 2 + 0.1 + (i * (d - 0.2)) / 21
        const x0 = side * (w / 2 - 0.01)
        const len = 0.08 + rand() * 0.03
        const bend = (rand() - 0.5) * 0.04
        b.tube('fabricCream', [[x0, 0.006, z], [x0 + side * len * 0.5, 0.004, z + bend * 0.5], [x0 + side * len, 0.003, z + bend]], 0.005, {
          seg: 4,
          radial: 4,
          shadow: false,
        })
      }
    }
  })
}

/** Closed rounded-rectangle loop of points in a plane (for piping / welts). */
function loop(w: number, h: number, rc: number, map: (x: number, y: number) => Vec3, perCorner = 4): Vec3[] {
  const pts: Vec3[] = []
  const cs: Array<[number, number, number]> = [
    [w / 2 - rc, h / 2 - rc, 0],
    [-w / 2 + rc, h / 2 - rc, Math.PI / 2],
    [-w / 2 + rc, -h / 2 + rc, Math.PI],
    [w / 2 - rc, -h / 2 + rc, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of cs)
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2)
      pts.push(map(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc))
    }
  return pts
}

/** A welted seam around the top edge of a cushion of `size` centred at `c` (cushion-local axes). */
function topPiping(b: PartsBuilder, mat: LivingMat, size: Vec3, r: number, c: Vec3, rot?: Vec3) {
  const k = r * 0.3
  b.group(c, 0, () => {
    const pts = loop(size[0] - 2 * k, size[2] - 2 * k, r * 0.75, (x, z) => [x, size[1] / 2 - k, z])
    b.tube(mat, pts, 0.0065, { seg: 72, radial: 5, closed: true, shadow: false })
  }, rot ?? [0, 0, 0])
}

/** Welt around the +Z face of a cushion (back cushions). */
function frontPiping(b: PartsBuilder, mat: LivingMat, size: Vec3, r: number, bulge: number, c: Vec3, rot: Vec3) {
  const k = r * 0.3
  b.group(c, 0, () => {
    const pts = loop(size[0] - 2 * k, size[1] - 2 * k, r * 0.75, (x, y) => [x, y, size[2] / 2 - k + bulge * 0.15])
    b.tube(mat, pts, 0.0065, { seg: 72, radial: 5, closed: true, shadow: false })
  }, rot)
}

function taperedLeg(b: PartsBuilder, pos: Vec3, h: number, rTop: number, rBot: number, mat: LivingMat = 'woodDark', splay: Vec3 = [0, 0, 0]) {
  const prof: V2[] = [
    [0, 0],
    [rBot * 0.85, 0],
    [rBot, 0.006],
    [(rBot + rTop) / 2, h * 0.5],
    [rTop, h - 0.004],
    [rTop * 0.9, h],
    [0, h],
  ]
  b.lathe(mat, prof, pos, { seg: 14, rot: splay })
}

export function couch(b: PartsBuilder) {
  const L = COUCH.length
  const D = COUCH.depth
  const mat: LivingMat = 'fabricPlum'
  b.group(COUCH.center, COUCH.rotY, () => {
    const legH = 0.1
    // Tapered, slightly splayed walnut legs (4 corners + 2 centre supports).
    for (const x of [-L / 2 + 0.1, 0, L / 2 - 0.1])
      for (const z of [-D / 2 + 0.09, D / 2 - 0.09]) {
        if (x === 0 && z > 0) continue
        const sx = x === 0 ? 0 : Math.sign(x) * 0.12
        taperedLeg(b, [x, 0, z], legH + 0.01, 0.03, 0.02, 'woodDark', [-Math.sign(z) * 0.12, 0, sx])
      }
    // Upholstered base (sits between the arms) and the back frame.
    b.soft(mat, [L - 0.36, 0.21, D - 0.12], [0, legH + 0.105, 0.05], {
      radius: 0.05,
      deform: cushion({ bulge: 0.008, wrinkle: 0.002, seed: 3 }),
    })
    b.soft(mat, [L - 0.02, 0.64, 0.22], [0, legH + 0.32, -D / 2 + 0.11], {
      radius: 0.07,
      deform: cushion({ crown: 0.01, bulge: 0.01, wrinkle: 0.002, seed: 4 }),
    })
    // Arms: chunky, rounded, a little puffed out.
    for (const s of [-1, 1])
      b.soft(mat, [0.2, 0.58, D], [s * (L / 2 - 0.1), legH + 0.29, 0], {
        radius: 0.085,
        deform: cushion({ crown: 0.012, bulge: 0.012, wrinkle: 0.0025, seed: 10 + s }),
      })
    // Seat cushions: crowned, sagging where people sit, welted top edge.
    const seat: Vec3 = [0.895, 0.16, 0.7]
    ;[-1, 1].forEach((s, i) => {
      const c: Vec3 = [s * 0.45, legH + 0.21 + seat[1] / 2, 0.085]
      b.soft(mat, seat, c, {
        radius: 0.055,
        deform: cushion({ crown: 0.014, sag: 0.022 + i * 0.006, bulge: 0.014, wrinkle: 0.003, seed: 20 + i }),
      })
      topPiping(b, mat, seat, 0.055, c)
    })
    // Back cushions: reclined, plump fronts.
    const back: Vec3 = [0.88, 0.47, 0.2]
    ;[-1, 1].forEach((s, i) => {
      const rot: Vec3 = [-0.17, s * 0.02, 0]
      const c: Vec3 = [s * 0.45, legH + 0.37 + back[1] / 2, -D / 2 + 0.31]
      b.soft(mat, back, c, {
        rot,
        radius: 0.07,
        deform: cushion({ front: 0.035, bulge: 0.012, sag: 0.004, wrinkle: 0.0035, seed: 30 + i }),
      })
      frontPiping(b, mat, back, 0.07, 0.035, c, rot)
    })
    // Throw pillows: plump with pinched corners.
    const pillow = (m: LivingMat, s: number, pos: Vec3, rot: Vec3, seed: number) =>
      b.soft(m, [s, s, 0.19], pos, { rot, radius: 0.075, deform: cushion({ pinch: 0.5, bulge: 0.012, wrinkle: 0.004, seed }) })
    pillow('fabricOrange', 0.42, [-0.7, legH + 0.66, -0.1], [-0.28, 0.22, 0.16], 41)
    pillow('fabricTeal', 0.4, [0.68, legH + 0.65, -0.1], [-0.28, -0.28, -0.14], 42)
    pillow('fabricCream', 0.32, [0.08, legH + 0.6, -0.03], [-0.22, 0.1, 0.48], 43)
    throwBlanket(b, L)
  })
}

/** Knitted throw draped over the right arm: a thick sheet following the arm with soft folds. */
function throwBlanket(b: PartsBuilder, L: number) {
  const top = 0.1 + 0.58 + 0.006
  const path = new THREE.SplineCurve([
    new THREE.Vector2(L / 2 - 0.22, top - 0.004),
    new THREE.Vector2(L / 2 - 0.12, top + 0.008),
    new THREE.Vector2(L / 2 - 0.035, top - 0.008),
    new THREE.Vector2(L / 2 + 0.012, top - 0.07),
    new THREE.Vector2(L / 2 + 0.028, top - 0.24),
    new THREE.Vector2(L / 2 + 0.034, top - 0.42),
  ])
  const W = 0.64
  const z0 = 0.04
  const fold = waves(5, 6)
  const place = (u: number, v: number, out: THREE.Vector3, lift: number) => {
    const p = path.getPoint(u)
    const t = path.getTangent(u)
    const nx = -t.y
    const ny = t.x
    const hang = smoothstep(0.35, 1, u)
    const a = 0.004 + 0.016 * hang
    const f = Math.sin(v * Math.PI * 2 * 3.2 + u * 1.7) * a + fold(u * 3, v * 3, 0) * 0.004 + lift
    const hem = Math.sin(v * Math.PI * 5) * 0.012 * hang * u
    out.set(p.x + nx * f, p.y + ny * f - hem * 0.2, z0 + (0.5 - v) * W + Math.sin(u * 3) * 0.01)
  }
  b.add('fabricCream', surface(20, 24, (u, v, o) => place(u, v, o, 0), 0.008), [0, 0, 0])
  // Two woven stripes.
  for (const v0 of [0.16, 0.78])
    b.add('fabricOrange', surface(20, 3, (u, v, o) => place(u, v0 + v * 0.07, o, 0.0018)), [0, 0, 0], { shadow: false })
  // Tassels along the bottom hem.
  for (let i = 0; i <= 12; i++) {
    const p = new THREE.Vector3()
    place(1, i / 12, p, 0.002)
    b.tube('fabricCream', [[p.x, p.y + 0.005, p.z], [p.x + 0.004, p.y - 0.025, p.z], [p.x + 0.006, p.y - 0.05, p.z + 0.004]], 0.004, {
      seg: 4,
      radial: 4,
      shadow: false,
    })
  }
}

/** A slouchy bean bag: one smooth high-segment sphere pushed into shape with a seat dent and creases. */
function beanBagGeometry(r: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 56, 40)
  const H = 0.66
  const n = waves(seed, 7)
  const n2 = waves(seed + 3, 17)
  return scaleUv(
    deform(geo, (p) => {
      const { x, y, z } = p
      const rad = Math.sqrt(Math.max(0, 1 - y * y))
      const ang = Math.atan2(z, x)
      // Broad, heavy lower half; rounder top.
      const R = r * (y < 0 ? Math.pow(rad, 0.35) * (1 + 0.08 * -y) : Math.pow(rad, 0.85))
      let Y = H * 0.5 * (1 + y)
      if (Y < 0.1) Y = 0.1 * Math.pow(Y / 0.1, 2.2)
      const dx = rad > 1e-6 ? x / rad : 0
      const dz = rad > 1e-6 ? z / rad : 0
      let X = dx * R
      let Z = dz * R
      // Back rises into a backrest (-Z), the seat dips in front of it.
      const up = smoothstep(-0.2, 0.7, y)
      Y += 0.3 * Math.pow(Math.max(0, -dz), 1.5) * up * rad
      Z -= 0.05 * Math.max(0, -dz) * up
      const sd = Math.hypot(X / r, Z / r - 0.1)
      Y -= 0.24 * Math.exp(-(sd * sd) / 0.22) * smoothstep(-0.1, 0.8, y)
      // Creases radiating from the dent, plus gentle overall wrinkles.
      const crease = Math.pow(Math.abs(Math.sin(ang * 5 + n(X, Y, Z) * 2.2)), 3) * 0.018 * smoothstep(0.0, 0.85, y) * (1 - smoothstep(0.92, 1, y))
      const wr = n2(X * 2, Y * 2, Z * 2) * 0.006
      const k = 1 - crease / Math.max(R, 0.05) + wr / Math.max(R, 0.05)
      X *= k
      Z *= k
      Y += wr * 0.5 - crease * 0.3
      p.set(X, Y, Z)
    }),
    4,
    2,
  )
}

export function beanBags(b: PartsBuilder) {
  BEAN_BAGS.forEach((bag, i) => {
    const mat = bag.mat as LivingMat
    b.group(bag.center, bag.rotY, () => {
      b.add(mat, beanBagGeometry(bag.r, 11 + i * 5), [0, 0, 0])
      // Carry strap at the back and a little cream tag.
      b.tube(mat, [[-0.07, 0.7, -0.38], [0, 0.75, -0.42], [0.07, 0.7, -0.38]], 0.012, { seg: 10, radial: 6 })
      b.soft('fabricCream', [0.075, 0.05, 0.008], [bag.r * 0.7, 0.3, 0.27], { rot: [0, 0.9, 0.1], radius: 0.003, edgeSeg: 1, shadow: false })
    })
  })
  // Round knitted pouf: turned profile with cable-knit ridges.
  b.group(POUF.center, 0, () => {
    const R = POUF.r
    const H = POUF.h
    const prof: V2[] = []
    for (let i = 0; i <= 22; i++) {
      const a = -Math.PI / 2 + (i / 22) * Math.PI
      const c = Math.cos(a)
      const s = Math.sin(a)
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 0.35)
      const sy = Math.sign(s) * Math.pow(Math.abs(s), 0.6)
      prof.push([R * sx, H / 2 + (H / 2) * sy])
    }
    const geo = deform(lathe(prof, 96), (p) => {
      const rr = Math.hypot(p.x, p.z)
      const phi = Math.atan2(p.z, p.x)
      const w = Math.pow(rr / R, 4)
      const knit = Math.cos(phi * 18 + Math.sin(p.y * 70) * 0.9) * 0.006 * w
      if (rr > 1e-5) {
        p.x += (p.x / rr) * knit
        p.z += (p.z / rr) * knit
      }
      if (rr < R * 0.7 && p.y > H * 0.8) p.y -= 0.012 * (1 - rr / (R * 0.7)) // centre dimple
    })
    b.add('fabricPlum', geo, [0, 0, 0])
    b.torus('fabricOrange', R * 1.005, 0.012, [0, H * 0.45, 0], { rot: [Math.PI / 2, 0, 0], seg: 64, shadow: false })
    b.sphere('fabricOrange', 0.018, [0, H + 0.0, 0], { scale: [1, 0.55, 1], shadow: false })
  })
}

/** Hollow mug (lathe walls) with a handle and a drink inside. `pos` = base centre. */
export function mug(b: PartsBuilder, pos: Vec3, rotY: number, mat: LivingMat, drink: LivingMat = 'woodDark', r = 0.042, h = 0.1) {
  b.group(pos, rotY, () => {
    b.lathe(mat, [
      [0, 0.004],
      [r * 0.85, 0],
      [r * 0.95, 0.004],
      [r, h * 0.3],
      [r * 1.02, h - 0.003],
      [r * 0.98, h],
      [r * 0.9, h - 0.004],
      [r * 0.88, h * 0.3],
      [r * 0.8, 0.012],
      [0, 0.012],
    ], [0, 0, 0], { seg: 28 })
    b.lathe(drink, [[r * 0.89, h - 0.018], [0, h - 0.016]], [0, 0, 0], { seg: 24, shadow: false })
    b.tube(mat, [[r * 0.9, h * 0.78, 0], [r + 0.03, h * 0.82, 0], [r + 0.035, h * 0.45, 0], [r + 0.012, h * 0.25, 0], [r * 0.9, h * 0.24, 0]], 0.0065, {
      seg: 16,
      radial: 6,
    })
  })
}

/** A board-game pawn (turned). */
function pawn(b: PartsBuilder, mat: LivingMat, pos: Vec3) {
  b.lathe(mat, [[0, 0], [0.016, 0], [0.017, 0.004], [0.011, 0.012], [0.007, 0.03], [0.009, 0.034], [0.0105, 0.042], [0.008, 0.05], [0, 0.052]], pos, {
    seg: 12,
    shadow: false,
  })
}

export function coffeeTable(b: PartsBuilder) {
  const [w, h, d] = COFFEE_TABLE.size
  b.group(COFFEE_TABLE.center, 0, () => {
    const tT = 0.045
    // Chamfered top with rounded corners, aprons and a lower shelf.
    b.slab('woodLight', [w, tT, d], [0, h - tT / 2, 0], { r: 0.05, bevel: 0.01 })
    const ax = w / 2 - 0.07
    const az = d / 2 - 0.07
    for (const s of [-1, 1]) {
      b.box('woodLight', [0.022, 0.07, d - 0.2], [s * ax, h - tT - 0.035, 0], { radius: 0.005, seg: 1 })
      b.box('woodLight', [w - 0.2, 0.07, 0.022], [0, h - tT - 0.035, s * az], { radius: 0.005, seg: 1 })
    }
    b.slab('woodLight', [w - 0.18, 0.022, d - 0.2], [0, 0.13, 0], { r: 0.02, bevel: 0.005 })
    // Tapered round legs, slightly splayed, with brass ferrules.
    const legH = h - tT
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.075)
        const z = sz * (d / 2 - 0.075)
        const splay: Vec3 = [sz * 0.06, 0, -sx * 0.06]
        taperedLeg(b, [x + sx * 0.012, 0, z + sz * 0.012], legH, 0.026, 0.017, 'woodDark', splay)
        b.lathe('brass', [[0.0175, 0], [0.0185, 0.002], [0.0185, 0.028], [0.0172, 0.03]], [x + sx * 0.012, 0, z + sz * 0.012], {
          seg: 14,
          rot: splay,
          shadow: false,
        })
      }
    const top = h
    // Mug of cocoa.
    mug(b, [-0.18, top, -0.35], 0.6, 'fabricTeal')
    // Board game box (+ a smaller one on top) with paper lids.
    b.group([0.05, top, 0.25], 0.22, () => {
      b.box('fabricOrange', [0.36, 0.07, 0.36], [0, 0.035, 0], { radius: 0.006 })
      b.box('paper', [0.22, 0.004, 0.22], [0, 0.0715, 0], { shadow: false })
      b.box('fabricPlum', [0.24, 0.05, 0.16], [0.02, 0.095, -0.05], { radius: 0.005, rot: [0, -0.5, 0] })
      // Game pieces scattered nearby.
      const pieces: Array<[LivingMat, number, number]> = [['fabricTeal', 0.27, 0.12], ['pinRed', 0.25, -0.06], ['brass', -0.25, 0.2]]
      for (const [m, x, z] of pieces) pawn(b, m, [x, 0, z])
      // A die.
      b.box('paper', [0.035, 0.035, 0.035], [-0.26, 0.0175, -0.02], { radius: 0.006, rot: [0, 0.6, 0] })
      for (const [px, pz] of [[0, 0], [0.008, 0.008], [-0.008, -0.008]] as const)
        b.sphere('metalDark', 0.0035, [-0.26 + px, 0.0352, -0.02 + pz], { w: 6, h: 4, shadow: false })
    })
    tinyPlant(b, [0.17, top, -0.45], 7)
    // A few cards fanned out.
    for (let i = 0; i < 3; i++)
      b.box('paper', [0.06, 0.0025, 0.09], [-0.2, top + 0.0015 + i * 0.0026, 0.0 + i * 0.03], { radius: 0.001, seg: 1, rot: [0, 0.3 + i * 0.25, 0], shadow: false })
  })
}

/** A hardback lying flat: coloured cover boards + cream page block. `pos` = bottom centre. */
export function flatBook(b: PartsBuilder, mat: LivingMat, size: Vec3, pos: Vec3, rotY: number) {
  const [w, h, d] = size
  b.group(pos, rotY, () => {
    const t = 0.0035
    for (const y of [t / 2, h - t / 2]) b.box(mat, [w, t, d], [0, y, 0], { radius: 0.0012, seg: 1 })
    b.box(mat, [0.006, h, d], [-w / 2 + 0.003, h / 2, 0], { radius: 0.0025, seg: 1 })
    b.box('paper', [w - 0.012, h - 2 * t + 0.001, d - 0.008], [0.002, h / 2, 0], { shadow: false })
  })
}

export function sideTable(b: PartsBuilder) {
  const { r, h } = SIDE_TABLE
  b.group(SIDE_TABLE.center, 0, () => {
    // Turned top with a rounded, bevelled edge.
    b.lathe('woodLight', [
      [0, h - 0.045],
      [r - 0.012, h - 0.045],
      [r - 0.002, h - 0.038],
      [r, h - 0.025],
      [r - 0.002, h - 0.008],
      [r - 0.01, h - 0.001],
      [r - 0.016, h],
      [0, h],
    ], [0, 0, 0], { seg: 48 })
    // Turned pedestal and foot.
    b.lathe('woodDark', [
      [0, 0],
      [0.19, 0],
      [0.2, 0.008],
      [0.19, 0.024],
      [0.12, 0.04],
      [0.05, 0.06],
      [0.04, 0.09],
      [0.052, 0.12],
      [0.038, 0.16],
      [0.03, 0.3],
      [0.034, h - 0.12],
      [0.05, h - 0.085],
      [0.045, h - 0.06],
      [0.06, h - 0.046],
      [0, h - 0.045],
    ], [0, 0, 0], { seg: 32 })
    // Two stacked books + a succulent.
    flatBook(b, 'fabricTeal', [0.2, 0.038, 0.15], [-0.05, h, 0.07], 0.3)
    flatBook(b, 'fabricOrange', [0.18, 0.032, 0.13], [-0.05, h + 0.038, 0.07], -0.1)
    tinyPlant(b, [0.08, h, -0.09], 11, 'ceramic')
  })
}

/** Drum/cone lamp shade with real wall thickness and lips: radius rb at the bottom, rt at the top. */
function shadeProfile(rb: number, rt: number, h: number, t = 0.006): V2[] {
  const y0 = -h / 2
  const y1 = h / 2
  return [
    [rb, y0],
    [rt, y1],
    [rt, y1],
    [rt - t, y1],
    [rt - t, y1],
    [rb - t, y0],
    [rb - t, y0],
    [rb, y0],
  ]
}

export function floorLamp(b: PartsBuilder) {
  const sy = FLOOR_LAMP.shade[1]
  b.group(FLOOR_LAMP.base, 0, () => {
    // Weighted, turned base.
    b.lathe('metalDark', [
      [0, 0],
      [0.168, 0],
      [0.18, 0.006],
      [0.181, 0.016],
      [0.172, 0.026],
      [0.13, 0.042],
      [0.06, 0.054],
      [0.03, 0.062],
      [0.022, 0.075],
      [0, 0.076],
    ], [0, 0, 0], { seg: 40 })
    // Pole with a turned knuckle halfway and a collar under the shade.
    b.lathe('brass', [
      [0.014, 0.07],
      [0.014, 0.9],
      [0.02, 0.92],
      [0.022, 0.95],
      [0.02, 0.98],
      [0.014, 1.0],
      [0.012, sy - 0.17],
      [0.02, sy - 0.16],
      [0.02, sy - 0.12],
      [0.009, sy - 0.11],
      [0.009, sy - 0.02],
      [0, sy - 0.02],
    ], [0, 0, 0], { seg: 16, shadow: false })
    // Glowing drum shade with real thickness; its centre is exactly LAMPS.floorLamp. Never casts shadows.
    b.lathe('emissiveWarm', shadeProfile(0.26, 0.2, 0.34), [0, sy, 0], { seg: 48, shadow: false })
    for (const [rr, y] of [[0.262, -0.17], [0.202, 0.17], [0.252, -0.165], [0.193, 0.165]] as const)
      b.torus('brass', rr, 0.0045, [0, sy + y, 0], { rot: [Math.PI / 2, 0, 0], seg: 48, radial: 5, shadow: false })
    // Spider arms from the top ring to the socket.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      b.rod('brass', [0, sy + 0.12, 0], [Math.cos(a) * 0.19, sy + 0.165, Math.sin(a) * 0.19], 0.003, { shadow: false, seg: 5 })
    }
    b.lathe('brass', [[0.02, sy - 0.03], [0.022, sy + 0.08], [0.016, sy + 0.12], [0, sy + 0.125]], [0, 0, 0], { seg: 14, shadow: false })
    b.mark('floorLampShade', [0, sy, 0])
    // Cord out of the base, across the floor towards the wall.
    b.tube('metalDark', [[0.12, 0.045, 0], [0.19, 0.012, 0.02], [0.32, 0.004, 0.09], [0.55, 0.004, 0.14], [0.8, 0.004, 0.3]], 0.0045, {
      seg: 28,
      radial: 5,
      shadow: false,
    })
  })
}

/** Ceiling canopy, cord grip and cord, in the pendant's local frame (origin = shade centre at height `y`). */
function pendantCord(b: PartsBuilder, y: number, bottom: number) {
  const top = ROOM.height - y - 0.002
  b.lathe('brass', [[0, top - 0.05], [0.03, top - 0.05], [0.06, top - 0.035], [0.078, top - 0.012], [0.08, top], [0, top]], [0, 0, 0], {
    seg: 28,
    shadow: false,
  })
  b.cyl('brass', 0.008, 0.01, 0.025, [0, top - 0.06, 0], { seg: 10, shadow: false })
  b.cyl('metalDark', 0.0045, 0.0045, top - 0.07 - bottom, [0, (top - 0.07 + bottom) / 2, 0], { seg: 8, shadow: false })
}

export function pendants(b: PartsBuilder) {
  // A: round ribbed paper lantern.
  b.group(LAMPS.pendantA, 0, () => {
    const r = 0.24
    pendantCord(b, LAMPS.pendantA[1], r * 0.9 + 0.03)
    b.lathe('brass', [[0.045, r * 0.86], [0.05, r * 0.9], [0.03, r * 0.9 + 0.035], [0.012, r * 0.9 + 0.04], [0, r * 0.9 + 0.04]], [0, 0, 0], {
      seg: 20,
      shadow: false,
    })
    const prof: V2[] = []
    const N = 72
    for (let i = 0; i <= N; i++) {
      const th = 0.12 + (i / N) * (Math.PI - 0.3)
      const rib = 1 - 0.035 * Math.pow(Math.abs(Math.cos(th * 11)), 6)
      prof.push([r * Math.sin(th) * rib, -0.9 * r * Math.cos(th)])
    }
    b.lathe('emissiveWarm', prof, [0, 0, 0], { seg: 40, shadow: false })
    b.torus('brass', r * Math.sin(0.12) * 0.98, 0.004, [0, -0.9 * r * Math.cos(0.12), 0], { rot: [Math.PI / 2, 0, 0], seg: 20, shadow: false })
    b.mark('pendantA', [0, 0, 0])
  })
  // B: cone shade with thickness, an inner rim and the bulb peeking out.
  b.group(LAMPS.pendantB, 0, () => {
    const h = 0.28
    pendantCord(b, LAMPS.pendantB[1], h / 2 + 0.06)
    b.lathe('brass', [[0.06, h / 2 - 0.02], [0.062, h / 2 + 0.02], [0.045, h / 2 + 0.05], [0.01, h / 2 + 0.06], [0, h / 2 + 0.061]], [0, 0, 0], {
      seg: 24,
      shadow: false,
    })
    b.lathe('emissiveWarm', shadeProfile(0.27, 0.07, h, 0.007), [0, 0, 0], { seg: 48, shadow: false })
    b.torus('brass', 0.27, 0.006, [0, -h / 2, 0], { rot: [Math.PI / 2, 0, 0], seg: 48, shadow: false })
    b.torus('brass', 0.262, 0.004, [0, -h / 2 + 0.006, 0], { rot: [Math.PI / 2, 0, 0], seg: 48, radial: 5, shadow: false })
    b.sphere('emissiveWarm', 0.075, [0, -h / 2 - 0.02, 0], { w: 20, h: 14, shadow: false })
    b.mark('pendantB', [0, 0, 0])
  })
}
