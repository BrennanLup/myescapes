/**
 * Static desk geometry, built with the living set's PartsBuilder (rounded, lathed and tubed parts
 * merged into one geometry per (material, castShadow) bucket) so the whole set costs a handful of
 * draw calls. Everything here is in the desk anchor's local frame.
 */
import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'
import { PartsBuilder, type BuiltPart } from '../living/builder'
import { cushion, deform, helix, type V2 } from '../living/geo'
import { D, LAMP_BULB_LOCAL } from './layout'

export type PartMat =
  | 'woodLight'
  | 'woodDark'
  | 'fabricTeal'
  | 'fabricOrange'
  | 'metalDark'
  | 'metal'
  | 'brass'
  | 'ceramic'
  | 'pot'
  | 'leaf'
  | 'stickyYellow'
  | 'stickyPink'
  | 'plastic'
  | 'led'
  | 'shade'

type B = PartsBuilder<PartMat>

function desk(b: B) {
  const { topY, topT, width, backZ, frontZ } = D
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2
  const legH = topY - topT
  // Thick top with rounded corners and a soft bevel.
  b.slab('woodLight', [width, topT, depth], [0, topY - topT / 2, cz], { r: 0.03, bevel: 0.012 })
  // Front apron (the LED strip runs just in front of it) and a modesty panel.
  b.box('woodDark', [width - 0.22, 0.05, 0.025], [0, legH - 0.025, frontZ - 0.08], { radius: 0.006 })
  b.box('woodDark', [width - 0.2, 0.42, 0.03], [0, legH - 0.24, backZ + 0.06], { radius: 0.008 })
  // Left slab leg with a foot rail.
  b.box('woodLight', [0.07, legH, depth - 0.05], [-width / 2 + 0.07, legH / 2, cz], { radius: 0.012 })
  b.box('woodDark', [0.09, 0.025, depth - 0.02], [-width / 2 + 0.07, 0.0125, cz], { radius: 0.008 })
  // Drawer cabinet on the right: carcass, plinth, three bevelled drawer fronts with bar pulls.
  const cx = 0.74
  const cw = 0.48
  const cd = depth - 0.1
  b.box('woodLight', [cw, legH - 0.04, cd], [cx, (legH - 0.04) / 2 + 0.04, cz - 0.02], { radius: 0.012 })
  b.box('woodDark', [cw - 0.04, 0.04, cd - 0.04], [cx, 0.02, cz - 0.02], { radius: 0.006 })
  const fz = cz - 0.02 + cd / 2
  for (let i = 0; i < 3; i++) {
    const y = 0.16 + i * 0.22
    b.box('woodDark', [0.43, 0.2, 0.024], [cx, y, fz + 0.004], { radius: 0.007 })
    b.tube('brass', [[cx - 0.08, y + 0.05, fz + 0.016], [cx - 0.075, y + 0.05, fz + 0.04], [cx + 0.075, y + 0.05, fz + 0.04], [cx + 0.08, y + 0.05, fz + 0.016]], 0.006, {
      seg: 16,
      radial: 6,
    })
  }
  // Cable bundle from the back of the monitors down behind the desk.
  b.tube('plastic', [[0.1, topY + 0.02, -0.29], [0.05, topY + 0.01, backZ + 0.03], [0.02, topY - 0.15, backZ - 0.01], [-0.05, 0.25, backZ - 0.015], [-0.2, 0.01, backZ - 0.01]], 0.009, {
    seg: 24,
    radial: 6,
  })
}

function monitor(b: B, pos: Vec3, w: number, h: number, rotY: number) {
  const standH = pos[1] - D.topY
  b.group(pos, rotY, () => {
    // Slim bezel; the screen plane sits just in front of it at z = 0.019.
    b.box('plastic', [w + 0.026, h + 0.026, 0.02], [0, 0, 0.008], { radius: 0.006 })
    // Chin with a tiny power LED.
    b.box('plastic', [w * 0.4, 0.012, 0.012], [0, -h / 2 - 0.016, 0.006], { radius: 0.004, seg: 1 })
    // Tapered back housing.
    b.soft('plastic', [w * 0.82, h * 0.78, 0.05], [0, -0.01, -0.024], {
      radius: 0.02,
      edgeSeg: 2,
      deform: (p, u) => {
        const k = 1 - 0.12 * Math.max(0, -u.z)
        p.x *= k
        p.y *= k
      },
    })
    // VESA plate, neck and a rounded foot.
    b.box('metalDark', [0.12, 0.12, 0.02], [0, -0.04, -0.055], { radius: 0.006, seg: 1 })
    b.box('metalDark', [0.055, standH - 0.01, 0.026], [0, -standH / 2 - 0.02, -0.075], { radius: 0.01, rot: [0.06, 0, 0] })
    b.slab('metalDark', [0.27, 0.014, 0.19], [0, -standH + 0.007, -0.04], { r: 0.06, bevel: 0.004 })
  })
}

