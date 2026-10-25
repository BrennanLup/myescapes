/**
 * The desk terminal screen: a pure frame builder (`terminalFrame`) that decides
 * what is on screen for a given time / hover state, and a canvas painter
 * (`drawTerminal`) that renders a frame. The painter is the only part that
 * touches the DOM.
 */
import { FONTS, LIGHT, PALETTE } from '@/contracts/style'

export const TERMINAL_CANVAS = { width: 512, height: 304 } as const

export interface TerminalFrame {
  /** Header bar text. */
  title: string
  /** Body lines, top to bottom. The prompt line is `lines[promptIndex]`. */
  lines: string[]
  promptIndex: number
  /** The prompt as typed so far (typewriter effect). */
  prompt: string
  cursorOn: boolean
  /** Call to action under the prompt. */
  button: string
  /** Waveform bar heights in [0,1] (animated microphone meter). */
  bars: number[]
  hovered: boolean
  /** Cache key: identical keys render identical pixels. */
  key: string
}

const PROMPT = 'LOG A NEW ESCAPE ROOM'
const HOVER_PROMPT = 'READY TO RECORD'
/** Seconds per typed character and the length of one loop of the idle animation. */
const TYPE_SPEED = 0.07
const LOOP = 9
const BAR_COUNT = 18
/** Frames per second the animated parts step at (keeps texture uploads cheap). */
export const TERMINAL_FPS = 8

function quant(t: number) {
  return Math.floor(Math.max(0, t) * TERMINAL_FPS) / TERMINAL_FPS
}

export function terminalFrame(t: number, hovered: boolean, roomCount = 0): TerminalFrame {
  const q = quant(t)
  const loopT = q % LOOP
  const target = hovered ? HOVER_PROMPT : PROMPT
  const typed = hovered ? target.length : Math.min(target.length, Math.floor(loopT / TYPE_SPEED))
  const prompt = target.slice(0, typed)
  // Cursor: solid while typing, then blinks at 2 Hz (faster when hovered).
  const blinkHz = hovered ? 3 : 2
  const cursorOn = typed < target.length || Math.floor(q * blinkHz * 2) % 2 === 0
  const count = Math.max(0, Math.floor(roomCount))
  const lines = [
    `crew@escape-hq:~$ rooms --count`,
    `${count} ${count === 1 ? 'room' : 'rooms'} escaped so far`,
    '',
    `> ${prompt}`,
  ]
  const button = hovered ? '[ click to start a voice note ]' : 'click to record a voice note'
  const bars: number[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    const amp = hovered ? 1 : 0.35
    const v = 0.5 + 0.5 * Math.sin(q * (hovered ? 9 : 3) + i * 0.9) * Math.cos(q * 1.7 + i * 0.37)
    bars.push(Math.round((0.12 + 0.88 * v * amp) * 100) / 100)
  }
  const title = 'escape-os  -  field log'
  const key = [hovered ? 1 : 0, count, prompt, cursorOn ? 1 : 0, bars.join(',')].join('|')
  return { title, lines, promptIndex: 3, prompt, cursorOn, button, bars, hovered, key }
}

const TEAL = LIGHT.ledTeal
const TEAL_DIM = '#1d8f86'
const BG = PALETTE.screen

/** Paints a frame onto a 2D context sized TERMINAL_CANVAS. */
export function drawTerminal(ctx: CanvasRenderingContext2D, f: TerminalFrame) {
  const { width: W, height: H } = TERMINAL_CANVAS
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  // Soft vignette glow.
  const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7)
  g.addColorStop(0, f.hovered ? '#1f4a52' : '#1b3c46')
  g.addColorStop(1, '#0d1c22')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // Header bar.
  ctx.fillStyle = f.hovered ? '#2a6e6c' : '#21524f'
  ctx.fillRect(0, 0, W, 30)
  for (const [i, c] of ['#e8433a', '#e0a93a', '#4f9d5a'].entries()) {
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(18 + i * 18, 15, 5.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.font = `600 15px ${FONTS.mono}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#bff7ef'
  ctx.fillText(f.title, 80, 16)

  // Body.
  let y = 58
  f.lines.forEach((line, i) => {
    if (i === f.promptIndex) {
      ctx.font = `600 33px ${FONTS.mono}`
      ctx.fillStyle = TEAL
      ctx.fillText(line, 22, y + 6)
      if (f.cursorOn) {
        const w = ctx.measureText(line).width
        ctx.fillRect(22 + w + 4, y - 11, 17, 34)
      }
      y += 50
    } else {
      ctx.font = `400 ${i === 0 ? 15 : 19}px ${FONTS.mono}`
      ctx.fillStyle = i === 0 ? TEAL_DIM : '#7fd8cf'
      if (line) ctx.fillText(line, 22, y)
      y += 24
    }
  })

  // Call to action pill.
  ctx.font = `600 20px ${FONTS.mono}`
  const tw = ctx.measureText(f.button).width
  const bx = 22
  const by = y + 4
  ctx.fillStyle = f.hovered ? TEAL : 'rgba(45,226,208,0.12)'
  roundRect(ctx, bx, by, tw + 64, 44, 12)
  ctx.fill()
  ctx.strokeStyle = TEAL
  ctx.lineWidth = 2
  ctx.stroke()
  // Mic dot.
  ctx.fillStyle = f.hovered ? '#e8433a' : TEAL
  ctx.beginPath()
  ctx.arc(bx + 22, by + 22, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = f.hovered ? '#06181b' : TEAL
  ctx.fillText(f.button, bx + 42, by + 23)

  // Waveform meter.
  const baseY = H - 22
  const barW = 9
  f.bars.forEach((v, i) => {
    const h = 6 + v * 46
    ctx.fillStyle = f.hovered ? TEAL : TEAL_DIM
    ctx.fillRect(W - 24 - (f.bars.length - i) * (barW + 4), baseY - h, barW, h)
  })
  ctx.font = `400 13px ${FONTS.mono}`
  ctx.fillStyle = TEAL_DIM
  ctx.fillText(f.hovered ? 'mic: armed' : 'mic: standby', 22, baseY - 8)
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

/** Static secondary-monitor content: a little "crew chat" window. */
export const SIDE_SCREEN_LINES = [
  '#crew-chat',
  'mia: that cipher wall tho',
  'sam: 4 min left. 4!!',
  'jo: log it at the desk',
  'you: on it >_',
]

export function drawSideScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#152a33'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#5a3f6e'
  ctx.fillRect(0, 0, 70, h)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ['#e07b39', '#2f8f8a', '#d4a24c', '#b5579b'][i]
    ctx.beginPath()
    ctx.arc(35, 40 + i * 50, 16, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.textBaseline = 'middle'
  SIDE_SCREEN_LINES.forEach((line, i) => {
    ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? 20 : 17}px ${FONTS.mono}`
    ctx.fillStyle = i === 0 ? '#ffd9b0' : i === SIDE_SCREEN_LINES.length - 1 ? LIGHT.ledTeal : '#cfe6e3'
    ctx.fillText(line, 86, 30 + i * 40)
  })
}
