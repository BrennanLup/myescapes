/**
 * Escape of the Day engine (workstream 21): deterministic generators seeded by the daily seed
 * (same puzzle for everyone), reusing the Phase 1 generators in src/gate. Pure, no React.
 * `localDay` and `dailyNumber` are implemented (shared with the server); `generateDaily` is a STUB.
 */
import { DAILY_EPOCH, type DailyKind, type DailyPuzzle } from '../../contracts/models'

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

export interface GeneratedDaily {
  kind: DailyKind
  /** Generator-specific puzzle data for the UI (22). */
  data: unknown
  /** Checks a guess; returns one mark per position. */
  check(guess: unknown): ('hit' | 'close' | 'miss')[]
}

export function generateDaily(_puzzle: DailyPuzzle): GeneratedDaily {
  throw new Error('Escape of the Day generators are not built yet (workstream 21).')
}
