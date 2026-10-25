import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bus } from '@/contracts/events'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { useStore } from '@/state/store'
import { ReviewOverlay } from './index'
import { boardOrder, neighbours, formatAddress, formatDate, initials, mapsUrl, safeUrl } from './helpers'

function setup(pins: Array<{ roomId: string; order: number }> = []) {
  useStore.getState().setDataset(structuredClone(FIXTURE_DATASET))
  useStore.getState().setBoardPins(pins.map((p) => ({ ...p, group: 'g', target: [0, 0, 0] })))
}

function spyBus() {
  const events: Array<{ type: string; payload: unknown }> = []
  const off = bus.onAny((e) => events.push(e))
  return { events, off }
}

beforeEach(() => setup())
afterEach(() => cleanup())

describe('ReviewOverlay', () => {
  it('renders every section for a fixture review', () => {
    render(<ReviewOverlay roomId="room_fx_1" />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = screen.getByRole('heading', { level: 2, name: 'The Clockmaker' })
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)

    // Header
    expect(screen.getByText('Puzzle Parlour')).toBeTruthy()
    expect(screen.getByText(/San Francisco/, { selector: 'p' })).toBeTruthy()
    expect(screen.getByTestId('genre-chip').textContent).toContain('Mystery')
    expect(screen.getByText('14 March 2025')).toBeTruthy()
    const crew = screen.getAllByTestId('crew-member').map((n) => n.textContent)
    expect(crew).toEqual(['BRBrennan', 'MAMaya'])
    expect(screen.getByRole('link', { name: /example\.com/ }).getAttribute('href')).toBe('https://example.com')
    expect(screen.getByRole('link', { name: /1 Market St/ }).getAttribute('href')).toContain('google.com/maps')

    // No photos -> genre placeholder
    expect(screen.getByTestId('photo-placeholder')).toBeTruthy()

    // Ratings
    for (const [k, v] of Object.entries({ overall: 88, puzzles: 90, setting: 85, storyline: 80, difficulty: 70 })) {
      expect(screen.getByTestId(`score-${k}`).textContent).toBe(String(v))
      expect(within(screen.getByTestId(`rating-${k}`)).getByRole('meter').getAttribute('aria-valuenow')).toBe(String(v))
    }
    expect(screen.getAllByText("“Loved it.”").length).toBe(1)
    expect(screen.getByTestId("verdict").textContent).toContain("Loved it.")

    // Puzzles
    const puzzles = screen.getAllByTestId('puzzle')
    expect(puzzles).toHaveLength(2)
    expect(puzzles[0].textContent).toContain('grandfather clock')
    expect(puzzles[0].textContent).toContain('Lock & key')
    expect(puzzles[0].textContent).toContain('Memorable puzzle')
    expect(puzzles[1].textContent).toContain('Math')
    expect(puzzles[1].textContent).not.toContain('Memorable puzzle')

    // Tools
    expect(screen.getAllByTestId('tool').map((t) => t.textContent)).toEqual(['keypads', 'magnets'])

    // Voice note (collapsible)
    const note = screen.getByTestId('voice-note') as HTMLDetailsElement
    expect(note.tagName).toBe('DETAILS')
    expect(note.textContent).toContain('We did The Clockmaker')
  })

  it('shows the right yes/no badges and escape time', () => {
    render(<ReviewOverlay roomId="room_fx_1" />)
    const val = (k: string) => screen.getByTestId(`badge-${k}`).getAttribute('data-value')
    expect(val('escaped')).toBe('yes')
    expect(val('visibleTimer')).toBe('yes')
    expect(val('multiRoom')).toBe('yes')
    expect(val('flashlights')).toBe('no')
    expect(val('liveActors')).toBe('no')
    expect(screen.getByTestId('badge-escaped').textContent).toContain('52 min')
    expect(screen.getByTestId('escape-stamp').textContent).toContain('52 min')
  })

  it('shows a failed escape for room 2', () => {
    render(<ReviewOverlay roomId="room_fx_2" />)
    expect(screen.getByTestId('badge-escaped').getAttribute('data-value')).toBe('no')
    expect(screen.getByTestId('badge-flashlights').getAttribute('data-value')).toBe('yes')
    expect(screen.getByTestId('badge-liveActors').getAttribute('data-value')).toBe('yes')
    expect(screen.getByTestId('escape-stamp').textContent).toContain('Trapped')
  })

  it('emits paper sfx on open and moves focus into the dialog', () => {
    const { events, off } = spyBus()
    render(<ReviewOverlay roomId="room_fx_1" />)
    off()
    expect(events).toContainEqual({ type: 'sfx', payload: { name: 'paper' } })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('Esc and the close button emit overlay:close', () => {
    const { events, off } = spyBus()
    render(<ReviewOverlay roomId="room_fx_1" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    off()
    expect(events.filter((e) => e.type === 'overlay:close')).toHaveLength(2)
  })

  it('arrow keys and buttons navigate rooms in board order', () => {
    setup([
      { roomId: 'room_fx_3', order: 0 },
      { roomId: 'room_fx_1', order: 1 },
      { roomId: 'room_fx_2', order: 2 },
    ])
    const { events, off } = spyBus()
    render(<ReviewOverlay roomId="room_fx_1" />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: 'Next room' }))
    off()
    const opened = events.filter((e) => e.type === 'review:open').map((e) => (e.payload as { roomId: string }).roomId)
    expect(opened).toEqual(['room_fx_2', 'room_fx_3', 'room_fx_2'])
  })

  it('falls back to rooms array order without board pins, and re-renders on navigation', () => {
    const { events, off } = spyBus()
    const { rerender } = render(<ReviewOverlay roomId="room_fx_1" />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(events.filter((e) => e.type === 'review:open').map((e) => (e.payload as { roomId: string }).roomId)).toEqual(['room_fx_3'])
    act(() => rerender(<ReviewOverlay roomId="room_fx_3" />))
    off()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Mars Base Omega')
  })

  it('shows room info and a friendly empty state when there is no review', () => {
    const d = structuredClone(FIXTURE_DATASET)
    d.rooms.push({ id: 'room_new', name: 'Pirate Cove', company: 'Escape Hatch', city: 'Toronto', genre: 'adventure', address: '', website: '', photos: [] })
    useStore.getState().setDataset(d)
    render(<ReviewOverlay roomId="room_new" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Pirate Cove' })).toBeTruthy()
    expect(screen.getByTestId('no-review').textContent).toContain('No review yet')
    expect(screen.queryByTestId('rating-overall')).toBeNull()
    expect(screen.queryByTestId('badge-escaped')).toBeNull()
  })

  it('shows a photo gallery with prev/next when photos exist', () => {
    const d = structuredClone(FIXTURE_DATASET)
    d.rooms[0].photos = [{ url: '/a.jpg', caption: 'Team pic' }]
    d.reviews[0].photos = [{ url: '/b.jpg' }]
    useStore.getState().setDataset(d)
    render(<ReviewOverlay roomId="room_fx_1" />)
    const img = () => screen.getByTestId('gallery').querySelector('img')!
    expect(img().getAttribute('src')).toBe('/a.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(img().getAttribute('src')).toBe('/b.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(img().getAttribute('src')).toBe('/a.jpg')
  })

  it('handles an unknown room id', () => {
    render(<ReviewOverlay roomId="nope" />)
    expect(screen.getByText('Room not found')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('formatAddress does not repeat a city the address already contains', () => {
    expect(formatAddress('418 Bayview Wharf, San Francisco, CA', 'San Francisco')).toBe('418 Bayview Wharf, San Francisco, CA')
    expect(formatAddress('12 Main St', 'Toronto')).toBe('12 Main St, Toronto')
    expect(formatAddress('', 'Toronto')).toBe('Toronto')
    expect(formatAddress('12 Main St', '')).toBe('12 Main St')
    expect(mapsUrl('1 Rue X, paris', 'Paris')).toContain(encodeURIComponent('1 Rue X, paris'))
    expect(mapsUrl('1 Rue X, paris', 'Paris')).not.toContain('Paris')
  })
  it('boardOrder sorts pins and appends unpinned rooms', () => {
    const rooms = FIXTURE_DATASET.rooms
    const pins = [
      { roomId: 'room_fx_2', order: 5, group: '', target: [0, 0, 0] as [number, number, number] },
      { roomId: 'room_fx_3', order: 1, group: '', target: [0, 0, 0] as [number, number, number] },
    ]
    expect(boardOrder(pins, rooms)).toEqual(['room_fx_3', 'room_fx_2', 'room_fx_1'])
    expect(boardOrder([], rooms)).toEqual(['room_fx_1', 'room_fx_2', 'room_fx_3'])
  })
  it('neighbours wraps and handles 0/1 rooms', () => {
    expect(neighbours(['a', 'b', 'c'], 'a')).toEqual({ prev: 'c', next: 'b' })
    expect(neighbours(['a'], 'a')).toEqual({ prev: null, next: null })
    expect(neighbours([], 'a')).toEqual({ prev: null, next: null })
  })
  it('formats', () => {
    expect(formatDate('2024-10-31')).toBe('31 October 2024')
    expect(initials('Maya Lopez')).toBe('ML')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('example.com')).toBe('https://example.com')
  })
})

