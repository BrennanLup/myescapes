/**
 * Draws the chalk writing for the wish-list board onto a transparent canvas.
 * The board surface itself uses the shared `chalkboard` material; this canvas
 * sits just in front of it with dusty smudges, the title and the list.
 */
import type { WishlistItem } from '@/contracts/types'
import { FONTS } from '@/contracts/style'
import { boardLines } from './listOps'

export const CANVAS_W = 2048
export const CANVAS_H = 1280
export const MAX_LINES = 12

const CHALK = 'rgba(246, 244, 232, 0.92)'
const CHALK_SOFT = 'rgba(246, 244, 232, 0.6)'
const CHALK_YELLOW = 'rgba(255, 226, 140, 0.9)'
const CHALK_PINK = 'rgba(255, 170, 160, 0.85)'

/** Tiny deterministic PRNG so the board looks the same every render. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** A wobbly chalk line from (x1,y1) to (x2,y2). */
function chalkLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, rand: () => number, width = 6) {
  ctx.lineCap = 'round'
  ctx.lineWidth = width
  ctx.beginPath()
  const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 60))
  ctx.moveTo(x1, y1)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    ctx.lineTo(x1 + (x2 - x1) * t + (rand() - 0.5) * 3, y1 + (y2 - y1) * t + (rand() - 0.5) * 5)
  }
  ctx.stroke()
}

function drawTick(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rand: () => number) {
  ctx.strokeStyle = CHALK_YELLOW
  chalkLine(ctx, x, y, x + size * 0.35, y + size * 0.4, rand, 8)
  chalkLine(ctx, x + size * 0.35, y + size * 0.4, x + size, y - size * 0.55, rand, 8)
}

