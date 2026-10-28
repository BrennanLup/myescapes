/**
 * "Search the room" in 3D: the day's brass keys (or stars, or hearts) hide under real objects in the
 * puzzle room. Pure, no React or three.js.
 *
 * The rules are the 2D game's, so the share grid means the same thing: each round you get one look
 * per target still missing; looks that find a target stay found; when the round's looks are used up
 * the round is sent as one guess (`[...found, ...looks]`, an empty string for a look that found
 * nothing) and marked by the daily engine.
 */
import type { Vec3 } from '@/contracts/scene'
import { createRng } from '../../gate/rng'
import type { SearchDailyChallenge } from '../engine'
import { searchFound } from '../ui/views'

export type SpotKind = 'cushion' | 'books' | 'jar' | 'pot' | 'crate' | 'hatbox' | 'chest' | 'rug' | 'frame' | 'vase' | 'basket' | 'lamp'

export interface HidingSpot {
  id: string
  kind: SpotKind
  /** Prompt verb phrase: "Look under the cushion". */
  label: string
  /** World position of the object's base (where a found token appears just above). */
  position: Vec3
  /** Y rotation of the object. */
  rotationY: number
}

/** Every hiding place in the room. Furniture is always there; in a search day it can be checked. */
export const HIDING_SPOTS: readonly HidingSpot[] = [
  { id: 'cushion', kind: 'cushion', label: 'Look under the cushion', position: [-3.05, 0.48, 2.55], rotationY: 0.5 },
  { id: 'books', kind: 'books', label: 'Move the books', position: [-3.72, 1.02, -1.25], rotationY: Math.PI / 2 },
  { id: 'jar', kind: 'jar', label: 'Open the jar', position: [-3.72, 0.56, -2.0], rotationY: Math.PI / 2 },
  { id: 'pot', kind: 'pot', label: 'Check the plant pot', position: [3.35, 0, 4.35], rotationY: 0 },
  { id: 'crate', kind: 'crate', label: 'Open the crate', position: [3.3, 0, -2.25], rotationY: 0.15 },
  { id: 'hatbox', kind: 'hatbox', label: 'Lift the hat box', position: [3.45, 0, -1.2], rotationY: 0.4 },
  { id: 'chest', kind: 'chest', label: 'Open the chest', position: [-3.15, 0, 4.2], rotationY: -0.3 },
  { id: 'rug', kind: 'rug', label: 'Lift the rug corner', position: [1.12, 0.012, 1.52], rotationY: 0 },
  { id: 'frame', kind: 'frame', label: 'Look behind the picture', position: [2.2, 1.55, 4.97], rotationY: Math.PI },
  { id: 'vase', kind: 'vase', label: 'Look in the vase', position: [-1.95, 0.72, -2.55], rotationY: 0 },
  { id: 'basket', kind: 'basket', label: 'Search the basket', position: [1.95, 0, -2.6], rotationY: 0.2 },
  { id: 'lamp', kind: 'lamp', label: 'Check under the lamp', position: [3.5, 0, 2.45], rotationY: 0 },
]

/**
 * Which spot hides which target, deterministic for the day (`seed` is the puzzle seed). Returns
 * spot id -> target id; spots without a target are absent.
 */
export function assignTargets(c: SearchDailyChallenge, seed: string): Map<string, string> {
  const rng = createRng(`eotd-room-search:${seed}`)
  const spots = rng.shuffle(HIDING_SPOTS.map((s) => s.id))
  const out = new Map<string, string>()
  c.answer.forEach((targetId, i) => out.set(spots[i % spots.length], targetId))
  return out
}

export interface SearchRound {
  /** Target ids found in earlier rounds (they stay found). */
  found: string[]
  /** Spot ids looked at this round, in order. */
  looked: string[]
}

/** Looks left this round. */
export function looksLeft(c: SearchDailyChallenge, round: SearchRound): number {
  return Math.max(0, c.slots - round.found.length - round.looked.length)
}

/** Found target ids in earlier rounds plus this round's lucky looks. */
export function foundNow(round: SearchRound, assignment: Map<string, string>): string[] {
  const out = new Set(round.found)
  for (const spot of round.looked) {
    const t = assignment.get(spot)
    if (t) out.add(t)
  }
  return [...out]
}

/** True when a spot can be looked at now (not looked at this round, and its target not already found). */
export function canLook(spotId: string, round: SearchRound, assignment: Map<string, string>): boolean {
  if (round.looked.includes(spotId)) return false
  const t = assignment.get(spotId)
  return !(t && round.found.includes(t))
}

/**
 * Look at a spot. Returns the next round state and, when this look used the round's last one, the
 * guess to send (`[...found, ...one entry per look]`).
 */
export function look(c: SearchDailyChallenge, round: SearchRound, spotId: string, assignment: Map<string, string>): { round: SearchRound; guess: string[] | null; hit: string | null } {
  if (!canLook(spotId, round, assignment) || looksLeft(c, round) === 0) return { round, guess: null, hit: null }
  const looked = [...round.looked, spotId]
  const hit = assignment.get(spotId) ?? null
  if (round.found.length + looked.length >= c.slots) {
    const guess = [...round.found, ...looked.map((s) => assignment.get(s) ?? '')]
    return { round: { found: round.found, looked: [] }, guess, hit }
  }
  return { round: { found: round.found, looked }, guess: null, hit }
}

/** The round state at the start of the next round, from the guesses so far. */
export function roundFromGuesses(c: SearchDailyChallenge, guesses: readonly string[][]): SearchRound {
  return { found: searchFound(c, guesses), looked: [] }
}
