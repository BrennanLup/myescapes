/**
 * Generates the cute placeholder polaroid photos for the seed rooms.
 *
 *   npx tsx seed/generate-photos.ts
 *
 * Reads seed/reviews.json and writes every `/seed/photos/<roomId>-<n>.svg` that a
 * room references into public/seed/photos/. Photo 1 is a genre scene (lighthouse,
 * vault door, rocket, haunted house...), photo 2 is a "crew photo" holding the
 * result sign. Output is deterministic (seeded by room id).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatasetSchema, type Review, type Room } from '../src/contracts/types'
import { GENRE_COLORS, PALETTE, UI } from '../src/contracts/style'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '../public/seed/photos')

// Image area inside the polaroid frame.
const W = 356
const H = 330

type Rng = () => number
function rngFor(seed: string): Rng {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}
const f = (n: number) => String(Math.round(n * 10) / 10)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function sky(id: string, top: string, bottom: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${id})"/>`
}

function stars(rng: Rng, n: number, maxY: number, color = '#fff6d8'): string {
  let s = ''
  for (let i = 0; i < n; i++) {
    const x = rng() * W, y = rng() * maxY, r = 0.6 + rng() * 1.6
    s += rng() < 0.2
      ? `<path d="M${f(x)} ${f(y - r * 2.4)}L${f(x + r * 0.6)} ${f(y)}L${f(x)} ${f(y + r * 2.4)}L${f(x - r * 0.6)} ${f(y)}Z" fill="${color}"/>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}" opacity="${f(0.5 + rng() * 0.5)}"/>`
  }
  return s
}

function confetti(rng: Rng, n: number): string {
  const cols = [PALETTE.fabricOrange, PALETTE.fabricTeal, PALETTE.brass, PALETTE.pinRed, GENRE_COLORS.fantasy, PALETTE.leaf]
  let s = ''
  for (let i = 0; i < n; i++) {
    const x = rng() * W, y = rng() * H * 0.7, c = cols[Math.floor(rng() * cols.length)]
    s += `<rect x="${f(x)}" y="${f(y)}" width="${f(4 + rng() * 5)}" height="${f(3 + rng() * 3)}" rx="1" fill="${c}" transform="rotate(${f(rng() * 180)} ${f(x)} ${f(y)})"/>`
  }
  return s
}

function hills(color: string, y: number, amp: number, rng: Rng): string {
  let d = `M0 ${H}L0 ${f(y)}`
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    const x = (W / steps) * i
    d += `Q${f(x - W / steps / 2)} ${f(y - amp * (0.4 + rng()))} ${f(x)} ${f(y + (rng() - 0.5) * amp * 0.4)}`
  }
  return `<path d="${d}L${W} ${H}Z" fill="${color}"/>`
}

function puffs(rng: Rng, x: number, y: number, n: number, color = '#ffffff', spread = 40): string {
  let s = ''
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${f(x + (rng() - 0.5) * spread)}" cy="${f(y + (rng() - 0.5) * spread * 0.5)}" r="${f(8 + rng() * 14)}" fill="${color}" opacity="${f(0.55 + rng() * 0.35)}"/>`
  }
  return s
}

/** Little cute face: two dot eyes, blush, smile. */
function face(x: number, y: number, s = 1, ink: string = UI.ink): string {
  return `<circle cx="${f(x - 6 * s)}" cy="${f(y)}" r="${f(2.2 * s)}" fill="${ink}"/><circle cx="${f(x + 6 * s)}" cy="${f(y)}" r="${f(2.2 * s)}" fill="${ink}"/>` +
    `<circle cx="${f(x - 10 * s)}" cy="${f(y + 5 * s)}" r="${f(2.6 * s)}" fill="#f29a8a" opacity="0.7"/><circle cx="${f(x + 10 * s)}" cy="${f(y + 5 * s)}" r="${f(2.6 * s)}" fill="#f29a8a" opacity="0.7"/>` +
    `<path d="M${f(x - 4 * s)} ${f(y + 5 * s)}Q${f(x)} ${f(y + 9 * s)} ${f(x + 4 * s)} ${f(y + 5 * s)}" stroke="${ink}" stroke-width="${f(1.8 * s)}" fill="none" stroke-linecap="round"/>`
}

// ---------------------------------------------------------------------------
// Scenes (photo 1)
// ---------------------------------------------------------------------------

type Scene = (rng: Rng, genre: string) => string

