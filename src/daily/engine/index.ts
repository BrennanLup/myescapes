/**
 * Escape of the Day engine (workstream 21): deterministic generators seeded by the date (the same
 * puzzle for everyone), reusing the Phase 1 generators in src/gate. Pure, no React. Shared by the
 * server (which day, which kind, scoring) and the client (rendering and marking guesses).
 */
import { DAILY_EPOCH, DAILY_KINDS, type DailyKind, type DailyPuzzle } from '../../contracts/models'
import { createRng } from '../../gate/rng'
import { cipherChallenge, combinationChallenge, searchChallenge, sequenceChallenge, type DailyChallenge, type DailyGuessMark } from './challenges'

export * from './challenges'

/** The calendar day `YYYY-MM-DD` in an IANA time zone (falls back to UTC for an unknown zone). */
export function localDay(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** "Escape #N": 1 on DAILY_EPOCH, counting up one per calendar day. */
export function dailyNumber(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DAILY_EPOCH}T00:00:00Z`)
  return Math.floor(ms / 86_400_000) + 1
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** A valid IANA time zone name in canonical form, or null. */
export function normalizeTimeZone(tz: string | null | undefined): string | null {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** The browser's time zone (UTC when unknown). */
export function browserTimeZone(): string {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The first instant at which `day` has begun in `timeZone` (local midnight, or the first moment
 * after it for zones whose clocks skip midnight). Found by bisection, so it needs no tz database.
 */
export function startOfDay(day: string, timeZone: string): Date {
  // Local midnight lies within UTC-14h..UTC+12h of UTC midnight; search a 30 h window.
  let lo = Date.parse(`${day}T00:00:00Z`) - 15 * 3600_000
  let hi = Date.parse(`${day}T00:00:00Z`) + 15 * 3600_000
  if (localDay(timeZone, new Date(lo)) >= day) return new Date(lo)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (localDay(timeZone, new Date(mid)) >= day) hi = mid
    else lo = mid
  }
  return new Date(hi)
}

export const DAILY_MAX_GUESSES = 6

/** Seed for a day: the same everywhere. */
export function dailySeed(day: string): string {
  return `eotd:${day}`
}

/**
 * Which generator runs on a day. Kinds cycle in blocks of four, each block shuffled by its own
 * seed, so every kind appears once every four days and the order still feels random.
 */
export function dailyKind(day: string): DailyKind {
  const n = Math.max(1, dailyNumber(day))
  const block = Math.floor((n - 1) / DAILY_KINDS.length)
  const order = createRng(`eotd-kinds:${block}`).shuffle(DAILY_KINDS)
  return order[(n - 1) % DAILY_KINDS.length]
}

/** Everything about a day's puzzle except its theme (the server picks that from the directory). */
export function dailySpec(day: string): Omit<DailyPuzzle, 'theme'> {
  return { day, number: dailyNumber(day), kind: dailyKind(day), seed: dailySeed(day), maxGuesses: DAILY_MAX_GUESSES }
}

export type GeneratedDaily = DailyChallenge

/** Builds the playable challenge for a puzzle. Deterministic in `kind` and `seed`. */
export function generateDaily(puzzle: Pick<DailyPuzzle, 'kind' | 'seed'>): GeneratedDaily {
  switch (puzzle.kind) {
    case 'combination':
      return combinationChallenge(puzzle.seed)
    case 'cipher':
      return cipherChallenge(puzzle.seed)
    case 'sequence':
      return sequenceChallenge(puzzle.seed)
    case 'search':
      return searchChallenge(puzzle.seed)
  }
}

// ---------------------------------------------------------------------------
// Scoring and sharing
// ---------------------------------------------------------------------------

export const SCORE = { base: 1000, perExtraGuess: 120, perHint: 150, freeSeconds: 30, maxTimePenalty: 300, floor: 100 } as const

/**
 * Points for a result: 1000 for a first-guess solve, minus 120 per extra guess, 150 per hint and
 * 1 per second after the first 30 (at most 300). A solve is worth at least 100; a fail is 0.
 */
export function scoreResult(r: { solved: boolean; guesses: number; hintsUsed: number; timeMs: number }): number {
  if (!r.solved) return 0
  const timePenalty = Math.min(SCORE.maxTimePenalty, Math.max(0, Math.floor(r.timeMs / 1000) - SCORE.freeSeconds))
  const raw = SCORE.base - Math.max(0, r.guesses - 1) * SCORE.perExtraGuess - r.hintsUsed * SCORE.perHint - timePenalty
  return Math.max(SCORE.floor, raw)
}

export type GridMark = DailyGuessMark | 'hint'

const EMOJI: Record<GridMark, string> = { hit: '🟩', close: '🟨', miss: '⬛', hint: '💡' }

/** `m:ss` (or `h:mm:ss`). */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Spoiler-free share text: number, outcome, time and an emoji grid (no answers, no theme). */
export function shareText(r: { number: number; solved: boolean; guesses: number; maxGuesses: number; hintsUsed: number; timeMs: number; grid: readonly (readonly GridMark[])[] }, url?: string): string {
  const head = `My Escapes · Escape #${r.number} ${r.solved ? '🔓' : '🔒'} ${r.solved ? r.guesses : 'X'}/${r.maxGuesses} · ${formatDuration(r.timeMs)}${r.hintsUsed ? ` · ${r.hintsUsed} hint${r.hintsUsed > 1 ? 's' : ''}` : ''}`
  const rows = r.grid.map((row) => row.map((m) => EMOJI[m] ?? '⬛').join(''))
  return [head, ...rows, ...(url ? [url] : [])].join('\n')
}

/**
 * Sanity checks for a submitted result, shared by the server and the client: the counts fit the
 * grid, and a solve ends with an all-hit guess. Returns a message, or null when it's consistent.
 */
export function validateResultShape(r: { solved: boolean; guesses: number; hintsUsed: number; grid: readonly (readonly string[])[] }, maxGuesses: number): string | null {
  if (r.guesses > maxGuesses) return `At most ${maxGuesses} guesses.`
  const guessRows = r.grid.filter((row) => !(row.length > 0 && row.every((m) => m === 'hint')))
  const hintRows = r.grid.length - guessRows.length
  if (guessRows.length !== r.guesses) return 'The grid must have one row per guess.'
  if (hintRows > r.hintsUsed) return 'The grid has more hint rows than hints used.'
  if (guessRows.some((row) => row.length === 0 || row.includes('hint'))) return 'Guess rows hold hit, close or miss marks.'
  if (r.solved) {
    const last = guessRows[guessRows.length - 1]
    if (!last || !last.every((m) => m === 'hit')) return 'A solved result ends with an all-hit guess.'
    if (guessRows.slice(0, -1).some((row) => row.every((m) => m === 'hit'))) return 'Play stops at the first all-hit guess.'
  } else if (guessRows.some((row) => row.every((m) => m === 'hit'))) {
    return 'A result with an all-hit guess is solved.'
  }
  // Unsolved with fewer than maxGuesses guesses means the player gave up: allowed.
  return null
}
