/** Living-area furniture: rug, couch, bean bags, pouf, coffee table, side table, lamps. */
import { ROOM, LAMPS } from '@/contracts/scene'
import type { LivingMat, PartsBuilder } from './builder'
import { BEAN_BAGS, COFFEE_TABLE, COUCH, FLOOR_LAMP, POUF, RUG, SIDE_TABLE } from './layout'
import { tinyPlant } from './plants'

export function rug(b: PartsBuilder) {
  const [w, d] = RUG.size
  b.group(RUG.center, 0, () => {
    const layer = (mat: LivingMat, sw: number, sd: number, h: number) => b.box(mat, [sw, h, sd], [0, h / 2, 0], { shadow: false })
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
    // Fringe tassels on the short ends.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 16; i++) {
        const z = -d / 2 + 0.12 + (i * (d - 0.24)) / 15
        b.box('fabricCream', [0.09, 0.012, 0.025], [side * (w / 2 + 0.04), 0.006, z], { shadow: false })
      }
    }
  })
}

export function couch(b: PartsBuilder) {
  const L = COUCH.length
  const D = COUCH.depth
  b.group(COUCH.center, COUCH.rotY, () => {
    const legH = 0.08
    for (const x of [-L / 2 + 0.12, L / 2 - 0.12])
      for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) b.cyl('woodDark', 0.035, 0.03, legH, [x, legH / 2, z], { seg: 8 })
    b.box('fabricPlum', [L, 0.32, D], [0, legH + 0.16, 0], { radius: 0.07 })
    // Seat cushions.
    for (const x of [-0.52, 0.52]) b.box('fabricPlum', [1.02, 0.17, 0.7], [x, legH + 0.32 + 0.07, 0.08], { radius: 0.07 })
    // Back.
    b.box('fabricPlum', [L, 0.58, 0.24], [0, legH + 0.32 + 0.27, -D / 2 + 0.12], { radius: 0.1 })
    for (const x of [-0.52, 0.52])
      b.box('fabricPlum', [0.98, 0.42, 0.17], [x, legH + 0.62, -D / 2 + 0.3], { radius: 0.08, rot: [-0.14, 0, 0] })
    // Chunky round arms.
    for (const s of [-1, 1]) b.box('fabricPlum', [0.22, 0.62, D], [s * (L / 2 - 0.11), legH + 0.31, 0], { radius: 0.1 })
    // Throw pillows.
    b.box('fabricOrange', [0.4, 0.4, 0.14], [-0.68, legH + 0.66, -0.12], { radius: 0.07, rot: [-0.25, 0.25, 0.18] })
    b.box('fabricTeal', [0.38, 0.38, 0.14], [0.7, legH + 0.65, -0.12], { radius: 0.07, rot: [-0.25, -0.3, -0.16] })
    b.box('fabricCream', [0.3, 0.3, 0.12], [0.1, legH + 0.6, -0.08], { radius: 0.06, rot: [-0.2, 0.1, 0.5] })
    // Knitted throw over the right arm.
    b.box('fabricCream', [0.3, 0.035, 0.62], [L / 2 - 0.13, legH + 0.635, 0.04], { radius: 0.015 })
    b.box('fabricCream', [0.035, 0.42, 0.62], [L / 2 + 0.005, legH + 0.42, 0.04], { radius: 0.015 })
    for (let i = 0; i < 3; i++)
      b.box('fabricOrange', [0.04, 0.4, 0.04], [L / 2 + 0.01, legH + 0.42, -0.18 + i * 0.22], { radius: 0.01, shadow: false })
  })
}

