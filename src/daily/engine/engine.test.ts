import { describe, expect, it } from 'vitest'
import { DAILY_EPOCH, DAILY_KINDS, DailyResultInputSchema } from '../../contracts/models'
import {
  addDays,
  dailyKind,
  dailyNumber,
  dailySpec,
  formatDuration,
  generateDaily,
  localDay,
  normalizeTimeZone,
  scoreResult,
  shareText,
  startOfDay,
  validateResultShape,
  wordleMarks,
  type DailyChallenge,
} from './index'

const DAYS = Array.from({ length: 60 }, (_, i) => addDays(DAILY_EPOCH, i))
const strip = (c: DailyChallenge) => JSON.stringify({ ...c, check: undefined })

describe('days and numbers', () => {
  it('numbers start at 1 on the epoch', () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1)
    expect(dailyNumber(addDays(DAILY_EPOCH, 11))).toBe(12)
  })

  it('localDay follows the time zone', () => {
    const t = new Date('2026-10-26T04:30:00Z')
    expect(localDay('UTC', t)).toBe('2026-10-26')
    expect(localDay('America/Los_Angeles', t)).toBe('2026-10-25')
    expect(localDay('Asia/Tokyo', t)).toBe('2026-10-26')
    expect(localDay('Not/AZone', t)).toBe('2026-10-26')
  })

  it('addDays crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('normalizeTimeZone accepts IANA names and rejects junk', () => {
    expect(normalizeTimeZone('Europe/London')).toBe('Europe/London')
    expect(normalizeTimeZone('UTC')).toBe('UTC')
    expect(normalizeTimeZone('Nope/Zone')).toBeNull()
    expect(normalizeTimeZone('')).toBeNull()
    expect(normalizeTimeZone(null)).toBeNull()
    expect(normalizeTimeZone('x'.repeat(80))).toBeNull()
  })

  it('startOfDay finds local midnight', () => {
    expect(startOfDay('2026-10-27', 'UTC').toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(startOfDay('2026-10-27', 'America/Los_Angeles').toISOString()).toBe('2026-10-27T07:00:00.000Z')
    expect(startOfDay('2026-10-27', 'Asia/Kolkata').toISOString()).toBe('2026-10-26T18:30:00.000Z')
    expect(startOfDay('2026-10-27', 'Pacific/Kiritimati').toISOString()).toBe('2026-10-26T10:00:00.000Z')
    // DST change week in London (clocks went back on 2026-10-25).
    expect(startOfDay('2026-10-25', 'Europe/London').toISOString()).toBe('2026-10-24T23:00:00.000Z')
    expect(startOfDay('2026-10-26', 'Europe/London').toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })
})

describe('daily spec', () => {
  it('is the same for everyone on a day', () => {
    expect(dailySpec('2026-11-02')).toEqual(dailySpec('2026-11-02'))
    expect(dailySpec('2026-11-02').seed).not.toBe(dailySpec('2026-11-03').seed)
  })

  it('every kind appears once in each block of four days', () => {
    for (let b = 0; b < 10; b++) {
      const kinds = [0, 1, 2, 3].map((i) => dailyKind(addDays(DAILY_EPOCH, b * 4 + i)))
      expect(new Set(kinds).size).toBe(4)
      for (const k of kinds) expect(DAILY_KINDS).toContain(k)
    }
  })
})

