/**
 * Canvas drawing for the bulletin board: polaroids (with procedural genre
 * illustrations), group label cards, sort tabs and the empty-state note.
 */
import * as THREE from 'three'
import { FONTS, GENRE_COLORS, PALETTE, UI } from '@/contracts/style'
import type { Genre, Review, Room } from '@/contracts/types'
import type { CrewSticker } from '@/state/crew'
import { seededRandom } from './layout'

/** Logical canvas size of a polaroid (drawn at any resolution via scale). */
export const POLAROID_W = 256
export const POLAROID_H = 300
const PHOTO = { x: 14, y: 14, w: 228, h: 200 }

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

let fontsPromise: Promise<void> | null = null
/** Resolves when the hand/display web fonts are loaded (or after a timeout). */
export function whenFontsReady(): Promise<void> {
  if (fontsPromise) return fontsPromise
  if (typeof document === 'undefined' || !document.fonts?.load) return (fontsPromise = Promise.resolve())
  const load = Promise.all([
    document.fonts.load(`700 32px ${FONTS.hand}`),
    document.fonts.load(`600 32px ${FONTS.display}`),
  ]).then(
    () => undefined,
    () => undefined,
  )
  const timeout = new Promise<void>((res) => setTimeout(res, 5000))
  fontsPromise = Promise.race([load, timeout])
  return fontsPromise
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  if (amt >= 0) {
    r += (255 - r) * amt
    g += (255 - g) * amt
    b += (255 - b) * amt
  } else {
    r *= 1 + amt
    g *= 1 + amt
    b *= 1 + amt
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, max: number, min: number, width: number): number {
  let size = max
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  ctx.font = `${weight} ${size}px ${family}`
  return size
}

function wrapTwo(ctx: CanvasRenderingContext2D, text: string, width: number): [string, string] | null {
  const words = text.split(/\s+/)
  if (words.length < 2) return null
  let best: [string, string] | null = null
  let bestW = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width)
    if (w < bestW) {
      bestW = w
      best = [a, b]
    }
  }
  return best && bestW <= width ? best : null
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
  return t + '…'
}

export function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---------------------------------------------------------------------------
// Genre illustrations
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D

