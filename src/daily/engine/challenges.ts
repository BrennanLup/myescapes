/**
 * Escape of the Day challenges (workstream 21). Each one turns a seed into a puzzle with a fixed
 * number of slots, answered Wordle-style: every guess fills all the slots and gets one mark per
 * slot (`hit` right in the right place, `close` nearly, `miss`). Reuses the Phase 1 generators in
 * src/gate for the clue content. Pure, no React.
 */
import {
  generateCipher,
  generateLock,
  generateSearch,
  normalizeAnswer,
  SHAPE_COLORS,
  SHAPES,
  type CipherChallenge,
  type LockClue,
  type SearchChallenge,
  type ShapeToken,
} from '../../gate/generators'
import { createRng, type Rng } from '../../gate/rng'

export type DailyGuessMark = 'hit' | 'close' | 'miss'

interface Base {
  /** Short mechanic name shown as a chip. */
  title: string
  prompt: string
  /** Number of slots per guess (one mark each). */
  slots: number
  /** The answer, one entry per slot. */
  answer: string[]
  /** Progressive hints, gentlest first. Each one costs points. */
  hints: string[]
  /** One mark per slot. A guess of the wrong length is all misses. */
  check(guess: readonly string[]): DailyGuessMark[]
}

export interface CombinationChallenge extends Base {
  kind: 'combination'
  data: { clues: LockClue[] }
}

export interface CipherDailyChallenge extends Base {
  kind: 'cipher'
  data: {
    /** Symbols of the hidden word, in order. */
    encoded: string[]
    /** The key, minus the symbols the player has to work out. */
    key: Array<{ symbol: string; letter: string }>
    /** Symbols that appear in the word but are missing from the key. */
    missing: string[]
  }
}

export type SequenceItem = { kind: 'number'; value: string } | { kind: 'shape'; token: ShapeToken; id: string }

export interface SequenceDailyChallenge extends Base {
  kind: 'sequence'
  data:
    | { mode: 'number'; shown: string[]; rule: string }
    | { mode: 'shape'; shown: Array<ShapeToken & { id: string }>; choices: Array<ShapeToken & { id: string }>; rule: string }
}

export interface SearchDailyChallenge extends Base {
  kind: 'search'
  /** The Phase 1 search scene (targets included) for the SVG renderer. */
  scene: SearchChallenge
  data: { symbol: SearchChallenge['data']['symbol']; count: number }
}

export type DailyChallenge = CombinationChallenge | CipherDailyChallenge | SequenceDailyChallenge | SearchDailyChallenge

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

/**
 * Wordle marking: exact matches first, then each remaining guess symbol is `close` if the answer
 * still has an unmatched copy of it. Duplicates are handled like Wordle.
 */
export function wordleMarks(guess: readonly string[], answer: readonly string[]): DailyGuessMark[] {
  if (guess.length !== answer.length) return answer.map(() => 'miss')
  const marks: DailyGuessMark[] = answer.map(() => 'miss')
  const left = new Map<string, number>()
  answer.forEach((a, i) => {
    if (guess[i] === a) marks[i] = 'hit'
    else left.set(a, (left.get(a) ?? 0) + 1)
  })
  guess.forEach((g, i) => {
    if (marks[i] === 'hit') return
    const n = left.get(g) ?? 0
    if (n > 0) {
      marks[i] = 'close'
      left.set(g, n - 1)
    }
  })
  return marks
}

export const allHit = (marks: readonly string[]) => marks.length > 0 && marks.every((m) => m === 'hit')

// ---------------------------------------------------------------------------
// 1. Combination lock
// ---------------------------------------------------------------------------

export function combinationChallenge(seed: string): CombinationChallenge {
  const lock = generateLock(seed)
  const answer = String(lock.answer).split('')
  return {
    kind: 'combination',
    title: 'Combination lock',
    prompt: `Crack the ${answer.length}-digit code. Each clue gives one digit, left to right. Green: right digit, right place. Gold: in the code, somewhere else.`,
    slots: answer.length,
    answer,
    hints: lock.hints,
    data: { clues: lock.data.clues },
    check: (guess) => wordleMarks(guess.map((g) => g.trim()), answer),
  }
}

