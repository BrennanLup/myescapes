import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { bus } from '@/contracts/events'
import type { Review } from '@/contracts/types'
import { STORAGE_KEY, buildDailyGate, parseGateUrl, pickGenerator, selectPuzzle, shouldAutoOpen, todayKey } from './daily'
import { canHint, canSkip, gateReducer, initialGateState, type GateState } from './machine'
import { maybeAutoOpenGate, resetAutoOpenGuard } from './useGateAutoOpen'

const { rooms, reviews } = FIXTURE_DATASET

describe('todayKey', () => {
  it('uses the local calendar date', () => {
    expect(todayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(todayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})

describe('selectPuzzle', () => {
  it('is deterministic per day', () => {
    expect(selectPuzzle(rooms, reviews, '2026-10-25').puzzle.id).toBe(selectPuzzle(rooms, reviews, '2026-10-25').puzzle.id)
  })
  it('prefers memorable puzzles', () => {
    for (let d = 1; d <= 28; d++) {
      const s = selectPuzzle(rooms, reviews, `2026-02-${String(d).padStart(2, '0')}`)
      expect(s.puzzle.memorable).toBe(true)
      expect(s.room?.id).toBe(s.review?.roomId)
    }
  })
  it('varies across days', () => {
    const ids = new Set(Array.from({ length: 28 }, (_, d) => selectPuzzle(rooms, reviews, `2026-02-${String(d + 1).padStart(2, '0')}`).puzzle.id))
    expect(ids.size).toBeGreaterThan(1)
  })
  it('falls back to non-memorable puzzles, then to a generic one', () => {
    const plain: Review[] = reviews.map((r) => ({ ...r, puzzles: r.puzzles.map((p) => ({ ...p, memorable: false })) }))
    expect(selectPuzzle(rooms, plain, '2026-10-25').generic).toBe(false)
    const none = selectPuzzle(rooms, reviews.map((r) => ({ ...r, puzzles: [] })), '2026-10-25')
    expect(none.generic).toBe(true)
    expect(none.room).toBeNull()
    expect(selectPuzzle([], [], '2026-10-25').generic).toBe(true)
  })
})

describe('buildDailyGate', () => {
  it('maps puzzle types to generators and honours a forced kind', () => {
    expect(pickGenerator('lock-and-key', 'd', false)).toBe('lock')
    expect(pickGenerator('search', 'd', false)).toBe('search')
    expect(pickGenerator('physical', 'd', false)).toBe('search')
    expect(pickGenerator('audio-visual', 'd', false)).toBe('cipher')
    expect(['cipher', 'sequence']).toContain(pickGenerator('logic', 'd', false))
    expect(['lock', 'sequence']).toContain(pickGenerator('math', 'd', false))
    expect(pickGenerator('weird', 'd', true)).toBe('recall')
    expect(pickGenerator('weird', 'd', false)).toBe('lock')
    for (const k of ['lock', 'cipher', 'sequence', 'search', 'recall'] as const)
      expect(buildDailyGate(rooms, reviews, '2026-10-25', k).challenge.kind).toBe(k)
  })
  it('handles 0 rooms (generic lock; recall falls back to lock)', () => {
    const g = buildDailyGate([], [], '2026-10-25', 'recall')
    expect(g.source.generic).toBe(true)
    expect(g.challenge.kind).toBe('lock')
  })
  it('handles many rooms', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...rooms[0], id: `r${i}`, name: `Room ${i}` }))
    const revs = many.map((r, i) => ({ ...reviews[0], id: `v${i}`, roomId: r.id, puzzles: [{ ...reviews[0].puzzles[0], id: `p${i}`, reviewId: `v${i}` }] }))
    const g = buildDailyGate(many, revs, '2026-10-25', 'recall')
    expect(g.challenge.kind).toBe('recall')
    expect(g.challenge.check(g.challenge.answer)).toBe(true)
  })
})