function ghost(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#fffaf2'
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.42, cy + s * 0.45)
  ctx.lineTo(cx - s * 0.42, cy - s * 0.05)
  ctx.arc(cx, cy - s * 0.05, s * 0.42, Math.PI, 0)
  ctx.lineTo(cx + s * 0.42, cy + s * 0.45)
  for (let i = 0; i < 4; i++) {
    const x0 = cx + s * 0.42 - (i * s * 0.84) / 4
    ctx.quadraticCurveTo(x0 - s * 0.105, cy + s * (i % 2 ? 0.58 : 0.32), x0 - s * 0.21, cy + s * 0.45)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#2b1d22'
  ctx.beginPath()
  ctx.ellipse(cx - s * 0.14, cy - s * 0.06, s * 0.06, s * 0.09, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + s * 0.14, cy - s * 0.06, s * 0.06, s * 0.09, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f29aa5'
  ctx.beginPath()
  ctx.ellipse(cx - s * 0.25, cy + s * 0.08, s * 0.06, s * 0.035, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + s * 0.25, cy + s * 0.08, s * 0.06, s * 0.035, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2b1d22'
  ctx.lineWidth = s * 0.03
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.07, s * 0.06, 0.1 * Math.PI, 0.9 * Math.PI)
  ctx.stroke()
}

function magnifier(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.6)
  ctx.fillStyle = '#7a4a2b'
  roundRect(ctx, -s * 0.07, s * 0.28, s * 0.14, s * 0.42, s * 0.06)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = 'rgba(220,240,255,0.55)'
  ctx.beginPath()
  ctx.arc(cx - s * 0.08, cy - s * 0.08, s * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = PALETTE.brass
  ctx.lineWidth = s * 0.08
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = s * 0.035
  ctx.beginPath()
  ctx.arc(cx - s * 0.08, cy - s * 0.08, s * 0.19, Math.PI * 1.05, Math.PI * 1.45)
  ctx.stroke()
  ctx.fillStyle = '#3b2a26'
  ctx.font = `700 ${Math.round(s * 0.34)}px ${FONTS.display}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', cx - s * 0.08, cy - s * 0.06)
}

function mountains(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#ffe9a8'
  ctx.beginPath()
  ctx.arc(cx + s * 0.32, cy - s * 0.32, s * 0.14, 0, Math.PI * 2)
  ctx.fill()
  const peak = (x: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.moveTo(x - w / 2, cy + s * 0.45)
    ctx.lineTo(x, cy + s * 0.45 - h)
    ctx.lineTo(x + w / 2, cy + s * 0.45)
    ctx.fill()
    ctx.fillStyle = '#fffaf2'
    ctx.beginPath()
    ctx.moveTo(x - w * 0.14, cy + s * 0.45 - h * 0.72)
    ctx.lineTo(x, cy + s * 0.45 - h)
    ctx.lineTo(x + w * 0.14, cy + s * 0.45 - h * 0.72)
    ctx.lineTo(x + w * 0.05, cy + s * 0.45 - h * 0.66)
    ctx.lineTo(x - w * 0.04, cy + s * 0.45 - h * 0.74)
    ctx.fill()
  }
  peak(cx + s * 0.22, s * 0.7, s * 0.55, '#8a5a3a')
  peak(cx - s * 0.12, s * 0.9, s * 0.8, '#6d4a36')
  ctx.strokeStyle = '#3b2a26'
  ctx.lineWidth = s * 0.025
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.12, cy + s * 0.45 - s * 0.8)
  ctx.lineTo(cx - s * 0.12, cy - s * 0.6)
  ctx.stroke()
  ctx.fillStyle = PALETTE.pinRed
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.12, cy - s * 0.6)
  ctx.lineTo(cx + s * 0.06, cy - s * 0.53)
  ctx.lineTo(cx - s * 0.12, cy - s * 0.46)
  ctx.fill()
}

function rocket(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(0.5)
  ctx.fillStyle = '#ffb347'
  ctx.beginPath()
  ctx.moveTo(-s * 0.1, s * 0.3)
  ctx.quadraticCurveTo(0, s * 0.7, s * 0.1, s * 0.3)
  ctx.fill()
  ctx.fillStyle = PALETTE.pinRed
  ctx.beginPath()
  ctx.moveTo(-s * 0.14, s * 0.05)
  ctx.lineTo(-s * 0.3, s * 0.34)
  ctx.lineTo(-s * 0.12, s * 0.3)
  ctx.moveTo(s * 0.14, s * 0.05)
  ctx.lineTo(s * 0.3, s * 0.34)
  ctx.lineTo(s * 0.12, s * 0.3)
  ctx.fill()
  ctx.fillStyle = '#fffaf2'
  ctx.beginPath()
  ctx.ellipse(0, 0, s * 0.16, s * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2de2d0'
  ctx.strokeStyle = '#9aa3a8'
  ctx.lineWidth = s * 0.04
  ctx.beginPath()
  ctx.arc(0, -s * 0.1, s * 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function castle(ctx: Ctx, cx: number, cy: number, s: number) {
  const base = cy + s * 0.45
  ctx.fillStyle = '#efe0c8'
  ctx.fillRect(cx - s * 0.3, base - s * 0.45, s * 0.6, s * 0.45)
  const tower = (x: number, w: number, h: number) => {
    ctx.fillStyle = '#e4cfae'
    ctx.fillRect(x - w / 2, base - h, w, h)
    ctx.fillStyle = '#8a3b52'
    ctx.beginPath()
    ctx.moveTo(x - w * 0.62, base - h)
    ctx.lineTo(x, base - h - w * 1.1)
    ctx.lineTo(x + w * 0.62, base - h)
    ctx.fill()
  }
  tower(cx - s * 0.33, s * 0.2, s * 0.65)
  tower(cx + s * 0.33, s * 0.2, s * 0.65)
  tower(cx, s * 0.24, s * 0.82)
  ctx.fillStyle = '#efe0c8'
  for (let i = 0; i < 3; i++) ctx.fillRect(cx - s * 0.22 + i * s * 0.17, base - s * 0.52, s * 0.1, s * 0.08)
  ctx.fillStyle = '#7a4a2b'
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.09, base)
  ctx.lineTo(cx - s * 0.09, base - s * 0.15)
  ctx.arc(cx, base - s * 0.15, s * 0.09, Math.PI, 0)
  ctx.lineTo(cx + s * 0.09, base)
  ctx.fill()
  ctx.fillStyle = '#ffe9a8'
  ctx.fillRect(cx - s * 0.36, base - s * 0.48, s * 0.06, s * 0.08)
  ctx.fillRect(cx + s * 0.3, base - s * 0.48, s * 0.06, s * 0.08)
}

function vault(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#9aa3a8'
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c3cacd'
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3d4248'
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * s * 0.39, cy + Math.sin(a) * s * 0.39, s * 0.025, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = PALETTE.brass
  ctx.lineWidth = s * 0.06
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * s * 0.24, cy + Math.sin(a) * s * 0.24)
    ctx.stroke()
  }
  ctx.fillStyle = PALETTE.brass
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineCap = 'butt'
}

function pyramid(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#ffe9a8'
  ctx.beginPath()
  ctx.arc(cx - s * 0.3, cy - s * 0.3, s * 0.12, 0, Math.PI * 2)
  ctx.fill()
  const base = cy + s * 0.45
  ctx.fillStyle = '#e8c27a'
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.5, base)
  ctx.lineTo(cx + s * 0.05, base - s * 0.7)
  ctx.lineTo(cx + s * 0.5, base)
  ctx.fill()
  ctx.fillStyle = '#c99a52'
  ctx.beginPath()
  ctx.moveTo(cx + s * 0.05, base - s * 0.7)
  ctx.lineTo(cx + s * 0.5, base)
  ctx.lineTo(cx + s * 0.18, base)
  ctx.fill()
  ctx.strokeStyle = 'rgba(122,74,43,0.35)'
  ctx.lineWidth = s * 0.015
  for (let i = 1; i < 5; i++) {
    const y = base - (s * 0.7 * i) / 5
    const half = (s * 0.5 * (5 - i)) / 5
    ctx.beginPath()
    ctx.moveTo(cx + s * 0.05 - half * 1.1, y)
    ctx.lineTo(cx + s * 0.05 + half * 0.9, y)
    ctx.stroke()
  }
}

function smiley(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#ffd84a'
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.05, s * 0.38, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3b2a26'
  ctx.beginPath()
  ctx.ellipse(cx - s * 0.13, cy - s * 0.04, s * 0.045, s * 0.07, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + s * 0.13, cy - s * 0.04, s * 0.045, s * 0.07, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#b8503f'
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.1, s * 0.2, 0, Math.PI)
  ctx.fill()
  // party hat
  ctx.fillStyle = '#2f8f8a'
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.16, cy - s * 0.27)
  ctx.lineTo(cx + s * 0.08, cy - s * 0.66)
  ctx.lineTo(cx + s * 0.2, cy - s * 0.24)
  ctx.fill()
  ctx.fillStyle = PALETTE.pinRed
  ctx.beginPath()
  ctx.arc(cx + s * 0.08, cy - s * 0.66, s * 0.05, 0, Math.PI * 2)
  ctx.fill()
}

function stopwatch(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#3d4248'
  ctx.fillRect(cx - s * 0.06, cy - s * 0.5, s * 0.12, s * 0.12)
  ctx.fillStyle = '#fffaf2'
  ctx.strokeStyle = '#3d4248'
  ctx.lineWidth = s * 0.07
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.04, s * 0.38, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(232,67,58,0.3)'
  ctx.beginPath()
  ctx.moveTo(cx, cy + s * 0.04)
  ctx.arc(cx, cy + s * 0.04, s * 0.32, -Math.PI / 2, Math.PI * 0.15)
  ctx.fill()
  ctx.strokeStyle = '#3b2a26'
  ctx.lineWidth = s * 0.04
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy + s * 0.04)
  ctx.lineTo(cx, cy - s * 0.22)
  ctx.moveTo(cx, cy + s * 0.04)
  ctx.lineTo(cx + s * 0.18, cy + s * 0.12)
  ctx.stroke()
  ctx.lineCap = 'butt'
}

function key(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.5)
  ctx.strokeStyle = PALETTE.brass
  ctx.fillStyle = PALETTE.brass
  ctx.lineWidth = s * 0.09
  ctx.beginPath()
  ctx.arc(-s * 0.26, 0, s * 0.15, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillRect(-s * 0.12, -s * 0.045, s * 0.55, s * 0.09)
  ctx.fillRect(s * 0.25, 0, s * 0.07, s * 0.15)
  ctx.fillRect(s * 0.36, 0, s * 0.07, s * 0.11)
  ctx.restore()
}

const ICONS: Record<Genre, (ctx: Ctx, cx: number, cy: number, s: number) => void> = {
  horror: ghost,
  mystery: magnifier,
  adventure: mountains,
  'sci-fi': rocket,
  fantasy: castle,
  heist: vault,
  historical: pyramid,
  comedy: smiley,
  thriller: stopwatch,
  other: key,
}

/** Cute procedural "photo" for a genre, drawn into the given rect. */
export function drawGenreIllustration(ctx: Ctx, genre: Genre, seed: string, x: number, y: number, w: number, h: number) {
  const base = GENRE_COLORS[genre] ?? GENRE_COLORS.other
  const rnd = seededRandom(seed + ':art')
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  const g = ctx.createLinearGradient(x, y, x, y + h)
  g.addColorStop(0, shade(base, 0.45))
  g.addColorStop(1, shade(base, -0.1))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  // sparkles / stars
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  for (let i = 0; i < 14; i++) {
    const r = 1 + rnd() * 2.6
    ctx.beginPath()
    ctx.arc(x + rnd() * w, y + rnd() * h * 0.6, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // ground hill
  ctx.fillStyle = shade(base, -0.3)
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + h * 0.84)
  ctx.quadraticCurveTo(x + w * (0.3 + rnd() * 0.4), y + h * 0.7, x + w, y + h * 0.82)
  ctx.lineTo(x + w, y + h)
  ctx.fill()
  const s = Math.min(w, h) * 0.62
  ICONS[genre](ctx, x + w / 2 + (rnd() - 0.5) * w * 0.08, y + h * 0.48, s)
  // soft glossy light leak
  const gl = ctx.createLinearGradient(x, y, x + w, y + h)
  gl.addColorStop(0, 'rgba(255,255,255,0.22)')
  gl.addColorStop(0.45, 'rgba(255,255,255,0)')
  gl.addColorStop(1, 'rgba(255,170,90,0.12)')
  ctx.fillStyle = gl
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Polaroid
// ---------------------------------------------------------------------------

export interface PolaroidData {
  room: Room
  review: Review | undefined
  /** Crew of the latest visit, drawn as avatar stickers on the photo's bottom-right corner. */
  crew?: readonly CrewSticker[]
}

// ---------------------------------------------------------------------------
// Crew avatar stickers (workstream 37)
// ---------------------------------------------------------------------------

/** At most this many stickers; a fuller crew shows the first three and a "+N" sticker. */
export const MAX_STICKERS = 4
export const STICKER_R = 19

export interface StickerSlot {
  x: number
  y: number
  r: number
  /** Sticker index in the crew, or -1 for the "+N" overflow sticker. */
  index: number
  rot: number
  /** Overflow count for the "+N" sticker. */
  more: number
}

/** Where each sticker goes on the 256x300 polaroid: a slightly overlapping row, right to left. */
export function stickerSlots(count: number, seed = ''): StickerSlot[] {
  if (count <= 0) return []
  const shown = count > MAX_STICKERS ? MAX_STICKERS - 1 : count
  const total = count > MAX_STICKERS ? MAX_STICKERS : count
  const rnd = seededRandom('stickers:' + seed)
  const out: StickerSlot[] = []
  const right = PHOTO.x + PHOTO.w - STICKER_R - 4
  const y = PHOTO.y + PHOTO.h - STICKER_R + 6
  const step = STICKER_R * 1.55
  for (let i = 0; i < total; i++) {
    const overflow = i === shown
    out.push({
      x: right - i * step,
      y: y + (rnd() - 0.5) * 4,
      r: STICKER_R,
      index: overflow ? -1 : i,
      rot: (rnd() - 0.5) * 0.4,
      more: overflow ? count - shown : 0,
    })
  }
  return out
}

/** Draws crew stickers: the avatar picture when loaded, else coloured initials. */
export function drawCrewStickers(
  ctx: CanvasRenderingContext2D,
  crew: readonly CrewSticker[],
  avatars: ReadonlyMap<string, HTMLImageElement> = new Map(),
  seed = '',
) {
  const slots = stickerSlots(crew.length, seed)
  // Paint left to right so the rightmost sticker sits on top.
  for (const slot of [...slots].reverse()) {
    const st = slot.index >= 0 ? crew[slot.index] : null
    ctx.save()
    ctx.translate(slot.x, slot.y)
    ctx.rotate(slot.rot)
    ctx.globalAlpha = st?.pending ? 0.6 : 1
    // shadow + white die-cut border
    ctx.fillStyle = 'rgba(40,20,10,0.28)'
    ctx.beginPath()
    ctx.arc(1.5, 2.5, slot.r + 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fffdf8'
    ctx.beginPath()
    ctx.arc(0, 0, slot.r + 3, 0, Math.PI * 2)
    ctx.fill()
    const img = st?.image ? avatars.get(st.image) : undefined
    ctx.beginPath()
    ctx.arc(0, 0, slot.r, 0, Math.PI * 2)
    if (img && img.naturalWidth > 0) {
      ctx.save()
      ctx.clip()
      const sc = Math.max((slot.r * 2) / img.naturalWidth, (slot.r * 2) / img.naturalHeight)
      const iw = img.naturalWidth * sc
      const ih = img.naturalHeight * sc
      try {
        ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih)
      } catch {
        ctx.fillStyle = st?.color ?? UI.accent
        ctx.fill()
      }
      ctx.restore()
    } else {
      ctx.fillStyle = st ? st.color : '#3b2a26'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const text = st ? st.initials : `+${slot.more}`
      fitFont(ctx, text, '700', FONTS.display, 20, 10, slot.r * 1.6)
      ctx.fillText(text, 0, 1.5)
    }
    if (st?.pending) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#9a8a80'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(0, 0, slot.r + 1.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()
  }
}

/** Draws a full polaroid onto `canvas` (any resolution with the 256:300 aspect). */
export function drawPolaroid(
  canvas: HTMLCanvasElement,
  { room, review, crew }: PolaroidData,
  img: HTMLImageElement | null,
  avatars?: ReadonlyMap<string, HTMLImageElement>,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(canvas.width / POLAROID_W, 0, 0, canvas.height / POLAROID_H, 0, 0)
  // paper
  const pg = ctx.createLinearGradient(0, 0, 0, POLAROID_H)
  pg.addColorStop(0, '#fffdf8')
  pg.addColorStop(1, '#f4ecdd')
  ctx.fillStyle = pg
  ctx.fillRect(0, 0, POLAROID_W, POLAROID_H)
  ctx.strokeStyle = 'rgba(120,90,60,0.25)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, POLAROID_W - 2, POLAROID_H - 2)

  // photo
  const { x, y, w, h } = PHOTO
  if (img && img.naturalWidth > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const iw = img.naturalWidth * s
    const ih = img.naturalHeight * s
    try {
      ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
    } catch {
      drawGenreIllustration(ctx, room.genre, room.id, x, y, w, h)
    }
    // warm photo tint
    ctx.fillStyle = 'rgba(255,190,120,0.08)'
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  } else {
    drawGenreIllustration(ctx, room.genre, room.id, x, y, w, h)
  }
  ctx.strokeStyle = 'rgba(60,40,30,0.35)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  if (crew?.length) drawCrewStickers(ctx, crew, avatars, review?.id ?? room.id)

  // caption
  const ink = '#2f2340'
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const name = room.name
  const capW = 226
  const size = fitFont(ctx, name, '700', FONTS.hand, 34, 24, capW)
  const lineY = 248
  if (ctx.measureText(name).width <= capW) {
    ctx.fillText(name, POLAROID_W / 2, lineY)
  } else {
    ctx.font = `700 22px ${FONTS.hand}`
    const two = wrapTwo(ctx, name, capW)
    if (two) {
      ctx.fillText(two[0], POLAROID_W / 2, 234)
      ctx.fillText(two[1], POLAROID_W / 2, 254)
    } else {
      ctx.font = `700 ${size}px ${FONTS.hand}`
      ctx.fillText(ellipsize(ctx, name, capW), POLAROID_W / 2, lineY)
    }
  }

  // city (left) + score (right, circled in red ink)
  const score = review?.ratings.overall.score
  ctx.textAlign = 'left'
  ctx.fillStyle = '#6a5a6e'
  ctx.font = `700 22px ${FONTS.hand}`
  ctx.fillText(ellipsize(ctx, room.city, score != null ? 160 : 224), 16, 284)
  if (score != null) {
    const sx = POLAROID_W - 36
    const sy = 277
    ctx.strokeStyle = '#d0392f'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.ellipse(sx, sy, 27, 16, -0.12, 0.2, Math.PI * 2.1)
    ctx.stroke()
    ctx.fillStyle = '#d0392f'
    ctx.textAlign = 'center'
    ctx.font = `700 26px ${FONTS.hand}`
    ctx.fillText(String(score), sx, sy + 8)
  }
}

// ---------------------------------------------------------------------------
// Labels, tabs, note, shadow
// ---------------------------------------------------------------------------

/** Paper label card for a group. Canvas aspect follows the card's world aspect. */
export function drawLabelCard(label: string, count: number, accent: string, aspect: number): HTMLCanvasElement {
  const H = 80
  const W = Math.max(80, Math.min(1024, Math.round(H * aspect)))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fbf5ea'
  roundRect(ctx, 2, 2, W - 4, H - 4, 8)
  ctx.fill()
  ctx.strokeStyle = 'rgba(120,90,60,0.35)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(2, 2, W - 4, 9)
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const countText = W > 200 ? `  ·  ${count}` : ''
  const text = label + countText
  fitFont(ctx, text, '600', FONTS.display, 44, 14, W - 18)
  if (ctx.measureText(text).width > W - 18) ctx.fillText(ellipsize(ctx, label, W - 18), W / 2, H / 2 + 5)
  else ctx.fillText(text, W / 2, H / 2 + 5)
  return c
}

/** Index tab for a sort key. */
export function drawTab(label: string, active: boolean): HTMLCanvasElement {
  const W = 256
  const H = 80
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = active ? UI.accent : '#fbf5ea'
  roundRect(ctx, 3, 3, W - 6, H - 6, 18)
  ctx.fill()
  ctx.strokeStyle = active ? '#b85d22' : 'rgba(120,90,60,0.45)'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = active ? '#ffffff' : UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fitFont(ctx, label, active ? '700' : '600', FONTS.display, 40, 18, W - 30)
  ctx.fillText(label, W / 2, H / 2 + 3)
  return c
}

/** Handwritten note card (e.g. "Sort by", the empty-state note). */
export function drawNote(lines: string[], w: number, h: number, bg = '#fff3b8'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  ctx.fillRect(0, h - 10, w, 10)
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lh = h / (lines.length + 0.6)
  lines.forEach((l, i) => {
    fitFont(ctx, l, '700', FONTS.hand, Math.round(lh * 0.85), 12, w - 24)
    ctx.fillText(l, w / 2, lh * (i + 0.8))
  })
  return c
}

/** Soft rectangular drop shadow with alpha. */
export function drawSoftShadow(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 72
  const ctx = c.getContext('2d')!
  ctx.filter = 'blur(5px)'
  ctx.fillStyle = 'rgba(40,20,10,0.9)'
  ctx.fillRect(10, 10, 44, 52)
  ctx.filter = 'none'
  // Fallback if filter is unsupported: still soft-ish thanks to the alpha ramp.
  return c
}