/** Faint eraser smudges so the board doesn't look brand new. */
function drawSmudges(ctx: CanvasRenderingContext2D, rand: () => number) {
  for (let i = 0; i < 14; i++) {
    const x = rand() * CANVAS_W
    const y = rand() * CANVAS_H
    const r = 120 + rand() * 260
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(235, 240, 230, ${0.035 + rand() * 0.045})`)
    g.addColorStop(1, 'rgba(235, 240, 230, 0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // a couple of half-wiped arcs
  ctx.strokeStyle = 'rgba(235, 240, 230, 0.05)'
  ctx.lineWidth = 70
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    const cx = rand() * CANVAS_W
    const cy = rand() * CANVAS_H
    ctx.arc(cx, cy, 200 + rand() * 200, rand() * Math.PI, rand() * Math.PI + Math.PI * 0.6)
    ctx.stroke()
  }
}

/** Erode the chalk strokes with speckles so they read as dusty chalk, not ink. */
function erode(ctx: CanvasRenderingContext2D, rand: () => number) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.6})`
    const s = 1 + rand() * 3
    ctx.fillRect(rand() * CANVAS_W, rand() * CANVAS_H, s, s)
  }
  // horizontal grain streaks
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.3})`
    ctx.fillRect(rand() * CANVAS_W, rand() * CANVAS_H, 8 + rand() * 30, 1.5)
  }
  ctx.restore()
}

export function drawChalkList(ctx: CanvasRenderingContext2D, items: readonly WishlistItem[]) {
  const rand = rng(hash(items.map((i) => `${i.id}:${i.done}`).join('|')) ^ 0x9e3779b9)
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  drawSmudges(ctx, rng(42))

  const hand = FONTS.hand
  ctx.textBaseline = 'alphabetic'

  // Title
  ctx.save()
  ctx.translate(CANVAS_W / 2, 175)
  ctx.rotate(-0.015)
  ctx.fillStyle = CHALK
  ctx.font = `700 150px ${hand}`
  ctx.textAlign = 'center'
  ctx.fillText('Rooms to try', 0, 0)
  ctx.strokeStyle = CHALK_PINK
  const tw = ctx.measureText('Rooms to try').width
  chalkLine(ctx, -tw / 2 - 10, 30, tw / 2 + 20, 22, rand, 7)
  chalkLine(ctx, -tw / 2 + 40, 46, tw / 2 - 30, 40, rand, 5)
  ctx.restore()

  // little doodle: a key in the corner
  ctx.save()
  ctx.strokeStyle = CHALK_SOFT
  ctx.lineWidth = 6
  ctx.translate(CANVAS_W - 190, 130)
  ctx.rotate(-0.5)
  ctx.beginPath()
  ctx.arc(0, 0, 32, 0, Math.PI * 2)
  ctx.moveTo(32, 0)
  ctx.lineTo(130, 0)
  ctx.moveTo(105, 0)
  ctx.lineTo(105, 26)
  ctx.moveTo(125, 0)
  ctx.lineTo(125, 20)
  ctx.stroke()
  ctx.restore()

  const { shown, more } = boardLines(items, MAX_LINES)
  const top = 300
  const bottom = CANVAS_H - 60

  if (shown.length === 0) {
    ctx.fillStyle = CHALK_SOFT
    ctx.font = `500 96px ${hand}`
    ctx.textAlign = 'center'
    ctx.fillText('Nothing here yet...', CANVAS_W / 2, 600)
    ctx.fillText('click to add a room you want to try!', CANVAS_W / 2, 720)
    erode(ctx, rand)
    return
  }

  const lineCount = shown.length + (more > 0 ? 1 : 0)
  const twoCols = lineCount > 6
  const cols = twoCols ? 2 : 1
  const rows = Math.ceil(lineCount / cols)
  const rowH = Math.min(150, (bottom - top) / rows)
  const fontPx = Math.round(Math.min(104, rowH * 0.72))
  const colW = twoCols ? (CANVAS_W - 220) / 2 : CANVAS_W - 360
  const left = twoCols ? 110 : 220

  ctx.textAlign = 'left'
  shown.forEach((item, i) => {
    const col = twoCols ? Math.floor(i / rows) : 0
    const row = twoCols ? i % rows : i
    const x = left + col * (colW + 40) + (rand() - 0.5) * 10
    const y = top + row * rowH + fontPx * 0.85 + (rand() - 0.5) * 6
    const tilt = (rand() - 0.5) * 0.025

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(tilt)
    const num = `${i + 1}.`
    ctx.font = `700 ${fontPx}px ${hand}`
    ctx.fillStyle = item.done ? CHALK_SOFT : CHALK_YELLOW
    ctx.fillText(num, 0, 0)
    const numW = Math.max(ctx.measureText('10.').width, ctx.measureText(num).width) + 22

    const textX = numW + (item.done ? fontPx * 0.75 : 0)
    const maxW = colW - textX - 30
    // Shrink a long name a little before falling back to an ellipsis.
    let namePx = fontPx
    ctx.font = `700 ${namePx}px ${hand}`
    while (namePx > fontPx * 0.78 && ctx.measureText(item.name).width > maxW) {
      namePx -= 2
      ctx.font = `700 ${namePx}px ${hand}`
    }
    const name = fitText(ctx, item.name, maxW)
    ctx.fillStyle = item.done ? CHALK_SOFT : CHALK
    ctx.fillText(name, textX, 0)
    const nameW = ctx.measureText(name).width
    let endX = textX + nameW
    if (item.city) {
      ctx.font = `500 ${Math.round(fontPx * 0.62)}px ${hand}`
      const room = maxW - nameW - 18
      const full = `– ${item.city}`
      // Only show the city when at least a readable chunk of it fits.
      if (room >= Math.min(ctx.measureText(full).width, fontPx * 2.2)) {
        ctx.fillStyle = CHALK_SOFT
        const city = fitText(ctx, full, room)
        ctx.fillText(city, textX + nameW + 18, 0)
        endX = textX + nameW + 18 + ctx.measureText(city).width
      }
    }
    if (item.done) {
      drawTick(ctx, numW - 4, -fontPx * 0.28, fontPx * 0.55, rand)
      ctx.strokeStyle = CHALK
      chalkLine(ctx, textX - 8, -fontPx * 0.27, endX + 10, -fontPx * 0.3, rand, 6)
    }
    ctx.restore()
  })

  if (more > 0) {
    const i = shown.length
    const col = twoCols ? Math.floor(i / rows) : 0
    const row = twoCols ? i % rows : i
    ctx.font = `500 ${Math.round(fontPx * 0.85)}px ${hand}`
    ctx.fillStyle = CHALK_PINK
    ctx.fillText(`+${more} more...`, left + col * (colW + 40) + 30, top + row * rowH + fontPx * 0.85)
  }

  erode(ctx, rand)
}