const lighthouse: Scene = (rng) => {
  let s = sky('sk', '#5b5fa8', PALETTE.sky) + stars(rng, 25, 120)
  s += `<circle cx="290" cy="70" r="26" fill="#fff1c9"/>`
  s += `<path d="M168 92L-20 40L-20 150Z" fill="#fff4b0" opacity="0.35"/><path d="M188 92L380 30L380 150Z" fill="#fff4b0" opacity="0.35"/>`
  s += `<rect y="235" width="${W}" height="${H - 235}" fill="${PALETTE.fabricTeal}"/>`
  for (let i = 0; i < 7; i++) s += `<path d="M${f(rng() * W)} ${f(250 + i * 11)}q10 -6 20 0t20 0" stroke="#bfeee8" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
  s += `<path d="M110 250Q130 205 175 215Q225 200 250 250Z" fill="${PALETTE.metalDark}"/>`
  s += `<path d="M155 220L163 110L193 110L201 220Z" fill="${PALETTE.paper}"/>`
  s += `<path d="M157.5 190L198.5 190L200 205L156 205Z M160 150L196 150L197.5 168L158.6 168Z M162.5 118L193.5 118L194.5 132L161.6 132Z" fill="${PALETTE.pinRed}"/>`
  s += `<rect x="156" y="104" width="44" height="8" rx="2" fill="${PALETTE.metalDark}"/><rect x="164" y="80" width="28" height="24" rx="3" fill="#ffe27a" stroke="${PALETTE.metalDark}" stroke-width="3"/>`
  s += `<path d="M160 82L178 64L196 82Z" fill="${PALETTE.pinRed}"/><circle cx="178" cy="92" r="6" fill="#fff9d8"/>`
  s += `<rect x="171" y="196" width="14" height="24" rx="7" fill="${PALETTE.woodDark}"/>`
  for (let i = 0; i < 4; i++) {
    const x = 40 + rng() * 260, y = 30 + rng() * 80
    s += `<path d="M${f(x)} ${f(y)}q6 -6 12 0q6 -6 12 0" stroke="${UI.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  }
  return s
}

const vault: Scene = (rng) => {
  let s = `<rect width="${W}" height="${H}" fill="#7a4a2b"/>`
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 8; col++) {
      const x = col * 48 - (row % 2) * 24, y = row * 24
      s += `<rect x="${x + 2}" y="${y + 2}" width="44" height="20" rx="3" fill="${shade('#a96a3f', (rng() - 0.5) * 0.25)}"/>`
    }
  }
  s += `<rect y="262" width="${W}" height="${H - 262}" fill="${PALETTE.woodDark}"/>`
  s += `<circle cx="178" cy="150" r="112" fill="${PALETTE.metalDark}"/><circle cx="178" cy="150" r="100" fill="${PALETTE.metal}"/><circle cx="178" cy="150" r="82" fill="#b9c1c5" stroke="#7d868b" stroke-width="4"/>`
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    s += `<circle cx="${f(178 + Math.cos(a) * 92)}" cy="${f(150 + Math.sin(a) * 92)}" r="4.5" fill="${PALETTE.brass}"/>`
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3
    s += `<line x1="178" y1="150" x2="${f(178 + Math.cos(a) * 58)}" y2="${f(150 + Math.sin(a) * 58)}" stroke="${PALETTE.brass}" stroke-width="9" stroke-linecap="round"/><circle cx="${f(178 + Math.cos(a) * 58)}" cy="${f(150 + Math.sin(a) * 58)}" r="9" fill="${PALETTE.brass}"/>`
  }
  s += `<circle cx="178" cy="150" r="22" fill="${PALETTE.brass}" stroke="#a87a2a" stroke-width="4"/><circle cx="178" cy="150" r="7" fill="#a87a2a"/>`
  for (let i = 0; i < 6; i++) {
    const x = 36 + (i % 3) * 30 + (i > 2 ? 15 : 0), y = i > 2 ? 278 : 296
    s += `<path d="M${x} ${y + 18}L${x + 6} ${y}L${x + 30} ${y}L${x + 36} ${y + 18}Z" fill="#f2c14e" stroke="#c48f2a" stroke-width="2"/>`
  }
  for (let i = 0; i < 9; i++) s += `<ellipse cx="${f(250 + rng() * 80)}" cy="${f(290 + rng() * 25)}" rx="9" ry="5" fill="#f2c14e" stroke="#c48f2a" stroke-width="1.5"/>`
  s += `<path d="M300 30l6 14l14 2l-10 10l3 14l-13 -7l-13 7l3 -14l-10 -10l14 -2Z" fill="#fff1c9" opacity="0.8"/>`
  return s
}

const rocket: Scene = (rng) => {
  let s = sky('sk', '#253a5e', GENRE_COLORS['sci-fi']) + stars(rng, 50, H)
  s += `<circle cx="285" cy="80" r="34" fill="#e8d6b8"/><circle cx="275" cy="72" r="6" fill="#d4bc95"/><circle cx="296" cy="92" r="9" fill="#d4bc95"/><ellipse cx="285" cy="80" rx="58" ry="12" fill="none" stroke="${PALETTE.brass}" stroke-width="4" transform="rotate(-18 285 80)"/>`
  s += hills('#1f5e5b', 280, 30, rng)
  s += puffs(rng, 150, 285, 9, '#fbe7d0', 120)
  s += `<path d="M138 250Q150 280 162 250Z M150 250Q150 300 150 250" fill="#ffb36b"/><path d="M140 248Q150 300 160 248Z" fill="#ffd36b"/>`
  s += `<path d="M150 60C185 95 185 180 175 245L125 245C115 180 115 95 150 60Z" fill="${PALETTE.paper}"/>`
  s += `<path d="M150 60C162 72 170 86 174 100L126 100C130 86 138 72 150 60Z" fill="${PALETTE.pinRed}"/>`
  s += `<path d="M125 200L98 250L126 240Z M175 200L202 250L174 240Z" fill="${PALETTE.pinRed}"/><rect x="146" y="200" width="8" height="48" rx="4" fill="${PALETTE.pinRed}"/>`
  s += `<circle cx="150" cy="140" r="18" fill="${PALETTE.fabricTeal}" stroke="${PALETTE.metalDark}" stroke-width="5"/><circle cx="144" cy="134" r="5" fill="#bff3ee"/>`
  s += `<rect x="128" y="242" width="44" height="8" rx="3" fill="${PALETTE.metalDark}"/>`
  return s
}

