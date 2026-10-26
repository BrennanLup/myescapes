import { beforeEach, describe, expect, it } from 'vitest'
import { DailyResultInputSchema } from '../../contracts/models'
import { validateResultShape } from '../engine'
import { loadProgress, newProgress, playReducer, saveProgress, storageKey, toResultInput, type Progress } from './state'

const P = () => newProgress('2026-10-27', 2)
const run = (actions: Parameters<typeof playReducer>[1][], start: Progress = P()) => actions.reduce(playReducer, start)

describe('playReducer', () => {
  it('plays to a solve, with hints in the grid, and produces a valid result body', () => {
    const p = run([
      { type: 'start', at: 1000 },
      { type: 'guess', guess: ['1', '2', '3'], marks: ['miss', 'close', 'hit'], maxGuesses: 6, at: 2000 },
      { type: 'hint', maxHints: 3 },
      { type: 'guess', guess: ['2', '9', '3'], marks: ['hit', 'hit', 'hit'], maxGuesses: 6, at: 61_000 },
      // Ignored once finished.
      { type: 'guess', guess: ['0', '0', '0'], marks: ['miss', 'miss', 'miss'], maxGuesses: 6, at: 70_000 },
      { type: 'hint', maxHints: 3 },
    ])
    expect(p.status).toBe('solved')
    expect(p.grid).toEqual([['miss', 'close', 'hit'], ['hint'], ['hit', 'hit', 'hit']])
    const body = toResultInput(p)
    expect(body).toEqual({ day: '2026-10-27', number: 2, solved: true, guesses: 2, hintsUsed: 1, timeMs: 60_000, grid: p.grid })
    expect(DailyResultInputSchema.safeParse(body).success).toBe(true)
    expect(validateResultShape(body, 6)).toBeNull()
  })

  it('ignores guesses before the start, fails after the last guess, and allows giving up', () => {
    expect(run([{ type: 'guess', guess: ['1'], marks: ['miss'], maxGuesses: 2, at: 1 }]).guesses).toHaveLength(0)
    const failed = run([
      { type: 'start', at: 0 },
      { type: 'guess', guess: ['1'], marks: ['miss'], maxGuesses: 2, at: 1 },
      { type: 'guess', guess: ['2'], marks: ['close'], maxGuesses: 2, at: 2 },
    ])
    expect(failed.status).toBe('failed')
    expect(validateResultShape(toResultInput(failed), 2)).toBeNull()
    const gaveUp = run([{ type: 'start', at: 0 }, { type: 'giveUp', at: 5 }])
    expect(gaveUp).toMatchObject({ status: 'failed', finishedAt: 5 })
  })

  it('caps hints and keeps the first start time', () => {
    const p = run([{ type: 'start', at: 10 }, { type: 'start', at: 99 }, { type: 'hint', maxHints: 1 }, { type: 'hint', maxHints: 1 }])
    expect(p.startedAt).toBe(10)
    expect(p.hintsUsed).toBe(1)
  })
})

describe('persistence', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips progress per day and ignores other puzzles or junk', () => {
    const p = run([{ type: 'start', at: 5 }, { type: 'hint', maxHints: 3 }])
    saveProgress(p)
    expect(loadProgress('2026-10-27', 2)).toEqual(p)
    expect(loadProgress('2026-10-27', 3).status).toBe('idle')
    window.localStorage.setItem(storageKey('2026-10-28'), '{nope')
    expect(loadProgress('2026-10-28', 3).status).toBe('idle')
  })

  it('drops days older than a week', () => {
    saveProgress(newProgress('2026-10-01', 1))
    saveProgress(newProgress('2026-10-27', 2))
    expect(window.localStorage.getItem(storageKey('2026-10-01'))).toBeNull()
    expect(window.localStorage.getItem(storageKey('2026-10-27'))).not.toBeNull()
  })
})
