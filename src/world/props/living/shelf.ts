/**
 * Bookshelf unit on the east wall (ANCHORS.shelves) with books and trinkets.
 * Built in the anchor's local frame: +X along the wall (world +Z), +Z into the room.
 * Books (and record sleeves) are returned as instance data for one InstancedMesh.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Vec3 } from '@/contracts/scene'
import type { PartsBuilder } from './builder'
import { cushion, type V2 } from './geo'
import { SHELF } from './layout'
import { cactus, pot, tinyPlant, vine } from './plants'
import { rng } from './random'

export interface BookInstance {
  matrix: THREE.Matrix4
  color: string
  /** 'book' (cover + page block) or 'record' (plain sleeve). Default book. */
  kind?: 'book' | 'record'
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
  // Turned bun feet.
  for (const x of [-W / 2 + 0.12, W / 2 - 0.12])
    for (const z of [ZB + 0.06, ZF - 0.06])
      b.lathe('woodDark', [[0, 0], [0.03, 0], [0.038, 0.02], [0.04, 0.05], [0.034, 0.08], [0.036, FOOT], [0, FOOT]], [x, 0, z], { seg: 16 })
  const bodyH = SHELF.height - FOOT
  const board = { radius: 0.006, seg: 2 }
  for (const s of [-1, 1]) b.box('woodLight', [0.05, bodyH, D], [s * (W / 2 - 0.025), FOOT + bodyH / 2, ZC], { radius: 0.01, seg: 2 })
  for (const x of DIVIDERS) b.box('woodLight', [0.04, bodyH - 0.05, D - 0.02], [x, FOOT + bodyH / 2, ZC], board)
  // Top with a moulded, overhanging cornice.
  b.slab('woodLight', [W + 0.06, 0.035, D + 0.04], [0, SHELF.height - 0.0175, ZC + 0.015], { r: 0.012, bevel: 0.01 })
  b.box('woodDark', [W + 0.02, 0.02, 0.02], [0, SHELF.height - 0.045, ZF + 0.012], { radius: 0.008, seg: 2 })
  // Plinth and kick board.
  b.box('woodLight', [W, 0.05, D], [0, FOOT + 0.025, ZC], board)
  b.box('woodDark', [W - 0.08, FOOT - 0.02, 0.02], [0, FOOT / 2 + 0.01, ZF - 0.03], { radius: 0.005, seg: 1 })
  // Shelves with a rounded front lip.
  for (let i = 1; i < LEVELS.length; i++) {
    b.box('woodLight', [W - 0.1, BOARD, D - 0.02], [0, LEVELS[i] - BOARD / 2, ZC], board)
    b.box('woodLight', [W - 0.1, BOARD + 0.012, 0.02], [0, LEVELS[i] - BOARD / 2 - 0.004, ZF - 0.012], { radius: 0.008, seg: 2 })
  }
  // Tongue-and-groove back panel: a solid backing board with V-grooved planks in front.
  b.box('woodDark', [W - 0.06, bodyH, 0.008], [0, FOOT + bodyH / 2, ZB + 0.004], { shadow: false })
  const planks = 12
  for (let i = 0; i < planks; i++) {
    const pw = (W - 0.06) / planks
    b.box('woodDark', [pw - 0.002, bodyH, 0.012], [-W / 2 + 0.03 + pw * (i + 0.5), FOOT + bodyH / 2, ZB + 0.012], { radius: 0.003, seg: 1 })
  }
}

/** Fill [x0, x1] on a level with upright books (some leaning). Returns the x where it stopped. */
function bookRow(out: BookInstance[], rand: () => number, level: number, x0: number, x1: number, opts: { leanEnd?: boolean } = {}) {
  const base = LEVELS[level]
  const maxH = LEVEL_TOP[level] - base - 0.06
  let x = x0
  while (true) {
    const w = 0.024 + rand() * 0.038
    const h = Math.min(maxH, 0.2 + rand() * 0.18)
    const d = 0.18 + rand() * 0.09
    // Now and then a book is pushed back or tipped a little against its neighbour.
    const tip = rand() < 0.14 ? (rand() < 0.5 ? -1 : 1) * (0.02 + rand() * 0.035) : 0
    const extra = Math.abs(Math.sin(tip)) * h
    if (x + w + extra > x1) break
    const color = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]
    const push = rand() < 0.3 ? rand() * 0.025 : 0
    const cx = x + w / 2 + extra / 2
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, base + (h * Math.cos(tip) + w * Math.abs(Math.sin(tip))) / 2, ZB + 0.03 + d / 2 + (0.27 - d) * 0.6 - push),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rand() - 0.5) * 0.04, tip)),
      new THREE.Vector3(w, h, d),
    )
    out.push({ matrix: m, color })
    x += w + extra + 0.0015
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
      kind: 'record',
    })
  }
}