const TOWER_POS: Vec3 = [-0.97, D.topY, -0.18]

function tower(b: B) {
  b.group(TOWER_POS, 0, () => {
    b.box('metalDark', [0.22, 0.46, 0.42], [0, 0.245, 0], { radius: 0.014 })
    for (const x of [-0.08, 0.08]) for (const z of [-0.17, 0.17]) b.cyl('plastic', 0.018, 0.02, 0.018, [x, 0.009, z], { seg: 12 })
    // Front mesh panel and top vents.
    b.box('plastic', [0.2, 0.42, 0.006], [0, 0.245, 0.211], { radius: 0.003, seg: 1 })
    for (let i = 0; i < 6; i++) b.box('plastic', [0.15, 0.003, 0.012], [0, 0.476, -0.15 + i * 0.05], { shadow: false })
    // Two fans: housing ring, hub and blades (LED rings are separate).
    for (const y of [0.3, 0.15]) {
      b.torus('metal', 0.058, 0.004, [0, y + 0.005, 0.215], { seg: 24, radial: 5, shadow: false })
      b.cyl('metal', 0.02, 0.02, 0.008, [0, y + 0.005, 0.216], { rot: [Math.PI / 2, 0, 0], seg: 14, shadow: false })
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2
        b.box('metal', [0.036, 0.016, 0.002], [Math.cos(a) * 0.036, y + 0.005 + Math.sin(a) * 0.036, 0.215], { rot: [0.35, 0, a], shadow: false })
      }
    }
    b.cyl('metal', 0.008, 0.008, 0.004, [0.07, 0.44, 0.215], { rot: [Math.PI / 2, 0, 0], seg: 10, shadow: false })
  })
}

/** LED parts on the PC tower + a thin strip along the desk underside front (one separate glowing mesh). */
export function buildLedGeometry(): THREE.BufferGeometry {
  const b = new PartsBuilder<PartMat>()
  b.group(TOWER_POS, 0, () => {
    b.torus('led', 0.062, 0.008, [0, 0.3, 0.22], { seg: 32, radial: 6 })
    b.torus('led', 0.062, 0.008, [0, 0.15, 0.22], { seg: 32, radial: 6 })
    b.box('led', [0.012, 0.4, 0.012], [-0.1, 0.24, 0.215], { radius: 0.004, seg: 1 })
    b.box('led', [0.14, 0.01, 0.01], [0, 0.43, 0.215], { radius: 0.004, seg: 1 })
  })
  b.box('led', [D.width - 0.3, 0.012, 0.012], [0, D.topY - D.topT - 0.03, D.frontZ - 0.05], { radius: 0.005, seg: 1 })
  return b.build()[0].geometry
}

/** Row-by-row keyboard layout in key units; numbers are key widths. */
const KEY_ROWS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
  [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25],
]