// ---------------------------------------------------------------------------
// 2. Symbol cipher with gaps in the key
// ---------------------------------------------------------------------------

export function cipherChallenge(seed: string): CipherDailyChallenge {
  const base: CipherChallenge = generateCipher(seed)
  const rng = createRng(`eotd-cipher:${seed}`)
  const word = String(base.answer)
  const answer = word.split('')
  const distinct = [...new Set(answer)]
  const hideCount = distinct.length <= 3 ? 1 : 2
  const hiddenLetters = new Set(rng.shuffle(distinct).slice(0, hideCount))
  const missing = base.data.key.filter((k) => hiddenLetters.has(k.letter)).map((k) => k.symbol)
  return {
    kind: 'cipher',
    title: 'Symbol cipher',
    prompt: `Decode the ${answer.length}-letter word. ${hideCount === 1 ? 'One symbol is' : 'Two symbols are'} missing from the key, so you'll have to guess. Green: right letter, right place. Gold: in the word, somewhere else.`,
    slots: answer.length,
    answer,
    hints: base.hints,
    data: { encoded: base.data.encoded, key: base.data.key.filter((k) => !hiddenLetters.has(k.letter)), missing },
    check: (guess) => wordleMarks(guess.map((g) => normalizeAnswer(g)), answer),
  }
}

// ---------------------------------------------------------------------------
// 3. Sequence: fill the next three
// ---------------------------------------------------------------------------

const SEQ_SHOWN = 4
const SEQ_SLOTS = 3

function numberRun(rng: Rng): { terms: number[]; rule: string; gentle: string } {
  const n = SEQ_SHOWN + SEQ_SLOTS
  const variant = rng.int(0, 4)
  if (variant === 0) {
    const a = rng.int(1, 20)
    const d = rng.int(2, 9)
    return { terms: Array.from({ length: n }, (_, i) => a + i * d), rule: `Each step adds ${d}.`, gentle: 'Look at the gap between neighbours.' }
  }
  if (variant === 1) {
    const a = rng.int(10, 30)
    const up = rng.int(3, 9)
    const down = rng.int(1, up - 1)
    const terms = [a]
    for (let i = 1; i < n; i++) terms.push(terms[i - 1] + (i % 2 === 1 ? up : -down))
    return { terms, rule: `It alternates: +${up}, then −${down}.`, gentle: 'Two different steps take turns.' }
  }
  if (variant === 2) {
    const start = rng.int(1, 4)
    const off = rng.int(0, 3)
    return {
      terms: Array.from({ length: n }, (_, i) => (start + i) ** 2 + off),
      rule: off ? `Square numbers plus ${off}.` : 'Square numbers.',
      gentle: 'Think of numbers multiplied by themselves.',
    }
  }
  if (variant === 3) {
    const a = rng.int(1, 3)
    return { terms: Array.from({ length: n }, (_, i) => a * 2 ** i), rule: 'Each number is doubled.', gentle: 'The gaps grow fast: try multiplying.' }
  }
  const a = rng.int(1, 3)
  const b = rng.int(a, a + 3)
  const terms = [a, b]
  while (terms.length < n) terms.push(terms[terms.length - 1] + terms[terms.length - 2])
  return { terms, rule: 'Each number is the sum of the two before it.', gentle: 'Look at the two numbers just before each one.' }
}

const tokenId = (t: ShapeToken) => `${t.colorName}-${t.shape}`

