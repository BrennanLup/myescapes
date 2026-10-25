/**
 * Bookshelf unit on the east wall (ANCHORS.shelves) with books and trinkets.
 * Built in the anchor's local frame: +X along the wall (world +Z), +Z into the room.
 * Books (and record sleeves) are returned as instance data for one InstancedMesh.
 */
import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'
import type { PartsBuilder } from './builder'
import { SHELF } from './layout'
import { cactus, tinyPlant } from './plants'
import { rng } from './random'

export interface BookInstance {
  matrix: THREE.Matrix4
  color: string
}

export const BOOK_COLORS = [
  '#c4513f', '#2f8f8a', '#e0a93a', '#6d3b5c', '#5b5fa8', '#4f9d5a', '#e07b39', '#efe0c8', '#8a3b52', '#3f7a7a', '#d4a24c', '#b5579b',
]

const W = SHELF.width
const ZB = SHELF.zBack
const ZF = SHELF.zFront
const D = ZF - ZB
const ZC = (ZF + ZB) / 2
const FOOT = 0.1
const BOARD = 0.04
/** Top surfaces of each level (bottom board first). */
export const LEVELS = [0.15, 0.72, 1.27, 1.82]
const LEVEL_TOP = [0.68, 1.23, 1.78, SHELF.height - 0.05]
const DIVIDERS = [-0.5, 0.5]
/** Bay x ranges (local). */
const BAYS: Array<[number, number]> = [
  [-W / 2 + 0.05, -0.52],
  [-0.48, 0.48],
  [0.52, W / 2 - 0.05],
]

function frame(b: PartsBuilder) {
  for (const x of [-W / 2 + 0.12, W / 2 - 0.12])
    for (const z of [ZB + 0.06, ZF - 0.06]) b.box('woodDark', [0.08, FOOT, 0.08], [x, FOOT / 2, z])
  const bodyH = SHELF.height - FOOT
  for (const s of [-1, 1]) b.box('woodLight', [0.05, bodyH, D], [s * (W / 2 - 0.025), FOOT + bodyH / 2, ZC], { radius: 0.012 })
  for (const x of DIVIDERS) b.box('woodLight', [0.04, bodyH - 0.05, D - 0.02], [x, FOOT + bodyH / 2, ZC])
  b.box('woodLight', [W + 0.04, 0.05, D + 0.03], [0, SHELF.height - 0.025, ZC + 0.01], { radius: 0.015 })
  b.box('woodLight', [W, 0.05, D], [0, FOOT + 0.025, ZC])
  for (let i = 1; i < LEVELS.length; i++) b.box('woodLight', [W - 0.1, BOARD, D - 0.02], [0, LEVELS[i] - BOARD / 2, ZC])
  b.box('woodDark', [W - 0.06, bodyH, 0.02], [0, FOOT + bodyH / 2, ZB + 0.01])
}

/** Fill [x0, x1] on a level with upright books (some leaning). Returns the x where it stopped. */
function bookRow(out: BookInstance[], rand: () => number, level: number, x0: number, x1: number, opts: { leanEnd?: boolean } = {}) {
  const base = LEVELS[level]
  const maxH = LEVEL_TOP[level] - base - 0.06
  let x = x0
  while (true) {
    const w = 0.028 + rand() * 0.035
    const h = Math.min(maxH, 0.22 + rand() * 0.16)
    const d = 0.2 + rand() * 0.08
    if (x + w > x1) break
    const color = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + w / 2, base + h / 2, ZB + 0.03 + d / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(w, h, d),
    )
    out.push({ matrix: m, color })
    x += w + 0.002
  }
  if (opts.leanEnd && x1 - x > 0.04) {
    // One book leaning against the row.
    const w = 0.035
    const h = Math.min(maxH, 0.28)
    const d = 0.24
    const th = 0.32
    const cx = x + (h * Math.sin(th) + w * Math.cos(th)) / 2
    const cy = base + (h * Math.cos(th) + w * Math.sin(th)) / 2
    out.push({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(cx, cy, ZB + 0.03 + d / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -th)),
        new THREE.Vector3(w, h, d),
      ),
      color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)],
    })
  }
  return x
}