function keyboard(b: B) {
  b.group([0.15, D.topY, 0.16], 0.03, () => {
    b.box('plastic', [0.46, 0.022, 0.155], [0, 0.011, 0], { radius: 0.007 })
    const unit = 0.0305
    const key = unit - 0.004
    KEY_ROWS.forEach((row, r) => {
      const total = row.reduce((a, c) => a + c, 0) * unit
      let x = -total / 2
      const z = -0.058 + r * unit
      row.forEach((wu, i) => {
        const w = wu * unit - 0.004
        const accent = (r === 0 && i === 0) || (r === 2 && i === row.length - 1)
        b.box(accent ? 'fabricOrange' : 'metal', [w, 0.009, key], [x + (wu * unit) / 2, 0.026, z], { radius: 0.0028, seg: 1, shadow: false })
        x += wu * unit
      })
    })
  })
  // Mouse: a smooth sculpted shell with a split and a scroll wheel.
  const mouse = deform(new THREE.SphereGeometry(1, 20, 14), (p) => {
    const front = p.z < 0 ? 1 : 0
    p.set(p.x * 0.032 * (1 - 0.15 * front * -p.z), Math.max(0, p.y) * 0.02 + 0.002 * (1 + p.y), p.z * 0.058)
  })
  b.add('plastic', mouse, [0.55, D.topY, 0.2], { rot: [0, 0.1, 0] })
  b.cyl('metal', 0.006, 0.006, 0.005, [0.548, D.topY + 0.022, 0.18], { rot: [0, 0.1, Math.PI / 2], seg: 12, shadow: false })
  // Desk mat.
  b.slab('fabricTeal', [0.95, 0.005, 0.36], [0.25, D.topY + 0.0025, 0.18], { r: 0.03, bevel: 0.002 })
}

function deskItems(b: B) {
  const y = D.topY
  // Mug with handle and coffee.
  b.group([-0.3, y, 0.22], 0, () => {
    const r = 0.042
    const h = 0.1
    b.lathe('ceramic', [[0, 0.004], [r * 0.85, 0], [r * 0.95, 0.004], [r, h * 0.3], [r * 1.02, h - 0.003], [r * 0.98, h], [r * 0.9, h - 0.004], [r * 0.86, 0.012], [0, 0.012]], [0, 0, 0], {
      seg: 28,
    })
    b.lathe('woodDark', [[r * 0.88, h - 0.02], [0, h - 0.018]], [0, 0, 0], { seg: 20, shadow: false })
    b.tube('ceramic', [[r * 0.9, h * 0.78, 0], [r + 0.03, h * 0.82, 0], [r + 0.035, h * 0.45, 0], [r + 0.012, h * 0.25, 0], [r * 0.9, h * 0.24, 0]], 0.0065, { seg: 16 })
  })
  // Tiny ribbed cactus in a pot.
  b.group([-0.68, y, 0.23], 0, () => {
    b.lathe('pot', [[0, 0], [0.034, 0], [0.036, 0.006], [0.045, 0.062], [0.049, 0.064], [0.049, 0.072], [0.042, 0.072], [0.04, 0.06]], [0, 0, 0], { seg: 24 })
    b.lathe('woodDark', [[0.041, 0.058], [0, 0.062]], [0, 0, 0], { seg: 16, shadow: false })
    const ribbed = (r: number, h: number) =>
      deform(
        new THREE.LatheGeometry(
          Array.from({ length: 9 }, (_, i) => {
            const t = i / 8
            return new THREE.Vector2(t < 0.7 ? r : r * Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2)), t * h)
          }),
          28,
        ),
        (p) => {
          const k = 1 + 0.12 * Math.abs(Math.cos(Math.atan2(p.z, p.x) * 4))
          p.x *= k
          p.z *= k
        },
      )
    b.add('leaf', ribbed(0.028, 0.15), [0, 0.055, 0])
    b.add('leaf', ribbed(0.013, 0.06), [0.04, 0.11, 0])
    b.tube('leaf', [[0.015, 0.105, 0], [0.035, 0.105, 0], [0.04, 0.115, 0]], 0.011, { seg: 6, radial: 8 })
    b.sphere('stickyPink', 0.011, [0, 0.207, 0], { w: 10, h: 6, scale: [1, 0.6, 1], shadow: false })
  })
  // Sticky notes: on the main monitor bezel and on the desk (slightly curled).
  const mm = D.mainMonitor
  b.box('stickyYellow', [0.07, 0.07, 0.002], [mm.pos[0] + mm.w / 2 - 0.01, mm.pos[1] + 0.2, mm.pos[2] + 0.0195], { rot: [0.05, 0, 0.12], shadow: false })
  b.box('stickyPink', [0.07, 0.07, 0.002], [mm.pos[0] - mm.w / 2 + 0.02, mm.pos[1] - 0.21, mm.pos[2] + 0.0195], { rot: [0.05, 0, -0.1], shadow: false })
  b.box('stickyYellow', [0.08, 0.003, 0.08], [-0.15, y + 0.0015, 0.3], { rot: [0, 0.3, 0], shadow: false })
  b.box('stickyYellow', [0.08, 0.003, 0.08], [-0.12, y + 0.0045, 0.31], { rot: [0.04, -0.15, 0], shadow: false })
}