describe('generators', () => {
  it('are deterministic per day and differ across days', () => {
    const seen = new Set<string>()
    for (const day of DAYS) {
      const spec = dailySpec(day)
      const a = generateDaily(spec)
      const b = generateDaily(spec)
      expect(strip(a)).toBe(strip(b))
      expect(a.kind).toBe(spec.kind)
      seen.add(strip(a))
    }
    expect(seen.size).toBeGreaterThan(50)
  })

  it('the answer always checks as all hits, and fits the share grid limits', () => {
    for (const kind of DAILY_KINDS) {
      for (let i = 0; i < 40; i++) {
        const c = generateDaily({ kind, seed: `seed-${i}` })
        expect(c.answer).toHaveLength(c.slots)
        expect(c.slots).toBeGreaterThan(0)
        expect(c.slots).toBeLessThanOrEqual(12)
        expect(c.check(c.answer)).toEqual(c.answer.map(() => 'hit'))
        expect(c.hints.length).toBeGreaterThanOrEqual(3)
        expect(c.check([])).toEqual(c.answer.map(() => 'miss'))
      }
    }
  })

  it('combination: clue digits spell the code', () => {
    for (let i = 0; i < 30; i++) {
      const c = generateDaily({ kind: 'combination', seed: `c${i}` })
      if (c.kind !== 'combination') throw new Error('kind')
      expect(c.data.clues.map((x) => String(x.digit)).join('')).toBe(c.answer.join(''))
    }
  })

  it('cipher: the key is missing exactly the hidden word symbols and the rest decode', () => {
    for (let i = 0; i < 30; i++) {
      const c = generateDaily({ kind: 'cipher', seed: `x${i}` })
      if (c.kind !== 'cipher') throw new Error('kind')
      const key = new Map(c.data.key.map((k) => [k.symbol, k.letter]))
      expect(c.data.missing.length).toBeGreaterThanOrEqual(1)
      for (const s of c.data.missing) {
        expect(key.has(s)).toBe(false)
        expect(c.data.encoded).toContain(s)
      }
      c.data.encoded.forEach((s, idx) => {
        if (!c.data.missing.includes(s)) expect(key.get(s)).toBe(c.answer[idx])
      })
      // Case and spacing don't matter.
      expect(c.check(c.answer.map((l) => ` ${l.toLowerCase()} `))).toEqual(c.answer.map(() => 'hit'))
    }
  })

  it('sequence: numbers mark close within 10%, tiles mark close on shape or colour', () => {
    let numbers = 0
    let shapes = 0
    for (let i = 0; i < 60; i++) {
      const c = generateDaily({ kind: 'sequence', seed: `s${i}` })
      if (c.kind !== 'sequence') throw new Error('kind')
      if (c.data.mode === 'number') {
        numbers++
        const off = c.answer.map((a) => String(Number(a) + 1))
        expect(c.check(off)).toEqual(['close', 'close', 'close'])
        expect(c.check(c.answer.map((a) => String(Number(a) + 1000)))).toEqual(['miss', 'miss', 'miss'])
        expect(c.check(['', 'abc', c.answer[2]])).toEqual(['miss', 'miss', 'hit'])
      } else {
        shapes++
        const choices = c.data.choices
        const ids = choices.map((x) => x.id)
        for (const a of c.answer) expect(ids).toContain(a)
        expect(new Set(ids).size).toBe(ids.length)
        const want = choices.find((y) => y.id === c.answer[0])!
        const wrong = choices.find((x) => x.shape !== want.shape && x.colorName !== want.colorName)
        if (wrong) expect(c.check([wrong.id, c.answer[1], c.answer[2]])).toEqual(['miss', 'hit', 'hit'])
      }
    }
    expect(numbers).toBeGreaterThan(0)
    expect(shapes).toBeGreaterThan(0)
  })

  it('search: each distinct target is a hit; repeats and blanks miss', () => {
    const c = generateDaily({ kind: 'search', seed: 'room' })
    if (c.kind !== 'search') throw new Error('kind')
    expect(c.scene.data.targets).toHaveLength(c.slots)
    const first = c.answer[0]
    const guess = [first, first, ...Array(c.slots - 2).fill('')]
    expect(c.check(guess)).toEqual(['hit', ...Array(c.slots - 1).fill('miss')])
    expect(c.check([...c.answer].reverse())).toEqual(c.answer.map(() => 'hit'))
  })
})

