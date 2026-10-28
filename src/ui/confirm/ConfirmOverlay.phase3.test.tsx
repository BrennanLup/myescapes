// Phase 3 (A): room directory search, photos while reviewing, keyboard-safe scrolling.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GameSummary, PhotoV2, VenueSummary } from '@/contracts/models'
import type { Entry } from '@/contracts/types'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { useStore } from '@/state/store'
import { configurePhotoQueue, resetPhotoQueueForTests, usePhotoQueue } from '@/ui/photos'
import { ConfirmOverlay } from './index'
import { sampleDraft } from './sampleDraft'

const game: GameSummary = {
  id: 'gam_clock',
  slug: 'the-clockmaker',
  name: 'The Clockmaker',
  genre: 'mystery',
  status: 'active',
  venueId: 'ven_pp',
  venueName: 'Puzzle Parlour Downtown',
  venueSlug: 'puzzle-parlour-downtown',
  city: 'San Francisco',
  country: 'US',
  reviewCount: 3,
  avgOverall: 81,
}
const venue: VenueSummary = {
  id: 'ven_pp', slug: 'puzzle-parlour-downtown', name: 'Puzzle Parlour Downtown', brand: 'Puzzle Parlour', address: '1 Gear St', city: 'San Francisco',
  citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: 37.7, lng: -122.4, status: 'active', gameCount: 2,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  useStore.getState().setDataset(FIXTURE_DATASET)
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/directory/search')) return json({ games: [game], venues: [venue] })
    if (url.startsWith('/api/venues/')) return json({ venue: { ...venue, postalCode: null, website: null, phone: null, googlePlaceId: null, createdAt: '2026-01-01T00:00:00.000Z' }, games: [] }, 500)
    return json({ error: 'nope' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
const original = useStore.getState().addEntry
afterEach(() => {
  cleanup()
  useStore.setState({ addEntry: original })
  vi.unstubAllGlobals()
  resetPhotoQueueForTests()
})

function fillRest() {
  fireEvent.change(screen.getByTestId('field-review.ratings.storyline.score'), { target: { value: '81' } })
  fireEvent.change(screen.getByTestId('field-review.puzzles.1.type'), { target: { value: 'math' } })
  fireEvent.click(screen.getByTestId('field-review.multiRoom-yes'))
  fireEvent.click(screen.getByTestId('field-review.liveActors-no'))
}

describe('ConfirmOverlay room search', () => {
  it('offers the exact directory match and saves against that game', async () => {
    const addEntry = vi.fn(async (e: Entry) => e)
    useStore.setState({ addEntry })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    // Every section is on the page at once (no wizard, nothing collapsed).
    for (const t of ['Room', 'Visit', 'Outcome & features', 'Tools', 'Ratings', 'Puzzles', 'Photos']) expect(screen.getByRole('heading', { name: new RegExp(t) })).toBeTruthy()

    fireEvent.click(await screen.findByTestId('room-search-suggestion'))
    expect(screen.getByTestId('confirm-room-linked').textContent).toContain('The Clockmaker')
    expect((screen.getByTestId('field-room.city') as HTMLInputElement).value).toBe('San Francisco')
    expect((screen.getByTestId('field-room.company') as HTMLInputElement).value).toBe('Puzzle Parlour Downtown')
    // The city was flagged by the extractor; the directory answered it.
    expect(screen.queryByTestId('flag-room.city')).toBeNull()

    fillRest()
    await act(async () => fireEvent.click(screen.getByTestId('confirm-save')))
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(addEntry.mock.calls[0][0].room.id).toBe('gam_clock')
  })

  it('unlinks when the room is renamed, and "Add" makes it a new room', async () => {
    const user = userEvent.setup()
    const addEntry = vi.fn(async (e: Entry) => e)
    useStore.setState({ addEntry })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    fireEvent.click(await screen.findByTestId('room-search-suggestion'))
    fireEvent.change(screen.getByTestId('field-room.name'), { target: { value: 'The Clockmaker 2' } })
    expect(screen.queryByTestId('confirm-room-linked')).toBeNull()

    const search = screen.getByTestId('confirm-room-search')
    await user.clear(search)
    await user.type(search, 'Moon Base')
    const add = await screen.findByTestId('roompicker-option-create', {}, { timeout: 2000 })
    fireEvent.click(add)
    expect((screen.getByTestId('field-room.name') as HTMLInputElement).value).toBe('Moon Base')
    fireEvent.change(screen.getByTestId('field-room.city'), { target: { value: 'Austin' } })
    fillRest()
    await act(async () => fireEvent.click(screen.getByTestId('confirm-save')))
    expect(addEntry.mock.calls[0][0].room.id).toMatch(/^room_/)
    expect(addEntry.mock.calls[0][0].room.name).toBe('Moon Base')
  })

  it('Escape closes an open result list without asking to discard the review', async () => {
    const user = userEvent.setup()
    render(<ConfirmOverlay draft={sampleDraft()} />)
    const search = screen.getByTestId('confirm-room-search')
    await user.click(search)
    await user.type(search, 'x')
    await screen.findByTestId('roompicker-list', {}, { timeout: 2000 })
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Discard this review?')).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Discard this review?')).toBeTruthy()
  })
})

describe('ConfirmOverlay photos', () => {
  const photo = (id: string): PhotoV2 => ({ id, visitId: 'vis_saved', url: `/api/photos/${id}`, uploaderId: 'usr_me', caption: '', width: 4, height: 3, createdAt: '2026-10-28T00:00:00.000Z' })

  it('asks signed-out visitors to sign in', () => {
    render(<ConfirmOverlay draft={sampleDraft()} />)
    expect(screen.getByTestId('photo-disabled').textContent).toMatch(/Sign in/)
  })

  it('queues photos while writing and uploads them to the saved visit', async () => {
    const user = userEvent.setup()
    useStore.setState({ dataSource: 'postgres' })
    const uploaded: string[] = []
    configurePhotoQueue({
      resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
      upload: async (visitId) => {
        uploaded.push(visitId)
        return photo(`pho_${uploaded.length}`)
      },
      createUrl: () => 'blob:x',
      revokeUrl: () => {},
    })
    // Like the real store: a save closes the overlay (unmounts the form) before it resolves.
    let unmount = () => {}
    const addEntry = vi.fn(async (e: Entry): Promise<Entry> => {
      unmount()
      return { ...e, review: { ...e.review, id: 'vis_saved' } }
    })
    useStore.setState({ addEntry, reviews: [...useStore.getState().reviews] })
    ;({ unmount } = render(<ConfirmOverlay draft={sampleDraft()} />))
    await user.upload(screen.getByTestId('photo-input'), [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })])
    await waitFor(() => expect(screen.getByTestId('photo-status').textContent).toMatch(/2 photos will upload when you save/))
    expect(uploaded).toHaveLength(0)

    fireEvent.change(screen.getByTestId('field-room.city'), { target: { value: 'San Francisco' } })
    fillRest()
    await act(async () => fireEvent.click(screen.getByTestId('confirm-save')))
    await waitFor(() => expect(uploaded).toEqual(['vis_saved', 'vis_saved']))
    await waitFor(() => expect(usePhotoQueue.getState().items.every((i) => i.status === 'done' && i.target === 'visit:vis_saved')).toBe(true))
  })

  it('drops queued photos when the review is discarded', async () => {
    const user = userEvent.setup()
    useStore.setState({ dataSource: 'postgres' })
    configurePhotoQueue({ resize: async () => ({ blob: new Blob(['x']), width: 1, height: 1 }), createUrl: () => null })
    render(<ConfirmOverlay draft={sampleDraft()} />)
    await user.upload(screen.getByTestId('photo-input'), [new File(['a'], 'a.jpg', { type: 'image/jpeg' })])
    expect(usePhotoQueue.getState().items).toHaveLength(1)
    cleanup()
    expect(usePhotoQueue.getState().items).toHaveLength(0)
  })
})