function recordPlayer(b: PartsBuilder, x: number, level: number) {
  const y = LEVELS[level]
  b.group([x, y, ZC + 0.02], 0, () => {
    // Plinth on little feet.
    for (const fx of [-0.18, 0.18]) for (const fz of [-0.14, 0.14]) b.cyl('metalDark', 0.018, 0.02, 0.012, [fx, 0.006, fz], { seg: 12 })
    b.box('woodDark', [0.42, 0.075, 0.34], [0, 0.012 + 0.0375, 0], { radius: 0.01 })
    b.box('metalDark', [0.405, 0.004, 0.325], [0, 0.0885, 0], { radius: 0.0015, seg: 1, shadow: false })
    // Platter, record with grooves and label, spindle.
    const px = -0.04
    b.lathe('metal', [[0, 0.09], [0.14, 0.09], [0.142, 0.094], [0.142, 0.1], [0, 0.1]], [px, 0, 0], { seg: 40 })
    const grooves: V2[] = [[0.135, 0.1]]
    for (let i = 0; i <= 10; i++) grooves.push([0.13 - i * 0.008, 0.1035 + (i % 2) * 0.0006])
    grooves.push([0.04, 0.1035], [0, 0.1035])
    b.lathe('vinyl', grooves, [px, 0, 0], { seg: 40 })
    b.cyl('fabricOrange', 0.04, 0.04, 0.001, [px, 0.1045, 0], { seg: 20, shadow: false })
    b.cyl('metal', 0.003, 0.003, 0.016, [px, 0.11, 0], { seg: 6, shadow: false })
    // Tonearm: pivot, counterweight, S-shaped arm and headshell resting near the edge.
    b.lathe('metal', [[0, 0.09], [0.024, 0.09], [0.024, 0.1], [0.012, 0.106], [0.01, 0.125], [0, 0.125]], [0.15, 0, -0.11], { seg: 16 })
    b.cyl('metalDark', 0.012, 0.012, 0.03, [0.168, 0.122, -0.135], { seg: 14, rot: [Math.PI / 2, 0, -0.6] })
    b.tube('metal', [[0.15, 0.122, -0.11], [0.13, 0.121, -0.04], [0.1, 0.118, 0.02], [0.065, 0.114, 0.065]], 0.0035, { seg: 16, radial: 6 })
    b.box('metal', [0.022, 0.007, 0.034], [0.058, 0.112, 0.08], { rot: [0, 0.5, 0], radius: 0.002, seg: 1 })
    b.box('metal', [0.005, 0.003, 0.012], [0.075, 0.112, 0.08], { rot: [0, 0.5, 0], shadow: false })
    // Speed knobs and a pilot light.
    for (const kx of [0.13, 0.17]) b.lathe('brass', [[0.012, 0.09], [0.012, 0.098], [0.009, 0.102], [0, 0.102]], [kx, 0, 0.13], { seg: 12, shadow: false })
    b.sphere('emissiveWarm', 0.004, [-0.18, 0.09, 0.15], { w: 6, h: 4, shadow: false })
    // Smoked dust cover, propped open.
    b.group([0, 0.092, -0.16], 0, () => {
      b.box('glass', [0.41, 0.05, 0.33], [0, 0.025, 0.165], { radius: 0.008, seg: 1, shadow: false })
    }, [-1.25, 0, 0])
  })
  // Bookshelf speakers either side: cabinet, woofer cone, dust cap, tweeter dome.
  for (const s of [-1, 1]) {
    b.group([x + s * 0.34, y, ZC + 0.03], 0, () => {
      b.box('woodDark', [0.15, 0.24, 0.15], [0, 0.12, 0], { radius: 0.012 })
      b.box('metalDark', [0.135, 0.225, 0.004], [0, 0.12, 0.075], { radius: 0.0015, seg: 1 })
      b.lathe('metalDark', [[0.054, 0], [0.056, 0.004], [0.05, 0.006], [0.03, 0.0], [0.02, -0.006], [0.0, -0.004]], [0, 0.1, 0.077], { seg: 24, rot: [Math.PI / 2, 0, 0] })
      b.sphere('metal', 0.016, [0, 0.1, 0.07], { scale: [1, 1, 0.5], w: 12, h: 8 })
      b.torus('metal', 0.022, 0.003, [0, 0.198, 0.078], { seg: 16, radial: 4, shadow: false })
      b.sphere('metal', 0.014, [0, 0.198, 0.076], { scale: [1, 1, 0.5], w: 10, h: 6, shadow: false })
    })
  }
}

