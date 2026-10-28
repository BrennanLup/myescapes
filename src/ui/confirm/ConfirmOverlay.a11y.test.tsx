// QA round 3: focus on open, errors tied to their controls, the "Check this" chips as one Tab stop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { useStore } from '@/state/store'
import { ConfirmOverlay } from './index'
import { sampleDraft } from './sampleDraft'

describe('ConfirmOverlay accessibility', () => {
  beforeEach(() => {
    useStore.getState().setDataset(FIXTURE_DATASET)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('moves focus into the dialog, onto its title, when it opens', () => {
    render(<ConfirmOverlay draft={sampleDraft()} />)
    const title = screen.getByRole('heading', { name: 'Check your review' })
    expect(document.activeElement).toBe(title)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('marks the first invalid control and points it at its error text after Save', async () => {
    const draft = sampleDraft({ flags: [] })
    draft.review.ratings.puzzles.score = null
    draft.review.escaped = null
    render(<ConfirmOverlay draft={draft} />)
    // Before Save nothing is marked.
    expect(screen.getByTestId('field-review.ratings.puzzles.score-slider').getAttribute('aria-invalid')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-save'))
    })
    const city = screen.getByTestId('field-room.city')
    expect(document.activeElement).toBe(city)
    expect(city.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(city.getAttribute('aria-describedby') ?? '')?.textContent).toBe('City is required')

    for (const id of ['field-review.ratings.puzzles.score-slider', 'field-review.ratings.puzzles.score']) {
      const el = screen.getByTestId(id)
      expect(el.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Set a puzzles score')
    }
    const escaped = screen.getByTestId('field-review.escaped')
    expect(escaped.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(escaped.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Did you escape?')
    // A valid field stays unmarked.
    expect(screen.getByTestId('field-room.name').getAttribute('aria-invalid')).toBeNull()

    // Fixing it removes the marks.
    fireEvent.change(city, { target: { value: 'Oakland' } })
    expect(city.getAttribute('aria-invalid')).toBeNull()
    expect(city.getAttribute('aria-describedby')).toBeNull()
  })

  it('makes the "Check this" chips one Tab stop with arrow keys inside', () => {
    vi.useFakeTimers()
    try {
      render(<ConfirmOverlay draft={sampleDraft()} />)
      const bar = screen.getByRole('toolbar', { name: 'Fields to check' })
      const buttons = () => [...bar.querySelectorAll('button')]
      expect(buttons()).toHaveLength(12)
      expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1)
      expect(buttons()[0].tabIndex).toBe(0)

      fireEvent.keyDown(buttons()[0], { key: 'ArrowRight' })
      expect(document.activeElement).toBe(buttons()[1])
      expect(buttons()[1].tabIndex).toBe(0)
      expect(buttons()[0].tabIndex).toBe(-1)
      fireEvent.keyDown(buttons()[1], { key: 'End' })
      expect(document.activeElement).toBe(buttons()[11])
      fireEvent.keyDown(buttons()[11], { key: 'ArrowRight' })
      expect(document.activeElement).toBe(buttons()[0])

      // Ticking one off keeps the keyboard in the chips (on the next chip).
      fireEvent.keyDown(buttons()[0], { key: 'ArrowRight' })
      fireEvent.click(buttons()[1])
      act(() => {
        vi.runAllTimers()
      })
      expect(buttons()).toHaveLength(10)
      expect(document.activeElement).toBe(buttons()[0])
      expect(buttons()[0].textContent).toBe('Date')
    } finally {
      vi.useRealTimers()
    }
  })
})
