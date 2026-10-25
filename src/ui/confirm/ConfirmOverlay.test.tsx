import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bus } from '@/contracts/events'
import { EntrySchema, type Entry } from '@/contracts/types'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { useStore } from '@/state/store'
import { ConfirmOverlay } from './index'
import { sampleDraft } from './sampleDraft'

const flaggedWrap = (testId: string) => screen.getByTestId(testId).closest('[data-flagged]') as HTMLElement

function fillRequired() {
  fireEvent.change(screen.getByTestId('field-room.city'), { target: { value: 'San Francisco' } })
  fireEvent.change(screen.getByTestId('field-review.ratings.storyline.score'), { target: { value: '81' } })
  fireEvent.change(screen.getByTestId('field-review.puzzles.1.type'), { target: { value: 'math' } })
  fireEvent.click(screen.getByTestId('field-review.multiRoom-yes'))
  fireEvent.click(screen.getByTestId('field-review.liveActors-no'))
}

describe('ConfirmOverlay', () => {
  const original = useStore.getState().addEntry
  beforeEach(() => {
    useStore.getState().setDataset(FIXTURE_DATASET)
  })
  afterEach(() => {
    cleanup()
    useStore.setState({ addEntry: original })
    vi.restoreAllMocks()
  })

  it('shows the mode badge and highlights flagged fields', () => {
    render(<ConfirmOverlay draft={sampleDraft()} />)
    expect(screen.getByTestId('confirm-mode').textContent).toMatch(/Mock extractor/)
    expect(flaggedWrap('field-room.city').dataset.flagged).toBe('true')
    expect(flaggedWrap('field-room.name').dataset.flagged).toBe('false')
    expect(flaggedWrap('field-review.ratings.storyline.score').dataset.flagged).toBe('true')
    expect(screen.getByTestId('flag-room.city').textContent).toBe('Check this')
    expect(screen.getByTestId('confirm-flag-summary').textContent).toMatch(/6 fields need a look/)
    // date defaults to today but stays flagged
    expect((screen.getByTestId('field-review.date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(flaggedWrap('field-review.date').dataset.flagged).toBe('true')
  })

  it('clears the highlight when a flagged field is edited', () => {
    render(<ConfirmOverlay draft={sampleDraft({ mode: 'claude' })} />)
    expect(screen.getByTestId('confirm-mode').textContent).toBe('Extracted by Claude')
    fireEvent.change(screen.getByTestId('field-room.city'), { target: { value: 'Oakland' } })
    expect(flaggedWrap('field-room.city').dataset.flagged).toBe('false')
    expect(screen.queryByTestId('flag-room.city')).toBeNull()
    expect(screen.getByTestId('confirm-flag-summary').textContent).toMatch(/5 fields need a look/)
  })

  it('blocks save until required fields are valid', () => {
    const addEntry = vi.fn(async (e: Entry) => e)
    useStore.setState({ addEntry })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    const save = screen.getByTestId('confirm-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByTestId('confirm-save-reason').textContent).toMatch(/Still needed: City/)
    expect(screen.getByTestId('error-room.city')).toBeTruthy()
    fireEvent.click(save)
    expect(addEntry).not.toHaveBeenCalled()
    fillRequired()
    expect(save.disabled).toBe(false)
  })

  it('saves a valid entry via addEntry, reusing the room id on a revisit', async () => {
    const addEntry = vi.fn(async (e: Entry) => e)
    useStore.setState({ addEntry })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    fillRequired()
    expect(screen.getByTestId('confirm-revisit')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-save'))
    })
    expect(addEntry).toHaveBeenCalledTimes(1)
    const entry = addEntry.mock.calls[0][0]
    expect(EntrySchema.safeParse(entry).success).toBe(true)
    expect(entry.room.id).toBe('room_fx_1')
    expect(entry.review.multiRoom).toBe(true)
    expect(entry.review.liveActors).toBe(false)
    expect(entry.review.ratings.storyline.score).toBe(81)
  })

  it('shows a save error and keeps the form', async () => {
    useStore.setState({ addEntry: vi.fn(async () => Promise.reject(new Error('sheet offline'))) })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    fillRequired()
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-save'))
    })
    expect(screen.getByTestId('confirm-error').textContent).toMatch(/sheet offline/)
    expect((screen.getByTestId('field-room.city') as HTMLInputElement).value).toBe('San Francisco')
    expect((screen.getByTestId('confirm-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks before discarding on cancel and Esc', () => {
    const close = vi.fn()
    const off = bus.on('overlay:close', close)
    render(<ConfirmOverlay draft={sampleDraft()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Discard this review?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('confirm-discard-no'))
    expect(screen.queryByText('Discard this review?')).toBeNull()
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    fireEvent.click(screen.getByTestId('confirm-discard-yes'))
    expect(close).toHaveBeenCalledTimes(1)
    off()
  })

  it('adds and removes crew chips and puzzles', () => {
    render(<ConfirmOverlay draft={sampleDraft()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Jules' }))
    expect(screen.getByRole('button', { name: 'Remove Jules' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maya' }))
    expect(screen.queryByRole('button', { name: 'Remove Maya' })).toBeNull()
    fireEvent.click(screen.getByTestId('puzzle-remove-0'))
    // flag for old puzzle 1 type shifted onto puzzle 0
    expect(flaggedWrap('field-review.puzzles.0.type').dataset.flagged).toBe('true')
    fireEvent.click(screen.getByTestId('puzzle-add'))
    expect(screen.getByTestId('field-review.puzzles.1.description')).toBeTruthy()
  })
})