function globe(b: PartsBuilder, pos: Vec3) {
  b.group(pos, 0, () => {
    b.lathe('woodDark', [[0, 0], [0.075, 0], [0.078, 0.008], [0.06, 0.025], [0.02, 0.035], [0.014, 0.07], [0, 0.07]], [0, 0, 0], { seg: 24 })
    const c: Vec3 = [0, 0.19, 0]
    b.group(c, 0, () => {
      b.sphere('fabricTeal', 0.11, [0, 0, 0], { w: 32, h: 22 })
      // Continents: flattened smooth blobs hugging the sphere.
      const lands: Array<[number, number, number]> = [[0.6, 0.3, 0.035], [2.1, -0.2, 0.03], [3.4, 0.5, 0.04], [4.6, -0.4, 0.028], [1.2, -0.6, 0.025], [5.4, 0.7, 0.022]]
      for (const [lon, lat, s] of lands) {
        const r = 0.104
        const p: Vec3 = [Math.cos(lat) * Math.cos(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.sin(lon) * r]
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...p).normalize())
        const e = new THREE.Euler().setFromQuaternion(q)
        b.sphere('leaf', s, p, { scale: [1.3, 0.3, 0.9], w: 12, h: 8, rot: [e.x, e.y, e.z], shadow: false })
      }
      // Meridian ring and axis pins.
      b.torus('brass', 0.122, 0.005, [0, 0, 0], { arc: Math.PI * 1.25, rot: [0, Math.PI / 2, -Math.PI * 0.12], seg: 40 })
      for (const sy of [-1, 1]) b.cyl('brass', 0.004, 0.004, 0.03, [0, sy * 0.115, 0], { seg: 6, shadow: false })
    }, [0, 0, 0.4])
    b.rod('brass', [0, 0.035, 0], [0, 0.09, 0.0], 0.008)
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
    b.box('brass', [0.05, 0.014, 0.002], [0, 0.018, 0.0505], { shadow: false })
    // Turned stem and a hollow cup.
    b.lathe('brass', [
      [0.026, 0.035],
      [0.02, 0.042],
      [0.008, 0.05],
      [0.01, 0.07],
      [0.006, 0.08],
      [0.014, 0.088],
      [0.045, 0.11],
      [0.062, 0.15],
      [0.066, 0.18],
      [0.062, 0.181],
      [0.058, 0.152],
      [0.042, 0.115],
      [0, 0.1],
    ], [0, 0, 0], { seg: 32 })
    for (const s of [-1, 1])
      b.tube('brass', [[s * 0.058, 0.168, 0], [s * 0.088, 0.165, 0], [s * 0.085, 0.13, 0], [s * 0.05, 0.12, 0]], 0.0045, { seg: 12, radial: 6 })
  })
}