/** Books lying flat, stacked. */
function bookStack(out: BookInstance[], rand: () => number, level: number, x: number, n: number) {
  let y = LEVELS[level]
  for (let i = 0; i < n; i++) {
    const h = 0.035 + rand() * 0.02
    const w = 0.2 + rand() * 0.05
    out.push({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(x + (rand() - 0.5) * 0.02, y + h / 2, ZC + 0.02),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rand() - 0.5) * 0.3, 0)),
        new THREE.Vector3(w, h, 0.16 + rand() * 0.04),
      ),
      color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)],
    })
    y += h
  }
  return y
}

/** Upright vinyl sleeves. */
function records(out: BookInstance[], level: number, x0: number, n: number) {
  const s = 0.31
  const colors = ['#2f8f8a', '#e0a93a', '#6d3b5c', '#c4513f', '#efe0c8', '#3d4248', '#e07b39', '#5b5fa8']
  for (let i = 0; i < n; i++) {
    out.push({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(x0 + i * 0.016, LEVELS[level] + s / 2 + 0.002, ZC),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, i === n - 1 ? -0.05 : 0)),
        new THREE.Vector3(0.012, s, s),
      ),
      color: colors[i % colors.length],
    })
  }
}

function recordPlayer(b: PartsBuilder, x: number, level: number) {
  const y = LEVELS[level]
  b.group([x, y, ZC + 0.02], 0, () => {
    b.box('woodDark', [0.42, 0.09, 0.34], [0, 0.045, 0], { radius: 0.015 })
    b.cyl('metalDark', 0.14, 0.14, 0.012, [-0.04, 0.096, 0], { seg: 16 })
    b.cyl('vinyl', 0.135, 0.135, 0.006, [-0.04, 0.105, 0], { seg: 16 })
    b.cyl('fabricOrange', 0.04, 0.04, 0.003, [-0.04, 0.109, 0], { seg: 10, shadow: false })
    b.cyl('metal', 0.022, 0.022, 0.02, [0.15, 0.1, -0.11], { seg: 8 })
    b.rod('metal', [0.15, 0.115, -0.11], [0.05, 0.115, 0.07], 0.005)
    b.box('metal', [0.025, 0.012, 0.035], [0.045, 0.112, 0.08], { rot: [0, 0.4, 0] })
    for (const kx of [0.14, 0.18]) b.cyl('brass', 0.012, 0.012, 0.01, [kx, 0.094, 0.13], { seg: 8, shadow: false })
  })
  // Little speakers either side.
  for (const s of [-1, 1]) {
    b.group([x + s * 0.34, y, ZC + 0.03], 0, () => {
      b.box('woodDark', [0.15, 0.24, 0.15], [0, 0.12, 0], { radius: 0.015 })
      b.cyl('metalDark', 0.05, 0.05, 0.01, [0, 0.13, 0.076], { rot: [Math.PI / 2, 0, 0], seg: 12 })
      b.cyl('metalDark', 0.022, 0.022, 0.01, [0, 0.205, 0.076], { rot: [Math.PI / 2, 0, 0], seg: 10 })
    })
  }
}

