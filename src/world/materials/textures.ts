/**
 * Procedural canvas textures for the shared material set.
 *
 * Every texture is generated lazily on first request, then cached. Each name
 * produces a small bundle generated in one pass:
 *
 * - `getTexture(name)`: sRGB detail map. Most are light (mean near white)
 *   greyscale or faintly tinted maps that multiply the material's palette
 *   colour, so `material.color` stays the palette value. The rug is the
 *   exception: it carries its own colours.
 * - `getNormalTexture(name)`: tangent-space normal map (OpenGL convention,
 *   +Y up) derived with a Sobel filter from the generator's height field.
 * - `getRoughnessTexture(name)`: linear roughness map (read from the green
 *   channel by three.js). `roughnessMapMean(name)` gives its mean so materials
 *   can scale `material.roughness` to hit a target average.
 * - `getBumpTexture(name)`: the height field as a linear greyscale texture
 *   (or the detail map in linear space when a generator has no height).
 *
 * Everything is deterministic (seeded PRNG) and tiles seamlessly (except the
 * rug, which is clamped). Safe in Vitest/jsdom: when no 2D canvas context is
 * available every getter returns null and materials fall back to plain colour.
 */
import * as THREE from 'three'
import { PALETTE } from '@/contracts/style'

export const TEXTURE_NAMES = [
  'woodGrain',
  'planks',
  'cork',
  'fabric',
  'paper',
  'chalk',
  'rug',
  'plaster',
  'screen',
  'brushed',
  'clay',
] as const
export type TextureName = (typeof TEXTURE_NAMES)[number]

type Ctx = CanvasRenderingContext2D
type Field = Float32Array

let canvasSupport: boolean | null = null

/** True when a real 2D canvas is available (false in jsdom / SSR / workers). */
export function canvasAvailable(): boolean {
  if (canvasSupport !== null) return canvasSupport
  canvasSupport = false
  try {
    if (typeof document === 'undefined') return false
    // jsdom logs a "not implemented" error on getContext; skip it entirely.
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false
    const c = document.createElement('canvas')
    canvasSupport = !!c.getContext('2d')
  } catch {
    canvasSupport = false
  }
  return canvasSupport
}

/** Small deterministic PRNG so textures look the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] | null {
  if (!canvasAvailable()) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  return [c, ctx]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** 0..1 -> 0..255 integer, clamped. */
const b8 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0)
/** Pack an opaque RGBA pixel. */
const rgba = (r: number, g: number, b: number) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
const grey8 = (g: number) => (0xff000000 | (g << 16) | (g << 8) | g) >>> 0

const grey = (v: number, a = 1) => {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)))
  return `rgba(${g},${g},${g},${a})`
}

// ---------------------------------------------------------------------------
// Fields: periodic value noise, fbm, streaks. All tile over the canvas size.
// ---------------------------------------------------------------------------

/**
 * Add periodic value noise with `cx` x `cy` lattice cells (0..1, times `amp`)
 * into `out` (a w x h field). Rows are blended once per lattice column, so the
 * per-pixel cost is two reads and a lerp.
 */
function addValueNoise(out: Field, w: number, h: number, cx: number, cy: number, amp: number, rand: () => number) {
  const grid = new Float32Array(cx * cy)
  for (let i = 0; i < grid.length; i++) grid[i] = rand() * amp
  const xi0 = new Int32Array(w)
  const xi1 = new Int32Array(w)
  const xt = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const f = (x * cx) / w
    const i = Math.floor(f)
    const t = f - i
    xi0[x] = i % cx
    xi1[x] = (i + 1) % cx
    xt[x] = t * t * (3 - 2 * t)
  }
  const rowv = new Float32Array(cx)
  for (let y = 0; y < h; y++) {
    const f = (y * cy) / h
    const j = Math.floor(f)
    let ty = f - j
    ty = ty * ty * (3 - 2 * ty)
    const r0 = (j % cy) * cx
    const r1 = ((j + 1) % cy) * cx
    for (let i = 0; i < cx; i++) {
      const a = grid[r0 + i]
      rowv[i] = a + (grid[r1 + i] - a) * ty
    }
    const o = y * w
    for (let x = 0; x < w; x++) {
      const a = rowv[xi0[x]]
      out[o + x] += a + (rowv[xi1[x]] - a) * xt[x]
    }
  }
}

/** Periodic value noise, 0..1. */
function valueNoise(w: number, h: number, cx: number, cy: number, rand: () => number): Field {
  const out = new Float32Array(w * h)
  addValueNoise(out, w, h, cx, cy, 1, rand)
  return out
}

/** Fractal sum of value noise, normalised to 0..1 (mean 0.5). */
function fbm(w: number, h: number, cx: number, cy: number, octaves: number, rand: () => number, gain = 0.5): Field {
  const out = new Float32Array(w * h)
  let total = 0
  let amp = 1
  for (let o = 0; o < octaves; o++) {
    total += amp
    amp *= gain
  }
  amp = 1 / total
  for (let o = 0; o < octaves; o++) {
    addValueNoise(out, w, h, cx << o, cy << o, amp, rand)
    amp *= gain
  }
  return out
}

