import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../contracts/routes'
import type { ReviewDraft } from '../../contracts/types'
import { blankDraft } from './index'
import { draftToForm, formFlags, hintsFrom, memorableIds, numOrNull, reviewOf, toCreateVisitBody, validateLogForm } from './form'

const draft: ReviewDraft = {
  room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: '2026-10-12',
    crew: ['me', 'Mia', 'Leo'],
    ratings: {
      overall: { score: 87, comment: 'Great' },
      puzzles: { score: 90, comment: '' },
      setting: { score: 92, comment: '' },
      storyline: { score: null, comment: '' },
      difficulty: { score: 70, comment: '' },
    },
    puzzles: [
      { description: 'Star chart dome', type: 'lock-and-key', memorable: true },
      { description: '  ', type: null, memorable: false },
      { description: 'UV search', type: 'search', memorable: false },
    ],
    escaped: true,
    escapeTimeMinutes: 48,
    visibleTimer: true,
    multiRoom: false,
    flashlights: null,
    liveActors: true,
    toolsUsed: ['UV light', 'uv light', 'magnets'],
    voiceTranscript: 'from the draft',
  },
  flags: ['review.ratings.storyline.score', 'review.flashlights', 'room.address', 'extraction.fallback'],
  mode: 'mock',
}

describe('mobile log form', () => {
  it('turns a draft into a form, keeping only review flags', () => {
    const { form, flags } = draftToForm(draft, { transcript: 'my words' })
    expect(flags).toEqual(['ratings.storyline.score', 'flashlights'])
    expect(form.transcript).toBe('my words')
    expect(form.toolsUsed).toEqual(['UV light', 'magnets'])
    expect(form.puzzles.map((p) => p.description)).toEqual(['Star chart dome', 'UV search'])
    expect(form.visibility).toBe('public')
    expect(formFlags(['review.date', 'review.date', 'room.city'])).toEqual(['date'])
  })

  it('flags a missing date and fills in today', () => {
    const { form, flags } = draftToForm({ ...draft, review: { ...draft.review, date: 'last week' } }, { today: '2026-10-26' })
    expect(form.date).toBe('2026-10-26')
    expect(flags).toContain('date')
  })

  it('validates scores, dates, minutes and puzzle types', () => {
    const { form } = draftToForm(draft)
    const e = validateLogForm(form, '2026-10-26')
    expect(Object.keys(e)).toEqual(['ratings.storyline.score'])
    const bad = validateLogForm(
      { ...form, date: '2027-01-01', escapeTimeMinutes: 700, ratings: { ...form.ratings, storyline: { score: 101, comment: '' } }, puzzles: [{ key: 'k', description: 'x', type: '', memorable: false }] },
      '2026-10-26',
    )
    expect(bad).toMatchObject({ date: expect.any(String), escapeTimeMinutes: expect.any(String), 'ratings.storyline.score': expect.any(String), 'puzzles.0.type': expect.any(String) })
  })

  it('builds a POST /api/visits body the contract accepts', () => {
    const { form } = draftToForm(draft)
    form.ratings.storyline.score = 78
    const body = toCreateVisitBody(form, 'gam_observatory', [{ userId: 'usr_mia' }, { guestName: 'Leo' }])
    const parsed = (ROUTES.createVisit.body as import('zod').ZodType).parse(body)
    expect(parsed).toMatchObject({
      gameId: 'gam_observatory',
      facts: { date: '2026-10-12', escaped: true, escapeTimeMinutes: 48, flashlights: null, toolsUsed: ['UV light', 'magnets'] },
      crew: [{ userId: 'usr_mia' }, { guestName: 'Leo' }],
      review: { visibility: 'public', containsSpoilers: false, memorablePuzzleIds: [] },
    })
    expect(body.puzzles).toHaveLength(2)
    expect(body.review?.ratings.overall).toEqual({ score: 87, comment: 'Great' })
  })

  it('maps memorable puzzles to the saved visit puzzle ids by position', () => {
    const { form } = draftToForm(draft)
    const ids = memorableIds(form, [
      { id: 'pz2', description: 'UV search', type: 'search', notes: '', position: 1 },
      { id: 'pz1', description: 'Star chart dome', type: 'lock-and-key', notes: '', position: 0 },
    ])
    expect(ids).toEqual(['pz1'])
    form.ratings.storyline.score = 50
    expect(reviewOf(form, ids).memorablePuzzleIds).toEqual(['pz1'])
  })

  it('hints come from the extraction, or from the room fields for an older server', () => {
    expect(hintsFrom(draft)).toEqual({ venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: null })
    expect(hintsFrom({ ...draft, hints: { venue: 'V', game: 'G', city: null, country: 'CA' } })).toEqual({ venue: 'V', game: 'G', city: null, country: 'CA' })
  })

  it('a blank draft (fill in by hand) needs every score', () => {
    const { form } = draftToForm(blankDraft('typed'), { today: '2026-10-26' })
    expect(form.transcript).toBe('typed')
    expect(Object.keys(validateLogForm(form, '2026-10-26'))).toHaveLength(5)
    expect(numOrNull('')).toBeNull()
    expect(numOrNull('42')).toBe(42)
    expect(numOrNull('x')).toBeNull()
  })
})
