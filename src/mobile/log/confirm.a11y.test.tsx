// QA round 4: every input on the phone's review form has an accessible name.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameSummary, VenueSummary } from '../../contracts/models'
import type { ReviewDraft } from '../../contracts/types'
import { ConfirmStep } from './confirm'
import { draftToForm } from './form'

const VENUE: VenueSummary = {
  id: 'ven_starlight', slug: 'starlight', name: 'Starlight Escapes', brand: null, address: '', city: 'San Francisco',
  citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 1,
}
const GAME: GameSummary = {
  id: 'gam_obs', slug: 'obs', name: 'The Lost Observatory', genre: 'sci-fi', status: 'active', venueId: VENUE.id, venueName: VENUE.name,
  venueSlug: VENUE.slug, city: 'San Francisco', country: 'US', reviewCount: 0, avgOverall: null,
}
const r = (score: number | null) => ({ score, comment: '' })
const DRAFT = {
  room: { name: GAME.name, company: VENUE.name, city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: '2026-10-12', crew: [], ratings: { overall: r(87), puzzles: r(90), setting: r(92), storyline: r(null), difficulty: r(70) },
    puzzles: [{ description: 'Star chart', type: null, memorable: false }], escaped: true, escapeTimeMinutes: 48,
    visibleTimer: true, multiRoom: false, flashlights: null, liveActors: true, toolsUsed: [], voiceTranscript: '',
  },
  flags: [], mode: 'mock',
} as unknown as ReviewDraft

afterEach(cleanup)

function renderStep() {
  const { form } = draftToForm(DRAFT, { today: '2026-10-28' })
  return render(
    <ConfirmStep
      form={form} onChange={vi.fn()} flags={[]} errors={{}} venue={VENUE} game={GAME} crew={[]} onCrewChange={vi.fn()}
      crewSuggestions={[]} notice={null} saving={false} saveError={null} onChangeGame={vi.fn()} onChangeRoom={vi.fn()} onSave={vi.fn()}
    />,
  )
}

describe('phone review form labels', () => {
  it('ties "Date played" and "Escape time" captions to their inputs', () => {
    renderStep()
    expect(screen.getByLabelText('Date played')).toBe(screen.getByTestId('confirm-date'))
    expect(screen.getByLabelText('Escape time (minutes)')).toBe(screen.getByTestId('confirm-time'))
    expect(screen.getByLabelText('Overall (1-100)')).toBe(screen.getByTestId('confirm-score-overall'))
    expect(screen.getByLabelText('Overall comment (optional)')).toBe(screen.getByTestId('confirm-comment-overall'))
    expect(screen.getByLabelText('Tools used')).toBeTruthy()
  })

  it('names the Yes / No / Not sure groups by their question', () => {
    renderStep()
    expect(screen.getByRole('group', { name: 'Did you escape?' }).contains(screen.getByTestId('confirm-escaped-yes'))).toBe(true)
    expect(screen.getByRole('group', { name: 'Live actors' })).toBeTruthy()
  })

  it('gives every text, number and date input an accessible name', () => {
    const { container } = renderStep()
    const unnamed = [...container.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select')].filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title) return false
      return !(el.id && container.querySelector(`label[for="${el.id}"]`)) && !el.closest('label')
    })
    expect(unnamed.map((el) => el.outerHTML)).toEqual([])
  })

  it('makes the answer buttons and "Not right? Change it" 44 px tap targets', () => {
    renderStep()
    expect(screen.getByTestId('confirm-escaped-unknown').className).toMatch(/\bmin-h-11\b/)
    expect(screen.getByTestId('confirm-change-game').className).toMatch(/\bmin-h-11\b/)
  })
})