/** Sparse dashes along X (wood pores, brushed lines): 0 mostly, up to 1 on a dash. */
function dashes(w: number, h: number, density: number, len: number, rand: () => number): Field {
  const out = new Float32Array(w * h)
  const count = Math.round(w * h * density)
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rand() * w)
    const o = Math.floor(rand() * h) * w
    const l = 1 + Math.floor(rand() * len)
    const s = 0.5 + rand() * 0.5
    const step = Math.PI / l
    for (let k = 0; k < l; k++) {
      const i = o + ((x + k) % w)
      const v = s * Math.sin(step * (k + 0.5))
      if (v > out[i]) out[i] = v
    }
  }
  return out
}

/** Rasterise a soft straight segment into a field (wrapping), adding `amount`. */
function stroke(f: Field, w: number, h: number, x0: number, y0: number, x1: number, y1: number, amount: number, width = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(2, Math.ceil(len))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const fade = Math.sin(Math.PI * t)
    for (let oy = -width; oy <= width; oy++) {
      const yy = (((Math.round(y) + oy) % h) + h) % h
      const fall = 1 - Math.abs(oy) / (width + 1)
      const xx = ((Math.round(x) % w) + w) % w
      f[yy * w + xx] += amount * fade * fall
    }
  }
}

// ---------------------------------------------------------------------------
// Output helpers.
// ---------------------------------------------------------------------------

interface Generated {
  /** Detail / colour map (sRGB). */
  albedo: HTMLCanvasElement
  /** Height field, 0..1 (any range works; only slopes matter). */
  height?: Field
  /** Pixel slope multiplier for the normal map. */
  normalStrength?: number
  /** Roughness field, 0..1. */
  rough?: Field
  /** Write the roughness map at half resolution (large textures). */
  roughHalf?: boolean
  w: number
  h: number
}

/** Write a greyscale or RGB field set into a canvas. */
function writeCanvas(w: number, h: number, fill: (px: Uint32Array) => void): HTMLCanvasElement | null {
  const m = makeCanvas(w, h)
  if (!m) return null
  const [c, ctx] = m
  const img = ctx.createImageData(w, h)
  // Little-endian RGBA packing (every browser this app targets is little-endian).
  fill(new Uint32Array(img.data.buffer))
  ctx.putImageData(img, 0, 0)
  return c
}

function greyCanvas(f: Field, w: number, h: number, half = false): HTMLCanvasElement | null {
  if (!half) {
    return writeCanvas(w, h, (px) => {
      for (let i = 0; i < f.length; i++) px[i] = grey8(b8(f[i]))
    })
  }
  const hw = w >> 1
  const hh = h >> 1
  return writeCanvas(hw, hh, (px) => {
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const i = y * 2 * w + x * 2
        px[y * hw + x] = grey8(b8((f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) * 0.25))
      }
    }
  })
}

