import { describe, expect, it } from 'vitest'
import { EntrySchema } from '@/contracts/types'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { draftToEntry, draftToForm, findExistingRoom, shiftPuzzleFlags, validateForm, type FormState } from './form'
import { sampleDraft } from './sampleDraft'

function completeForm(): FormState {
  const { form } = draftToForm(sampleDraft(), '2026-10-25')
  form.room.city = 'Oakland'
  form.review.ratings.storyline.score = 77
  form.review.puzzles[1].type = 'math'
  form.review.multiRoom = true
  form.review.liveActors = false
  return form
}

describe('draftToForm', () => {
  it('defaults a missing date to today and keeps it flagged', () => {
    const d = sampleDraft()
    d.flags = d.flags.filter((f) => f !== 'review.date')
    const { form, flags } = draftToForm(d, '2026-10-25')
    expect(form.review.date).toBe('2026-10-25')
    expect(flags).toContain('review.date')
    expect(form.room.city).toBe('')
    expect(form.review.multiRoom).toBeNull()
  })

  it('turns the extraction.fallback flag into a draft-level note, not a field flag', () => {
    const d = sampleDraft()
    d.flags = [...d.flags, 'extraction.fallback']
    const { flags, notes } = draftToForm(d, '2026-10-25')
    expect(flags).not.toContain('extraction.fallback')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/offline extractor/)
    expect(draftToForm(sampleDraft(), '2026-10-25').notes).toEqual([])
  })
})

describe('validateForm', () => {
  it('reports every missing required field', () => {
    const { form } = draftToForm(sampleDraft(), '2026-10-25')
    const e = validateForm(form)
    expect(Object.keys(e).sort()).toEqual(
      ['room.city', 'review.ratings.storyline.score', 'review.puzzles.1.type', 'review.multiRoom', 'review.liveActors'].sort(),
    )
  })
  it('passes a complete form', () => {
    expect(validateForm(completeForm())).toEqual({})
  })
  it('requires escaped and genre', () => {
    const f = completeForm()
    f.review.escaped = null
    f.room.genre = ''
    expect(Object.keys(validateForm(f))).toEqual(expect.arrayContaining(['review.escaped', 'room.genre']))
  })
})

describe('draftToEntry', () => {
  it('builds an Entry that validates with EntrySchema', () => {
    const entry = draftToEntry(completeForm(), [])
    expect(EntrySchema.safeParse(entry).success).toBe(true)
    expect(entry.room.id).toMatch(/^room_/)
    expect(entry.review.id).toMatch(/^rev_/)
    expect(entry.review.roomId).toBe(entry.room.id)
    expect(entry.room.city).toBe('Oakland')
    expect(entry.review.puzzles).toHaveLength(2)
    for (const p of entry.review.puzzles) {
      expect(p.id).toMatch(/^pz_/)
      expect(p.reviewId).toBe(entry.review.id)
    }
    expect(entry.review.ratings.storyline.score).toBe(77)
  })
  it('drops blank puzzles', () => {
    const f = completeForm()
    f.review.puzzles.push({ key: 'x', description: '  ', type: '', memorable: false })
    expect(draftToEntry(f).review.puzzles).toHaveLength(2)
  })
  it('throws on an incomplete form', () => {
    const { form } = draftToForm(sampleDraft(), '2026-10-25')
    expect(() => draftToEntry(form)).toThrow(/not complete/)
  })
  it('reuses the existing room id on a revisit (case-insensitive)', () => {
    const f = completeForm()
    f.room.name = 'the clockmaker '
    f.room.company = 'PUZZLE PARLOUR'
    f.room.city = 'san francisco'
    const entry = draftToEntry(f, FIXTURE_DATASET.rooms)
    expect(entry.room.id).toBe('room_fx_1')
    expect(entry.room.name).toBe('The Clockmaker')
    expect(entry.review.roomId).toBe('room_fx_1')
    expect(findExistingRoom({ name: 'Clockmaker', company: 'Puzzle Parlour', city: 'San Francisco' }, FIXTURE_DATASET.rooms)).toBeUndefined()
  })
})

describe('shiftPuzzleFlags', () => {
  it('drops the removed puzzle flags and shifts later ones', () => {
    expect(shiftPuzzleFlags(['room.city', 'review.puzzles.0.type', 'review.puzzles.2.description'], 0)).toEqual([
      'room.city',
      'review.puzzles.1.description',
    ])
  })
})