const haunted: Scene = (rng) => {
  let s = sky('sk', '#6d3b5c', '#f2a07a') + stars(rng, 18, 110)
  s += `<circle cx="80" cy="74" r="38" fill="#fff1c9"/><circle cx="92" cy="66" r="7" fill="#f3e2b0"/>`
  s += hills('#4a2b44', 250, 40, rng)
  s += `<path d="M110 250L110 150L178 100L246 150L246 250Z" fill="#5a3550"/><path d="M98 156L178 92L258 156L248 162L178 106L108 162Z" fill="#3b2a36"/>`
  s += `<path d="M196 120L196 70L226 50L256 70L256 128Z" fill="#5a3550"/><path d="M188 76L226 40L264 76Z" fill="#3b2a36"/>`
  const win = (x: number, y: number) => `<rect x="${x}" y="${y}" width="22" height="26" rx="11" fill="#ffb36b"/><line x1="${x + 11}" y1="${y}" x2="${x + 11}" y2="${y + 26}" stroke="#5a3550" stroke-width="2.5"/>`
  s += win(126, 170) + win(208, 170) + win(215, 80) + win(126, 210)
  s += `<rect x="166" y="200" width="26" height="50" rx="13" fill="#3b2a36"/><circle cx="186" cy="226" r="2.5" fill="${PALETTE.brass}"/>`
  for (let i = 0; i < 13; i++) s += `<path d="M${10 + i * 27} 300L${10 + i * 27} 268L${16 + i * 27} 260L${22 + i * 27} 268L${22 + i * 27} 300Z" fill="#2f1f2c"/>`
  s += `<rect y="280" width="${W}" height="5" fill="#2f1f2c"/>`
  s += `<path d="M280 236C280 196 324 196 324 236L324 262L316 256L309 264L302 256L295 264L288 256L280 262Z" fill="#fffaf0"/>` + face(302, 228, 1)
  for (let i = 0; i < 3; i++) {
    const x = 160 + rng() * 150, y = 30 + rng() * 40
    s += `<path d="M${f(x)} ${f(y)}q-8 -8 -16 -2q6 2 6 8q4 -4 10 -2q6 -2 10 2q0 -6 6 -8q-8 -6 -16 2Z" fill="#2f1f2c"/>`
  }
  return s
}

const saloon: Scene = (rng) => {
  let s = sky('sk', '#f2a03a', '#ffd9b0')
  s += `<circle cx="280" cy="80" r="40" fill="#fff1c9" opacity="0.9"/>`
  s += hills('#d9925a', 210, 22, rng)
  s += `<rect y="250" width="${W}" height="${H - 250}" fill="#e2b07a"/>`
  s += `<path d="M70 250L70 110L100 110L100 92L256 92L256 110L286 110L286 250Z" fill="${PALETTE.woodLight}"/>`
  for (let i = 0; i < 10; i++) s += `<line x1="70" y1="${120 + i * 13}" x2="286" y2="${120 + i * 13}" stroke="${PALETTE.woodDark}" stroke-width="1.5" opacity="0.4"/>`
  s += `<rect x="108" y="100" width="140" height="32" rx="4" fill="${PALETTE.paper}" stroke="${PALETTE.woodDark}" stroke-width="3"/><text x="178" y="124" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="22" fill="${PALETTE.pinRed}" letter-spacing="3">SALOON</text>`
  s += `<rect x="60" y="150" width="236" height="10" fill="${PALETTE.woodDark}"/>`
  for (let i = 0; i < 6; i++) s += `<rect x="${70 + i * 42}" y="160" width="6" height="90" fill="${PALETTE.woodDark}"/>`
  s += `<rect x="92" y="180" width="30" height="34" fill="#ffd36b" stroke="${PALETTE.woodDark}" stroke-width="3"/><rect x="234" y="180" width="30" height="34" fill="#ffd36b" stroke="${PALETTE.woodDark}" stroke-width="3"/>`
  s += `<path d="M150 200L176 200L176 236L150 232Z M180 200L206 200L206 232L180 236Z" fill="${PALETTE.woodDark}"/>`
  s += `<path d="M320 260L320 200Q320 190 328 190Q336 190 336 200L336 260Z M320 228L308 228Q302 228 302 220L302 210Q302 204 307 204Q312 204 312 210L312 220L320 220Z M336 220L346 220L346 205Q346 199 351 199Q356 199 356 205L356 224Q356 230 350 230L336 230Z" fill="${PALETTE.leaf}"/>`
  s += `<circle cx="38" cy="276" r="13" fill="none" stroke="#a0704a" stroke-width="2.5" stroke-dasharray="6 4"/><circle cx="38" cy="276" r="7" fill="none" stroke="#a0704a" stroke-width="2"/>`
  return s
}