/** Tangent-space normal map from a height field (3x3 Sobel, wrapping). */
function normalCanvas(hf: Field, w: number, h: number, strength: number): HTMLCanvasElement | null {
  return writeCanvas(w, h, (px) => {
    const k = strength / 8
    const xm = new Int32Array(w)
    const xp = new Int32Array(w)
    for (let x = 0; x < w; x++) {
      xm[x] = (x - 1 + w) % w
      xp[x] = (x + 1) % w
    }
    for (let y = 0; y < h; y++) {
      const ym = ((y - 1 + h) % h) * w
      const y0 = y * w
      const yp = ((y + 1) % h) * w
      for (let x = 0; x < w; x++) {
        const l = xm[x]
        const r = xp[x]
        const tl = hf[ym + l]
        const tr = hf[ym + r]
        const bl = hf[yp + l]
        const br = hf[yp + r]
        const gx = tr + 2 * hf[y0 + r] + br - (tl + 2 * hf[y0 + l] + bl)
        const gy = bl + 2 * hf[yp + x] + br - (tl + 2 * hf[ym + x] + tr)
        // Canvas Y runs down while texture V runs up (flipY), so +gy is +Y.
        const nx = -gx * k
        const ny = gy * k
        const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1)
        px[y0 + x] = rgba((nx * inv + 128) | 0, (ny * inv + 128) | 0, (inv + 128) | 0)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Wood.
// ---------------------------------------------------------------------------

const WOOD_S = 1024
let woodFieldCache: { warp: Field; streak: Field; pores: Field } | null = null

/**
 * Noise fields shared by planks and woodGrain (each samples them at its own
 * offsets): ring warp, fine streaks along the grain, pore dashes.
 */
function woodFields() {
  if (woodFieldCache) return woodFieldCache
  const S = WOOD_S
  const r = rng(5)
  woodFieldCache = {
    warp: fbm(S, S, 3, 16, 3, r),
    streak: fbm(S, S, 3, 160, 2, r, 0.6),
    pores: dashes(S, S, 0.012, 15, r),
  }
  return woodFieldCache
}

interface Knot {
  x: number
  y: number
  sx: number
  sy: number
  amp: number
}

interface Board {
  start: number
  len: number
  tone: number
  tint: [number, number, number]
  dx: number
  dy: number
  freq: number
  phase: number
  cath: number
  cathX: number
  rough: number
  knots: Knot[]
}

/**
 * Staggered plank floor. One tile is meant to cover 2.5 m (along the planks, X)
 * by 1.25 m (across, Y): 6 boards per tile (~0.21 m wide), 0.7-2.5 m long.
 * Canvas X pixels are therefore twice as long in the world as Y pixels; knots
 * and end joints compensate.
 */
function genPlanks(): Generated | null {
  const S = WOOD_S
  const ROWS = 6
  const rowH = S / ROWS
  const r = rng(23)
  const { warp, streak, pores } = woodFields()
  const wear = fbm(S, S, 3, 3, 2, r)
  // Mottle reuses the warp field at another offset (saves a full noise pass).
  const MOT = 377 * S + 611

  // Lay out boards per row with staggered end joints.
  const rows: Board[][] = []
  const boardAt: Uint8Array[] = []
  const localX: Float32Array[] = []
  let prevJoints: number[] = []
  for (let row = 0; row < ROWS; row++) {
    const pick = r()
    const n = pick < 0.3 ? 1 : pick < 0.85 ? 2 : 3
    let offset = 0
    let joints: number[] = []
    for (let tries = 0; tries < 12; tries++) {
      offset = Math.floor(r() * S)
      joints = [offset]
      let acc = offset
      for (let k = 1; k < n; k++) {
        acc += Math.floor((S / n) * (0.7 + r() * 0.6))
        joints.push(acc % S)
      }
      const minGap = Math.min(
        ...joints.map((j) => Math.min(...prevJoints.map((p) => Math.min(Math.abs(p - j), S - Math.abs(p - j))), S)),
      )
      if (minGap > 140) break
    }
    prevJoints = joints
    const sorted = [...joints].sort((a, b) => a - b)
    const boards: Board[] = []
    for (let k = 0; k < sorted.length; k++) {
      const start = sorted[k]
      const end = k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + S
      const len = end - start
      const warmth = (r() - 0.5) * 0.06
      const knots: Knot[] = []
      if (r() < 0.45) {
        const kc = r() < 0.3 ? 2 : 1
        for (let q = 0; q < kc; q++) {
          knots.push({
            x: len * (0.15 + r() * 0.7),
            y: rowH * (0.2 + r() * 0.6),
            sx: 5 + r() * 6,
            sy: 6 + r() * 8,
            amp: 1.5 + r() * 2.5,
          })
        }
      }
      boards.push({
        start,
        len,
        tone: 0.87 + r() * 0.13,
        tint: [1 + warmth * 0.6, 1, 1 - warmth * 1.2],
        dx: Math.floor(r() * S),
        dy: Math.floor(r() * S),
        freq: (5 + r() * 9) / rowH,
        phase: r() * 10,
        cath: r() < 0.55 ? (r() - 0.5) * 9 : 0,
        cathX: len * (0.2 + r() * 0.6),
        rough: 0.3 + r() * 0.12,
        knots,
      })
    }
    const at = new Uint8Array(S)
    const lx = new Float32Array(S)
    for (let x = 0; x < S; x++) {
      for (let k = 0; k < boards.length; k++) {
        const b = boards[k]
        const rel = (((x - b.start) % S) + S) % S
        if (rel < b.len) {
          at[x] = k
          lx[x] = rel + 0.5
          break
        }
      }
    }
    rows.push(boards)
    boardAt.push(at)
    localX.push(lx)
  }

  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    const row = Math.min(ROWS - 1, Math.floor(y / rowH))
    const yl = y - row * rowH + 0.5
    const boards = rows[row]
    const at = boardAt[row]
    const lxs = localX[row]
    const ey = Math.min(yl, rowH - yl)
    for (let x = 0; x < S; x++) {
      const b = boards[at[x]]
      const xl = lxs[x]
      const i = y * S + x
      const si = ((y + b.dy) & (S - 1)) * S + ((x + b.dx) & (S - 1))
      // Edge distance in Y-pixel units (X pixels are twice as long).
      const ex = Math.min(xl, b.len - xl) * 2
      const e = ey < ex ? ey : ex
      let bevel = 1
      let seam = 0
      if (e < 4.5) {
        bevel = smooth(0.6, 4.5, e)
        seam = 1 - smooth(0.4, 1.6, e)
      }

      // Growth rings: warped, arched (cathedral) bands with knots bending them.
      const u = (xl - b.cathX) / b.len
      let d = yl * b.freq + (warp[si] - 0.5) * 2.4 + b.phase + b.cath * u * u
      let knotCore = 0
      for (let k = 0; k < b.knots.length; k++) {
        const kn = b.knots[k]
        const ky = (yl - kn.y) / kn.sy
        if (ky > 6.4 || ky < -6.4) continue
        const kx = ((xl - kn.x) * 2) / kn.sx
        const r2 = kx * kx + ky * ky
        if (r2 < 40) {
          d += kn.amp * Math.exp(-r2 * 0.18)
          knotCore = Math.max(knotCore, 1 - smooth(0.3, 1.3, r2))
        }
      }
      const ring = d - Math.floor(d)
      let late = ring * ring
      late *= late
      const st = streak[si] - 0.5
      const pr = pores[si]
      const wv = wear[i]
      const wr = wv <= 0.52 ? 0 : smooth(0.52, 0.8, wv)

      let v = b.tone * (1 - 0.2 * late - 0.16 * st - 0.22 * pr) * (0.96 + 0.08 * warp[(si + MOT) & (S * S - 1)])
      v *= 1 - 0.22 * knotCore
      v *= 1 + 0.05 * wr // worn varnish reads a touch lighter
      v *= 0.82 + 0.18 * bevel // grime in the bevel
      v *= 1 - 0.55 * seam
      A[i] = v

      H[i] = bevel * 1.0 - 0.06 * late - 0.08 * pr - 0.05 * knotCore - 0.5 * seam
      R[i] = Math.min(1, b.rough + 0.12 * st + 0.12 * pr + 0.1 * late + 0.3 * wr + 0.15 * (1 - bevel) + 0.5 * seam)
    }
  }

  // Fine scuffs and scratches (rougher, slightly lighter).
  for (let s = 0; s < 70; s++) {
    const x0 = r() * S
    const y0 = r() * S
    const a = (r() - 0.5) * 1.2 + (r() < 0.5 ? 0 : Math.PI / 2)
    const l = 10 + r() * 60
    stroke(R, S, S, x0, y0, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l * 2, 0.25, 0)
    stroke(A, S, S, x0, y0, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l * 2, 0.05, 0)
  }

  const albedo = writeCanvas(S, S, (px) => {
    for (let y = 0; y < S; y++) {
      const row = Math.min(ROWS - 1, Math.floor(y / rowH))
      const at = boardAt[row]
      const boards = rows[row]
      for (let x = 0; x < S; x++) {
        const t = boards[at[x]].tint
        const i = y * S + x
        const v = A[i]
        px[i] = rgba(b8(v * t[0]), b8(v * t[1]), b8(v * t[2]))
      }
    }
  })
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 2.2, rough: R, roughHalf: true, w: S, h: S }
}

/** Furniture / beam wood: flat-sawn grain along X with cathedral arches and two knots. */
function genWoodGrain(): Generated | null {
  const S = WOOD_S
  const r = rng(11)
  const { warp, streak, pores } = woodFields()
  // Broad tone drift reuses the warp field at another offset.
  const BROAD = 509 * S + 287
  const GRAIN_OFF = 211 * S + 733
  const MASK = S * S - 1
  const RINGS = 34
  const cathA = 2.6
  const cathX = r() * S
  const knots: Knot[] = [
    { x: r() * S, y: r() * S, sx: 7 + r() * 4, sy: 4 + r() * 2, amp: 1.6 },
    { x: r() * S, y: r() * S, sx: 5 + r() * 3, sy: 3 + r() * 2, amp: 1.2 },
  ]
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  const TAU = Math.PI * 2
  // Periodic arch term so the tile wraps in X.
  const arch = new Float32Array(S)
  for (let x = 0; x < S; x++) arch[x] = cathA * (1 - Math.cos((TAU * (x - cathX)) / S)) * 0.5
  const half = S / 2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const broad = warp[(i + BROAD) & MASK]
      const si = (i + GRAIN_OFF) & MASK
      let d = (y / S) * RINGS + (warp[si] - 0.5) * 1.3 + arch[x] * (0.6 + 0.8 * broad)
      let core = 0
      for (let k = 0; k < knots.length; k++) {
        const kn = knots[k]
        let dy = Math.abs(y - kn.y)
        if (dy > half) dy = S - dy
        if (dy > kn.sy * 7.1) continue
        let dx = Math.abs(x - kn.x)
        if (dx > half) dx = S - dx
        const kx = dx / kn.sx
        const ky = dy / kn.sy
        const r2 = kx * kx + ky * ky
        if (r2 < 50) {
          d += kn.amp * Math.exp(-r2 * 0.12)
          core = Math.max(core, 1 - smooth(0.4, 1.5, r2))
        }
      }
      const ring = d - Math.floor(d)
      let late = ring * ring
      late *= late
      const st = streak[si] - 0.5
      const pr = pores[si]
      let v = (0.93 + 0.07 * (broad - 0.5)) * (1 - 0.18 * late - 0.14 * st - 0.2 * pr)
      v *= 1 - 0.25 * core
      A[i] = v
      H[i] = -0.08 * late - 0.12 * pr - 0.06 * core + 0.03 * st
      R[i] = Math.min(1, 0.42 + 0.14 * st + 0.18 * pr + 0.08 * late)
    }
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 1.6, rough: R, roughHalf: true, w: S, h: S }
}

