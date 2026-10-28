/**
 * Canvas drawings for the puzzle room's posters, plaques and the guess board. Each returns a
 * CanvasTexture, or null where there is no 2D canvas (tests), in which case the mesh falls back to a
 * plain colour. The drawings mirror the 2D game's views so both read the same.
 */
import * as THREE from 'three'
import { PALETTE } from '@/contracts/style'
import type { IconName, LockClue, SearchSymbol, ShapeName } from '../../gate/generators'
import type { CipherDailyChallenge, DailyChallenge, GridMark, SequenceDailyChallenge } from '../engine'
import { MARK_STYLE } from '../ui/views'

type G = CanvasRenderingContext2D

const DISPLAY = "'Fredoka', 'Nunito', system-ui, sans-serif"
const HAND = "'Caveat', 'Comic Sans MS', cursive"
const MONO = "'JetBrains Mono', ui-monospace, monospace"

/** The faces the drawings use (as loaded by src/index.css from Google Fonts). */
const CANVAS_FONTS = [`600 40px ${DISPLAY}`, `700 40px ${DISPLAY}`, `700 40px ${HAND}`, `600 40px ${MONO}`]
let fontsPromise: Promise<boolean> | null = null

/**
 * Resolves once the canvas fonts are loaded (true), or right away where they can't be (false).
 * A canvas never triggers a web font download by itself, so the first drawings would use the
 * fallback fonts: textures are drawn again once this resolves.
 */
export function canvasFontsReady(): Promise<boolean> {
  if (fontsPromise) return fontsPromise
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined
  if (!fonts || typeof fonts.load !== 'function') return (fontsPromise = Promise.resolve(false))
  fontsPromise = Promise.all(CANVAS_FONTS.map((f) => fonts.load(f).catch(() => [])))
    .then(() => true)
    .catch(() => false)
  return fontsPromise
}

export function canvasTexture(w: number, h: number, draw: (g: G, w: number, h: number) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  let g: G | null = null
  try {
    g = c.getContext('2d')
  } catch {
    g = null
  }
  if (!g) return null
  draw(g, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Word-wrap `text` into lines no wider than `max`. */
export function wrapLines(g: Pick<G, 'measureText'>, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (line && g.measureText(next).width > max) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function paperBackground(g: G, w: number, h: number, color: string = PALETTE.paper) {
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  // Soft speckle so it reads as paper, not a flat panel.
  g.fillStyle = 'rgba(122,74,43,0.05)'
  for (let i = 0; i < 160; i++) g.fillRect((i * 97) % w, (i * 53) % h, 2, 2)
  g.strokeStyle = 'rgba(122,74,43,0.35)'
  g.lineWidth = 6
  g.strokeRect(3, 3, w - 6, h - 6)
}

// ---------------------------------------------------------------------------
// Icons (same drawings as src/gate/icons.tsx, on a 24 x 24 grid)
// ---------------------------------------------------------------------------

function withPath(g: G, d: string, fill: string, stroke?: string, lw = 1) {
  if (typeof Path2D === 'undefined') return
  const p = new Path2D(d)
  g.fillStyle = fill
  g.fill(p)
  if (stroke) {
    g.strokeStyle = stroke
    g.lineWidth = lw
    g.stroke(p)
  }
}

export function drawIcon(g: G, name: IconName, x: number, y: number, size: number) {
  g.save()
  g.translate(x, y)
  g.scale(size / 24, size / 24)
  if (name === 'candle') {
    withPath(g, 'M12 2c2 3 2 5 0 6-2-1-2-3 0-6z', '#ffb36b')
    g.fillStyle = '#fbf5ea'
    g.fillRect(8.5, 9, 7, 12)
    g.strokeStyle = '#c98f6b'
    g.strokeRect(8.5, 9, 7, 12)
    g.fillStyle = '#d4a24c'
    g.fillRect(6, 20, 12, 2.5)
  } else if (name === 'mug') {
    withPath(g, 'M5 8h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', '#2f8f8a')
    g.strokeStyle = '#2f8f8a'
    g.lineWidth = 2
    g.beginPath()
    g.arc(17, 13, 3, -Math.PI / 2, Math.PI / 2)
    g.stroke()
  } else if (name === 'book') {
    g.fillStyle = '#6d3b5c'
    g.fillRect(4, 4, 14, 17)
    g.fillStyle = '#4f2a43'
    g.fillRect(6, 4, 2, 17)
    g.fillStyle = '#efe0c8'
    g.fillRect(10, 8, 6, 2)
  } else if (name === 'leaf') {
    withPath(g, 'M4 20C4 9 11 4 20 4c0 9-5 16-16 16z', '#5a9a4b', '#3f7a3a', 1.5)
  } else {
    withPath(g, 'M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z', '#e8b93a', '#b9863a')
  }
  g.restore()
}

export function drawShape(g: G, shape: ShapeName, color: string, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx - size / 2, cy - size / 2)
  g.scale(size / 40, size / 40)
  g.fillStyle = color
  if (shape === 'circle') {
    g.beginPath()
    g.arc(20, 20, 14, 0, Math.PI * 2)
    g.fill()
  } else if (shape === 'square') {
    roundRect(g, 7, 7, 26, 26, 4)
    g.fill()
  } else if (shape === 'triangle') withPath(g, 'M20 5l16 29H4z', color)
  else if (shape === 'diamond') withPath(g, 'M20 3l15 17-15 17L5 20z', color)
  else withPath(g, 'M20 3l5 10.5 11.5 1.3-8.6 7.9 2.4 11.4L20 28.4 9.7 34.1l2.4-11.4L3.5 14.8 15 13.5z', color)
  g.restore()
}

function drawClock(g: G, hour: number, minute: number, cx: number, cy: number, r: number) {
  g.fillStyle = PALETTE.paper
  g.strokeStyle = PALETTE.woodDark
  g.lineWidth = r * 0.14
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.fillStyle = '#7a6258'
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    g.beginPath()
    g.arc(cx + Math.sin(a) * r * 0.78, cy - Math.cos(a) * r * 0.78, i % 3 === 0 ? r * 0.075 : r * 0.04, 0, Math.PI * 2)
    g.fill()
  }
  const ha = ((hour % 12) + minute / 60) * (Math.PI / 6)
  const ma = minute * (Math.PI / 30)
  g.lineCap = 'round'
  g.strokeStyle = '#3b2a26'
  g.lineWidth = r * 0.12
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + Math.sin(ha) * r * 0.45, cy - Math.cos(ha) * r * 0.45)
  g.stroke()
  g.strokeStyle = '#e07b39'
  g.lineWidth = r * 0.07
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + Math.sin(ma) * r * 0.7, cy - Math.cos(ma) * r * 0.7)
  g.stroke()
}

