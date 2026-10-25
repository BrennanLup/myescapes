// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PUZZLE_TYPES, ReviewDraftSchema } from '../../src/contracts/types'
import { SAMPLE_TRANSCRIPT } from './fixtures'
import { findAddress, findDate, findEscaped, findEscapeTime, findFeatures, findPuzzles, findRatings, mockExtract } from './mock'

const NOW = new Date('2026-10-25T12:00:00Z')

describe('mockExtract: brief sample (The Lost Observatory)', () => {
  const d = mockExtract(SAMPLE_TRANSCRIPT, { now: NOW })

  it('is a valid mock ReviewDraft carrying the transcript', () => {
    expect(ReviewDraftSchema.parse(d)).toBeTruthy()
    expect(d.mode).toBe('mock')
    expect(d.review.voiceTranscript).toBe(SAMPLE_TRANSCRIPT)
  })

  it('extracts the room', () => {
    expect(d.room.name).toBe('The Lost Observatory')
    expect(d.room.company).toBe('Starlight Escapes')
    expect(d.room.city).toBe('San Francisco')
    expect(d.room.genre).toBe('sci-fi')
  })

  it('extracts ratings with comments, converting 10-point scales', () => {
    expect(d.review.ratings.overall.score).toBe(87)
    expect(d.review.ratings.overall.comment).toMatch(/87 out of 100/)
    expect(d.review.ratings.puzzles.score).toBe(90)
    expect(d.review.ratings.setting.score).toBe(90)
    expect(d.review.ratings.difficulty.score).toBe(70)
    expect(d.review.ratings.storyline.score).toBeNull()
  })

  it('extracts outcome, features, crew and tools', () => {
    expect(d.review.escaped).toBe(true)
    expect(d.review.escapeTimeMinutes).toBe(48)
    expect(d.review.visibleTimer).toBe(true)
    expect(d.review.liveActors).toBe(true)
    expect(d.review.crew).toEqual(['Maya', 'Jordan', 'Priya'])
    expect(d.review.toolsUsed).toEqual(expect.arrayContaining(['UV light', 'magnets', 'writing boards']))
  })

  it('extracts at least 3 typed puzzles, marking the favourite memorable', () => {
    const typed = d.review.puzzles.filter((p) => p.type !== null)
    expect(typed.length).toBeGreaterThanOrEqual(3)
    for (const p of typed) expect(PUZZLE_TYPES).toContain(p.type)
    expect(new Set(typed.map((p) => p.type)).size).toBeGreaterThanOrEqual(3)
    const fav = d.review.puzzles.find((p) => /telescope/.test(p.description))
    expect(fav).toMatchObject({ type: 'physical', memorable: true })
    expect(d.review.puzzles.find((p) => /math puzzle/.test(p.description))?.type).toBe('math')
    expect(d.review.puzzles.find((p) => /search the whole library/.test(p.description))?.type).toBe('search')
  })

  it('flags every unknown', () => {
    expect(d.review.date).toBeNull() // "last Saturday" stays null
    expect(d.flags).toEqual(
      expect.arrayContaining([
        'review.date',
        'room.address',
        'room.website',
        'review.ratings.storyline.score',
        'review.multiRoom',
        'review.flashlights',
      ]),
    )
    expect(d.flags).not.toContain('room.name')
    expect(d.flags).not.toContain('review.escapeTimeMinutes')
  })
})