// ---------------------------------------------------------------------------
// Other surfaces.
// ---------------------------------------------------------------------------

/** Hand-troweled plaster: soft blotches, faint burnished ridges, sand grain. */
function genPlaster(): Generated | null {
  const S = 512
  const r = rng(97)
  const blot = fbm(S, S, 3, 3, 5, r)
  const trow = fbm(S, S, 5, 4, 3, r)
  const trow2 = fbm(S, S, 9, 7, 2, r)
  const sand = valueNoise(S, S, 256, 256, r)
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let i = 0; i < A.length; i++) {
    const ridge = 1 - Math.abs(2 * trow[i] - 1)
    const ridge2 = 1 - Math.abs(2 * trow2[i] - 1)
    const r2 = ridge * ridge
    const q2 = ridge2 * ridge2
    const t = r2 * r2 * ridge * 0.7 + q2 * q2 * q2 * ridge2 * 0.4
    const b = blot[i] - 0.5
    A[i] = 0.95 + 0.055 * b + 0.02 * t - 0.025 * (sand[i] - 0.5)
    H[i] = 0.45 * t + 0.6 * b + 0.2 * sand[i]
    R[i] = 0.93 - 0.08 * t + 0.05 * b
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 1.4, rough: R, w: S, h: S }
}

/** 2/2 twill weave with per-yarn tone, twist striations and fuzz. */
function genFabric(): Generated | null {
  const S = 512
  const P = 4 // pixels per thread
  const N = S / P
  const r = rng(41)
  const warpTone = new Float32Array(N)
  const weftTone = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    warpTone[i] = 0.9 + r() * 0.1
    weftTone[i] = 0.84 + r() * 0.1
  }
  // Lookup tables: yarn cross-section, the bulge where a yarn dives under, twist.
  const across = new Float32Array(P)
  for (let k = 0; k < P; k++) across[k] = Math.sin((Math.PI * (k + 0.5)) / P)
  const along = new Float32Array(P * 2)
  for (let k = 0; k < P * 2; k++) along[k] = 0.75 + 0.25 * Math.sin((Math.PI * k) / (P * 2))
  const TW = 20
  const twistT = new Float32Array(TW)
  for (let k = 0; k < TW; k++) twistT[k] = Math.sin((Math.PI * 2 * k) / TW)
  const fuzz = valueNoise(S, S, 128, 128, r)
  const mottle = fbm(S, S, 4, 4, 2, r)
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    const j = (y / P) | 0
    const fy = y % P
    const ay = along[y % (P * 2)]
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const ii = (x / P) | 0
      const fx = x % P
      let prof: number
      let tone: number
      let twist: number
      if (((ii + j) & 3) < 2) {
        // Vertical yarn on top: rounded across X, bulging where it dives under.
        prof = across[fx] * ay
        tone = warpTone[ii]
        twist = twistT[(fx * 10 + 5 + y * 7) % TW]
      } else {
        prof = across[fy] * along[x % (P * 2)]
        tone = weftTone[j]
        twist = twistT[(fy * 10 + 5 + x * 7) % TW]
      }
      const fz = fuzz[i] - 0.5
      A[i] = tone * (0.72 + 0.28 * prof) * (1 + 0.03 * twist + 0.05 * fz) * (0.97 + 0.06 * mottle[i])
      H[i] = prof * (1 + 0.08 * twist) + 0.1 * fz
      R[i] = 0.98 - 0.08 * prof
    }
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 1.2, rough: R, w: S, h: S }
}