const circus: Scene = (rng) => {
  let s = sky('sk', '#7ec8d6', '#ffe9b8')
  s += puffs(rng, 70, 60, 4, '#ffffff', 60) + puffs(rng, 290, 46, 4, '#ffffff', 50)
  s += `<rect y="262" width="${W}" height="${H - 262}" fill="${PALETTE.leaf}"/>`
  const stripes = 8
  for (let i = 0; i < stripes; i++) {
    const x0 = 58 + (240 / stripes) * i, x1 = 58 + (240 / stripes) * (i + 1)
    s += `<path d="M178 70L${f(x0)} 160L${f(x1)} 160Z" fill="${i % 2 ? PALETTE.paper : PALETTE.pinRed}"/>`
    s += `<rect x="${f(x0 + 6)}" y="160" width="${f(x1 - x0)}" height="104" fill="${i % 2 ? PALETTE.pinRed : PALETTE.paper}"/>`
  }
  for (let i = 0; i < 10; i++) s += `<path d="M${f(58 + i * 24)} 160q12 16 24 0Z" fill="${PALETTE.brass}"/>`
  s += `<path d="M178 70L178 40" stroke="${PALETTE.metalDark}" stroke-width="3"/><path d="M178 40L204 48L178 56Z" fill="${PALETTE.fabricTeal}"/>`
  s += `<path d="M156 264L156 210Q178 188 200 210L200 264Z" fill="#3b2a26"/>`
  s += `<path d="M0 30Q90 70 178 40Q266 70 356 30" stroke="${PALETTE.metalDark}" stroke-width="1.5" fill="none"/>`
  for (let i = 0; i < 12; i++) {
    const x = 10 + i * 30, y = i < 6 ? 34 + i * 6 : 34 + (11 - i) * 6
    s += `<path d="M${x} ${f(y)}L${x + 14} ${f(y)}L${x + 7} ${f(y + 16)}Z" fill="${[PALETTE.fabricOrange, PALETTE.fabricTeal, PALETTE.brass][i % 3]}"/>`
  }
  s += `<rect x="252" y="214" width="40" height="66" rx="20" fill="#6aa84f" transform="rotate(14 272 247)"/>`
  for (let i = 0; i < 6; i++) s += `<circle cx="${f(258 + rng() * 26)}" cy="${f(222 + rng() * 50)}" r="2.2" fill="#4f8a3a"/>`
  s += face(274, 240, 1.1)
  s += `<path d="M262 216l10 -14l10 14Z" fill="${PALETTE.fabricTeal}"/><circle cx="272" cy="202" r="3" fill="${PALETTE.brass}"/>`
  s += confetti(rng, 30)
  return s
}

const castle: Scene = (rng) => {
  let s = sky('sk', GENRE_COLORS.fantasy, '#ffcf9e') + stars(rng, 22, 120)
  s += `<path d="M0 250L60 150L110 220L170 130L240 230L300 160L356 230L356 330L0 330Z" fill="#8c6fb3" opacity="0.6"/>`
  s += hills('#5a9a4b', 270, 26, rng)
  const tower = (x: number, y: number, w: number, h: number, roof: string) => {
    let t = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e9d7c0"/>`
    t += `<path d="M${x - 6} ${y}L${x + w / 2} ${y - w * 1.1}L${x + w + 6} ${y}Z" fill="${roof}"/>`
    t += `<rect x="${x + w / 2 - 5}" y="${y + 18}" width="10" height="16" rx="5" fill="#ffb36b"/>`
    return t
  }
  s += `<rect x="96" y="180" width="168" height="100" fill="#dcc6aa"/>`
  for (let i = 0; i < 8; i++) s += `<rect x="${96 + i * 22}" y="170" width="13" height="12" fill="#dcc6aa"/>`
  s += tower(70, 150, 40, 130, PALETTE.fabricTeal) + tower(250, 150, 40, 130, PALETTE.fabricTeal) + tower(156, 110, 48, 90, PALETTE.pinRed)
  s += `<path d="M180 52L180 38L198 44L180 50" fill="${PALETTE.brass}" stroke="${PALETTE.brass}" stroke-width="1"/>`
  s += `<path d="M160 280L160 238Q180 218 200 238L200 280Z" fill="${PALETTE.woodDark}"/>`
  for (let i = 0; i < 4; i++) s += `<line x1="${166 + i * 10}" y1="232" x2="${166 + i * 10}" y2="280" stroke="#5a3520" stroke-width="2"/>`
  // little dragon on the right tower
  s += `<path d="M296 128q20 -20 34 -4q-10 -2 -14 8Z" fill="#6aa84f"/><path d="M284 136q-14 -26 4 -34q-2 14 10 22Z" fill="#8cc06a"/>`
  s += `<ellipse cx="296" cy="140" rx="20" ry="13" fill="#6aa84f"/><circle cx="314" cy="128" r="11" fill="#6aa84f"/>`
  s += `<circle cx="317" cy="125" r="2.2" fill="${UI.ink}"/><circle cx="322" cy="131" r="1.4" fill="${UI.ink}"/><path d="M308 118l-2 -8l6 5Z M316 116l2 -8l3 7Z" fill="${PALETTE.brass}"/>`
  s += puffs(rng, 336, 122, 3, '#fff3e0', 14)
  return s
}