export function beanBags(b: PartsBuilder) {
  for (const bag of BEAN_BAGS) {
    const mat = bag.mat as LivingMat
    b.group(bag.center, bag.rotY, () => {
      b.sphere(mat, bag.r, [0, 0.28, 0.02], { scale: [1, 0.6, 1], w: 12, h: 8 })
      b.sphere(mat, bag.r * 0.82, [0, 0.5, -0.2], { scale: [1, 0.85, 0.62], w: 12, h: 8, rot: [-0.25, 0, 0] })
      b.sphere(mat, bag.r * 0.62, [0, 0.42, 0.12], { scale: [1, 0.35, 1], w: 10, h: 6 })
      // Little cream tag.
      b.box('fabricCream', [0.08, 0.05, 0.015], [bag.r * 0.62, 0.34, 0.25], { rot: [0, 0.9, 0], shadow: false })
    })
  }
  // Round knitted pouf.
  b.group(POUF.center, 0, () => {
    b.cyl('fabricPlum', POUF.r * 0.92, POUF.r, POUF.h - 0.04, [0, (POUF.h - 0.04) / 2, 0], { seg: 12 })
    b.sphere('fabricPlum', POUF.r * 0.92, [0, POUF.h - 0.04, 0], { scale: [1, 0.22, 1], w: 12, h: 6 })
    b.torus('fabricOrange', POUF.r * 0.98, 0.022, [0, POUF.h * 0.45, 0], { rot: [Math.PI / 2, 0, 0], shadow: false })
  })
}

export function coffeeTable(b: PartsBuilder) {
  const [w, h, d] = COFFEE_TABLE.size
  b.group(COFFEE_TABLE.center, 0, () => {
    b.box('woodLight', [w, 0.06, d], [0, h - 0.03, 0], { radius: 0.025 })
    b.box('woodLight', [w - 0.16, 0.03, d - 0.16], [0, 0.13, 0], { radius: 0.01 })
    for (const x of [-w / 2 + 0.08, w / 2 - 0.08])
      for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) b.cyl('woodDark', 0.04, 0.032, h - 0.06, [x, (h - 0.06) / 2, z], { seg: 8 })
    const top = h
    // Mug of cocoa.
    b.group([-0.18, top, -0.35], 0.6, () => {
      b.cyl('fabricTeal', 0.045, 0.04, 0.1, [0, 0.05, 0], { seg: 10 })
      b.cyl('woodDark', 0.04, 0.04, 0.005, [0, 0.096, 0], { seg: 10, shadow: false })
      b.torus('fabricTeal', 0.028, 0.008, [0.05, 0.05, 0], { arc: Math.PI, rot: [0, 0, -Math.PI / 2] })
    })
    // Board game box (+ a smaller one on top) with paper lids.
    b.group([0.05, top, 0.25], 0.22, () => {
      b.box('fabricOrange', [0.36, 0.07, 0.36], [0, 0.035, 0], { radius: 0.008 })
      b.box('paper', [0.22, 0.006, 0.22], [0, 0.071, 0], { shadow: false })
      b.box('fabricPlum', [0.24, 0.05, 0.16], [0.02, 0.095, -0.05], { radius: 0.006, rot: [0, -0.5, 0] })
      // Game pieces scattered nearby.
      const pieces: Array<[LivingMat, number, number]> = [['fabricTeal', 0.27, 0.12], ['pinRed', 0.25, -0.06], ['brass', -0.25, 0.2]]
      for (const [m, x, z] of pieces) {
        b.cyl(m, 0.012, 0.018, 0.04, [x, 0.02, z], { seg: 6, shadow: false })
        b.sphere(m, 0.014, [x, 0.05, z], { w: 6, h: 4, shadow: false })
      }
      // A die.
      b.box('paper', [0.035, 0.035, 0.035], [-0.26, 0.018, -0.02], { radius: 0.006, rot: [0, 0.6, 0] })
    })
    tinyPlant(b, [0.17, top, -0.45], 7)
    // A few cards fanned out.
    for (let i = 0; i < 3; i++) b.box('paper', [0.06, 0.003, 0.09], [-0.2, top + 0.002 + i * 0.002, 0.0 + i * 0.03], { rot: [0, 0.3 + i * 0.25, 0], shadow: false })
  })
}