/** Podcast mic on a two-section boom arm (with springs) clamped to the back edge. */
function mic(b: B) {
  const base: Vec3 = [0.64, D.topY, -0.4]
  const elbow: Vec3 = [0.64, D.topY + 0.5, -0.3]
  const m: Vec3 = [0.66, D.topY + 0.3, 0.12]
  // Desk clamp.
  b.box('metalDark', [0.06, 0.05, 0.08], [base[0], base[1] + 0.025, base[2]], { radius: 0.008 })
  b.box('metalDark', [0.05, 0.1, 0.02], [base[0], base[1] - 0.04, D.backZ - 0.005], { radius: 0.006, seg: 1 })
  b.lathe('metalDark', [[0, base[1] + 0.05], [0.02, base[1] + 0.05], [0.02, base[1] + 0.1], [0, base[1] + 0.1]], [base[0], 0, base[2]], { seg: 16 })
  const arm = (from: Vec3, to: Vec3) => {
    for (const off of [-0.012, 0.012]) b.rod('metalDark', [from[0] + off, from[1], from[2]], [to[0] + off, to[1], to[2]], 0.006, { seg: 8 })
    // Spring running along the arm.
    const a = new THREE.Vector3(...from)
    const c = new THREE.Vector3(...to)
    const len = a.distanceTo(c)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize())
    const e = new THREE.Euler().setFromQuaternion(q)
    const mid = a.clone().lerp(c, 0.5)
    b.add('metal', helix(0.007, -len * 0.3, len * 0.3, 14, 0.0015, 96), [mid.x, mid.y + 0.018, mid.z], { rot: [e.x, e.y, e.z], shadow: false })
  }
  arm([base[0], base[1] + 0.1, base[2]], elbow)
  arm(elbow, [m[0], m[1] + 0.09, m[2] - 0.03])
  b.cyl('metal', 0.016, 0.016, 0.04, elbow, { rot: [0, 0, Math.PI / 2], seg: 16 })
  // Shock mount and the mic: turned body with a grille head.
  b.group(m, 0, () => {
    b.torus('metal', 0.05, 0.005, [0, 0.01, 0], { rot: [0, Math.PI / 2, 0], seg: 28 })
    b.torus('metal', 0.05, 0.005, [0, -0.04, 0], { rot: [0, Math.PI / 2, 0], seg: 28 })
    b.lathe('metalDark', [[0, -0.08], [0.02, -0.08], [0.03, -0.07], [0.032, -0.02], [0.033, 0.03], [0, 0.03]], [0, 0, 0], { seg: 24 })
    b.lathe('metal', [[0.033, 0.03], [0.035, 0.05], [0.034, 0.08], [0.025, 0.1], [0, 0.106]], [0, 0, 0], { seg: 24 })
    b.torus('metalDark', 0.034, 0.003, [0, 0.03, 0], { rot: [Math.PI / 2, 0, 0], seg: 24, shadow: false })
  }, [0.25, 0, 0])
}