describe('mockExtract: negations and scales', () => {
  it('handles negated features and a failed escape', () => {
    const d = mockExtract(
      'We played Bank Job at Vault Rooms in Toronto. There was no visible timer, and no actors. We did not escape, we ran out of time. It was a single room. We didn\'t need flashlights.',
    )
    expect(d.room.name).toBe('Bank Job')
    expect(d.room.company).toBe('Vault Rooms')
    expect(d.room.city).toBe('Toronto')
    expect(d.room.genre).toBe('heist')
    expect(d.review.visibleTimer).toBe(false)
    expect(d.review.liveActors).toBe(false)
    expect(d.review.escaped).toBe(false)
    expect(d.review.multiRoom).toBe(false)
    expect(d.review.flashlights).toBe(false)
  })

  it('converts 10-point and slash scales and bare numbers after a category', () => {
    const r = findRatings('Overall 8 out of 10. The story was 7.5/10, a bit thin. Setting 95/100. Puzzles about 9.')
    expect(r.overall.score).toBe(80)
    expect(r.storyline.score).toBe(75)
    expect(r.storyline.comment).toMatch(/bit thin/)
    expect(r.setting.score).toBe(95)
    expect(r.puzzles.score).toBe(90)
    expect(r.difficulty.score).toBeNull()
  })

  it('does not read minutes as scores', () => {
    const r = findRatings('The puzzles took 45 minutes overall.')
    expect(r.puzzles.score).toBeNull()
    expect(r.overall.score).toBeNull()
  })

  it('computes time from "with N minutes left"', () => {
    expect(findEscapeTime('We escaped with 12 minutes left!')).toBe(48)
    expect(findEscapeTime('got out in 55 minutes')).toBe(55)
    expect(findEscapeTime('it was fun')).toBeNull()
    expect(findEscaped('we escaped with 12 minutes left')).toBe(true)
    expect(findEscaped("we didn't quite escape")).toBe(false)
    expect(findEscaped('it was fun')).toBeNull()
  })

  it('reads yes/no answers', () => {
    const f = findFeatures('Visible timer? No. Live actors: yes. Multi-room? Yes.')
    expect(f.visibleTimer).toBe(false)
    expect(f.liveActors).toBe(true)
    expect(f.multiRoom).toBe(true)
    expect(f.flashlights).toBeNull()
  })

  it('parses spoken dates', () => {
    expect(findDate('We went on March 3rd', NOW)).toBe('2026-03-03')
    expect(findDate('on 2025-12-30', NOW)).toBe('2025-12-30')
    expect(findDate('on December 20', NOW)).toBe('2025-12-20')
    expect(findDate('last Saturday', NOW)).toBeNull()
    expect(findDate('we went yesterday', new Date(2026, 9, 25))).toBe('2026-10-24')
  })

  it('handles "A, B and I", "with N minutes left" and puzzle words inside names', () => {
    const d = mockExtract(
      "Sam, Lee and I tried Pharaoh's Curse at Puzzle Palace in Oakland. Ancient Egypt theme. We escaped with 7 minutes left. The story was great, maybe 8/10. My favourite was a riddle on the sarcophagus.",
    )
    expect(d.review.crew).toEqual(['Sam', 'Lee'])
    expect(d.room).toMatchObject({ name: "Pharaoh's Curse", company: 'Puzzle Palace', city: 'Oakland', genre: 'historical' })
    expect(d.review.escapeTimeMinutes).toBe(53)
    expect(d.review.ratings.storyline.score).toBe(80)
    expect(d.review.puzzles).toEqual([{ description: 'My favourite was a riddle on the sarcophagus.', type: 'logic', memorable: true }])
  })
})

describe('mockExtract: sparse transcript', () => {
  it('nulls and flags everything it cannot find', () => {
    const d = mockExtract('It was really fun, we laughed a lot.')
    expect(ReviewDraftSchema.parse(d)).toBeTruthy()
    for (const path of [
      'room.name',
      'room.company',
      'room.city',
      'room.genre',
      'review.date',
      'review.escaped',
      'review.escapeTimeMinutes',
      'review.visibleTimer',
      'review.multiRoom',
      'review.flashlights',
      'review.liveActors',
      'review.ratings.overall.score',
      'review.ratings.puzzles.score',
      'review.ratings.setting.score',
      'review.ratings.storyline.score',
      'review.ratings.difficulty.score',
    ])
      expect(d.flags).toContain(path)
    expect(d.review.puzzles).toEqual([])
    expect(d.review.crew).toEqual([])
  })
})

describe('mockExtract: address and puzzle headings', () => {
  it('finds a spoken or street-shaped address', () => {
    expect(findAddress('The address is 1420 Valencia Street, and the crew was me.')).toBe('1420 Valencia Street')
    expect(findAddress('We played at 22 Baker Street last week.')).toBe('22 Baker Street')
    expect(findAddress('No location mentioned at all.')).toBeNull()
  })

  it('skips a bare "Puzzles." heading', () => {
    const ps = findPuzzles('Puzzles. The first puzzle was a padlock with a four digit code.', new Set())
    expect(ps).toHaveLength(1)
    expect(ps[0].type).toBe('lock-and-key')
  })
})