export function sequenceChallenge(seed: string): SequenceDailyChallenge {
  const rng = createRng(`eotd-sequence:${seed}`)
  if (rng.chance(0.6)) {
    const run = numberRun(rng)
    const shown = run.terms.slice(0, SEQ_SHOWN).map(String)
    const answer = run.terms.slice(SEQ_SHOWN).map(String)
    return {
      kind: 'sequence',
      title: 'Number sequence',
      prompt: 'What are the next three numbers? Green: exactly right. Gold: close (within 10%).',
      slots: SEQ_SLOTS,
      answer,
      hints: [run.gentle, run.rule, `The next number is ${answer[0]}.`],
      data: { mode: 'number', shown, rule: run.rule },
      check: (guess) => {
        if (guess.length !== answer.length) return answer.map(() => 'miss')
        return answer.map((a, i) => {
          const g = Number(String(guess[i]).trim())
          const want = Number(a)
          if (!Number.isFinite(g) || String(guess[i]).trim() === '') return 'miss'
          if (g === want) return 'hit'
          return Math.abs(g - want) <= Math.max(2, Math.round(Math.abs(want) * 0.1)) ? 'close' : 'miss'
        })
      },
    }
  }
  const period = rng.int(2, 4)
  const shapes = rng.shuffle(SHAPES).slice(0, period)
  const colors = rng.shuffle(SHAPE_COLORS)
  const colorPeriod = period === 2 ? 3 : 2
  const tokenAt = (i: number): ShapeToken & { id: string } => {
    const c = colors[i % colorPeriod]
    const t = { shape: shapes[i % period], color: c.hex, colorName: c.name }
    return { ...t, id: tokenId(t) }
  }
  const shownLen = Math.max(6, period * 2 + 1)
  const shown = Array.from({ length: shownLen }, (_, i) => tokenAt(i))
  const next = Array.from({ length: SEQ_SLOTS }, (_, i) => tokenAt(shownLen + i))
  const pool = new Map<string, ShapeToken & { id: string }>()
  for (const t of [...shown, ...next]) pool.set(t.id, t)
  // A few decoys sharing a shape or a colour with the sequence.
  const decoys = rng.shuffle(
    SHAPES.flatMap((sh) => colors.slice(0, colorPeriod + 1).map((c) => ({ shape: sh, color: c.hex, colorName: c.name }))),
  )
  for (const d of decoys) {
    if (pool.size >= 8) break
    pool.set(tokenId(d), { ...d, id: tokenId(d) })
  }
  const choices = rng.shuffle([...pool.values()])
  const answer = next.map((t) => t.id)
  const byId = new Map(choices.map((c) => [c.id, c]))
  return {
    kind: 'sequence',
    title: 'Pattern logic',
    prompt: 'Which three tiles come next? Green: exactly right. Gold: right shape or right colour.',
    slots: SEQ_SLOTS,
    answer,
    hints: ['Track shapes and colours separately.', `Shapes repeat every ${period}; colours repeat every ${colorPeriod}.`, `The next tile is the ${next[0].colorName} ${next[0].shape}.`],
    data: { mode: 'shape', shown, choices, rule: `Shapes repeat every ${period}, colours every ${colorPeriod}.` },
    check: (guess) => {
      if (guess.length !== answer.length) return answer.map(() => 'miss')
      return answer.map((a, i) => {
        if (guess[i] === a) return 'hit'
        const g = byId.get(guess[i])
        const want = byId.get(a)
        if (g && want && (g.shape === want.shape || g.colorName === want.colorName)) return 'close'
        return 'miss'
      })
    },
  }
}

// ---------------------------------------------------------------------------
// 4. Search the room
// ---------------------------------------------------------------------------

/**
 * A guess is one round of taps: the ids found so far plus one tap per remaining target
 * (an empty string for a tap that hit nothing). Each distinct target id is a `hit`.
 */
export function searchChallenge(seed: string): SearchDailyChallenge {
  const scene = generateSearch(seed)
  const ids = scene.data.targets.map((t) => t.id)
  const name = scene.data.symbol === 'key' ? 'keys' : scene.data.symbol === 'star' ? 'stars' : 'hearts'
  return {
    kind: 'search',
    title: 'Search the room',
    prompt: `Find all ${ids.length} little brass ${name}. Each round you get ${ids.length} taps; the ones you find stay found.`,
    slots: ids.length,
    answer: ids,
    hints: scene.hints,
    scene,
    data: { symbol: scene.data.symbol, count: ids.length },
    check: (guess) => {
      if (guess.length !== ids.length) return ids.map(() => 'miss')
      const seen = new Set<string>()
      return guess.map((g) => {
        if (ids.includes(g) && !seen.has(g)) {
          seen.add(g)
          return 'hit'
        }
        return 'miss'
      })
    },
  }
}
