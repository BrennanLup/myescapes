/** Low-poly plant generators (monstera, snake plant, bush, hanging pothos, cactus). */
import type { Vec3 } from '@/contracts/scene'
import type { LivingMat, PartsBuilder } from './builder'
import { rng } from './random'

/** A flat oval leaf whose base sits at `tip`, pointing outward at `angle`, drooping by `tilt`. */
function leaf(b: PartsBuilder, mat: LivingMat, tip: Vec3, angle: number, tilt: number, len: number, wide: number) {
  const dx = Math.cos(angle) * Math.cos(tilt) * (len / 2)
  const dz = Math.sin(angle) * Math.cos(tilt) * (len / 2)
  const dy = -Math.sin(tilt) * (len / 2)
  b.sphere(mat, 1, [tip[0] + dx, tip[1] + dy, tip[2] + dz], {
    rot: [0, -angle, -tilt],
    scale: [len / 2, 0.018, wide / 2],
    w: 9,
    h: 5,
  })
}

function pot(b: PartsBuilder, r: number, h: number, mat: LivingMat = 'pot') {
  b.cyl(mat, r, r * 0.78, h, [0, h / 2, 0], { seg: 10 })
  b.cyl(mat, r * 1.08, r * 1.08, 0.04, [0, h - 0.02, 0], { seg: 10 })
  b.cyl('woodDark', r * 0.95, r * 0.95, 0.01, [0, h + 0.002, 0], { seg: 10, shadow: false })
}

export function monstera(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    const potH = 0.42 * scale
    pot(b, 0.26 * scale, potH, 'ceramic')
    b.cyl('fabricTeal', 0.285 * scale, 0.285 * scale, 0.06, [0, potH * 0.35, 0], { seg: 10 })
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.5
      const reach = (0.22 + rand() * 0.25) * scale
      const hgt = potH + (0.35 + rand() * 0.7) * scale
      const tip: Vec3 = [Math.cos(a) * reach, hgt, Math.sin(a) * reach]
      b.rod('leafDark', [0, potH, 0], tip, 0.012 * scale)
      leaf(b, i % 2 ? 'leaf' : 'leafDark', tip, a, 0.25 + rand() * 0.45, (0.42 + rand() * 0.18) * scale, (0.34 + rand() * 0.1) * scale)
    }
  })
}

export function snakePlant(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    const potH = 0.32 * scale
    b.box('ceramic', [0.34 * scale, potH, 0.34 * scale], [0, potH / 2, 0], { radius: 0.04 })
    b.box('woodDark', [0.3 * scale, 0.01, 0.3 * scale], [0, potH + 0.002, 0], { shadow: false })
    const n = 7
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.4
      const r = 0.06 * scale * (i === 0 ? 0 : 1)
      const h = (0.55 + rand() * 0.45) * scale
      const tiltOut = 0.06 + rand() * 0.14
      b.cyl(i % 2 ? 'leaf' : 'leafDark', 0, 0.055 * scale, h, [Math.cos(a) * r, potH + h / 2 - 0.02, Math.sin(a) * r], {
        seg: 4,
        rot: [Math.sin(a) * tiltOut, -a, -Math.cos(a) * tiltOut],
        scale: [1, 1, 0.35],
      })
    }
  })
}

export function bush(b: PartsBuilder, pos: Vec3, scale: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, 0, () => {
    const potH = 0.3 * scale
    pot(b, 0.22 * scale, potH)
    const blobs: Array<[number, number, number, number]> = [
      [0, potH + 0.2, 0, 0.22],
      [0.13, potH + 0.13, 0.05, 0.16],
      [-0.12, potH + 0.15, -0.06, 0.17],
      [0.02, potH + 0.34, -0.04, 0.15],
      [-0.05, potH + 0.12, 0.13, 0.15],
    ]
    blobs.forEach(([x, y, z, r], i) =>
      b.blob(i % 2 ? 'leaf' : 'leafDark', r * scale * (0.9 + rand() * 0.2), [x * scale, y * scale + potH * (1 - scale), z * scale], {
        rot: [rand(), rand(), rand()],
      }),
    )
  })
}

/** Hanging pothos: pot on three cords from the ceiling with trailing vines. `pos` = pot centre. */
export function hangingPlant(b: PartsBuilder, pos: Vec3, ceiling: number, seed: number) {
  const rand = rng(seed)
  b.group(pos, rand() * Math.PI, () => {
    b.sphere('ceramic', 0.17, [0, 0, 0], { scale: [1, 0.75, 1], w: 10, h: 7 })
    b.cyl('ceramic', 0.15, 0.15, 0.04, [0, 0.1, 0], { seg: 10 })
    const top = ceiling - pos[1]
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      b.rod('woodLight', [Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14], [0, top - 0.25, 0], 0.005, { shadow: false })
    }
    b.rod('woodLight', [0, top - 0.25, 0], [0, top, 0], 0.006, { shadow: false })
    b.cyl('brass', 0.04, 0.04, 0.02, [0, top - 0.01, 0], { shadow: false })
    // Bushy top.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      b.blob(i % 2 ? 'leaf' : 'leafDark', 0.085, [Math.cos(a) * 0.1, 0.13 + rand() * 0.04, Math.sin(a) * 0.1], { detail: 0 })
    }
    // Trailing vines: chains of little leaves.
    const vines = 7
    for (let v = 0; v < vines; v++) {
      const a = (v / vines) * Math.PI * 2 + rand() * 0.4
      const len = 4 + Math.floor(rand() * 5)
      let x = Math.cos(a) * 0.16
      let z = Math.sin(a) * 0.16
      let y = 0.05
      for (let k = 0; k < len; k++) {
        b.sphere(k % 3 ? 'leaf' : 'leafDark', 0.05 - k * 0.002, [x, y, z], { w: 6, h: 4, scale: [1, 0.3, 0.7], rot: [rand() - 0.5, rand() * 3, 0.6 + rand()] })
        x += Math.cos(a) * 0.012 + (rand() - 0.5) * 0.03
        z += Math.sin(a) * 0.012 + (rand() - 0.5) * 0.03
        y -= 0.07
      }
    }
  })
}

/** Small table-top succulent. `pos` = base of the pot. */
export function tinyPlant(b: PartsBuilder, pos: Vec3, seed: number, potMat: LivingMat = 'pot') {
  const rand = rng(seed)
  b.group(pos, 0, () => {
    pot(b, 0.065, 0.09, potMat)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand() * 0.3
      leaf(b, i % 2 ? 'leaf' : 'leafDark', [0, 0.1, 0], a, -0.5 - rand() * 0.4, 0.12, 0.06)
    }
  })
}

export function cactus(b: PartsBuilder, pos: Vec3) {
  b.group(pos, 0.4, () => {
    pot(b, 0.06, 0.08)
    b.cyl('leafDark', 0.034, 0.038, 0.14, [0, 0.15, 0], { seg: 8 })
    b.sphere('leafDark', 0.034, [0, 0.22, 0], { w: 8, h: 5 })
    b.rod('leafDark', [0.03, 0.14, 0], [0.065, 0.15, 0], 0.016, { seg: 6 })
    b.cyl('leafDark', 0.016, 0.016, 0.06, [0.07, 0.18, 0], { seg: 6 })
    b.sphere('leafDark', 0.016, [0.07, 0.21, 0], { w: 6, h: 4 })
    b.sphere('fabricOrange', 0.012, [0, 0.255, 0], { w: 6, h: 4 })
  })
}
