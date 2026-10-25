/**
 * Daily selection: which past puzzle inspires today's gate, and which generator
 * builds the variation. Pure functions of (data, date) so tests can pin them.
 */
import type { Puzzle, PuzzleType, Review, Room } from '@/contracts/types'
import { createRng } from './rng'
import {
  GENERATOR_KINDS,
  generateCipher,
  generateLock,
  generateRecall,
  generateSearch,
  generateSequence,
  type Challenge,
  type GeneratorKind,
} from './generators'

export const STORAGE_KEY = 'myescapes.gate.lastSolved'

/** Local calendar date as `YYYY-MM-DD`. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function readLastSolved(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function writeLastSolved(day: string) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, day)
  } catch {
    /* storage unavailable: the gate will just reappear next load */
  }
}

export function isSolvedToday(now: Date = new Date()): boolean {
  return readLastSolved() === todayKey(now)
}

export type GateMode = 'auto' | 'off' | 'force'

export interface GateUrlOptions {
  mode: GateMode
  forceKind: GeneratorKind | null
}

export function parseGateUrl(search: string): GateUrlOptions {
  const p = new URLSearchParams(search)
  const g = p.get('gate')
  const t = p.get('gateType')
  return {
    mode: g === 'off' ? 'off' : g === 'force' ? 'force' : 'auto',
    forceKind: t && (GENERATOR_KINDS as readonly string[]).includes(t) ? (t as GeneratorKind) : null,
  }
}

/** Should the gate auto-open on load? */
export function shouldAutoOpen(opts: { mode: GateMode; lastSolved: string | null; today: string }): boolean {
  if (opts.mode === 'off') return false
  if (opts.mode === 'force') return true
  return opts.lastSolved !== opts.today
}

export const GENERIC_PUZZLE: Puzzle = {
  id: 'generic',
  reviewId: 'generic',
  description: 'A brass padlock whose code was hidden in clues around the room',
  type: 'lock-and-key',
  memorable: true,
}

export interface GateSource {
  puzzle: Puzzle
  review: Review | null
  room: Room | null
  generic: boolean
}

/** Picks today's inspiring puzzle. Prefers memorable puzzles across all reviews. */
export function selectPuzzle(rooms: Room[], reviews: Review[], day: string): GateSource {
  const all: Array<{ puzzle: Puzzle; review: Review }> = []
  // Sort for stability regardless of load order.
  const sorted = [...reviews].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const review of sorted) for (const puzzle of review.puzzles) all.push({ puzzle, review })
  if (all.length === 0) return { puzzle: GENERIC_PUZZLE, review: null, room: null, generic: true }
  const memorable = all.filter((p) => p.puzzle.memorable)
  const pool = memorable.length ? memorable : all
  const rng = createRng(`select:${day}`)
  const chosen = pool[Math.floor(rng.next() * pool.length)]
  const room = rooms.find((r) => r.id === chosen.review.roomId) ?? null
  return { puzzle: chosen.puzzle, review: chosen.review, room, generic: false }
}

const TYPE_MAP: Record<PuzzleType, GeneratorKind[]> = {
  'lock-and-key': ['lock'],
  math: ['lock', 'sequence'],
  logic: ['cipher', 'sequence'],
  'audio-visual': ['cipher'],
  search: ['search'],
  physical: ['search'],
}

/** Maps a puzzle type to a generator (seeded), with an occasional recall question for variety. */
export function pickGenerator(type: string, day: string, canRecall: boolean): GeneratorKind {
  const rng = createRng(`kind:${day}:${type}`)
  const options = TYPE_MAP[type as PuzzleType]
  if (!options) return canRecall ? 'recall' : 'lock'
  if (canRecall && rng.chance(0.2)) return 'recall'
  return rng.pick(options)
}

export interface DailyGate {
  day: string
  source: GateSource
  challenge: Challenge
}

export function buildDailyGate(rooms: Room[], reviews: Review[], day: string, forceKind: GeneratorKind | null = null): DailyGate {
  const source = selectPuzzle(rooms, reviews, day)
  const distinctNames = new Set(rooms.map((r) => r.name))
  const canRecall = !!source.room && distinctNames.size >= 2
  let kind = forceKind ?? pickGenerator(source.puzzle.type, day, canRecall)
  if (kind === 'recall' && !canRecall) kind = 'lock'
  const seed = `${day}|${source.puzzle.id}`
  let challenge: Challenge
  switch (kind) {
    case 'lock':
      challenge = generateLock(seed)
      break
    case 'cipher':
      challenge = generateCipher(seed)
      break
    case 'sequence':
      challenge = generateSequence(seed)
      break
    case 'search':
      challenge = generateSearch(seed)
      break
    case 'recall':
      challenge = generateRecall(seed, { description: source.puzzle.description, room: source.room!, rooms })
      break
  }
  return { day, source, challenge }
}