const temple: Scene = (rng) => {
  let s = sky('sk', '#8fd0b0', '#fff0c2')
  s += `<circle cx="70" cy="60" r="30" fill="#fff6d0"/>`
  s += hills('#3f7a3a', 240, 40, rng)
  for (let i = 0; i < 5; i++) {
    const w = 220 - i * 40, x = 178 - w / 2, y = 266 - i * 30
    s += `<rect x="${x}" y="${y}" width="${w}" height="30" fill="${shade('#b8a27a', -i * 0.04)}" stroke="#8a7550" stroke-width="2"/>`
  }
  s += `<rect x="128" y="106" width="100" height="34" fill="#a8916a"/><rect x="164" y="114" width="28" height="26" rx="12" fill="#3b2a26"/>`
  s += `<rect x="166" y="150" width="24" height="146" fill="#cbb48a" opacity="0.6"/>`
  // jade monkey statue
  s += `<circle cx="178" cy="78" r="18" fill="#3fae84"/><circle cx="160" cy="74" r="7" fill="#3fae84"/><circle cx="196" cy="74" r="7" fill="#3fae84"/><ellipse cx="178" cy="84" rx="11" ry="8" fill="#7fd6b0"/>` + face(178, 76, 0.75, '#1f4a3a')
  s += `<rect x="168" y="94" width="20" height="14" rx="5" fill="#3fae84"/>`
  for (let i = 0; i < 8; i++) {
    const x = rng() * W, y0 = 0
    s += `<path d="M${f(x)} ${y0}q${f((rng() - 0.5) * 30)} 40 0 ${f(60 + rng() * 60)}" stroke="#3f7a3a" stroke-width="3" fill="none"/><ellipse cx="${f(x)}" cy="${f(60 + rng() * 60)}" rx="7" ry="4" fill="#5a9a4b"/>`
  }
  for (let i = 0; i < 6; i++) {
    const x = (i % 2 ? W - 30 : 30) + (rng() - 0.5) * 30, y = 220 + rng() * 80
    s += `<path d="M${f(x)} ${f(y)}q30 -30 50 -10q-30 0 -50 10Z" fill="${PALETTE.leafDark}"/><path d="M${f(x)} ${f(y)}q-30 -34 -50 -6q30 -4 50 6Z" fill="${PALETTE.leaf}"/>`
  }
  return s
}

const train: Scene = (rng) => {
  let s = sky('sk', '#2a2f5a', '#c4513f') + stars(rng, 35, 150)
  s += `<circle cx="70" cy="70" r="24" fill="#fff1c9"/>`
  s += `<path d="M0 230L50 150L90 200L150 120L220 210L280 140L356 220L356 330L0 330Z" fill="#3b3560"/><path d="M150 120L170 145L160 150L150 140L138 152L130 145Z" fill="#fffaf0"/>`
  s += `<rect y="268" width="${W}" height="${H - 268}" fill="#2a2440"/>`
  s += `<rect y="270" width="${W}" height="5" fill="${PALETTE.metal}"/>`
  for (let i = 0; i < 18; i++) s += `<rect x="${i * 20 + 2}" y="275" width="10" height="5" fill="${PALETTE.woodDark}"/>`
  s += `<rect x="40" y="200" width="150" height="56" rx="20" fill="${GENRE_COLORS.thriller}"/><rect x="190" y="170" width="70" height="86" rx="6" fill="${PALETTE.fabricPlum}"/><rect x="180" y="162" width="90" height="12" rx="4" fill="${PALETTE.metalDark}"/>`
  s += `<rect x="204" y="184" width="40" height="28" rx="4" fill="#ffd36b"/><rect x="270" y="210" width="80" height="46" rx="6" fill="${PALETTE.fabricPlum}"/><rect x="282" y="220" width="22" height="18" rx="3" fill="#ffd36b"/><rect x="314" y="220" width="22" height="18" rx="3" fill="#ffd36b"/>`
  s += `<rect x="70" y="164" width="22" height="38" fill="${PALETTE.metalDark}"/><rect x="64" y="158" width="34" height="10" rx="3" fill="${PALETTE.metalDark}"/><circle cx="50" cy="228" r="8" fill="#ffe27a"/>`
  s += `<path d="M36 256L20 268L60 268Z" fill="${PALETTE.metalDark}"/>`
  for (const [x, r] of [[80, 16], [130, 16], [215, 13], [245, 13], [295, 11], [330, 11]] as const) s += `<circle cx="${x}" cy="${262 - r + 8}" r="${r}" fill="${PALETTE.metalDark}"/><circle cx="${x}" cy="${262 - r + 8}" r="${f(r * 0.4)}" fill="${PALETTE.brass}"/>`
  s += `<rect x="78" y="240" width="54" height="5" rx="2" fill="${PALETTE.metal}"/>`
  s += puffs(rng, 90, 130, 4, '#fbe7d0', 30) + puffs(rng, 120, 90, 4, '#fbe7d0', 50) + puffs(rng, 160, 60, 3, '#fbe7d0', 60)
  return s
}