export function sideTable(b: PartsBuilder) {
  const { r, h } = SIDE_TABLE
  b.group(SIDE_TABLE.center, 0, () => {
    b.cyl('woodLight', r, r, 0.045, [0, h - 0.0225, 0], { seg: 14 })
    b.cyl('woodDark', 0.04, 0.05, h - 0.06, [0, (h - 0.06) / 2 + 0.02, 0], { seg: 8 })
    b.cyl('woodDark', 0.18, 0.2, 0.03, [0, 0.015, 0], { seg: 12 })
    // Two stacked books + a succulent.
    b.box('fabricTeal', [0.2, 0.04, 0.15], [-0.05, h + 0.02, 0.07], { radius: 0.006, rot: [0, 0.3, 0] })
    b.box('fabricOrange', [0.18, 0.035, 0.13], [-0.05, h + 0.058, 0.07], { radius: 0.006, rot: [0, -0.1, 0] })
    tinyPlant(b, [0.08, h, -0.09], 11, 'ceramic')
  })
}

export function floorLamp(b: PartsBuilder) {
  const sy = FLOOR_LAMP.shade[1]
  b.group(FLOOR_LAMP.base, 0, () => {
    b.cyl('metalDark', 0.17, 0.19, 0.04, [0, 0.02, 0], { seg: 14 })
    b.rod('brass', [0, 0.04, 0], [0, sy - 0.12, 0], 0.018, { shadow: false })
    b.cyl('brass', 0.03, 0.03, 0.04, [0, sy - 0.14, 0], { seg: 8, shadow: false })
    // Glowing drum shade; its centre is exactly LAMPS.floorLamp. Never casts shadows (the light lives inside).
    b.cyl('emissiveWarm', 0.2, 0.26, 0.34, [0, sy, 0], { seg: 14, shadow: false })
    b.torus('brass', 0.262, 0.008, [0, sy - 0.17, 0], { rot: [Math.PI / 2, 0, 0], shadow: false })
    b.torus('brass', 0.202, 0.008, [0, sy + 0.17, 0], { rot: [Math.PI / 2, 0, 0], shadow: false })
    b.mark('floorLampShade', [0, sy, 0])
  })
}

/** Cord + ceiling canopy, in the pendant's local frame (origin = shade centre at height `y`). */
function pendantCord(b: PartsBuilder, y: number, bottom: number) {
  const top = ROOM.height - y - 0.002
  b.cyl('brass', 0.08, 0.08, 0.03, [0, top - 0.015, 0], { seg: 12, shadow: false })
  b.rod('metalDark', [0, top, 0], [0, bottom, 0], 0.007, { shadow: false })
}

export function pendants(b: PartsBuilder) {
  // A: round paper lantern.
  b.group(LAMPS.pendantA, 0, () => {
    const r = 0.24
    pendantCord(b, LAMPS.pendantA[1], r * 0.9)
    b.cyl('brass', 0.05, 0.07, 0.05, [0, r * 0.88, 0], { seg: 10, shadow: false })
    b.sphere('emissiveWarm', r, [0, 0, 0], { scale: [1, 0.9, 1], w: 14, h: 10, shadow: false })
    for (const y of [-0.1, 0, 0.1]) {
      const rr = Math.sqrt(r * r - (y / 0.9) ** 2) * 1.005
      b.torus('fabricCream', rr, 0.005, [0, y, 0], { rot: [Math.PI / 2, 0, 0], shadow: false })
    }
    b.mark('pendantA', [0, 0, 0])
  })
  // B: cone shade with the bulb peeking out.
  b.group(LAMPS.pendantB, 0, () => {
    const h = 0.28
    pendantCord(b, LAMPS.pendantB[1], h / 2 + 0.03)
    b.cyl('brass', 0.045, 0.06, 0.06, [0, h / 2 + 0.02, 0], { seg: 10, shadow: false })
    b.cyl('emissiveWarm', 0.07, 0.27, h, [0, 0, 0], { seg: 14, shadow: false })
    b.torus('brass', 0.27, 0.01, [0, -h / 2, 0], { rot: [Math.PI / 2, 0, 0], shadow: false })
    b.sphere('emissiveWarm', 0.075, [0, -h / 2 - 0.02, 0], { w: 10, h: 7, shadow: false })
    b.mark('pendantB', [0, 0, 0])
  })
}
