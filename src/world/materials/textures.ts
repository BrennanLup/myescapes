/**
 * Procedural canvas textures for the stylized material set.
 *
 * Every texture is generated lazily on first request, then cached. Most are
 * light greyscale "detail" maps (mean close to white) that multiply the
 * material's palette colour, so `material.color` stays the palette value.
 * The rug is the exception: it carries its own colours.
 *
 * Safe in Vitest/jsdom: when no 2D canvas context is available every getter
 * returns null and materials fall back to a plain colour.
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
] as const
export type TextureName = (typeof TEXTURE_NAMES)[number]

type Ctx = CanvasRenderingContext2D

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

const grey = (v: number, a = 1) => {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)))
  return `rgba(${g},${g},${g},${a})`
}

/** Per-pixel multiplicative noise (cheap: one ImageData pass). */
function noise(ctx: Ctx, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = 1 - amount * rand()
    d[i] *= n
    d[i + 1] *= n
    d[i + 2] *= n
  }
  ctx.putImageData(img, 0, 0)
}

/** Wavy grain lines along X; tiles horizontally. */
function drawGrain(ctx: Ctx, x: number, y: number, w: number, h: number, rand: () => number, lines: number) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  for (let i = 0; i < lines; i++) {
    const yy = y + rand() * h
    const amp = 1 + rand() * 4
    const freq = (Math.PI * 2 * (1 + Math.floor(rand() * 3))) / w
    const phase = rand() * Math.PI * 2
    ctx.strokeStyle = grey(0.55 + rand() * 0.25, 0.12 + rand() * 0.22)
    ctx.lineWidth = 0.6 + rand() * 1.6
    ctx.beginPath()
    for (let xx = 0; xx <= w + 16; xx += 16) {
      const py = yy + Math.sin(xx * freq + phase) * amp
      if (xx === 0) ctx.moveTo(x + xx, py)
      else ctx.lineTo(x + xx, py)
    }
    ctx.stroke()
  }
  // A knot now and then.
  if (rand() < 0.5) {
    const kx = x + rand() * w
    const ky = y + h * (0.3 + rand() * 0.4)
    for (let r = 1; r < 4; r++) {
      ctx.strokeStyle = grey(0.6, 0.25)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(kx, ky, r * 4, r * 1.6, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

const generators: Record<TextureName, () => HTMLCanvasElement | null> = {
  woodGrain() {
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(11)
    ctx.fillStyle = grey(0.96)
    ctx.fillRect(0, 0, 256, 256)
    // Broad soft bands, then fine grain.
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = grey(0.85 + r() * 0.1, 0.25)
      ctx.fillRect(0, r() * 256, 256, 6 + r() * 20)
    }
    drawGrain(ctx, 0, 0, 256, 256, r, 46)
    noise(ctx, 256, 256, 0.05, r)
    return c
  },

  planks() {
    // 4 planks per tile, staggered end joints; tile = 1.25 m square by default (planks ~0.31 m wide).
    const m = makeCanvas(512, 512)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(23)
    const rows = 4
    const ph = 512 / rows
    for (let row = 0; row < rows; row++) {
      const y = row * ph
      const offset = (row * 0.37 * 512) % 512
      const lengths = [512 * 0.68, 512 * 0.32]
      let x = -offset
      let k = 0
      while (x < 512) {
        const len = lengths[k % 2]
        const seed = 1000 + row * 50 + k++
        const tone = 0.88 + r() * 0.1
        // Draw twice (wrapped) so the tile repeats seamlessly.
        for (const dx of [0, 512]) {
          const px = x + dx
          if (px > 512 || px + len < 0) continue
          ctx.fillStyle = grey(tone)
          ctx.fillRect(px, y, len, ph)
          drawGrain(ctx, px, y + 2, len, ph - 4, rng(seed), 9)
          ctx.fillStyle = grey(0.45, 0.85)
          ctx.fillRect(px, y, 2, ph) // end joint
        }
        x += len
      }
      ctx.fillStyle = grey(0.4, 0.9)
      ctx.fillRect(0, y, 512, 2) // long seam
      ctx.fillStyle = grey(1, 0.25)
      ctx.fillRect(0, y + 2, 512, 2) // bevel highlight
    }
    noise(ctx, 512, 512, 0.04, r)
    return c
  },

  cork() {
    // Speckles written straight into pixels (much cheaper than thousands of fillRects).
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(37)
    const img = ctx.createImageData(256, 256)
    const d = img.data
    for (let i = 0; i < 256 * 256; i++) {
      const n = r()
      let v = 0.93 - 0.08 * r()
      if (n < 0.05) v = 0.55 + 0.2 * r()
      else if (n < 0.08) v = 1
      const g = v * 255
      const o = i * 4
      d[o] = d[o + 1] = d[o + 2] = g
      d[o + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    // Soften into chunky granules by drawing the canvas onto itself at a slight offset.
    ctx.globalAlpha = 0.5
    ctx.drawImage(c, 1, 1)
    ctx.drawImage(c, -1, 0)
    ctx.globalAlpha = 1
    return c
  },

  fabric() {
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(41)
    ctx.fillStyle = grey(0.92)
    ctx.fillRect(0, 0, 256, 256)
    // Basket weave: alternating horizontal / vertical threads in 4px cells.
    const s = 4
    for (let y = 0; y < 256; y += s) {
      for (let x = 0; x < 256; x += s) {
        const over = ((x / s) ^ (y / s)) & 1
        ctx.fillStyle = grey(over ? 0.98 : 0.84 + r() * 0.04)
        if (over) ctx.fillRect(x, y + 0.5, s, s - 1)
        else ctx.fillRect(x + 0.5, y, s - 1, s)
      }
    }
    noise(ctx, 256, 256, 0.05, r)
    return c
  },

  paper() {
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(53)
    ctx.fillStyle = grey(0.99)
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = grey(0.82, 0.18)
      ctx.lineWidth = 0.5
      const x = r() * 256
      const y = r() * 256
      const a = r() * Math.PI
      const l = 3 + r() * 9
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
    noise(ctx, 256, 256, 0.03, r)
    return c
  },

  chalk() {
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(67)
    ctx.fillStyle = grey(0.9)
    ctx.fillRect(0, 0, 256, 256)
    // Eraser smudges: big soft light ellipses.
    for (let i = 0; i < 14; i++) {
      const x = r() * 256
      const y = r() * 256
      const rad = 20 + r() * 50
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
      g.addColorStop(0, grey(1, 0.35))
      g.addColorStop(1, grey(1, 0))
      ctx.fillStyle = g
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    // Wipe streaks.
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = grey(1, 0.08 + r() * 0.08)
      ctx.lineWidth = 6 + r() * 14
      ctx.beginPath()
      const y = r() * 256
      ctx.moveTo(-10, y)
      ctx.bezierCurveTo(80, y + (r() - 0.5) * 40, 170, y + (r() - 0.5) * 40, 266, y + (r() - 0.5) * 30)
      ctx.stroke()
    }
    noise(ctx, 256, 256, 0.06, r)
    return c
  },

  rug() {
    // Full-colour woven rug: border, stripes and a diamond medallion row. Not tiled.
    const m = makeCanvas(512, 512)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(79)
    ctx.fillStyle = PALETTE.rug
    ctx.fillRect(0, 0, 512, 512)
    ctx.fillStyle = PALETTE.fabricCream
    ctx.fillRect(18, 18, 476, 476)
    ctx.fillStyle = PALETTE.rug
    ctx.fillRect(30, 30, 452, 452)
    // Inner stripes.
    const stripes = [PALETTE.fabricOrange, PALETTE.fabricCream, PALETTE.fabricPlum, PALETTE.fabricCream, PALETTE.fabricOrange]
    stripes.forEach((col, i) => {
      ctx.fillStyle = col
      ctx.fillRect(30, 70 + i * 8, 452, 4)
      ctx.fillRect(30, 512 - 74 - i * 8, 452, 4)
    })
    // Diamonds.
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
    }
    for (let i = 0; i < 6; i++) {
      const cx = 56 + i * 80
      drawDiamond(cx, 170, 8, PALETTE.fabricCream)
      drawDiamond(cx, 342, 8, PALETTE.fabricCream)
    }
    // Weave texture: fine alternating dark/light rows.
    for (let y = 0; y < 512; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.04})`
      ctx.fillRect(0, y, 512, 1)
    }
    for (let x = 0; x < 512; x += 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(x, 0, 1, 512)
    }
    noise(ctx, 512, 512, 0.08, r)
    return c
  },

  plaster() {
    const m = makeCanvas(256, 256)
    if (!m) return null
    const [c, ctx] = m
    const r = rng(97)
    ctx.fillStyle = grey(0.97)
    ctx.fillRect(0, 0, 256, 256)
    // Soft blotches that wrap (drawn at 9 offsets for seamless tiling).
    for (let i = 0; i < 40; i++) {
      const x = r() * 256
      const y = r() * 256
      const rad = 10 + r() * 40
      const shade = r() < 0.5 ? 0.88 : 1
      for (const ox of [-256, 0, 256]) {
        for (const oy of [-256, 0, 256]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad)
          g.addColorStop(0, grey(shade, 0.18))
          g.addColorStop(1, grey(shade, 0))
          ctx.fillStyle = g
          ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2)
        }
      }
    }
    noise(ctx, 256, 256, 0.035, r)
    return c
  },

  screen() {
    // Faint scanlines + vignette, used as an emissive map for idle screens.
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
    return c
  },
}

/** Default repeat per texture (materials apply this to their shared texture). */
const REPEAT: Partial<Record<TextureName, [number, number]>> = {
  // Room floor is 20 m x 16 m; one tile is 1.25 m x 1.25 m.
  planks: [16, 12.8],
  plaster: [3, 1.5],
  cork: [2, 1.2],
  fabric: [3, 3],
  woodGrain: [1, 1],
}

const cache = new Map<TextureName, THREE.CanvasTexture | null>()
let generationMs = 0
const timings: Partial<Record<TextureName, number>> = {}

/** Per-texture generation time in ms. */
export function textureTimings() {
  return { ...timings }
}

/** Total milliseconds spent generating textures so far (for perf checks). */
export function textureGenerationMs() {
  return generationMs
}

/**
 * Shared procedural texture by name, or null when canvas is unavailable.
 * sRGB colour space, mipmaps, RepeatWrapping. Do not dispose; clone to change repeat.
 */
export function getTexture(name: TextureName): THREE.CanvasTexture | null {
  if (cache.has(name)) return cache.get(name) ?? null
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const canvas = generators[name]()
  let tex: THREE.CanvasTexture | null = null
  if (canvas) {
    tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = 4
    const rep = REPEAT[name]
    if (rep) tex.repeat.set(rep[0], rep[1])
    if (name === 'rug') tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.name = `proc:${name}`
    tex.needsUpdate = true
  }
  if (typeof performance !== 'undefined') {
    const dt = performance.now() - t0
    timings[name] = dt
    generationMs += dt
  }
  cache.set(name, tex)
  return tex
}

const bumpCache = new Map<TextureName, THREE.Texture | null>()

/** Same image as `getTexture(name)` but in linear space, for use as a bump map. */
export function getBumpTexture(name: TextureName): THREE.Texture | null {
  if (bumpCache.has(name)) return bumpCache.get(name) ?? null
  const base = getTexture(name)
  let bump: THREE.Texture | null = null
  if (base) {
    bump = base.clone()
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
  canvasSupport = null
  generationMs = 0
}
