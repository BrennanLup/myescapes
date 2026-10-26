import { describe, expect, it } from 'vitest'
import { LogRowSchema } from '../../contracts/models'
import { BOB, MIA, game, logRow, participant, ratings, review, venue } from '../../social/testing/fakeApi'
import {
  applyFilters,
  crewLabel,
  crewOptions,
  decodeCrewFilter,
  encodeCrewFilter,
  escapedLabel,
  matchesQuery,
  nextSort,
  sortRows,
  summary,
} from './logic'

const rows = [
  logRow({ visitId: 'v1', date: '2026-10-12', crew: [participant('p1', MIA), participant('p2', BOB, 'pending')] }),
  logRow({ visitId: 'v2', date: '2026-09-01', game: game({ name: 'The Vault' }), myReview: review({ ratings: ratings(70) }), crew: [participant('p3', MIA)] }),
  logRow({ visitId: 'v3', date: '2025-05-01', game: game({ name: 'Haunted Lighthouse' }), venue: venue({ name: 'Maple & Key', city: 'Toronto' }), escaped: false, myReview: null, crew: [participant('p4', 'Jules')] }),
  logRow({ visitId: 'v4', date: '2026-01-01', game: game({ name: 'Árbol Secreto' }), escaped: null, crew: [participant('p5', MIA, 'declined')] }),
]

describe('rooms table logic', () => {
  it('builders are contract-valid', () => {
    for (const r of rows) expect(LogRowSchema.safeParse(r).success).toBe(true)
  })

  it('labels crew, skipping declined tags', () => {
    expect(crewLabel(rows[0])).toBe('Mia, Bob')
    expect(crewLabel(rows[3])).toBe('Solo')
    expect(crewLabel(rows[2])).toBe('Jules')
  })

  it('lists crew options by frequency', () => {
    const opts = crewOptions(rows)
    expect(opts.map((o) => [o.label, o.count])).toEqual([
      ['Mia', 2],
      ['Bob', 1],
      ['Jules', 1],
    ])
    expect(opts[0].value).toBe(`u:${MIA.id}`)
    expect(opts[2].value).toBe('g:jules')
  })

  it('searches game, venue, city and crew, accent-insensitively', () => {
    expect(matchesQuery(rows[2], 'toronto')).toBe(true)
    expect(matchesQuery(rows[2], 'maple light')).toBe(true)
    expect(matchesQuery(rows[2], 'vault')).toBe(false)
    expect(matchesQuery(rows[0], 'mia')).toBe(true)
    expect(matchesQuery(rows[3], 'arbol')).toBe(true)
    expect(matchesQuery(rows[3], '   ')).toBe(true)
  })

  it('filters with / without a crew member', () => {
    const mia = `u:${MIA.id}`
    const ids = (f: Parameters<typeof applyFilters>[2]) => applyFilters(rows, '', f, { key: 'date', dir: 'desc' }).map((r) => r.visitId)
    expect(ids({ mode: 'with', value: mia })).toEqual(['v1', 'v2'])
    expect(ids({ mode: 'without', value: mia })).toEqual(['v4', 'v3'])
    expect(ids({ mode: 'all' })).toEqual(['v1', 'v2', 'v4', 'v3'])
  })

  it('sorts by score with unscored rows last in both directions', () => {
    expect(sortRows(rows, { key: 'score', dir: 'desc' }).map((r) => r.visitId)).toEqual(['v1', 'v4', 'v2', 'v3'])
    expect(sortRows(rows, { key: 'score', dir: 'asc' }).map((r) => r.visitId).at(-1)).toBe('v3')
    expect(sortRows(rows, { key: 'name', dir: 'asc' }).map((r) => r.game.name)).toEqual(['Árbol Secreto', 'Haunted Lighthouse', 'The Lost Observatory', 'The Vault'])
  })

  it('toggles sort direction', () => {
    expect(nextSort({ key: 'date', dir: 'desc' }, 'date')).toEqual({ key: 'date', dir: 'asc' })
    expect(nextSort({ key: 'date', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'score')).toEqual({ key: 'score', dir: 'desc' })
  })

  it('round-trips crew filters, rejecting junk', () => {
    const f = { mode: 'without', value: 'g:mia jones' } as const
    expect(decodeCrewFilter(encodeCrewFilter(f))).toEqual(f)
    expect(decodeCrewFilter('all')).toEqual({ mode: 'all' })
    expect(decodeCrewFilter('nope|x')).toEqual({ mode: 'all' })
    expect(decodeCrewFilter('with|')).toEqual({ mode: 'all' })
  })

  it('labels escapes and summarises', () => {
    expect(escapedLabel(true, 52.4)).toBe('Yes · 52m')
    expect(escapedLabel(true, null)).toBe('Yes')
    expect(escapedLabel(false, 60)).toBe('No')
    expect(escapedLabel(null, null)).toBe('–')
    expect(summary(rows)).toEqual({ count: 4, escaped: 2, rate: 2 / 3 })
    expect(summary([])).toEqual({ count: 0, escaped: 0, rate: null })
  })
})
