import { describe, expect, it } from 'vitest'
import { createRng, hashString } from './rng'
import { generateCipher, generateLock, generateRecall, generateSearch, generateSequence, normalizeAnswer, type Challenge } from './generators'

const SEEDS = Array.from({ length: 40 }, (_, i) => `2026-10-${String((i % 28) + 1).padStart(2, '0')}|pz_${i}`)

const strip = (c: Challenge) => JSON.stringify({ ...c, check: undefined })

describe('rng', () => {
  it('is deterministic and seed-sensitive', () => {
    const a = createRng('x')
    const b = createRng('x')
    const c = createRng('y')
    const sa = [a.next(), a.next(), a.next()]
    expect([b.next(), b.next(), b.next()]).toEqual(sa)
    expect(c.next()).not.toEqual(sa[0])
    expect(hashString('abc')).toBe(hashString('abc'))
  })
  it('int stays in range', () => {
    const r = createRng('range')
    for (let i = 0; i < 500; i++) {
      const v = r.int(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
  })
})

const ROOMS = [
  { id: 'r1', name: 'The Clockmaker', city: 'SF', genre: 'mystery', company: 'PP' },
  { id: 'r2', name: 'Haunted Lighthouse', city: 'Toronto', genre: 'horror', company: 'EH' },
  { id: 'r3', name: 'Mars Base', city: 'SF', genre: 'sci-fi', company: 'PP' },
  { id: 'r4', name: 'Pharaoh', city: 'LA', genre: 'historical', company: 'X' },
  { id: 'r5', name: 'Vault', city: 'NY', genre: 'heist', company: 'Y' },
]

const generators: Record<string, (seed: string) => Challenge> = {
  lock: generateLock,
  cipher: generateCipher,
  sequence: generateSequence,
  search: generateSearch,
  recall: (seed) => generateRecall(seed, { description: 'Set the clock', room: ROOMS[0], rooms: ROOMS }),
}

describe.each(Object.entries(generators))('%s generator', (_name, gen) => {
  it('is deterministic per seed', () => {
    for (const s of SEEDS.slice(0, 10)) expect(strip(gen(s))).toBe(strip(gen(s)))
  })
  it('varies across seeds', () => {
    const distinct = new Set(SEEDS.map((s) => JSON.stringify(gen(s).answer) + strip(gen(s))))
    expect(distinct.size).toBeGreaterThan(SEEDS.length / 2)
  })
  it('accepts its own answer and rejects wrong ones', () => {
    for (const s of SEEDS) {
      const c = gen(s)
      expect(c.check(c.answer)).toBe(true)
      expect(c.check('definitely-wrong-zzz')).toBe(false)
      expect(c.check([])).toBe(false)
      expect(c.hints.length).toBeGreaterThanOrEqual(3)
      expect(c.prompt.length).toBeGreaterThan(5)
    }
  })
})

describe('lock', () => {
  it('code digits match the clues and clue maths is right', () => {
    for (const s of SEEDS) {
      const c = generateLock(s)
      expect(c.data.clues).toHaveLength(c.data.digits)
      expect(c.answer).toBe(c.data.clues.map((k) => k.digit).join(''))
      for (const clue of c.data.clues) {
        expect(clue.digit).toBeGreaterThanOrEqual(0)
        expect(clue.digit).toBeLessThanOrEqual(9)
        if (clue.type === 'clock') expect(clue.digit).toBe(clue.hour)
        if (clue.type === 'count' && clue.text.startsWith('Count')) expect(clue.digit).toBe(clue.count)
        if (clue.type === 'count' && clue.text.includes('× 2')) expect(clue.digit).toBe(clue.count * 2)
      }
    }
  })
  it('ignores spacing in typed answers', () => {
    const c = generateLock('a')
    expect(c.check(` ${(c.answer as string).split('').join(' ')} `)).toBe(true)
  })
})

describe('cipher', () => {
  it('the key decodes the encoded word to the answer, case-insensitively', () => {
    for (const s of SEEDS) {
      const c = generateCipher(s)
      const map = new Map(c.data.key.map((k) => [k.symbol, k.letter]))
      expect(c.data.encoded.map((sym) => map.get(sym)).join('')).toBe(c.answer)
      expect(new Set(c.data.key.map((k) => k.symbol)).size).toBe(c.data.key.length)
      expect(c.check((c.answer as string).toLowerCase())).toBe(true)
    }
  })
})

describe('sequence', () => {
  it('produces both number and shape modes, and shape choices include the answer', () => {
    const modes = new Set<string>()
    for (const s of SEEDS) {
      const c = generateSequence(s)
      modes.add(c.data.mode)
      if (c.data.mode === 'shape') {
        expect(c.input).toBe('choice')
        expect(c.choices!.map((x) => x.id)).toContain(c.answer)
        expect(new Set(c.choices!.map((x) => x.id)).size).toBe(c.choices!.length)
      } else {
        expect(Number(c.answer)).not.toBeNaN()
      }
    }
    expect(modes).toEqual(new Set(['number', 'shape']))
  })
})

describe('search', () => {
  it('places 3-5 separated targets inside the scene; needs every one found', () => {
    for (const s of SEEDS) {
      const c = generateSearch(s)
      const t = c.data.targets
      expect(t.length).toBeGreaterThanOrEqual(3)
      expect(t.length).toBeLessThanOrEqual(5)
      for (const p of t) {
        expect(p.x).toBeGreaterThan(0)
        expect(p.x).toBeLessThan(c.data.width)
        expect(p.y).toBeGreaterThan(0)
        expect(p.y).toBeLessThan(c.data.height)
      }
      expect(c.check(t.slice(1).map((x) => x.id))).toBe(false)
      expect(c.check([...t.map((x) => x.id)].reverse())).toBe(true)
    }
  })
})

describe('recall', () => {
  it('offers up to 4 distinct rooms including the right one', () => {
    const c = generateRecall('s', { description: 'd', room: ROOMS[1], rooms: ROOMS })
    expect(c.choices).toHaveLength(4)
    expect(c.choices!.map((x) => x.id)).toContain('r2')
    expect(c.check('r2')).toBe(true)
    expect(c.check('r1')).toBe(false)
  })
  it('works with only two rooms', () => {
    const c = generateRecall('s', { description: 'd', room: ROOMS[0], rooms: ROOMS.slice(0, 2) })
    expect(c.choices).toHaveLength(2)
  })
})

it('normalizeAnswer', () => {
  expect(normalizeAnswer(' co-coa! ')).toBe('COCOA')
})