/** Granulated cork: Worley cells with crevices, pits and larger tone drift. */
function genCork(): Generated | null {
  const S = 512
  const C = 128
  const r = rng(37)
  const px = new Float32Array(C * C)
  const py = new Float32Array(C * C)
  const tone = new Float32Array(C * C)
  for (let i = 0; i < C * C; i++) {
    px[i] = r()
    py[i] = r()
    const t = r()
    tone[i] = t < 0.05 ? 0.5 + r() * 0.15 : t < 0.1 ? 1.05 : 0.8 + r() * 0.2
  }
  const drift = fbm(S, S, 4, 4, 3, r)
  const grain = valueNoise(S, S, 256, 256, r)
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  const cs = S / C
  const wrapC = new Int32Array(C + 2)
  for (let k = 0; k < C + 2; k++) wrapC[k] = (k - 1 + C) % C
  for (let y = 0; y < S; y++) {
    const gy = y / cs
    const cy = gy | 0
    for (let x = 0; x < S; x++) {
      const gx = x / cs
      const cx = gx | 0
      let f1 = 9
      let f2 = 9
      let id = 0
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy
        const wy = wrapC[ny + 1] * C
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox
          const k = wy + wrapC[nx + 1]
          const dx = nx + px[k] - gx
          const dy = ny + py[k] - gy
          const dd = dx * dx + dy * dy
          if (dd < f1) {
            f2 = f1
            f1 = dd
            id = k
          } else if (dd < f2) f2 = dd
        }
      }
      const edge = smooth(0, 0.25, Math.sqrt(f2) - Math.sqrt(f1))
      const i = y * S + x
      const t = tone[id]
      const gn = grain[i] - 0.5
      A[i] = Math.min(1, t * (0.8 + 0.2 * edge) * (0.92 + 0.16 * drift[i]) * (1 + 0.14 * gn))
      H[i] = edge * 0.5 + t * 0.5 - Math.sqrt(f1) * 0.25 + 0.35 * gn
      R[i] = 1
    }
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 2.4, w: S, h: S }
}

