/**
 * Pure, seeded puzzle-variation generators for the daily gate.
 * Each generator takes a seed string (and a little context) and returns a
 * Challenge: prompt, render data, the answer, an answer checker and hints.
 */
import { createRng, type Rng } from './rng'

export const GENERATOR_KINDS = ['lock', 'cipher', 'sequence', 'search', 'recall'] as const
export type GeneratorKind = (typeof GENERATOR_KINDS)[number]

export type AnswerInput = string | string[]

export interface Choice {
  id: string
  label: string
  /** Optional token for visual choices (sequence shapes). */
  token?: ShapeToken
}

interface ChallengeBase<K extends GeneratorKind, D> {
  kind: K
  /** Short mechanic name shown as a chip. */
  title: string
  prompt: string
  /** How the player answers. */
  input: 'text' | 'choice' | 'targets'
  /** Keyboard hint for text inputs. */
  inputMode?: 'numeric' | 'text'
  choices?: Choice[]
  data: D
  /** The correct answer: a string for text/choice, the list of target ids for targets. */
  answer: string | string[]
  check(input: AnswerInput): boolean
  /** Progressive hints, gentlest first, last one nearly gives it away. */
  hints: string[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Uppercase, strip spaces/punctuation. */
export function normalizeAnswer(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const textCheck = (answer: string) => (input: AnswerInput) =>
  typeof input === 'string' && normalizeAnswer(input) === normalizeAnswer(answer)

// ---------------------------------------------------------------------------
// 1. Combination lock
// ---------------------------------------------------------------------------

export const ICONS = ['candle', 'mug', 'book', 'leaf', 'star'] as const
export type IconName = (typeof ICONS)[number]
const ICON_PLURAL: Record<IconName, string> = { candle: 'candles', mug: 'mugs', book: 'books', leaf: 'leaves', star: 'stars' }

export type LockClue =
  | { type: 'count'; text: string; icon: IconName; count: number; digit: number }
  | { type: 'arith'; text: string; digit: number }
  | { type: 'clock'; text: string; hour: number; minute: number; digit: number }

export type LockChallenge = ChallengeBase<'lock', { digits: number; clues: LockClue[] }>

function lockClue(rng: Rng, used: Set<string>): LockClue {
  const types = rng.shuffle(['count', 'arith', 'clock'] as const)
  // Avoid repeating the same clue type twice in a row when possible.
  const type = types.find((t) => !used.has(t)) ?? types[0]
  used.clear()
  used.add(type)
  if (type === 'count') {
    const icon = rng.pick(ICONS)
    const variant = rng.int(0, 2)
    if (variant === 0) {
      const count = rng.int(2, 9)
      return { type, icon, count, digit: count, text: `Count the ${ICON_PLURAL[icon]}` }
    }
    if (variant === 1) {
      const count = rng.int(1, 4)
      return { type, icon, count, digit: count * 2, text: `The number of ${ICON_PLURAL[icon]} × 2` }
    }
    const count = rng.int(1, 5)
    const plus = rng.int(1, 9 - count)
    return { type, icon, count, digit: count + plus, text: `The number of ${ICON_PLURAL[icon]} + ${plus}` }
  }
  if (type === 'arith') {
    const variant = rng.int(0, 3)
    if (variant === 0) {
      const d = rng.int(1, 9)
      return { type, digit: d, text: `Half of ${d * 2}` }
    }
    if (variant === 1) {
      const a = rng.int(1, 6)
      const d = rng.int(a + 1, 9)
      return { type, digit: d, text: `I am ${d - a} more than ${a}` }
    }
    if (variant === 2) {
      const d = rng.int(0, 7)
      const b = rng.int(1, 9 - d)
      return { type, digit: d, text: `${d + b} take away ${b}` }
    }
    const a = rng.int(1, 3)
    const b = rng.int(1, Math.floor(9 / a))
    return { type, digit: a * b, text: `${a} cup${a > 1 ? 's' : ''} of tea, ${b} sugar${b > 1 ? 's' : ''} each: how many sugars?` }
  }
  const hour = rng.int(1, 9)
  const minute = rng.pick([0, 15, 30, 45])
  return { type: 'clock', hour, minute, digit: hour, text: 'The hour on the clock' }
}

export function generateLock(seed: string): LockChallenge {
  const rng = createRng(`lock:${seed}`)
  const digits = rng.int(3, 4)
  const used = new Set<string>()
  const clues = Array.from({ length: digits }, () => lockClue(rng, used))
  const code = clues.map((c) => c.digit).join('')
  return {
    kind: 'lock',
    title: 'Combination lock',
    prompt: `Dial the ${digits}-digit code. Each clue gives one digit, left to right.`,
    input: 'text',
    inputMode: 'numeric',
    data: { digits, clues },
    answer: code,
    check: textCheck(code),
    hints: [
      'Solve the clues in order: clue 1 is the first digit.',
      `The first digit is ${code[0]}.`,
      `The code starts ${code.slice(0, digits - 1)}…`,
    ],
  }
}

// ---------------------------------------------------------------------------
// 2. Symbol cipher
// ---------------------------------------------------------------------------

export const COZY_WORDS: Array<{ word: string; clue: string }> = [
  { word: 'TEA', clue: 'you sip it from a mug' },
  { word: 'COCOA', clue: 'a warm chocolatey drink' },
  { word: 'QUILT', clue: 'a patchwork blanket' },
  { word: 'CANDLE', clue: 'it flickers on the shelf' },
  { word: 'BOOK', clue: 'it has pages' },
  { word: 'PLANT', clue: 'it needs watering' },
  { word: 'SOCKS', clue: 'woolly things for your feet' },
  { word: 'LAMP', clue: 'it glows orange in the corner' },
  { word: 'CLUE', clue: 'what every escape room is full of' },
  { word: 'KEY', clue: 'it opens a lock' },
  { word: 'PILLOW', clue: 'soft, for your head' },
  { word: 'BISCUIT', clue: 'dunk it in your tea' },
  { word: 'SLIPPERS', clue: 'indoor shoes' },
  { word: 'KETTLE', clue: 'it whistles when it boils' },
  { word: 'MITTENS', clue: 'gloves without fingers' },
  { word: 'PUZZLE', clue: 'what you are doing right now' },
  { word: 'HAMMOCK', clue: 'a swinging bed' },
  { word: 'MUFFIN', clue: 'a little cake' },
]

export const CIPHER_SYMBOLS = ['★', '☾', '♣', '♦', '♥', '♠', '☀', '✿', '❄', '☂', '♫', '⚓', '✦', '◆', '●', '▲', '■', '✚', '☘', '♜', '☁', '✈', '⌘', '☼'] as const

export type CipherChallenge = ChallengeBase<
  'cipher',
  { key: Array<{ symbol: string; letter: string }>; encoded: string[]; length: number }
>

export function generateCipher(seed: string): CipherChallenge {
  const rng = createRng(`cipher:${seed}`)
  const entry = rng.pick(COZY_WORDS)
  const word = entry.word
  const letters = [...new Set(word.split(''))]
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !letters.includes(l))
  const decoys = rng.shuffle(alphabet).slice(0, Math.max(3, 9 - letters.length))
  const symbols = rng.shuffle(CIPHER_SYMBOLS)
  const keyLetters = [...letters, ...decoys]
  const map = new Map(keyLetters.map((l, i) => [l, symbols[i]]))
  const key = rng.shuffle(keyLetters.map((letter) => ({ symbol: map.get(letter)!, letter })))
  const encoded = word.split('').map((l) => map.get(l)!)
  return {
    kind: 'cipher',
    title: 'Symbol cipher',
    prompt: 'Use the key to decode the word written in symbols.',
    input: 'text',
    inputMode: 'text',
    data: { key, encoded, length: word.length },
    answer: word,
    check: textCheck(word),
    hints: [
      `It's something cozy: ${entry.clue}.`,
      `It starts with "${word[0]}".`,
      `${word.length} letters: ${word
        .split('')
        .map((l, i) => (i === 0 || i === word.length - 1 ? l : '_'))
        .join(' ')}`,
    ],
  }
}

// ---------------------------------------------------------------------------
// 3. Sequence / logic
// ---------------------------------------------------------------------------

export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star'] as const
export type ShapeName = (typeof SHAPES)[number]
export const SHAPE_COLORS = [
  { name: 'orange', hex: '#e07b39' },
  { name: 'teal', hex: '#2f8f8a' },
  { name: 'plum', hex: '#6d3b5c' },
  { name: 'gold', hex: '#d4a24c' },
] as const
export interface ShapeToken {
  shape: ShapeName
  color: string
  colorName: string
}
const tokenId = (t: ShapeToken) => `${t.colorName}-${t.shape}`

export type SequenceChallenge = ChallengeBase<
  'sequence',
  { mode: 'number'; items: string[]; rule: string } | { mode: 'shape'; items: ShapeToken[]; rule: string }
>

function numberSequence(rng: Rng): { items: number[]; next: number; rule: string; gentle: string } {
  const variant = rng.int(0, 4)
  if (variant === 0) {
    const a = rng.int(1, 20)
    const d = rng.int(2, 9)
    const items = Array.from({ length: 5 }, (_, i) => a + i * d)
    return { items, next: a + 5 * d, rule: `Each step adds ${d}.`, gentle: 'Look at the gap between neighbours.' }
  }
  if (variant === 1) {
    const a = rng.int(10, 30)
    const up = rng.int(3, 9)
    let down = rng.int(1, 5)
    if (down === up) down = up - 1
    const items = [a]
    for (let i = 1; i < 6; i++) items.push(items[i - 1] + (i % 2 === 1 ? up : -down))
    const next = items[5] - down // index 6 is even: a "down" step
    return { items, next, rule: `It alternates: +${up}, then −${down}.`, gentle: 'Two different steps take turns.' }
  }
  if (variant === 2) {
    const start = rng.int(1, 5)
    const off = rng.int(0, 3)
    const items = Array.from({ length: 5 }, (_, i) => (start + i) ** 2 + off)
    const next = (start + 5) ** 2 + off
    return {
      items,
      next,
      rule: off ? `Square numbers plus ${off}: ${start}²+${off}, ${start + 1}²+${off}…` : `Square numbers: ${start}², ${start + 1}², ${start + 2}²…`,
      gentle: 'Think of numbers multiplied by themselves.',
    }
  }
  if (variant === 3) {
    const a = rng.int(1, 5)
    const m = rng.pick([2, 3])
    const items = Array.from({ length: 5 }, (_, i) => a * m ** i)
    return { items, next: a * m ** 5, rule: `Each number is ${m === 2 ? 'doubled' : 'tripled'}.`, gentle: 'The gaps grow fast: try multiplying.' }
  }
  const a = rng.int(1, 4)
  const b = rng.int(a, a + 4)
  const items = [a, b]
  while (items.length < 6) items.push(items[items.length - 1] + items[items.length - 2])
  return {
    items,
    next: items[4] + items[5],
    rule: 'Each number is the sum of the two before it.',
    gentle: 'Look at the two numbers just before each one.',
  }
}

export function generateSequence(seed: string): SequenceChallenge {
  const rng = createRng(`sequence:${seed}`)
  if (rng.chance(0.55)) {
    const s = numberSequence(rng)
    const answer = String(s.next)
    return {
      kind: 'sequence',
      title: 'Number sequence',
      prompt: 'What number comes next?',
      input: 'text',
      inputMode: 'numeric',
      data: { mode: 'number', items: s.items.map(String), rule: s.rule },
      answer,
      check: textCheck(answer),
      hints: [s.gentle, s.rule, `The answer has ${answer.length} digit${answer.length > 1 ? 's' : ''} and ends in ${answer[answer.length - 1]}.`],
    }
  }
  // Colour + shape pattern with a repeating period.
  const period = rng.int(2, 4)
  const shapes = rng.shuffle(SHAPES).slice(0, period)
  const colors = rng.shuffle(SHAPE_COLORS)
  // Colours cycle on a different period to make it a little trickier.
  const colorPeriod = period === 2 ? 3 : 2
  const tokenAt = (i: number): ShapeToken => {
    const c = colors[i % colorPeriod]
    return { shape: shapes[i % period], color: c.hex, colorName: c.name }
  }
  const length = Math.max(6, period * 2 + 1)
  const items = Array.from({ length }, (_, i) => tokenAt(i))
  const correct = tokenAt(length)
  const decoyPool: ShapeToken[] = []
  for (const sh of SHAPES)
    for (const c of SHAPE_COLORS.slice(0, 3)) {
      const t = { shape: sh, color: c.hex, colorName: c.name }
      if (tokenId(t) !== tokenId(correct)) decoyPool.push(t)
    }
  // Prefer decoys that share either shape or colour with the answer.
  const close = rng.shuffle(decoyPool.filter((t) => t.shape === correct.shape || t.colorName === correct.colorName))
  const options = rng.shuffle([correct, ...close.slice(0, 3)])
  const answer = tokenId(correct)
  return {
    kind: 'sequence',
    title: 'Pattern logic',
    prompt: 'Which tile comes next in the pattern?',
    input: 'choice',
    choices: options.map((t) => ({ id: tokenId(t), label: `${t.colorName} ${t.shape}`, token: t })),
    data: { mode: 'shape', items, rule: `Shapes repeat every ${period}, colours every ${colorPeriod}.` },
    answer,
    check: (input) => typeof input === 'string' && input === answer,
    hints: [
      'Track shapes and colours separately.',
      `Shapes repeat every ${period}; colours repeat every ${colorPeriod}.`,
      `The next one is ${correct.colorName}.`,
    ],
  }
}

// ---------------------------------------------------------------------------
// 4. Search-the-image
// ---------------------------------------------------------------------------

export const SEARCH_W = 400
export const SEARCH_H = 260
export const SEARCH_SYMBOLS = ['key', 'star', 'heart'] as const
export type SearchSymbol = (typeof SEARCH_SYMBOLS)[number]

export type ClutterKind = 'book' | 'plant' | 'mug' | 'frame' | 'yarn' | 'candle'
export interface ClutterItem {
  kind: ClutterKind
  x: number
  y: number
  scale: number
  color: string
  /** Extra seeded variation (book height, frame art...). */
  v: number
}
export interface SearchTarget {
  id: string
  x: number
  y: number
  rotation: number
  scale: number
}

export type SearchChallenge = ChallengeBase<
  'search',
  { width: number; height: number; symbol: SearchSymbol; clutter: ClutterItem[]; targets: SearchTarget[]; shelves: number[] }
>

const CLUTTER_COLORS = ['#e07b39', '#2f8f8a', '#6d3b5c', '#d4a24c', '#c4513f', '#5a9a4b', '#efe0c8', '#5b5fa8']

export function regionName(x: number, y: number, w = SEARCH_W, h = SEARCH_H): string {
  const v = y < h / 3 ? 'top' : y > (2 * h) / 3 ? 'bottom' : 'middle'
  const hz = x < w / 3 ? 'left' : x > (2 * w) / 3 ? 'right' : 'centre'
  return v === 'middle' && hz === 'centre' ? 'centre' : `${v}-${hz}`
}

export function generateSearch(seed: string): SearchChallenge {
  const rng = createRng(`search:${seed}`)
  const symbol = rng.pick(SEARCH_SYMBOLS)
  const shelves = [rng.int(70, 85), rng.int(140, 155)]
  const clutter: ClutterItem[] = []
  // Books / mugs / plants / candles on the shelves.
  for (const shelfY of shelves) {
    let x = rng.int(10, 30)
    while (x < SEARCH_W - 30) {
      const kind = rng.pick(['book', 'book', 'book', 'mug', 'plant', 'candle'] as const)
      clutter.push({ kind, x, y: shelfY, scale: 0.8 + rng.next() * 0.5, color: rng.pick(CLUTTER_COLORS), v: rng.next() })
      x += kind === 'book' ? rng.int(10, 16) : rng.int(26, 40)
      if (rng.chance(0.15)) x += rng.int(10, 30)
    }
  }
  // Frames on the wall.
  for (let i = 0; i < 3; i++)
    clutter.push({ kind: 'frame', x: 40 + i * 120 + rng.int(-15, 15), y: rng.int(18, 30), scale: 0.8 + rng.next() * 0.4, color: rng.pick(CLUTTER_COLORS), v: rng.next() })
  // Floor stuff.
  for (let i = 0; i < 5; i++) {
    const kind = rng.pick(['plant', 'yarn', 'book', 'mug'] as const)
    clutter.push({ kind, x: rng.int(20, SEARCH_W - 20), y: rng.int(225, 250), scale: 1 + rng.next() * 0.5, color: rng.pick(CLUTTER_COLORS), v: rng.next() })
  }
  clutter.sort((a, b) => a.y - b.y)

  const count = rng.int(3, 5)
  const targets: SearchTarget[] = []
  let guard = 0
  while (targets.length < count && guard++ < 500) {
    const x = rng.int(20, SEARCH_W - 20)
    const y = rng.int(20, SEARCH_H - 15)
    if (targets.some((t) => Math.hypot(t.x - x, t.y - y) < 60)) continue
    targets.push({ id: String(targets.length), x, y, rotation: rng.int(-40, 40), scale: 0.7 + rng.next() * 0.3 })
  }
  const answer = targets.map((t) => t.id)
  const name = symbol === 'key' ? 'keys' : symbol === 'star' ? 'stars' : 'hearts'
  const regions = [...new Set(targets.map((t) => regionName(t.x, t.y)))]
  return {
    kind: 'search',
    title: 'Search the room',
    prompt: `Find all ${targets.length} little brass ${name} hidden in the clutter. Tap each one.`,
    input: 'targets',
    data: { width: SEARCH_W, height: SEARCH_H, symbol, clutter, targets, shelves },
    answer,
    check: (input) => Array.isArray(input) && answer.every((id) => input.includes(id)),
    hints: [
      `They are small and brass coloured, about the size of a fingertip.`,
      `One hides near the ${regionName(targets[0].x, targets[0].y)}.`,
      `Look around: ${regions.join(', ')}.`,
    ],
  }
}

// ---------------------------------------------------------------------------
// 5. Recall question (fallback / variety)
// ---------------------------------------------------------------------------

export interface RecallRoom {
  id: string
  name: string
  city: string
  genre: string
  company: string
}

export type RecallChallenge = ChallengeBase<'recall', { description: string; correctRoomId: string }>

export function generateRecall(seed: string, ctx: { description: string; room: RecallRoom; rooms: RecallRoom[] }): RecallChallenge {
  const rng = createRng(`recall:${seed}`)
  const others = rng.shuffle(ctx.rooms.filter((r) => r.id !== ctx.room.id && r.name !== ctx.room.name))
  const seen = new Set<string>([ctx.room.name])
  const decoys: RecallRoom[] = []
  for (const r of others) {
    if (decoys.length >= 3) break
    if (seen.has(r.name)) continue
    seen.add(r.name)
    decoys.push(r)
  }
  const options = rng.shuffle([ctx.room, ...decoys])
  return {
    kind: 'recall',
    title: 'Memory recall',
    prompt: 'Which room had this puzzle?',
    input: 'choice',
    choices: options.map((r) => ({ id: r.id, label: r.name })),
    data: { description: ctx.description, correctRoomId: ctx.room.id },
    answer: ctx.room.id,
    check: (input) => typeof input === 'string' && input === ctx.room.id,
    hints: [`It was a ${ctx.room.genre} room.`, `It was in ${ctx.room.city}.`, `It was run by ${ctx.room.company}.`],
  }
}

export type Challenge = LockChallenge | CipherChallenge | SequenceChallenge | SearchChallenge | RecallChallenge