// ---------------------------------------------------------------------------
// Posters
// ---------------------------------------------------------------------------

/** One clue of the combination lock: a numbered poster. 512 x 640. */
export function clueTexture(clue: LockClue, index: number) {
  return canvasTexture(512, 640, (g, w, h) => {
    paperBackground(g, w, h)
    // Number badge
    g.fillStyle = '#3d4248'
    g.beginPath()
    g.arc(w / 2, 86, 54, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#f0c977'
    g.font = `600 64px ${MONO}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(index + 1), w / 2, 90)
    g.fillStyle = '#7a6258'
    g.font = `600 30px ${DISPLAY}`
    g.fillText(`digit ${index + 1}`, w / 2, 170)
    // Text
    g.fillStyle = '#3b2a26'
    g.font = `600 44px ${DISPLAY}`
    const lines = wrapLines(g, clue.text, w - 70)
    lines.slice(0, 4).forEach((l, i) => g.fillText(l, w / 2, 236 + i * 54))
    const top = 236 + Math.min(lines.length, 4) * 54
    if (clue.type === 'count') {
      const per = Math.min(5, clue.count)
      const size = 72
      for (let k = 0; k < clue.count; k++) {
        const row = Math.floor(k / per)
        const col = k % per
        const inRow = Math.min(per, clue.count - row * per)
        const x = w / 2 - (inRow * (size + 10)) / 2 + col * (size + 10) + 5
        const y = top + 10 + row * (size + 8)
        if (y + size < h - 10) drawIcon(g, clue.icon, x, y, size)
      }
    } else if (clue.type === 'clock') {
      drawClock(g, clue.hour, clue.minute, w / 2, Math.min(h - 120, top + 120), 105)
    } else {
      g.font = `700 120px ${HAND}`
      g.fillStyle = '#c4513f'
      g.fillText('?', w / 2, Math.min(h - 90, top + 90))
    }
  })
}

/** The cipher word above the door, in chalk on a dark banner. 1024 x 256. */
export function cipherBannerTexture(c: CipherDailyChallenge) {
  return canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = PALETTE.chalkboard
    g.fillRect(0, 0, w, h)
    g.strokeStyle = PALETTE.woodDark
    g.lineWidth = 16
    g.strokeRect(8, 8, w - 16, h - 16)
    g.fillStyle = 'rgba(233,241,234,0.7)'
    g.font = `700 40px ${HAND}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('decode me', w / 2, 46)
    const n = c.data.encoded.length
    const cell = Math.min(120, (w - 80) / n)
    c.data.encoded.forEach((s, i) => {
      const x = w / 2 - (n * cell) / 2 + i * cell + cell / 2
      const missing = c.data.missing.includes(s)
      g.strokeStyle = missing ? '#f0c977' : 'rgba(233,241,234,0.45)'
      g.lineWidth = 4
      g.setLineDash(missing ? [10, 8] : [])
      roundRect(g, x - cell / 2 + 8, 82, cell - 16, 140, 14)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = '#f7efe0'
      g.font = `600 ${Math.round(cell * 0.62)}px ${DISPLAY}`
      g.fillText(s, x, 154)
    })
  })
}

/** The cipher key on a parchment poster. 640 x 800. */
export function cipherKeyTexture(c: CipherDailyChallenge) {
  return canvasTexture(640, 800, (g, w, h) => {
    paperBackground(g, w, h, '#f6ead2')
    g.fillStyle = '#3b2a26'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 56px ${DISPLAY}`
    g.fillText('The key', w / 2, 64)
    g.font = `700 30px ${HAND}`
    g.fillStyle = '#7a6258'
    g.fillText('some symbols wore away…', w / 2, 112)
    const items = [...c.data.key.map((k) => ({ s: k.symbol, l: k.letter, miss: false })), ...c.data.missing.map((s) => ({ s, l: '?', miss: true }))]
    const cols = items.length > 8 ? 3 : 2
    const rows = Math.ceil(items.length / cols)
    const cw = (w - 60) / cols
    const ch = Math.min(150, (h - 180) / rows)
    items.forEach((it, i) => {
      const x = 30 + (i % cols) * cw
      const y = 150 + Math.floor(i / cols) * ch
      g.strokeStyle = it.miss ? '#e07b39' : 'rgba(122,74,43,0.4)'
      g.lineWidth = 3
      g.setLineDash(it.miss ? [8, 6] : [])
      roundRect(g, x + 6, y + 6, cw - 12, ch - 12, 12)
      g.stroke()
      g.setLineDash([])
      g.font = `600 ${Math.round(ch * 0.5)}px ${DISPLAY}`
      g.fillStyle = PALETTE.fabricPlum
      g.fillText(it.s, x + cw * 0.3, y + ch / 2)
      g.fillStyle = '#7a6258'
      g.fillText('=', x + cw * 0.52, y + ch / 2)
      g.font = `600 ${Math.round(ch * 0.45)}px ${MONO}`
      g.fillStyle = it.miss ? '#e07b39' : '#3b2a26'
      g.fillText(it.l, x + cw * 0.75, y + ch / 2)
    })
  })
}

/** The sequence so far, as a long lit panel: shown terms then three "?" slots. 1280 x 256. */
export function sequenceTexture(c: SequenceDailyChallenge) {
  return canvasTexture(1280, 256, (g, w, h) => {
    g.fillStyle = '#2a2f35'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = PALETTE.brass
    g.lineWidth = 12
    g.strokeRect(6, 6, w - 12, h - 12)
    const d = c.data
    const n = d.shown.length + 3
    const cell = Math.min(150, (w - 60) / n)
    const x0 = w / 2 - (n * cell) / 2
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell + cell / 2
      const q = i >= d.shown.length
      g.fillStyle = q ? 'rgba(224,123,57,0.12)' : '#3d4248'
      roundRect(g, x - cell / 2 + 8, 52, cell - 16, 152, 16)
      g.fill()
      if (q) {
        g.strokeStyle = '#e07b39'
        g.lineWidth = 4
        g.setLineDash([10, 8])
        g.stroke()
        g.setLineDash([])
        g.fillStyle = '#e07b39'
        g.font = `600 80px ${DISPLAY}`
        g.fillText('?', x, 130)
      } else if (d.mode === 'number') {
        g.fillStyle = '#f0c977'
        const v = d.shown[i]
        g.font = `600 ${v.length > 3 ? 46 : 64}px ${MONO}`
        g.fillText(v, x, 130)
      } else {
        const t = d.shown[i]
        drawShape(g, t.shape, t.color, x, 128, cell * 0.66)
      }
    }
  })
}

/** "Find the N brass keys" sign for a search day. 768 x 384. */
export function searchSignTexture(symbol: SearchSymbol, count: number) {
  const name = symbol === 'key' ? 'brass keys' : symbol === 'star' ? 'brass stars' : 'brass hearts'
  return canvasTexture(768, 384, (g, w, h) => {
    paperBackground(g, w, h)
    g.fillStyle = '#3b2a26'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 64px ${DISPLAY}`
    g.fillText(`Find the ${count} ${name}`, w / 2, 120, w - 60)
    g.font = `700 44px ${HAND}`
    g.fillStyle = '#7a6258'
    g.fillText('they hide under things in this room', w / 2, 200, w - 60)
    g.fillText(`${count} looks a round · found ones stay found`, w / 2, 270, w - 60)
  })
}

/** The brass plaque at the entrance. 768 x 384. */
export function plaqueTexture(number: number, kindLabel: string, theme: { gameName: string; venueName: string; city: string } | null) {
  return canvasTexture(768, 384, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#e8bf6a')
    grad.addColorStop(1, '#b9863a')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#7a4a2b'
    g.lineWidth = 10
    roundRect(g, 14, 14, w - 28, h - 28, 22)
    g.stroke()
    g.fillStyle = '#3b2a26'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 30px ${DISPLAY}`
    g.fillText('ESCAPE OF THE DAY', w / 2, 70)
    g.font = `700 92px ${DISPLAY}`
    g.fillText(`#${number}`, w / 2, 150)
    g.font = `600 36px ${DISPLAY}`
    g.fillText(kindLabel, w / 2, 222, w - 80)
    if (theme) {
      g.font = `700 38px ${HAND}`
      g.fillText(`inspired by ${theme.gameName}`, w / 2, 280, w - 80)
      g.font = `700 30px ${HAND}`
      g.fillText(`${theme.venueName}, ${theme.city}`, w / 2, 322, w - 80)
    }
  })
}