/** Paper: cloudy formation, fine tooth and scattered fibres. */
function genPaper(): Generated | null {
  const S = 512
  const r = rng(53)
  const cloud = fbm(S, S, 6, 6, 3, r)
  const tooth = valueNoise(S, S, 192, 192, r)
  const fib = new Float32Array(S * S)
  for (let i = 0; i < 700; i++) {
    const x = r() * S
    const y = r() * S
    const a = r() * Math.PI
    const l = 4 + r() * 16
    stroke(fib, S, S, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.5 + r() * 0.5, 0)
  }
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let i = 0; i < A.length; i++) {
    const f = Math.min(1, fib[i])
    A[i] = 0.985 + 0.02 * (cloud[i] - 0.5) - 0.025 * f - 0.012 * (tooth[i] - 0.5)
    H[i] = 0.5 * tooth[i] + 0.4 * f + 0.4 * cloud[i]
    R[i] = 0.9 + 0.06 * (tooth[i] - 0.5) - 0.05 * f
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 0.9, rough: R, w: S, h: S }
}

/** Slate chalkboard: eraser smudges and wipe arcs (dusty, rougher), chalk specks. */
function genChalk(): Generated | null {
  const S = 512
  const m = makeCanvas(S, S)
  if (!m) return null
  const [c, ctx] = m
  const r = rng(67)
  ctx.fillStyle = grey(0.82)
  ctx.fillRect(0, 0, S, S)
  const wrapDraw = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy)
  }
  for (let i = 0; i < 18; i++) {
    const x = r() * S
    const y = r() * S
    const rad = 40 + r() * 110
    const a = 0.12 + r() * 0.2
    wrapDraw((ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad)
      g.addColorStop(0, grey(1, a))
      g.addColorStop(1, grey(1, 0))
      ctx.fillStyle = g
      ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2)
    })
  }
  ctx.lineCap = 'round'
  for (let i = 0; i < 26; i++) {
    const y = r() * S
    const a = 0.05 + r() * 0.08
    const lw = 14 + r() * 30
    const c1 = (r() - 0.5) * 80
    const c2 = (r() - 0.5) * 80
    const e = (r() - 0.5) * 50
    wrapDraw((ox, oy) => {
      ctx.strokeStyle = grey(1, a)
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(ox - 20, y + oy)
      ctx.bezierCurveTo(ox + S * 0.33, y + oy + c1, ox + S * 0.66, y + oy + c2, ox + S + 20, y + oy + e)
      ctx.stroke()
    })
  }
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  const grain = valueNoise(S, S, 256, 256, r)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let i = 0, o = 0; i < H.length; i++, o += 4) {
    const dust = d[o] / 255
    const speck = r() < 0.004 ? 0.12 + r() * 0.1 : 0
    const v = Math.min(1, dust * (0.97 + 0.06 * (grain[i] - 0.5)) + speck)
    d[o] = d[o + 1] = d[o + 2] = v * 255
    H[i] = grain[i] * 0.6 + speck * 2
    R[i] = 0.72 + 0.35 * (dust - 0.82) / 0.18 + 0.05 * grain[i]
  }
  ctx.putImageData(img, 0, 0)
  return { albedo: c, height: H, normalStrength: 0.8, rough: R, w: S, h: S }
}

/** Full-colour woven rug: border, stripes and diamond medallions, knotted pile and abrash. Not tiled. */
function genRug(): Generated | null {
  const S = 512
  const m = makeCanvas(S, S)
  if (!m) return null
  const [c, ctx] = m
  const r = rng(79)
  ctx.fillStyle = PALETTE.rug
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = PALETTE.fabricCream
  ctx.fillRect(18, 18, 476, 476)
  ctx.fillStyle = PALETTE.rug
  ctx.fillRect(30, 30, 452, 452)
  // Running-dog border band.
  ctx.fillStyle = PALETTE.fabricPlum
  for (let x = 40; x < 472; x += 16) {
    ctx.fillRect(x, 40, 8, 8)
    ctx.fillRect(x + 8, 464, 8, 8)
  }
  for (let y = 56; y < 456; y += 16) {
    ctx.fillRect(40, y, 8, 8)
    ctx.fillRect(464, y + 8, 8, 8)
  }
  const stripes = [PALETTE.fabricOrange, PALETTE.fabricCream, PALETTE.fabricPlum, PALETTE.fabricCream, PALETTE.fabricOrange]
  stripes.forEach((col, i) => {
    ctx.fillStyle = col
    ctx.fillRect(30, 70 + i * 8, 452, 4)
    ctx.fillRect(30, S - 74 - i * 8, 452, 4)
  })
  const drawDiamond = (cx: number, cy: number, s: number, col: string) => {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.moveTo(cx, cy - s)
    ctx.lineTo(cx + s, cy)
    ctx.lineTo(cx, cy + s)
    ctx.lineTo(cx - s, cy)
    ctx.closePath()
    ctx.fill()
  }
  for (let i = 0; i < 5; i++) {
    const cx = 96 + i * 80
    drawDiamond(cx, 256, 34, PALETTE.fabricCream)
    drawDiamond(cx, 256, 24, PALETTE.fabricTeal)
    drawDiamond(cx, 256, 12, PALETTE.fabricOrange)
    drawDiamond(cx, 256, 4, PALETTE.fabricCream)
  }
  for (let i = 0; i < 6; i++) {
    const cx = 56 + i * 80
    drawDiamond(cx, 170, 8, PALETTE.fabricCream)
    drawDiamond(cx, 342, 8, PALETTE.fabricCream)
  }
  // Pile: 3 px knots, per-knot tone, abrash bands (dye-lot drift along the warp), light wear.
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  // 3 px knots (the rug is clamped, so the grid need not divide the size).
  const K = 3
  const KN = Math.ceil(S / K)
  const pileT = [0.55, 1, 0.55]
  const knot = new Float32Array(KN * KN)
  for (let i = 0; i < knot.length; i++) knot[i] = r()
  const abrash = valueNoise(S, S, 1, 9, r)
  const wear = fbm(S, S, 3, 3, 3, r)
  const fuzz = valueNoise(S, S, 128, 128, r)
  const H = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    const ky = (y / K) | 0
    const fy = y % K
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const kx = (x / K) | 0
      const fx = x % K
      const kt = knot[ky * KN + kx]
      const prof = pileT[fx] * pileT[fy]
      const w = smooth(0.55, 0.85, wear[i])
      const f = (0.86 + 0.14 * prof) * (0.94 + 0.1 * kt) * (0.95 + 0.08 * abrash[i]) * (1 + 0.04 * (fuzz[i] - 0.5))
      const o = i * 4
      for (let ch = 0; ch < 3; ch++) {
        // Worn pile shows the paler foundation.
        const v = (d[o + ch] * f) * (1 - 0.12 * w) + 200 * 0.12 * w
        d[o + ch] = v
      }
      H[i] = prof * 0.7 + kt * 0.3 - 0.4 * w + 0.2 * fuzz[i]
    }
  }
  ctx.putImageData(img, 0, 0)
  return { albedo: c, height: H, normalStrength: 1.4, w: S, h: S }
}

