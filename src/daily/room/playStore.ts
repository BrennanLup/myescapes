/**
 * A snapshot of today's play for the 3D scene. The play logic itself (`useDailyPlay`) runs in the
 * DOM part of the page; it publishes what the props need to draw here, so components inside the
 * Canvas never depend on React context crossing the renderer boundary.
 */
import { create } from 'zustand'
import type { DailyChallenge } from '../engine'
import type { Progress } from '../ui/state'
import type { SearchRound } from './search'

export interface RoomPlaySnapshot {
  challenge: DailyChallenge | null
  progress: Progress | null
  maxGuesses: number
  /** Search days: this round's looks and the spot -> target assignment. */
  round: SearchRound
  assignment: Map<string, string>
  /** The exit door is open (today is finished). */
  doorOpen: boolean
  /** Bumps when a fresh solve happens in this visit (drives the celebration). */
  celebrate: number
  number: number
  theme: { gameName: string; venueName: string; city: string } | null
}

export const EMPTY_ROUND: SearchRound = { found: [], looked: [] }

export const useRoomPlay = create<RoomPlaySnapshot>()(() => ({
  challenge: null,
  progress: null,
  maxGuesses: 6,
  round: EMPTY_ROUND,
  assignment: new Map(),
  doorOpen: false,
  celebrate: 0,
  number: 0,
  theme: null,
}))

export function resetRoomPlay() {
  useRoomPlay.setState({ challenge: null, progress: null, round: EMPTY_ROUND, assignment: new Map(), doorOpen: false, celebrate: 0, number: 0, theme: null })
}