describe('wordle marks', () => {
  const m = (g: string, a: string) => wordleMarks(g.split(''), a.split(''))
  it('handles duplicates like Wordle', () => {
    expect(m('1123', '1234')).toEqual(['hit', 'miss', 'close', 'close'])
    expect(m('4444', '1234')).toEqual(['miss', 'miss', 'miss', 'hit'])
    expect(m('SOCKS', 'SOCKS')).toEqual(['hit', 'hit', 'hit', 'hit', 'hit'])
    expect(m('KOSSS', 'SOCKS')).toEqual(['close', 'hit', 'close', 'miss', 'hit'])
    expect(m('12', '123')).toEqual(['miss', 'miss', 'miss'])
  })
})

describe('scoring', () => {
  it('rewards fewer guesses, fewer hints and speed', () => {
    expect(scoreResult({ solved: true, guesses: 1, hintsUsed: 0, timeMs: 20_000 })).toBe(1000)
    expect(scoreResult({ solved: true, guesses: 3, hintsUsed: 0, timeMs: 20_000 })).toBe(760)
    expect(scoreResult({ solved: true, guesses: 1, hintsUsed: 2, timeMs: 20_000 })).toBe(700)
    expect(scoreResult({ solved: true, guesses: 1, hintsUsed: 0, timeMs: 90_000 })).toBe(940)
    expect(scoreResult({ solved: true, guesses: 1, hintsUsed: 0, timeMs: 3_600_000 })).toBe(700)
    expect(scoreResult({ solved: true, guesses: 6, hintsUsed: 3, timeMs: 3_600_000 })).toBe(100)
    expect(scoreResult({ solved: false, guesses: 6, hintsUsed: 0, timeMs: 1000 })).toBe(0)
  })
})

describe('share text', () => {
  it('is spoiler-free: header, emoji rows, link', () => {
    const text = shareText(
      { number: 12, solved: true, guesses: 2, maxGuesses: 6, hintsUsed: 1, timeMs: 125_000, grid: [['miss', 'close', 'hit'], ['hint'], ['hit', 'hit', 'hit']] },
      'https://example.com/daily',
    )
    expect(text).toBe('My Escapes · Escape #12 🔓 2/6 · 2:05 · 1 hint\n⬛🟨🟩\n💡\n🟩🟩🟩\nhttps://example.com/daily')
    const fail = shareText({ number: 3, solved: false, guesses: 6, maxGuesses: 6, hintsUsed: 0, timeMs: 5_000, grid: [['miss']] })
    expect(fail.split('\n')[0]).toBe('My Escapes · Escape #3 🔒 X/6 · 0:05')
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(61_000)).toBe('1:01')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})

describe('result shape validation', () => {
  const ok = { solved: true, guesses: 2, hintsUsed: 1, grid: [['miss', 'hit'], ['hint'], ['hit', 'hit']] }
  it('accepts a consistent result that fits the contract', () => {
    expect(validateResultShape(ok, 6)).toBeNull()
    expect(DailyResultInputSchema.safeParse({ ...ok, day: '2026-10-26', number: 1, timeMs: 1000 }).success).toBe(true)
    expect(validateResultShape({ solved: false, guesses: 1, hintsUsed: 0, grid: [['miss', 'miss']] }, 6)).toBeNull()
  })
  it('rejects inconsistent ones', () => {
    expect(validateResultShape({ ...ok, guesses: 7 }, 6)).toMatch(/At most/)
    expect(validateResultShape({ ...ok, guesses: 3 }, 6)).toMatch(/one row per guess/)
    expect(validateResultShape({ ...ok, hintsUsed: 0 }, 6)).toMatch(/hint rows/)
    expect(validateResultShape({ ...ok, grid: [['miss', 'hit'], ['hint'], ['hit', 'close']] }, 6)).toMatch(/all-hit/)
    expect(validateResultShape({ solved: true, guesses: 2, hintsUsed: 0, grid: [['hit', 'hit'], ['hit', 'hit']] }, 6)).toMatch(/first all-hit/)
    expect(validateResultShape({ solved: false, guesses: 1, hintsUsed: 0, grid: [['hit', 'hit']] }, 6)).toMatch(/is solved/)
    expect(validateResultShape({ solved: true, guesses: 0, hintsUsed: 0, grid: [] }, 6)).toMatch(/all-hit/)
  })
})