function framedPhoto(b: PartsBuilder, pos: Vec3, rotY: number) {
  b.group(pos, rotY, () => {
    b.group([0, 0.15, 0], 0, () => {
      for (const [sx, sy, w, h] of [[0, 0.135, 0.24, 0.03], [0, -0.135, 0.24, 0.03], [0.105, 0, 0.03, 0.3], [-0.105, 0, 0.03, 0.3]] as const)
        b.box('woodDark', [w, h, 0.022], [sx, sy, 0], { radius: 0.006 })
      b.box('woodDark', [0.2, 0.26, 0.008], [0, 0, -0.006], { shadow: false })
      b.box('paper', [0.19, 0.25, 0.004], [0, 0, 0.002], { shadow: false })
      b.box('glass', [0.19, 0.25, 0.002], [0, 0, 0.009], { shadow: false })
      // The "photo": crew silhouettes on a teal sky.
      b.box('fabricTeal', [0.16, 0.13, 0.002], [0, 0.04, 0.005], { shadow: false })
      b.box('fabricOrange', [0.16, 0.05, 0.002], [0, -0.05, 0.005], { shadow: false })
      for (const [x, h] of [[-0.05, 0.06], [0, 0.075], [0.05, 0.055]] as const) {
        b.box('fabricPlum', [0.03, h, 0.002], [x, -0.03 + h / 2, 0.007], { shadow: false })
        b.sphere('fabricPlum', 0.014, [x, -0.03 + h + 0.012, 0.007], { scale: [1, 1, 0.15], w: 10, h: 8, shadow: false })
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
      basket(b, m, [x, LEVELS[0], ZC + 0.02])
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
    b.group([-0.95, tY, ZC], 0, () => pot(b, 0.13, 0.17, 'ceramic', { seed: 9 }))
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

/** Foliage crown + vines spilling forward (towards -X world, i.e. into the room) and down the front. */
function trailingTop(b: PartsBuilder, pos: Vec3) {
  const rand = rng(99)
  b.group(pos, 0, () => {
    for (let v = 0; v < 6; v++) {
      const z = (v - 2.5) * 0.06
      const a = Math.PI + (rand() - 0.5) * 0.5
      // Run forward over the top board, then fall down the shelf front.
      const pts: Vec3[] = [[-0.08, 0, z], [-0.2, -0.01, z + (rand() - 0.5) * 0.04], [-0.3, -0.05, z]]
      b.tube('leafDark', pts, 0.0035, { seg: 8, radial: 4, shadow: false })
      vine(b, rand, pts[2], a, 0.5 + rand() * 0.7, { out: 0.012, leaf: 0.07 })
    }
    // Leafy crown sitting in the pot.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand() * 0.3
      const rr = 0.03 + rand() * 0.08
      vine(b, rand, [Math.cos(a) * rr, 0.01 + rand() * 0.03, Math.sin(a) * rr], a, 0.12, { out: 0.06, leaf: 0.08 })
    }
  })
}

/** Woven storage basket with a rope rim and handles. `pos` = bottom centre. */
function basket(b: PartsBuilder, mat: 'rug' | 'fabricCream', pos: Vec3) {
  const weave = cushion({ bulge: 0.008, wrinkle: 0.0015, seed: mat === 'rug' ? 2 : 5 })
  b.soft(mat, [0.36, 0.27, 0.3], [pos[0], pos[1] + 0.135, pos[2]], {
    radius: 0.03,
    deform: (p, u) => {
      weave(p, u)
      // Basket-weave ridges on the walls.
      const r = Math.sin(p.y * 160) * Math.sin((p.x + p.z) * 90) * 0.0018
      if (Math.abs(u.x) > 0.9) p.x += Math.sign(u.x) * r
      if (Math.abs(u.z) > 0.9) p.z += Math.sign(u.z) * r
    },
  })
  b.tube('woodDark', loopPts(0.3, 0.24, 0.025, 0.268, pos), 0.008, { seg: 40, radial: 5, closed: true, shadow: false })
  for (const s of [-1, 1])
    b.tube('woodDark', [[pos[0] + s * 0.181, pos[1] + 0.2, pos[2] - 0.05], [pos[0] + s * 0.2, pos[1] + 0.235, pos[2]], [pos[0] + s * 0.181, pos[1] + 0.2, pos[2] + 0.05]], 0.006, {
      seg: 8,
      radial: 5,
      shadow: false,
    })
}

/** Rounded-rect loop of points in the XZ plane at height y (relative to `o`). */
function loopPts(w: number, d: number, r: number, y: number, o: Vec3): Vec3[] {
  const pts: Vec3[] = []
  const cs: Array<[number, number, number]> = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, Math.PI / 2],
    [-w / 2 + r, -d / 2 + r, Math.PI],
    [w / 2 - r, -d / 2 + r, Math.PI * 1.5],
  ]
  for (const [cx, cz, a0] of cs)
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2)
      pts.push([o[0] + cx + Math.cos(a) * r * 1.4, o[1] + y, o[2] + cz + Math.sin(a) * r * 1.4])
    }
  return pts
}

/** Unit book (centred 1 x 1 x 1, spine facing +Z): two cover boards and a rounded spine with bands (vertex colours darken them). */
export function bookCoverGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tint = (g: THREE.BufferGeometry, v: number) => {
    const ng = g.index ? g.toNonIndexed() : g
    ng.setAttribute('color', new THREE.Float32BufferAttribute(new Array(ng.attributes.position.count * 3).fill(v), 3))
    return ng
  }
  for (const s of [-1, 1]) parts.push(tint(new THREE.BoxGeometry(0.075, 1, 0.97).translate(s * 0.4625, 0, -0.015), 1))
  const spine = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true, -Math.PI / 2, Math.PI)
  spine.scale(1, 1, 0.06).translate(0, 0, 0.47)
  parts.push(tint(spine, 1))
  for (const y of [-0.38, -0.34, 0.34, 0.38]) {
    const band = new THREE.CylinderGeometry(0.505, 0.505, 0.018, 10, 1, true, -Math.PI / 2, Math.PI)
    band.scale(1, 1, 0.075).translate(0, y, 0.47)
    parts.push(tint(band, 0.5))
  }
  const merged = mergeGeometries(parts, false)!
  parts.forEach((g) => g.dispose())
  return merged
}

/** Unit page block that sits inside `bookCoverGeometry`. */
export function bookPagesGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.85, 0.95, 0.96).translate(0, 0, -0.01)
}