const lab: Scene = (rng) => {
  let s = `<rect width="${W}" height="${H}" fill="#cfe9e4"/>`
  for (let i = 0; i < 9; i++) s += `<line x1="${i * 44}" y1="0" x2="${i * 44}" y2="200" stroke="#b6d8d2" stroke-width="2"/>`
  s += `<rect x="40" y="30" width="130" height="80" rx="6" fill="#ffffff" stroke="${PALETTE.metal}" stroke-width="4"/>`
  s += `<text x="105" y="62" text-anchor="middle" font-family="monospace" font-size="16" fill="${PALETTE.fabricTeal}">H2O + ?</text><text x="105" y="90" text-anchor="middle" font-family="monospace" font-size="14" fill="${PALETTE.pinRed}">= CURE!</text>`
  s += `<rect y="200" width="${W}" height="20" fill="${PALETTE.metalDark}"/><rect y="220" width="${W}" height="${H - 220}" fill="#7d868b"/>`
  const flask = (x: number, liquid: string, h: number) =>
    `<path d="M${x - 9} ${200 - h}L${x - 9} ${200 - h * 0.55}L${x - 30} 196Q${x - 32} 200 ${x - 26} 200L${x + 26} 200Q${x + 32} 200 ${x + 30} 196L${x + 9} ${200 - h * 0.55}L${x + 9} ${200 - h}Z" fill="#ffffff" opacity="0.85" stroke="${PALETTE.metal}" stroke-width="2.5"/>` +
    `<path d="M${x - 22} 182L${x + 22} 182L${x + 30} 196Q${x + 32} 200 ${x + 26} 200L${x - 26} 200Q${x - 32} 200 ${x - 30} 196Z" fill="${liquid}"/>`
  s += flask(210, '#7ee0a0', 90) + flask(290, '#f29ad8', 70)
  for (let i = 0; i < 10; i++) s += `<circle cx="${f(200 + rng() * 100)}" cy="${f(80 + rng() * 90)}" r="${f(2 + rng() * 5)}" fill="none" stroke="#7ee0a0" stroke-width="2"/>`
  s += `<rect x="40" y="150" width="90" height="12" rx="3" fill="${PALETTE.woodLight}"/>`
  ;['#ffd36b', '#6d7fd1', '#2de2d0', '#e07b39'].forEach((c, i) => {
    s += `<rect x="${50 + i * 20}" y="128" width="12" height="58" rx="6" fill="#ffffff" stroke="${PALETTE.metal}" stroke-width="2"/><rect x="${51 + i * 20}" y="${160 - i * 6}" width="10" height="${25 + i * 6}" rx="5" fill="${c}"/>`
  })
  // hamster
  s += `<ellipse cx="80" cy="260" rx="34" ry="26" fill="#e8b07a"/><circle cx="58" cy="238" r="8" fill="#e8b07a"/><circle cx="102" cy="238" r="8" fill="#e8b07a"/><ellipse cx="80" cy="268" rx="20" ry="14" fill="#fbe7d0"/>` + face(80, 252, 1)
  s += `<rect x="150" y="250" width="180" height="40" rx="8" fill="#5f686d"/><circle cx="180" cy="270" r="10" fill="${PALETTE.pinRed}"/><circle cx="214" cy="270" r="10" fill="#7ee0a0"/><rect x="240" y="262" width="74" height="16" rx="4" fill="${PALETTE.screen}"/><text x="277" y="275" text-anchor="middle" font-family="monospace" font-size="12" fill="#2de2d0">00:46</text>`
  return s
}

const attic: Scene = (rng) => {
  let s = `<rect width="${W}" height="${H}" fill="#e9c9a0"/>`
  s += `<path d="M0 0L178 0L0 150Z M356 0L178 0L356 150Z" fill="${PALETTE.woodDark}"/>`
  for (let i = 0; i < 5; i++) s += `<line x1="${i * 40}" y1="0" x2="0" y2="${150 - i * 34}" stroke="#5a3520" stroke-width="3"/><line x1="${356 - i * 40}" y1="0" x2="356" y2="${150 - i * 34}" stroke="#5a3520" stroke-width="3"/>`
  s += `<circle cx="178" cy="80" r="40" fill="#fff1c9" stroke="${PALETTE.woodDark}" stroke-width="8"/><line x1="178" y1="40" x2="178" y2="120" stroke="${PALETTE.woodDark}" stroke-width="5"/><line x1="138" y1="80" x2="218" y2="80" stroke="${PALETTE.woodDark}" stroke-width="5"/>`
  s += `<path d="M150 112L90 330L270 330L206 112Z" fill="#fff3c4" opacity="0.35"/>`
  for (let i = 0; i < 18; i++) s += `<circle cx="${f(120 + rng() * 120)}" cy="${f(120 + rng() * 180)}" r="${f(1 + rng() * 1.8)}" fill="#fffbe8" opacity="0.8"/>`
  s += `<rect y="270" width="${W}" height="${H - 270}" fill="${PALETTE.woodFloor}"/>`
  // trunk
  s += `<rect x="30" y="220" width="110" height="64" rx="6" fill="${PALETTE.fabricPlum}"/><path d="M30 226Q85 196 140 226Z" fill="#7d4a6c"/><rect x="30" y="236" width="110" height="6" fill="${PALETTE.brass}"/><rect x="78" y="236" width="14" height="20" rx="3" fill="${PALETTE.brass}"/>`
  // rocking chair
  s += `<path d="M232 286Q270 300 310 286" stroke="${PALETTE.woodDark}" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="240" y="244" width="62" height="10" rx="4" fill="${PALETTE.woodLight}"/><rect x="292" y="180" width="10" height="106" rx="4" fill="${PALETTE.woodLight}"/><rect x="244" y="254" width="6" height="34" fill="${PALETTE.woodLight}"/><rect x="250" y="226" width="44" height="22" rx="8" fill="${PALETTE.fabricOrange}"/>`
  for (let i = 0; i < 3; i++) s += `<line x1="296" y1="${192 + i * 16}" x2="296" y2="${200 + i * 16}" stroke="${PALETTE.woodDark}" stroke-width="2"/>`
  // record player
  s += `<rect x="150" y="250" width="70" height="30" rx="4" fill="${PALETTE.woodLight}"/><ellipse cx="180" cy="250" rx="24" ry="6" fill="#2b2222"/><circle cx="180" cy="250" r="3" fill="${PALETTE.pinRed}"/><path d="M168 216Q150 196 140 210L158 226Z" fill="${PALETTE.brass}"/>`
  s += `<path d="M232 208l3 6m-6 0l3 6M246 196l2 8" stroke="${UI.ink}" stroke-width="2" stroke-linecap="round"/>`
  return s
}