// QA round 4: an exact directory hit links itself; otherwise a missing company points at "Use it".
describe('ConfirmOverlay exact directory match', () => {
  const at = (room: Partial<ReturnType<typeof sampleDraft>['room']>) => {
    const d = sampleDraft()
    return { ...d, room: { ...d.room, ...room } }
  }

  it('links a same-name, same-city match without a click and saves against that game', async () => {
    const addEntry = vi.fn(async (e: Entry) => e)
    useStore.setState({ addEntry })
    render(<ConfirmOverlay draft={at({ company: null, city: 'san francisco' })} />)
    const chip = await screen.findByTestId('confirm-room-linked')
    expect(chip.textContent).toContain('Matched in the room directory')
    expect(chip.textContent).toContain('Puzzle Parlour Downtown · San Francisco')
    expect(screen.getByTestId('confirm-room-auto')).toBeTruthy()
    // The search box (and its copy of the name) is gone; the fields are filled in.
    expect(screen.queryByTestId('confirm-room-search')).toBeNull()
    expect((screen.getByTestId('field-room.company') as HTMLInputElement).value).toBe('Puzzle Parlour Downtown')
    // Focus stays on the dialog title (not moved to a field).
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check your review' }))

    fillRest()
    await act(async () => fireEvent.click(screen.getByTestId('confirm-save')))
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(addEntry.mock.calls[0][0].room.id).toBe('gam_clock')
  })

  it('links the match once focus leaves the search box, when it arrived while typing there', async () => {
    render(<ConfirmOverlay draft={at({ company: null, city: 'san francisco' })} />)
    const input = document.getElementById('cf-room-search') as HTMLInputElement
    act(() => input.focus())
    expect(await screen.findByTestId('room-search-suggestion')).toBeTruthy()
    expect(screen.queryByTestId('confirm-room-linked')).toBeNull()
    act(() => input.blur())
    expect(await screen.findByTestId('confirm-room-linked')).toBeTruthy()
  })

  it('does not auto-link over a room the person chose themselves when the box loses focus', async () => {
    render(<ConfirmOverlay draft={at({ company: null, city: 'san francisco' })} />)
    const input = document.getElementById('cf-room-search') as HTMLInputElement
    act(() => input.focus())
    expect(await screen.findByTestId('room-search-suggestion')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'My own room' } })
    fireEvent.click(await screen.findByTestId('roompicker-option-create'))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(screen.queryByTestId('confirm-room-linked')).toBeNull()
  })

  it('does not link again after "Change"', async () => {
    render(<ConfirmOverlay draft={at({ company: null, city: 'San Francisco' })} />)
    fireEvent.click(await screen.findByTestId('confirm-room-unlink'))
    expect(await screen.findByTestId('room-search-suggestion')).toBeTruthy()
    expect(screen.queryByTestId('confirm-room-linked')).toBeNull()
  })

  it('does not link a match from another city; Save and "Show me" point the missing company at "Use it"', async () => {
    render(<ConfirmOverlay draft={at({ company: null, city: null })} />)
    const use = await screen.findByTestId('room-search-suggestion')
    expect(screen.queryByTestId('confirm-room-linked')).toBeNull()

    fireEvent.click(screen.getByTestId('confirm-save'))
    expect(screen.getByTestId('error-room.company').textContent).toMatch(/Use it/)
    expect(document.activeElement).toBe(use)

    // (Not the search box: its list closes on a timer after blur.)
    screen.getByTestId('field-room.name').focus()
    fireEvent.click(screen.getByTestId('confirm-next-missing'))
    expect(document.activeElement).toBe(use)

    fireEvent.click(use)
    expect(screen.queryByTestId('error-room.company')).toBeNull()
  })

  it('says "Not sure" and sentence-case genres, like every other control', () => {
    render(<ConfirmOverlay draft={sampleDraft()} />)
    const genre = screen.getByTestId('field-room.genre') as HTMLSelectElement
    expect(genre.className).not.toMatch(/capitalize/)
    const labels = [...genre.options].map((o) => o.textContent)
    expect(labels[0]).toBe('Not sure')
    expect(labels).toContain('Sci-fi')
    expect(labels).toContain('Mystery')
  })
})
