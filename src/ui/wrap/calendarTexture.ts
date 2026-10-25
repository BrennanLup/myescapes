/**
 * Canvas drawing for the wall calendar above the trophy shelf: current month and
 * year, a day grid, and a few days circled in red marker (days the crew played
 * this month, topped up with Saturdays so it never looks empty).
 */
import { FONTS, PALETTE } from '@/contracts/style'

export const CAL_W = 512
export const CAL_H = 640

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Pure: which days of `month` (0-based) in `year` get circled. */
export function circledDays(year: number, month: number, reviewDates: string[], want = 3): number[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const days = new Set<number>()
  for (const d of reviewDates) if (d.startsWith(prefix)) days.add(Number(d.slice(8, 10)))
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth && days.size < want; d++) {
    if (new Date(year, month, d).getDay() === 6) days.add(d)
  }
  return [...days].sort((a, b) => a - b)
}

export function drawCalendar(ctx: CanvasRenderingContext2D, now: Date, reviewDates: string[]) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const W = CAL_W
  const H = CAL_H

  // Paper
  ctx.fillStyle = PALETTE.paper
  ctx.fillRect(0, 0, W, H)

  // Header band with a little sunset "photo"
  const headH = 250
  const g = ctx.createLinearGradient(0, 0, 0, headH)
  g.addColorStop(0, '#f7b98a')
  g.addColorStop(0.6, '#e07b39')
  g.addColorStop(1, '#b8503f')
  ctx.fillStyle = g
  ctx.fillRect(18, 40, W - 36, headH - 40)
  // sun + hills
  ctx.fillStyle = '#ffe08a'
  ctx.beginPath()
  ctx.arc(W * 0.7, 150, 46, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6d3b5c'
  ctx.beginPath()
  ctx.moveTo(18, headH)
  ctx.quadraticCurveTo(W * 0.3, 150, W * 0.55, 215)
  ctx.quadraticCurveTo(W * 0.8, 170, W - 18, 200)
  ctx.lineTo(W - 18, headH)
  ctx.closePath()
  ctx.fill()

  // Spiral holes
  ctx.fillStyle = PALETTE.metalDark
  for (let i = 0; i < 9; i++) {
    ctx.beginPath()
    ctx.arc(60 + i * ((W - 120) / 8), 20, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // Year + month
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff7ec'
  ctx.font = `700 92px ${FONTS.display}`
  ctx.textAlign = 'left'
  ctx.fillText(String(year), 38, 140)
  ctx.font = `600 40px ${FONTS.display}`
  ctx.fillText(MONTHS[month].toUpperCase(), 42, 190)

  // Weekday header (Mon first)
  const gridTop = headH + 26
  const colW = (W - 40) / 7
  ctx.textAlign = 'center'
  ctx.font = `700 24px ${FONTS.body}`
  ;['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => {
    ctx.fillStyle = i >= 5 ? PALETTE.fabricOrange : '#7a6258'
    ctx.fillText(d, 20 + colW * (i + 0.5), gridTop + 20)
  })

  // Days
  const first = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const rowH = 50
  const circled = new Set(circledDays(year, month, reviewDates))
  ctx.font = `600 30px ${FONTS.body}`
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = first + d - 1
    const col = cell % 7
    const row = Math.floor(cell / 7)
    const cx = 20 + colW * (col + 0.5)
    const cy = gridTop + 62 + row * rowH
    ctx.fillStyle = col >= 5 ? PALETTE.fabricOrange : '#3b2a26'
    ctx.fillText(String(d), cx, cy)
    if (circled.has(d)) {
      // marker circle: two slightly offset loops
      ctx.strokeStyle = PALETTE.redString
      ctx.lineCap = 'round'
      ctx.lineWidth = 5
      for (let k = 0; k < 2; k++) {
        ctx.beginPath()
        ctx.ellipse(cx + k * 2, cy - 10 + k, 29 - k * 2, 24, -0.2 + k * 0.25, 0.15 + k, Math.PI * 2 + 0.3 + k)
        ctx.stroke()
      }
    }
  }

  // A tiny scribble at the bottom
  ctx.fillStyle = PALETTE.redString
  ctx.font = `700 34px ${FONTS.hand}`
  ctx.textAlign = 'right'
  ctx.fillText('escape day!', W - 30, H - 18)
}