const noir: Scene = (rng) => {
  let s = `<rect width="${W}" height="${H}" fill="#3b2140"/>`
  s += `<path d="M178 0L80 300L276 300Z" fill="#ffe2a8" opacity="0.28"/>`
  for (let i = 0; i < 7; i++) {
    const x = i * 18
    s += `<path d="M${x} 0Q${x + 10} 160 ${x - 4} 330L${x + 18} 330Q${x + 26} 160 ${x + 18} 0Z" fill="${i % 2 ? '#a3243b' : '#8a1d30'}"/>`
    s += `<path d="M${356 - x} 0Q${346 - x} 160 ${360 - x} 330L${338 - x} 330Q${330 - x} 160 ${338 - x} 0Z" fill="${i % 2 ? '#a3243b' : '#8a1d30'}"/>`
  }
  s += `<path d="M0 0L356 0L356 26Q300 46 178 30Q56 46 0 26Z" fill="#6e1626"/>`
  for (let i = 0; i < 8; i++) s += `<circle cx="${30 + i * 42}" cy="34" r="4" fill="${PALETTE.brass}"/>`
  s += `<ellipse cx="178" cy="300" rx="110" ry="18" fill="#5a2a48"/>`
  s += `<line x1="178" y1="150" x2="178" y2="296" stroke="${PALETTE.metal}" stroke-width="4"/><rect x="170" y="128" width="16" height="28" rx="8" fill="${PALETTE.metalDark}"/><path d="M160 298L196 298L178 288Z" fill="${PALETTE.metal}"/>`
  // fedora
  s += `<ellipse cx="96" cy="270" rx="40" ry="9" fill="#2f2230"/><path d="M70 268Q70 236 96 236Q122 236 122 268Z" fill="#2f2230"/><rect x="72" y="256" width="48" height="7" fill="${PALETTE.pinRed}"/>`
  // magnifier
  s += `<circle cx="262" cy="240" r="24" fill="#bfe6ff" opacity="0.45" stroke="${PALETTE.brass}" stroke-width="7"/><line x1="280" y1="258" x2="306" y2="286" stroke="${PALETTE.woodDark}" stroke-width="10" stroke-linecap="round"/><path d="M252 228q8 -6 16 0" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>`
  for (let i = 0; i < 5; i++) {
    const x = 120 + rng() * 120, y = 60 + rng() * 60
    s += `<text x="${f(x)}" y="${f(y)}" font-size="${f(14 + rng() * 8)}" fill="#ffe2a8" opacity="0.8">♪</text>`
  }
  return s
}

const SCENES: Record<string, Scene> = {
  room_lighthouse: lighthouse,
  room_vault: vault,
  room_rocket: rocket,
  room_haunted: haunted,
  room_saloon: saloon,
  room_circus: circus,
  room_castle: castle,
  room_temple: temple,
  room_train: train,
  room_lab: lab,
  room_attic: attic,
  room_noir: noir,
}

/** Fallback by genre, used if a room id has no bespoke scene. */
const GENRE_SCENES: Record<string, Scene> = {
  mystery: lighthouse, heist: vault, 'sci-fi': rocket, horror: haunted, historical: saloon, comedy: circus,
  fantasy: castle, adventure: temple, thriller: train, other: attic,
}

// ---------------------------------------------------------------------------
// Crew photo (photo 2)
// ---------------------------------------------------------------------------

const SKIN = ['#f5d0b0', '#e0a87e', '#c68a5e', '#8d5a3b', '#f0c3a0']
const SHIRTS = [PALETTE.fabricOrange, PALETTE.fabricTeal, PALETTE.fabricPlum, PALETTE.brass, PALETTE.rug]
const HAIR = ['#3b2a26', '#7a4a2b', '#1f1a1a', '#c98f3b', '#5a3a2a']