/** Faint scanlines + vignette, used as an emissive map for idle screens. */
function genScreen(): Generated | null {
  const m = makeCanvas(256, 256)
  if (!m) return null
  const [c, ctx] = m
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 190)
  g.addColorStop(0, grey(1))
  g.addColorStop(1, grey(0.55))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(0, y, 256, 1.5)
  }
  return { albedo: c, w: 256, h: 256 }
}

/** Brushed metal: fine streaks along X in roughness (and a whisper in colour). */
function genBrushed(): Generated | null {
  const S = 512
  const r = rng(131)
  const fine = valueNoise(S, S, 2, 512, r)
  const mid = valueNoise(S, S, 4, 128, r)
  const lines = dashes(S, S, 0.02, 60, r)
  const smudge = fbm(S, S, 3, 3, 3, r)
  const A = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let i = 0; i < A.length; i++) {
    const s = 0.6 * (fine[i] - 0.5) + 0.4 * (mid[i] - 0.5) + 0.25 * lines[i]
    A[i] = 0.96 - 0.06 * s
    R[i] = 0.62 + 0.55 * s + 0.2 * (smudge[i] - 0.5)
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, rough: R, w: S, h: S }
}

/** Unglazed terracotta: grog speckles and soft firing variation. */
function genClay(): Generated | null {
  const S = 256
  const r = rng(149)
  const fire = fbm(S, S, 3, 3, 4, r)
  const grain = valueNoise(S, S, 128, 128, r)
  const A = new Float32Array(S * S)
  const H = new Float32Array(S * S)
  const R = new Float32Array(S * S)
  for (let i = 0; i < A.length; i++) {
    const n = r()
    const speck = n < 0.025 ? -0.25 : n < 0.05 ? 0.12 : 0
    A[i] = Math.min(1, 0.94 + 0.1 * (fire[i] - 0.5) + speck - 0.03 * (grain[i] - 0.5))
    H[i] = grain[i] * 0.5 + (speck !== 0 ? 0.4 : 0) + fire[i] * 0.3
    R[i] = 0.9 + 0.08 * (grain[i] - 0.5)
  }
  const albedo = greyCanvas(A, S, S)
  if (!albedo) return null
  return { albedo, height: H, normalStrength: 1.5, rough: R, w: S, h: S }
}

const generators: Record<TextureName, () => Generated | null> = {
  woodGrain: genWoodGrain,
  planks: genPlanks,
  cork: genCork,
  fabric: genFabric,
  paper: genPaper,
  chalk: genChalk,
  rug: genRug,
  plaster: genPlaster,
  screen: genScreen,
  brushed: genBrushed,
  clay: genClay,
}

/**
 * Default repeat per texture (materials apply this to their shared texture).
 * Room floor plane is 20 m x 16 m; one plank tile is 2.5 m (along) x 1.25 m.
 */
const REPEAT: Partial<Record<TextureName, [number, number]>> = {
  planks: [8, 12.8],
  plaster: [3, 1.5],
  // Sized for the 8.8 x 2.8 m board face (0..1 UVs): ~0.63 m tiles, ~5 mm granules.
  cork: [14, 4.5],
  fabric: [3, 3],
  woodGrain: [1, 1],
  brushed: [1, 1],
  clay: [2, 1],
}