/** Desk lamp: weighted base, two articulated arms with springs, conical shade around the contract bulb. */
function lamp(b: B) {
  const [bx, by, bz] = LAMP_BULB_LOCAL
  const base: Vec3 = [bx + 0.12, D.topY, bz - 0.32]
  const elbow: Vec3 = [bx + 0.12, by + 0.2, bz - 0.36]
  const head: Vec3 = [bx, by + 0.11, bz - 0.02]
  b.lathe('fabricOrange', [[0, 0], [0.085, 0], [0.09, 0.006], [0.088, 0.02], [0.07, 0.03], [0.03, 0.036], [0, 0.036]], base, { seg: 32 })
  b.lathe('brass', [[0.02, 0.036], [0.02, 0.06], [0, 0.062]], base, { seg: 14 })
  const pivot: Vec3 = [base[0], base[1] + 0.06, base[2]]
  const arm = (from: Vec3, to: Vec3) => {
    for (const off of [-0.01, 0.01]) b.rod('brass', [from[0] + off, from[1], from[2]], [to[0] + off, to[1], to[2]], 0.005, { seg: 8 })
    const a = new THREE.Vector3(...from)
    const c = new THREE.Vector3(...to)
    const len = a.distanceTo(c)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize())
    const e = new THREE.Euler().setFromQuaternion(q)
    const mid = a.clone().lerp(c, 0.4)
    b.add('metal', helix(0.0055, -len * 0.18, len * 0.18, 12, 0.0012, 80), [mid.x + 0.02, mid.y, mid.z], { rot: [e.x, e.y, e.z], shadow: false })
  }
  arm(pivot, elbow)
  arm(elbow, head)
  for (const j of [pivot, elbow]) b.cyl('brass', 0.016, 0.016, 0.034, j, { rot: [0, 0, Math.PI / 2], seg: 16 })
  b.sphere('brass', 0.014, head, { w: 12, h: 8 })
  // Shade: open cone with real thickness around the bulb (bulb mesh is separate). No shadows: the light sits inside.
  const sh = 0.13
  const prof: V2[] = [
    [0.11, -sh / 2],
    [0.04, sh / 2],
    [0.04, sh / 2],
    [0.016, sh / 2 + 0.012],
    [0.016, sh / 2 + 0.035],
    [0, sh / 2 + 0.036],
  ]
  const inner: V2[] = [
    [0.035, sh / 2 - 0.002],
    [0.105, -sh / 2 + 0.001],
  ]
  b.lathe('shade', prof, [bx, by + 0.04, bz], { seg: 32, shadow: false })
  b.lathe('shade', inner, [bx, by + 0.04, bz], { seg: 32, shadow: false })
  b.torus('brass', 0.108, 0.0035, [bx, by + 0.04 - sh / 2, bz], { rot: [Math.PI / 2, 0, 0], seg: 32, radial: 5, shadow: false })
  // Cord from the base towards the back of the desk.
  b.tube('plastic', [[base[0] - 0.08, D.topY + 0.006, base[2]], [base[0] - 0.14, D.topY + 0.004, base[2] - 0.02], [base[0] - 0.2, D.topY + 0.004, D.backZ + 0.01], [base[0] - 0.22, D.topY - 0.1, D.backZ - 0.01]], 0.0035, {
    seg: 18,
    radial: 5,
    shadow: false,
  })
}