function crewPhoto(rng: Rng, room: Room, review: Review | undefined): string {
  const g = GENRE_COLORS[room.genre] ?? GENRE_COLORS.other
  let s = sky('sk', shade(g, 0.15), shade(g, 0.55))
  for (let i = 0; i < 14; i++) s += `<circle cx="${f(rng() * W)}" cy="${f(rng() * 180)}" r="${f(10 + rng() * 26)}" fill="#ffffff" opacity="${f(0.06 + rng() * 0.12)}"/>`
  s += `<rect y="250" width="${W}" height="${H - 250}" fill="${shade(g, -0.35)}"/>`
  const n = Math.max(2, Math.min(5, review?.crew.length ?? 4))
  const gap = W / (n + 1)
  for (let i = 0; i < n; i++) {
    const x = gap * (i + 1), bob = (i % 2) * 10, y = 190 + bob
    const shirt = SHIRTS[(i + room.id.length) % SHIRTS.length]
    s += `<path d="M${f(x - 30)} 340L${f(x - 26)} ${f(y + 34)}Q${f(x)} ${f(y + 18)} ${f(x + 26)} ${f(y + 34)}L${f(x + 30)} 340Z" fill="${shirt}"/>`
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="24" fill="${SKIN[(i * 3 + room.id.length) % SKIN.length]}"/>`
    s += `<path d="M${f(x - 25)} ${f(y - 2)}Q${f(x - 22)} ${f(y - 30)} ${f(x)} ${f(y - 27)}Q${f(x + 24)} ${f(y - 30)} ${f(x + 25)} ${f(y - 2)}Q${f(x + 8)} ${f(y - 16)} ${f(x - 25)} ${f(y - 2)}Z" fill="${HAIR[(i + 2) % HAIR.length]}"/>`
    s += face(x, y + 2, 0.9)
    if (i === 0 || i === n - 1) {
      const side = i === 0 ? -1 : 1
      s += `<path d="M${f(x + side * 24)} ${f(y + 40)}L${f(x + side * 40)} ${f(y - 4)}" stroke="${shirt}" stroke-width="11" stroke-linecap="round"/><circle cx="${f(x + side * 41)}" cy="${f(y - 8)}" r="6.5" fill="${SKIN[(i * 3 + room.id.length) % SKIN.length]}"/>`
    }
  }
  const escaped = review?.escaped ?? true
  const t = review?.escapeTimeMinutes
  const label = escaped ? (t != null ? `ESCAPED ${t}:00` : 'WE ESCAPED!') : 'SO CLOSE!'
  s += `<g transform="rotate(-4 178 290)"><rect x="78" y="262" width="200" height="50" rx="6" fill="${PALETTE.paper}" stroke="${UI.ink}" stroke-width="3"/>`
  s += `<text x="178" y="296" text-anchor="middle" font-family="'Fredoka', 'Nunito', sans-serif" font-weight="bold" font-size="21" textLength="${label.length > 10 ? 176 : 150}" lengthAdjust="spacingAndGlyphs" fill="${escaped ? UI.good : UI.bad}">${esc(label)}</text></g>`
  if (escaped) s += confetti(rng, 36)
  return s
}

// ---------------------------------------------------------------------------
// Polaroid frame
// ---------------------------------------------------------------------------

function polaroid(inner: string, caption: string, tapeColor: string, rng: Rng): string {
  const tilt = f((rng() - 0.5) * 6)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 470" width="400" height="470">` +
    `<rect x="8" y="10" width="388" height="456" rx="6" fill="#3b2a26" opacity="0.18"/>` +
    `<rect x="4" y="4" width="388" height="456" rx="6" fill="${PALETTE.paper}" stroke="#e6d6bf" stroke-width="2"/>` +
    `<clipPath id="pic"><rect x="20" y="20" width="${W}" height="${H}" rx="2"/></clipPath>` +
    `<g clip-path="url(#pic)"><g transform="translate(20 20)">${inner}` +
    `<rect width="${W}" height="${H}" fill="none" stroke="#3b2a26" stroke-opacity="0.12" stroke-width="18"/></g></g>` +
    `<rect x="20" y="20" width="${W}" height="${H}" fill="none" stroke="#d9c6a8" stroke-width="1.5"/>` +
    `<text x="200" y="405" text-anchor="middle" font-family="'Caveat', 'Comic Sans MS', cursive" font-size="36" fill="${UI.ink}" transform="rotate(${tilt} 200 405)">${esc(caption)}</text>` +
    `<rect x="160" y="-8" width="80" height="28" fill="${tapeColor}" opacity="0.75" transform="rotate(-3 200 6)"/>` +
    `</svg>\n`
}

export function renderPhoto(room: Room, review: Review | undefined, n: number, caption: string): string {
  const rng = rngFor(`${room.id}-${n}`)
  const inner = n === 1 ? (SCENES[room.id] ?? GENRE_SCENES[room.genre] ?? attic)(rng, room.genre) : crewPhoto(rng, room, review)
  return polaroid(inner, caption, GENRE_COLORS[room.genre] ?? GENRE_COLORS.other, rng)
}

function main() {
  const data = DatasetSchema.parse(JSON.parse(readFileSync(path.resolve(here, 'reviews.json'), 'utf8')))
  mkdirSync(OUT, { recursive: true })
  for (const room of data.rooms) {
    const review = data.reviews.find((r) => r.roomId === room.id)
    for (const photo of room.photos) {
      const m = /\/seed\/photos\/(.+)-(\d+)\.svg$/.exec(photo.url)
      if (!m || m[1] !== room.id) continue
      const svg = renderPhoto(room, review, Number(m[2]), photo.caption ?? room.name)
      const file = path.join(OUT, `${m[1]}-${m[2]}.svg`)
      writeFileSync(file, svg)
      console.log(`${path.relative(process.cwd(), file)}  ${(svg.length / 1024).toFixed(1)} KB`)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
