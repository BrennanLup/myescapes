import { describe, expect, it } from 'vitest'
import { allHit, searchChallenge } from '../engine'
import { assignTargets, canLook, foundNow, HIDING_SPOTS, look, looksLeft, roundFromGuesses, type SearchRound } from './search'

const seeds = ['eotd:2026-10-28', 'eotd:2026-11-01', 'eotd:a', 'eotd:b', 'eotd:c']

describe('search the room in 3D', () => {
  it('hides every target under a different spot, the same way every time for a day', () => {
    for (const seed of seeds) {
      const c = searchChallenge(seed)
      const a = assignTargets(c, seed)
      expect(a.size).toBe(c.answer.length)
      expect([...a.values()].sort()).toEqual([...c.answer].sort())
      for (const spot of a.keys()) expect(HIDING_SPOTS.some((s) => s.id === spot)).toBe(true)
      expect([...assignTargets(c, seed)]).toEqual([...a])
    }
    const c = searchChallenge('eotd:x')
    const days = new Set(['d1', 'd2', 'd3', 'd4', 'd5'].map((d) => [...assignTargets(c, d).keys()].sort().join()))
    expect(days.size).toBeGreaterThan(1)
  })

  it('a round of only lucky looks is an all-hit guess (a solve)', () => {
    const seed = seeds[0]
    const c = searchChallenge(seed)
    const a = assignTargets(c, seed)
    let round: SearchRound = { found: [], looked: [] }
    let guess: string[] | null = null
    for (const spot of a.keys()) {
      expect(canLook(spot, round, a)).toBe(true)
      const r = look(c, round, spot, a)
      expect(r.hit).toBe(a.get(spot))
      round = r.round
      guess = r.guess ?? guess
    }
    expect(guess).not.toBeNull()
    expect(allHit(c.check(guess!))).toBe(true)
  })

  it('misses use up the round; found ones carry over and cannot be looked at again', () => {
    const seed = seeds[1]
    const c = searchChallenge(seed)
    const a = assignTargets(c, seed)
    const empty = HIDING_SPOTS.map((s) => s.id).filter((id) => !a.has(id))
    const [lucky] = [...a.keys()]
    let round: SearchRound = { found: [], looked: [] }
    let r = look(c, round, lucky, a)
    round = r.round
    expect(looksLeft(c, round)).toBe(c.slots - 1)
    expect(canLook(lucky, round, a)).toBe(false)
    // Looking twice at the same spot does nothing.
    expect(look(c, round, lucky, a).round).toBe(round)
    let guess: string[] | null = null
    for (const id of empty) {
      r = look(c, round, id, a)
      round = r.round
      if (r.guess) {
        guess = r.guess
        break
      }
    }
    expect(guess).toHaveLength(c.slots)
    const marks = c.check(guess!)
    expect(marks.filter((m) => m === 'hit')).toHaveLength(1)
    // Next round starts from the guesses: the lucky one stays found.
    const next = roundFromGuesses(c, [guess!])
    expect(next.found).toEqual([a.get(lucky)])
    expect(canLook(lucky, next, a)).toBe(false)
    expect(looksLeft(c, next)).toBe(c.slots - 1)
    expect(foundNow(next, a)).toEqual([a.get(lucky)])
  })
})