describe('url + once per day', () => {
  it('parses overrides', () => {
    expect(parseGateUrl('?gate=off')).toEqual({ mode: 'off', forceKind: null })
    expect(parseGateUrl('?gate=force&gateType=cipher')).toEqual({ mode: 'force', forceKind: 'cipher' })
    expect(parseGateUrl('?gateType=nope').forceKind).toBeNull()
  })
  it('shouldAutoOpen', () => {
    expect(shouldAutoOpen({ mode: 'auto', lastSolved: null, today: '2026-10-25' })).toBe(true)
    expect(shouldAutoOpen({ mode: 'auto', lastSolved: '2026-10-24', today: '2026-10-25' })).toBe(true)
    expect(shouldAutoOpen({ mode: 'auto', lastSolved: '2026-10-25', today: '2026-10-25' })).toBe(false)
    expect(shouldAutoOpen({ mode: 'force', lastSolved: '2026-10-25', today: '2026-10-25' })).toBe(true)
    expect(shouldAutoOpen({ mode: 'off', lastSolved: null, today: '2026-10-25' })).toBe(false)
  })

  describe('maybeAutoOpenGate with mocked dates', () => {
    let opens = 0
    let off: () => void
    beforeEach(() => {
      localStorage.clear()
      resetAutoOpenGuard()
      opens = 0
      off = bus.on('gate:open', () => opens++)
      vi.useFakeTimers()
    })
    afterEach(() => {
      off()
      vi.useRealTimers()
    })
    it('opens once on a fresh day, never twice (StrictMode guard)', () => {
      vi.setSystemTime(new Date(2026, 9, 25, 9, 0))
      expect(maybeAutoOpenGate('')).toBe(true)
      expect(maybeAutoOpenGate('')).toBe(false)
      expect(opens).toBe(1)
    })
    it('stays closed when solved today, reopens the next day', () => {
      localStorage.setItem(STORAGE_KEY, '2026-10-25')
      expect(maybeAutoOpenGate('', new Date(2026, 9, 25, 20, 0))).toBe(false)
      resetAutoOpenGuard()
      expect(maybeAutoOpenGate('', new Date(2026, 9, 26, 0, 5))).toBe(true)
      expect(opens).toBe(1)
    })
    it('honours ?gate=off and ?gate=force', () => {
      expect(maybeAutoOpenGate('?gate=off', new Date(2026, 9, 25))).toBe(false)
      resetAutoOpenGuard()
      localStorage.setItem(STORAGE_KEY, '2026-10-25')
      expect(maybeAutoOpenGate('?gate=force', new Date(2026, 9, 25))).toBe(true)
    })
  })
})

describe('hint/skip state machine', () => {
  const run = (actions: Parameters<typeof gateReducer>[1][], total = 3): GateState =>
    actions.reduce((s, a) => gateReducer(s, a, total), initialGateState)

  it('shows hints automatically from the 2nd miss', () => {
    expect(run([{ type: 'miss' }]).hintsShown).toBe(0)
    expect(run([{ type: 'miss' }, { type: 'miss' }]).hintsShown).toBe(1)
    expect(run([{ type: 'miss' }, { type: 'miss' }, { type: 'miss' }]).hintsShown).toBe(2)
    expect(run(Array(10).fill({ type: 'miss' })).hintsShown).toBe(3)
  })
  it('skip is available after the 3rd miss or once hints run out', () => {
    expect(canSkip(run([{ type: 'miss' }, { type: 'miss' }]), 3)).toBe(false)
    expect(canSkip(run([{ type: 'miss' }, { type: 'miss' }, { type: 'miss' }]), 3)).toBe(true)
    const hinted = run([{ type: 'hint' }, { type: 'hint' }])
    expect(canSkip(hinted, 3)).toBe(false)
    expect(canHint(hinted, 3)).toBe(true)
    const exhausted = run([{ type: 'hint' }, { type: 'hint' }, { type: 'hint' }, { type: 'hint' }])
    expect(exhausted.hintsShown).toBe(3)
    expect(canHint(exhausted, 3)).toBe(false)
    expect(canSkip(exhausted, 3)).toBe(true)
  })
  it('refuses to skip early, and freezes after solve/skip', () => {
    expect(run([{ type: 'skip' }]).status).toBe('playing')
    const skipped = run([{ type: 'miss' }, { type: 'miss' }, { type: 'miss' }, { type: 'skip' }])
    expect(skipped.status).toBe('skipped')
    const solved = run([{ type: 'solve' }, { type: 'miss' }])
    expect(solved).toMatchObject({ status: 'solved', misses: 0 })
  })
  it('tracks found targets without duplicates', () => {
    expect(run([{ type: 'find', id: '1' }, { type: 'find', id: '1' }, { type: 'find', id: '2' }]).found).toEqual(['1', '2'])
  })
})