/** Anisotropic filtering requested on every texture (three clamps to the GPU max). */
export const TEXTURE_ANISOTROPY = 8

interface Bundle {
  albedo: THREE.CanvasTexture
  normal: THREE.CanvasTexture | null
  rough: THREE.CanvasTexture | null
  /** Raw height field, turned into a bump texture only if someone asks for it. */
  heightField: { f: Field; w: number; h: number; half: boolean } | null
  roughMean: number
}

const cache = new Map<TextureName, Bundle | null>()
let generationMs = 0
const timings: Partial<Record<TextureName, number>> = {}

/** Per-texture generation time in ms (detail + normal + roughness maps together). */
export function textureTimings() {
  return { ...timings }
}

/** Total milliseconds spent generating textures so far (for perf checks). */
export function textureGenerationMs() {
  return generationMs
}

function setup(tex: THREE.CanvasTexture, name: TextureName, kind: string, srgb: boolean) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = tex.wrapT = name === 'rug' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = TEXTURE_ANISOTROPY
  const rep = REPEAT[name]
  if (rep) tex.repeat.set(rep[0], rep[1])
  tex.name = kind ? `proc:${name}:${kind}` : `proc:${name}`
  tex.needsUpdate = true
  return tex
}

function getBundle(name: TextureName): Bundle | null {
  if (cache.has(name)) return cache.get(name) ?? null
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  let bundle: Bundle | null = null
  const g = canvasAvailable() ? generators[name]() : null
  if (g) {
    const albedo = setup(new THREE.CanvasTexture(g.albedo), name, '', true)
    let normal: THREE.CanvasTexture | null = null
    let heightField: Bundle['heightField'] = null
    let rough: THREE.CanvasTexture | null = null
    let roughMean = 1
    if (g.height) {
      const nc = normalCanvas(g.height, g.w, g.h, g.normalStrength ?? 1)
      if (nc) normal = setup(new THREE.CanvasTexture(nc), name, 'normal', false)
      heightField = { f: g.height, w: g.w, h: g.h, half: !!g.roughHalf }
    }
    if (g.rough) {
      let sum = 0
      for (let i = 0; i < g.rough.length; i++) {
        const v = clamp01(g.rough[i])
        g.rough[i] = v
        sum += v
      }
      roughMean = sum / g.rough.length
      const rc = greyCanvas(g.rough, g.w, g.h, g.roughHalf)
      if (rc) rough = setup(new THREE.CanvasTexture(rc), name, 'roughness', false)
    }
    bundle = { albedo, normal, rough, heightField, roughMean }
  }
  if (typeof performance !== 'undefined') {
    const dt = performance.now() - t0
    timings[name] = dt
    generationMs += dt
  }
  cache.set(name, bundle)
  return bundle
}

/**
 * Shared procedural detail texture by name, or null when canvas is unavailable.
 * sRGB colour space, mipmaps, RepeatWrapping (rug: clamped). Do not dispose; clone to change repeat.
 */
export function getTexture(name: TextureName): THREE.CanvasTexture | null {
  return getBundle(name)?.albedo ?? null
}

/** Tangent-space normal map for `name` (linear), or null when the texture has no relief / no canvas. */
export function getNormalTexture(name: TextureName): THREE.CanvasTexture | null {
  return getBundle(name)?.normal ?? null
}

/** Linear roughness map for `name` (green channel is what three.js reads), or null. */
export function getRoughnessTexture(name: TextureName): THREE.CanvasTexture | null {
  return getBundle(name)?.rough ?? null
}

/** Mean value of `getRoughnessTexture(name)` (1 when there is no map). */
export function roughnessMapMean(name: TextureName): number {
  return getBundle(name)?.roughMean ?? 1
}

const bumpCache = new Map<TextureName, THREE.Texture | null>()

/**
 * Linear greyscale height map for `name` (for bumpMap use). Falls back to the
 * detail map in linear space when the generator has no height field.
 */
export function getBumpTexture(name: TextureName): THREE.Texture | null {
  if (bumpCache.has(name)) return bumpCache.get(name) ?? null
  const b = getBundle(name)
  let bump: THREE.Texture | null = null
  if (b?.heightField) {
    const { f, w, h, half } = b.heightField
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < f.length; i++) {
      const v = f[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo || 1
    const hn = new Float32Array(f.length)
    for (let i = 0; i < hn.length; i++) hn[i] = (f[i] - lo) / span
    const hc = greyCanvas(hn, w, h, half)
    if (hc) bump = setup(new THREE.CanvasTexture(hc), name, 'height', false)
  } else if (b) {
    bump = b.albedo.clone()
    bump.colorSpace = THREE.NoColorSpace
    bump.name = `proc:${name}:bump`
    bump.needsUpdate = true
  }
  bumpCache.set(name, bump)
  return bump
}

/** Test helper: forget cached textures and canvas detection. */
export function __resetTextures() {
  cache.clear()
  bumpCache.clear()
  woodFieldCache = null
  canvasSupport = null
  generationMs = 0
  for (const k of Object.keys(timings)) delete timings[k as TextureName]
}