/** The chalkboard with every guess so far (marks only, plus the guess values) and guesses left. 1024 x 672. */
export function boardTexture(c: DailyChallenge, guesses: readonly string[][], grid: readonly GridMark[][], maxGuesses: number, hintsUsed: number) {
  return canvasTexture(1024, 672, (g, w, h) => {
    g.fillStyle = PALETTE.chalkboard
    g.fillRect(0, 0, w, h)
    g.strokeStyle = PALETTE.woodLight
    g.lineWidth = 22
    g.strokeRect(11, 11, w - 22, h - 22)
    g.fillStyle = 'rgba(233,241,234,0.85)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 52px ${HAND}`
    const used = guesses.length
    g.fillText(`Guesses ${used} / ${maxGuesses}${hintsUsed ? ` · ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}` : ''}`, w / 2, 64)
    const rows = grid.filter((r) => !(r.length === 1 && r[0] === 'hint'))
    const slots = c.slots
    const cell = Math.min(84, (w - 120) / slots)
    const rowH = Math.min(84, (h - 140) / maxGuesses)
    const byId = c.kind === 'sequence' && c.data.mode === 'shape' ? new Map(c.data.choices.map((t) => [t.id, t])) : null
    for (let r = 0; r < maxGuesses; r++) {
      const y = 112 + r * rowH
      for (let i = 0; i < slots; i++) {
        const x = w / 2 - (slots * cell) / 2 + i * cell
        const mark = rows[r]?.[i]
        if (mark) {
          const s = MARK_STYLE[mark]
          g.fillStyle = s.bg
          roundRect(g, x + 5, y + 5, cell - 10, rowH - 10, 10)
          g.fill()
          const v = guesses[r]?.[i] ?? ''
          const t = byId?.get(v)
          if (t) drawShape(g, t.shape, '#ffffff', x + cell / 2, y + rowH / 2, rowH * 0.55)
          else if (c.kind !== 'search' && v) {
            g.fillStyle = s.fg
            g.font = `600 ${v.length > 3 ? 24 : 36}px ${MONO}`
            g.fillText(v, x + cell / 2, y + rowH / 2 + 2)
          }
        } else {
          g.strokeStyle = 'rgba(233,241,234,0.3)'
          g.lineWidth = 3
          roundRect(g, x + 5, y + 5, cell - 10, rowH - 10, 10)
          g.stroke()
        }
      }
    }
  })
}

