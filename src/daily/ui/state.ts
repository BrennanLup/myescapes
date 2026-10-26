/**
 * Escape of the Day play state (workstream 22): a pure reducer plus per-day persistence in
 * localStorage, so a reload mid-game keeps your guesses. The server stores only the start and the
 * final result; this local copy is a convenience and may be missing (private mode, cleared data).
 */
import type { DailyResultInput } from '../../contracts/models'
import { allHit, type DailyGuessMark, type GridMark } from '../engine'

export type PlayStatus = 'idle' | 'playing' | 'solved' | 'failed'

export interface Progress {
  day: string
  number: number
  status: PlayStatus
  /** Client clock, ms. Taken from the server's start time when there is one. */
  startedAt: number | null
  finishedAt: number | null
  /** Submitted guesses, one entry per slot. */
  guesses: string[][]
  /** The share grid in play order: guess rows and single `hint` rows. */
  grid: GridMark[][]
  hintsUsed: number
  /** The server accepted the result (signed-in players). */
  submitted: boolean
}

export const newProgress = (day: string, number: number): Progress => ({
  day,
  number,
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  guesses: [],
  grid: [],
  hintsUsed: 0,
  submitted: false,
})

export type PlayAction =
  | { type: 'start'; at: number }
  | { type: 'guess'; guess: string[]; marks: DailyGuessMark[]; maxGuesses: number; at: number }
  | { type: 'hint'; maxHints: number }
  | { type: 'giveUp'; at: number }
  | { type: 'submitted' }
  | { type: 'reset'; progress: Progress }

const finished = (s: PlayStatus) => s === 'solved' || s === 'failed'

export function playReducer(state: Progress, action: PlayAction): Progress {
  switch (action.type) {
    case 'start':
      return state.status === 'idle' ? { ...state, status: 'playing', startedAt: state.startedAt ?? action.at } : state
    case 'guess': {
      if (state.status !== 'playing' || state.guesses.length >= action.maxGuesses) return state
      const guesses = [...state.guesses, action.guess]
      const grid = [...state.grid, action.marks]
      const status: PlayStatus = allHit(action.marks) ? 'solved' : guesses.length >= action.maxGuesses ? 'failed' : 'playing'
      return { ...state, guesses, grid, status, finishedAt: finished(status) ? action.at : null }
    }
    case 'hint':
      if (state.status !== 'playing' || state.hintsUsed >= action.maxHints) return state
      return { ...state, hintsUsed: state.hintsUsed + 1, grid: [...state.grid, ['hint']] }
    case 'giveUp':
      if (state.status !== 'playing') return state
      return { ...state, status: 'failed', finishedAt: action.at }
    case 'submitted':
      return { ...state, submitted: true }
    case 'reset':
      return action.progress
  }
}

export function isFinished(p: Progress): boolean {
  return finished(p.status)
}

/** The result body for POST /api/daily/results. */
export function toResultInput(p: Progress): DailyResultInput {
  const timeMs = p.startedAt !== null && p.finishedAt !== null ? Math.max(0, Math.min(24 * 3600 * 1000, p.finishedAt - p.startedAt)) : 0
  return {
    day: p.day,
    number: p.number,
    solved: p.status === 'solved',
    guesses: p.guesses.length,
    hintsUsed: p.hintsUsed,
    timeMs,
    grid: p.grid,
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'myescapes.daily.v1.'
export const storageKey = (day: string) => `${KEY_PREFIX}${day}`

export function loadProgress(day: string, number: number): Progress {
  try {
    const raw = window.localStorage.getItem(storageKey(day))
    if (!raw) return newProgress(day, number)
    const p = JSON.parse(raw) as Progress
    if (p && p.day === day && p.number === number && Array.isArray(p.guesses) && Array.isArray(p.grid)) return { ...newProgress(day, number), ...p }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return newProgress(day, number)
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(storageKey(p.day), JSON.stringify(p))
    // Keep only the last week of days.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX) && k.slice(KEY_PREFIX.length) < weekBefore(p.day)) window.localStorage.removeItem(k)
    }
  } catch {
    /* storage blocked: progress lives in memory only */
  }
}

function weekBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
}
