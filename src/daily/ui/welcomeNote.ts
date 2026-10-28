/**
 * The note the Escape of the Day puzzle room (/daily/room) leaves before it sends you home, and the
 * line both "welcome home" cards show. Store-free and three-free: the phone shell (/m) imports it.
 */
import { formatDuration } from '../engine'

export interface WelcomeNote {
  number: number
  solved: boolean
  guesses: number
  maxGuesses: number
  timeMs: number
  signedIn: boolean
  at: number
}

const KEY = 'myescapes.daily.welcome.v1'
/** A note older than this is stale (a reload much later should not celebrate again). */
const MAX_AGE_MS = 2 * 60_000

/** Where the exit door sends phones: `/m`, flagged so it shows the welcome card. */
export const MOBILE_FROM_DAILY_URL = '/m?from=daily'

/** True when the URL search carries the `from=daily` flag. */
export function isFromDaily(search: string): boolean {
  return new URLSearchParams(search ?? '').get('from') === 'daily'
}

let pending: WelcomeNote | null = null

/**
 * Set by the puzzle room's exit just before it navigates to the main room (a client-side
 * navigation, so memory is enough): the main room then skips its automatic "How to play" card,
 * which would cover the "welcome home" moment. A reload or a later visit shows it as usual.
 */
let arrivingFromDaily = false

export function markArrivingFromDaily(): void {
  arrivingFromDaily = true
}

/** True once after the puzzle room's exit; clears the flag. */
export function takeArrivingFromDaily(): boolean {
  const v = arrivingFromDaily
  arrivingFromDaily = false
  return v
}

export function leaveWelcomeNote(note: WelcomeNote): void {
  pending = note
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(note))
  } catch {
    /* storage blocked: the in-memory note still works for a client-side navigation */
  }
}

/** The note left by the puzzle room, if it is fresh. Does not clear it (see `clearWelcomeNote`). */
export function readWelcomeNote(now = Date.now()): WelcomeNote | null {
  let note = pending
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!note && raw) note = JSON.parse(raw) as WelcomeNote
  } catch {
    /* ignore */
  }
  if (!note || typeof note.number !== 'number' || typeof note.at !== 'number' || now - note.at > MAX_AGE_MS) return null
  return note
}

export function clearWelcomeNote(): void {
  pending = null
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Reads and clears the note. */
export function takeWelcomeNote(now = Date.now()): WelcomeNote | null {
  const note = readWelcomeNote(now)
  clearWelcomeNote()
  return note
}

export function welcomeLine(n: WelcomeNote): string {
  return n.solved ? `You escaped #${n.number} in ${n.guesses}/${n.maxGuesses} · ${formatDuration(n.timeMs)}` : `Escape #${n.number} stayed locked today. A new one opens tomorrow.`
}