/** The lock's display window: the last guess, one coloured cell per slot. 512 x 192. */
export function lockFaceTexture(c: DailyChallenge, last: readonly string[] | null, marks: readonly GridMark[] | null, open: boolean) {
  return canvasTexture(512, 192, (g, w, h) => {
    g.fillStyle = '#1f2326'
    g.fillRect(0, 0, w, h)
    const n = c.slots
    const cell = Math.min(110, (w - 40) / n)
    const byId = c.kind === 'sequence' && c.data.mode === 'shape' ? new Map(c.data.choices.map((t) => [t.id, t])) : null
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (let i = 0; i < n; i++) {
      const x = w / 2 - (n * cell) / 2 + i * cell
      const m = marks?.[i]
      g.fillStyle = open ? '#4f9d5a' : m ? MARK_STYLE[m].bg : '#3d4248'
      roundRect(g, x + 6, 26, cell - 12, h - 52, 12)
      g.fill()
      const v = last?.[i] ?? ''
      const t = byId?.get(v)
      if (t) drawShape(g, t.shape, '#ffffff', x + cell / 2, h / 2, cell * 0.5)
      else {
        g.fillStyle = m ? MARK_STYLE[m].fg : '#f0c977'
        const text = c.kind === 'search' ? (m === 'hit' ? '✓' : '·') : v || '–'
        g.font = `600 ${text.length > 3 ? 30 : 56}px ${MONO}`
        g.fillText(text, x + cell / 2, h / 2 + 3)
      }
    }
  })
}