/** Gaming office chair: 5-star base on twin-wheel casters, gas lift, padded seat and wrap-around back. */
function chair(b: B) {
  b.group(D.chair.pos, D.chair.rotY, () => {
    // Hub and five tapered legs sloping down to the casters.
    b.lathe('metalDark', [[0, 0.07], [0.055, 0.07], [0.06, 0.09], [0.045, 0.12], [0.03, 0.125], [0, 0.125]], [0, 0, 0], { seg: 24 })
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      b.group([0, 0, 0], a, () => {
        b.soft('metalDark', [0.05, 0.036, 0.27], [0, 0.088, 0.16], {
          radius: 0.012,
          edgeSeg: 2,
          rot: [0.1, 0, 0],
          deform: (p, u) => {
            const t = (u.z + 1) / 2
            p.x *= 1 - 0.3 * t
            p.y *= 1 - 0.35 * t
          },
        })
        // Caster: stem, fork and twin wheels.
        b.cyl('metalDark', 0.008, 0.008, 0.03, [0, 0.065, 0.29], { seg: 8 })
        b.box('plastic', [0.034, 0.024, 0.04], [0, 0.05, 0.3], { radius: 0.008, seg: 1 })
        for (const s of [-1, 1]) b.cyl('plastic', 0.026, 0.026, 0.012, [s * 0.013, 0.026, 0.31], { rot: [0, 0, Math.PI / 2], seg: 16 })
        b.cyl('metal', 0.006, 0.006, 0.036, [0, 0.026, 0.31], { rot: [0, 0, Math.PI / 2], seg: 8, shadow: false })
      })
    }
    // Gas lift: chrome piston in a stepped shroud.
    b.lathe('metalDark', [[0.03, 0.12], [0.03, 0.2], [0.026, 0.205], [0.026, 0.27], [0.022, 0.275], [0.022, 0.31], [0, 0.31]], [0, 0, 0], { seg: 20 })
    b.cyl('metal', 0.015, 0.015, 0.13, [0, 0.37, 0], { seg: 16 })
    // Tilt mechanism and lever.
    b.box('metalDark', [0.22, 0.045, 0.26], [0, 0.44, 0.02], { radius: 0.01 })
    b.tube('metal', [[0.1, 0.43, -0.03], [0.2, 0.425, -0.05], [0.24, 0.43, -0.1]], 0.005, { seg: 8 })
    b.sphere('plastic', 0.012, [0.24, 0.43, -0.1], { w: 10, h: 8 })
    // Seat: shell plus a crowned cushion with a waterfall front edge and orange side bolsters.
    b.box('plastic', [0.48, 0.03, 0.48], [0, 0.465, 0], { radius: 0.012 })
    const seatC = cushion({ crown: 0.012, sag: 0.006, bulge: 0.008, wrinkle: 0.0015, seed: 61 })
    b.soft('fabricTeal', [0.5, 0.085, 0.5], [0, 0.52, 0], {
      radius: 0.035,
      deform: (p, u) => {
        seatC(p, u)
        if (u.z < -0.5) p.y -= 0.02 * ((-u.z - 0.5) / 0.5) ** 2
      },
    })
    for (const s of [-1, 1])
      b.soft('fabricOrange', [0.07, 0.08, 0.46], [s * 0.225, 0.56, 0.01], { radius: 0.03, deform: cushion({ bulge: 0.004, wrinkle: 0.001, seed: 62 + s }) })
    // Back spine from the mechanism up behind the backrest.
    b.tube('metalDark', [[0, 0.44, 0.13], [0, 0.46, 0.27], [0, 0.6, 0.31], [0, 0.72, 0.32]], 0.02, { seg: 16, radial: 8 })
    // Wrap-around backrest (chair faces local -Z, toward the desk) with bolsters and a headrest pillow.
    b.group([0, 0.98, 0.26], 0, () => {
      b.soft('fabricTeal', [0.46, 0.7, 0.09], [0, 0, 0], {
        radius: 0.035,
        deform: (p, u) => {
          p.z -= 0.05 * u.x * u.x
          p.z -= 0.025 * Math.exp(-((u.y + 0.45) ** 2) / 0.08)
          if (u.z < 0) p.z -= 0.01 * (1 - u.x * u.x) * (1 - u.y * u.y)
        },
      })
      for (const s of [-1, 1])
        b.soft('fabricOrange', [0.075, 0.64, 0.11], [s * 0.235, -0.02, -0.035], {
          rot: [0, s * 0.35, 0],
          radius: 0.035,
          deform: cushion({ bulge: 0.006, wrinkle: 0.0015, seed: 70 + s }),
        })
      b.box('plastic', [0.44, 0.66, 0.02], [0, -0.01, 0.05], { radius: 0.01 })
      b.soft('fabricOrange', [0.26, 0.12, 0.08], [0, 0.25, -0.06], { radius: 0.035, deform: cushion({ pinch: 0.5, wrinkle: 0.002, seed: 73 }) })
      b.soft('fabricOrange', [0.3, 0.13, 0.07], [0, -0.26, -0.065], { radius: 0.03, deform: cushion({ pinch: 0.45, wrinkle: 0.002, seed: 74 }) })
    }, [-0.12, 0, 0])
    // Armrests: posts and padded tops.
    for (const s of [-1, 1]) {
      b.box('metalDark', [0.04, 0.05, 0.12], [s * 0.2, 0.46, 0.03], { radius: 0.01, seg: 1 })
      b.box('metalDark', [0.035, 0.22, 0.05], [s * 0.27, 0.58, 0.03], { radius: 0.012 })
      b.soft('plastic', [0.075, 0.035, 0.26], [s * 0.27, 0.705, 0.0], { radius: 0.016, deform: cushion({ crown: 0.004, seed: 80 }) })
    }
  })
}

/** All static furniture, merged per (material, shadow) bucket. */
export function buildDeskParts(): BuiltPart<PartMat>[] {
  const b = new PartsBuilder<PartMat>()
  desk(b)
  monitor(b, D.mainMonitor.pos, D.mainMonitor.w, D.mainMonitor.h, D.mainMonitor.rotY)
  monitor(b, D.sideMonitor.pos, D.sideMonitor.w, D.sideMonitor.h, D.sideMonitor.rotY)
  tower(b)
  keyboard(b)
  deskItems(b)
  mic(b)
  lamp(b)
  chair(b)
  return b.build()
}