function globe(b: PartsBuilder, pos: Vec3) {
  b.group(pos, 0, () => {
    b.cyl('woodDark', 0.06, 0.075, 0.03, [0, 0.015, 0], { seg: 10 })
    b.rod('brass', [0, 0.03, 0], [0, 0.07, 0], 0.01)
    const c: Vec3 = [0, 0.19, 0]
    b.group(c, 0, () => {
      b.sphere('fabricTeal', 0.11, [0, 0, 0], { w: 14, h: 10 })
      // Continents: little bumps.
      const lands: Vec3[] = [[0.6, 0.3, 0], [2.1, -0.2, 0], [3.4, 0.5, 0], [4.6, -0.4, 0], [1.2, -0.6, 0]]
      for (const [lon, lat] of lands) {
        const r = 0.107
        b.sphere('leaf', 0.028, [Math.cos(lat) * Math.cos(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.sin(lon) * r], {
          scale: [1, 0.8, 1],
          w: 6,
          h: 4,
          shadow: false,
        })
      }
      b.torus('brass', 0.125, 0.006, [0, 0, 0], { arc: Math.PI * 1.3, rot: [0, Math.PI / 2, -0.4 - Math.PI * 0.15] })
    }, [0, 0, 0.4])
  })
}

function puzzleBox(b: PartsBuilder, pos: Vec3) {
  b.group(pos, 0.35, () => {
    b.box('woodLight', [0.17, 0.12, 0.13], [0, 0.06, 0], { radius: 0.012 })
    b.box('woodDark', [0.175, 0.02, 0.135], [0, 0.09, 0])
    b.box('brass', [0.03, 0.035, 0.01], [0, 0.065, 0.066], { shadow: false })
    for (const x of [-0.06, 0.06]) for (const y of [0.025, 0.105]) b.sphere('brass', 0.008, [x, y, 0.066], { w: 6, h: 4, shadow: false })
    // A tiny 3x3 slide-puzzle face on top.
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (i + j !== 4) b.box(i === j ? 'fabricOrange' : 'paper', [0.035, 0.008, 0.03], [(i - 1) * 0.04, 0.124, (j - 1) * 0.035], { shadow: false })
  })
}

function trophy(b: PartsBuilder, pos: Vec3) {
  b.group(pos, 0, () => {
    b.box('woodDark', [0.1, 0.035, 0.1], [0, 0.0175, 0], { radius: 0.006 })
    b.box('paper', [0.05, 0.012, 0.003], [0, 0.018, 0.051], { shadow: false })
    b.cyl('brass', 0.012, 0.02, 0.05, [0, 0.06, 0], { seg: 8 })
    b.cyl('brass', 0.065, 0.032, 0.09, [0, 0.13, 0], { seg: 12 })
    for (const s of [-1, 1]) b.torus('brass', 0.025, 0.006, [s * 0.065, 0.14, 0], { rot: [0, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2], arc: Math.PI })
    b.sphere('brass', 0.018, [0, 0.19, 0], { w: 8, h: 5 })
  })
}

function framedPhoto(b: PartsBuilder, pos: Vec3, rotY: number) {
  b.group(pos, rotY, () => {
    b.group([0, 0.15, 0], 0, () => {
      b.box('woodDark', [0.24, 0.3, 0.022], [0, 0, 0], { radius: 0.006 })
      b.box('paper', [0.19, 0.25, 0.004], [0, 0, 0.012], { shadow: false })
      // The "photo": crew silhouettes on a teal sky.
      b.box('fabricTeal', [0.16, 0.13, 0.002], [0, 0.04, 0.015], { shadow: false })
      b.box('fabricOrange', [0.16, 0.05, 0.002], [0, -0.05, 0.015], { shadow: false })
      for (const [x, h] of [[-0.05, 0.06], [0, 0.075], [0.05, 0.055]] as const) {
        b.box('fabricPlum', [0.03, h, 0.002], [x, -0.03 + h / 2, 0.017], { shadow: false })
        b.sphere('fabricPlum', 0.014, [x, -0.03 + h + 0.012, 0.017], { scale: [1, 1, 0.15], w: 6, h: 4, shadow: false })
      }
    }, [-0.14, 0, 0])
  })
}

/** Builds the bookshelf + trinkets into `b` (in world space) and returns book instances (world space). */
export function bookshelf(b: PartsBuilder): BookInstance[] {
  const books: BookInstance[] = []
  const rand = rng(42)
  b.group(SHELF.anchor, SHELF.rotY, () => {
    frame(b)
    const [b0, b1, b2] = BAYS
    // Level 0 (floor): books | records | baskets.
    bookRow(books, rand, 0, b0[0], b0[1])
    records(books, 0, b1[0] + 0.03, 9)
    for (const [x, m] of [[b2[0] + 0.2, 'rug'], [b2[1] - 0.2, 'fabricCream']] as const) {
      b.box(m, [0.36, 0.28, 0.3], [x, LEVELS[0] + 0.14, ZC + 0.02], { radius: 0.03 })
      b.box('woodDark', [0.12, 0.03, 0.01], [x, LEVELS[0] + 0.2, ZC + 0.172], { shadow: false })
    }
    // Level 1: books + puzzle box | record player | books + cactus.
    bookRow(books, rand, 1, b0[0], b0[1] - 0.26, { leanEnd: true })
    puzzleBox(b, [b0[1] - 0.11, LEVELS[1], ZC + 0.04])
    recordPlayer(b, (b1[0] + b1[1]) / 2, 1)
    cactus(b, [b2[0] + 0.1, LEVELS[1], ZC + 0.05])
    bookRow(books, rand, 1, b2[0] + 0.22, b2[1])
    // Level 2: globe + stacked books | full row (leaning end) | photo + books.
    globe(b, [b0[0] + 0.17, LEVELS[2], ZC + 0.03])
    const top = bookStack(books, rand, 2, b0[1] - 0.17, 3)
    tinyPlant(b, [b0[1] - 0.17, top, ZC + 0.02], 5, 'ceramic')
    bookRow(books, rand, 2, b1[0], b1[1] - 0.2, { leanEnd: true })
    framedPhoto(b, [b2[0] + 0.17, LEVELS[2], ZC + 0.02], 0.25)
    bookRow(books, rand, 2, b2[0] + 0.36, b2[1])
    // Level 3: books | books + stack | trophy + books.
    bookRow(books, rand, 3, b0[0], b0[1], { leanEnd: true })
    bookRow(books, rand, 3, b1[0], b1[1] - 0.3)
    bookStack(books, rand, 3, b1[1] - 0.15, 4)
    trophy(b, [b2[0] + 0.14, LEVELS[3], ZC + 0.03])
    bookRow(books, rand, 3, b2[0] + 0.3, b2[1])
    // On top: a trailing pothos and a couple of game boxes.
    const tY = SHELF.height
    b.group([-0.95, tY, ZC], 0, () => {
      b.cyl('ceramic', 0.13, 0.1, 0.17, [0, 0.085, 0], { seg: 10 })
    })
    b.box('fabricOrange', [0.34, 0.08, 0.3], [0.7, tY + 0.04, ZC], { radius: 0.008, rot: [0, 0.1, 0] })
    b.box('fabricTeal', [0.3, 0.07, 0.26], [0.72, tY + 0.115, ZC], { radius: 0.008, rot: [0, -0.15, 0] })
    b.box('paper', [0.18, 0.005, 0.15], [0.72, tY + 0.153, ZC], { rot: [0, -0.15, 0], shadow: false })
  })
  // Pothos on top of the shelf spills over the front edge (reuse the hanging-plant vines, sat in a pot).
  const potTop = new THREE.Vector3(-0.95, SHELF.height + 0.17, ZC).applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...SHELF.anchor),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SHELF.rotY, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  )
  trailingTop(b, [potTop.x, potTop.y, potTop.z])
  // Books to world space.
  const toWorld = new THREE.Matrix4().compose(
    new THREE.Vector3(...SHELF.anchor),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SHELF.rotY, 0)),
    new THREE.Vector3(1, 1, 1),
  )
  for (const bk of books) bk.matrix.premultiply(toWorld)
  return books
}

/** Foliage cluster + vines spilling forward (towards -X world, i.e. into the room) and down. */
function trailingTop(b: PartsBuilder, pos: Vec3) {
  const rand = rng(99)
  b.group(pos, 0, () => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      b.blob(i % 2 ? 'leaf' : 'leafDark', 0.08, [Math.cos(a) * 0.09, 0.03 + rand() * 0.04, Math.sin(a) * 0.09], { detail: 0 })
    }
    for (let v = 0; v < 4; v++) {
      let x = -0.12
      let y = 0
      let z = (v - 1.5) * 0.12
      for (let k = 0; k < 9; k++) {
        b.sphere(k % 3 ? 'leaf' : 'leafDark', 0.045, [x, y, z], { w: 6, h: 4, scale: [1, 0.3, 0.7], rot: [rand() - 0.5, rand() * 3, 0.6 + rand()] })
        if (x > -0.34) x -= 0.06
        else y -= 0.08 + rand() * 0.02
        z += (rand() - 0.5) * 0.04
      }
    }
  })
}
