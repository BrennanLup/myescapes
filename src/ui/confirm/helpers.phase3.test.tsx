import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GameSummary } from '@/contracts/models'
import { isTypingField, keyboardInset, layoutShrunk, needsReveal, noteViewport, resetViewportMemory } from './keyboard'
import { roundCoord } from './near'
import { exactGameMatch, RoomSearch } from './RoomSearch'
import { draftToForm, draftToEntry, linkGame, linkMatches, linkVenue, newRoomNamed, venueMatches } from './form'
import { sampleDraft } from './sampleDraft'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** Let the picker's close-on-blur timer (150 ms) run before the test ends, not after the page is gone. */
const settleBlur = () => act(async () => {
  await new Promise((r) => setTimeout(r, 200))
})

const g = (id: string, name: string, city: string): GameSummary => ({ id, slug: id, name, genre: 'heist', status: 'active', venueId: 'ven', venueName: 'Lockbox', venueSlug: 'lockbox', city, country: 'US', reviewCount: 0, avgOverall: null })

describe('keyboard helpers', () => {
  it('measures the keyboard from the visual viewport and ignores URL-bar wobble', () => {
    expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 480, offsetTop: 0 } as VisualViewport })).toBe(320)
    expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 740, offsetTop: 0 } as VisualViewport })).toBe(0)
    expect(keyboardInset({ innerHeight: 800, visualViewport: null })).toBe(0)
  })
  it('counts a page the keyboard made shorter (Firefox for Android) as keyboard-open while typing', () => {
    resetViewportMemory()
    const field = document.createElement('input')
    const button = document.createElement('button')
    noteViewport({ innerWidth: 390, innerHeight: 844 })
    // The keyboard took 364 px of the layout viewport; the visual viewport matches it, so the inset is 0.
    noteViewport({ innerWidth: 390, innerHeight: 480 })
    expect(keyboardInset({ innerHeight: 480, visualViewport: { height: 480, offsetTop: 0 } as VisualViewport })).toBe(0)
    expect(layoutShrunk({ innerWidth: 390, innerHeight: 480 }, field)).toBe(true)
    // Not while a button has focus, not for URL-bar wobble, and a rotation starts over.
    expect(layoutShrunk({ innerWidth: 390, innerHeight: 480 }, button)).toBe(false)
    expect(layoutShrunk({ innerWidth: 390, innerHeight: 790 }, field)).toBe(false)
    noteViewport({ innerWidth: 844, innerHeight: 300 })
    expect(layoutShrunk({ innerWidth: 844, innerHeight: 300 }, field)).toBe(false)
    resetViewportMemory()
  })
  it('reveals fields under the keyboard or above the top only', () => {
    expect(needsReveal({ top: 500, bottom: 540 }, 480)).toBe(true)
    expect(needsReveal({ top: 100, bottom: 140 }, 480)).toBe(false)
    expect(needsReveal({ top: -20, bottom: 20 }, 480)).toBe(true)
    expect(needsReveal({ top: 400, bottom: 440 }, 480, 0, 60)).toBe(true)
  })
  it('knows which fields bring up a keyboard', () => {
    const text = document.createElement('input')
    const check = Object.assign(document.createElement('input'), { type: 'checkbox' })
    expect(isTypingField(text)).toBe(true)
    expect(isTypingField(document.createElement('textarea'))).toBe(true)
    expect(isTypingField(check)).toBe(false)
    expect(isTypingField(document.createElement('button'))).toBe(false)
  })
})

describe('room search', () => {
  it('rounds the position to about a kilometre', () => {
    expect(roundCoord(37.774929)).toBe(37.77)
    expect(roundCoord(-122.419416)).toBe(-122.42)
  })

  it('offers a game only when the name matches exactly (same city first)', () => {
    const games = [g('a', 'The Vault', 'Toronto'), g('b', 'The Vault', 'Austin'), g('c', 'Vault 2', 'Austin')]
    expect(exactGameMatch(games, 'the vault', 'Austin')?.id).toBe('b')
    expect(exactGameMatch(games, 'The Vault', null)).toBeNull() // ambiguous
    expect(exactGameMatch([games[2]], 'Vault 2')?.id).toBe('c')
    expect(exactGameMatch(games, 'Vau')).toBeNull()
  })

  it('"Near me" asks for the position once pressed, sends it rounded, and is remembered', async () => {
    const user = userEvent.setup()
    const search = vi.fn(async () => ({ games: [g('gam_1', 'The Vault', 'Austin')], venues: [] }))
    const geo = { getCurrentPosition: vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 30.26712, longitude: -97.74306 } } as GeolocationPosition)) } as unknown as Geolocation
    render(<RoomSearch onPick={() => {}} onCreate={() => {}} search={search} geolocation={geo} debounceMs={0} />)
    expect(geo.getCurrentPosition).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('room-search-near'))
    expect(screen.getByTestId('room-search-near').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('room-search-near').textContent).toContain('Nearest first')
    await user.type(screen.getByTestId('room-search-input'), 'vault')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'vault', lat: 30.27, lng: -97.74 }), expect.anything())
    expect(localStorage.getItem('myescapes.nearMe')).toBe('1')
    await user.click(screen.getByTestId('room-search-near'))
    expect(localStorage.getItem('myescapes.nearMe')).toBeNull()
    await settleBlur()
  })

  it('ranks the draft city first while Near me is off, and drops the city once it is on', async () => {
    const user = userEvent.setup()
    const search = vi.fn(async () => ({ games: [], venues: [] }))
    const geo = { getCurrentPosition: vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition)) } as unknown as Geolocation
    render(<RoomSearch onPick={() => {}} onCreate={() => {}} search={search} geolocation={geo} city="San Francisco" debounceMs={0} />)
    await user.type(screen.getByTestId('room-search-input'), 'escape')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'escape', city: 'San Francisco' }), expect.anything())
    await user.click(screen.getByTestId('room-search-near'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const last = search.mock.calls.at(-1) as unknown as [Record<string, unknown>]
    expect(last[0]).toMatchObject({ q: 'escape', lat: 37.77, lng: -122.42 })
    expect(last[0].city).toBeUndefined()
    await settleBlur()
  })

  it('says so when location is blocked', async () => {
    const user = userEvent.setup()
    const geo = { getCurrentPosition: vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError)) } as unknown as Geolocation
    render(<RoomSearch onPick={() => {}} onCreate={() => {}} search={async () => ({ games: [], venues: [] })} geolocation={geo} />)
    await user.click(screen.getByTestId('room-search-near'))
    expect(screen.getByText(/Location is blocked for this site/)).toBeTruthy()
  })
})

describe('directory link in the form', () => {
  const game = { ...g('gam_vault', 'The Vault', 'Austin'), genre: 'heist' as const }
  it('fills the room from a game, unlinks on rename, and saves with the game id', () => {
    const { form } = draftToForm(sampleDraft({ room: { name: null, company: null, city: null, genre: null, address: null, website: null } }), '2026-10-25')
    const linked = linkGame(form, game, { name: 'Lockbox Austin', brand: 'Lockbox', address: '9 Lake St' })
    expect(linked.room).toMatchObject({ name: 'The Vault', company: 'Lockbox', city: 'Austin', genre: 'heist', address: '9 Lake St' })
    expect(linkMatches(linked)).toBe(true)
    expect(linkMatches({ ...linked, room: { ...linked.room, name: 'Other' } })).toBe(false)

    const complete = { ...linked, review: { ...linked.review, escaped: true, multiRoom: false, liveActors: false, flashlights: false, visibleTimer: true } }
    complete.review.ratings = { ...complete.review.ratings, storyline: { score: 70, comment: '' } }
    complete.review.puzzles = complete.review.puzzles.map((p) => ({ ...p, type: p.type || 'logic' }))
    expect(draftToEntry(complete).room.id).toBe('gam_vault')
    expect(draftToEntry({ ...complete, room: { ...complete.room, city: 'Dallas' } }).room.id).toMatch(/^room_/)
  })
  it('a venue fills company and city; "add" names a new room', () => {
    const { form } = draftToForm(sampleDraft(), '2026-10-25')
    const v = linkVenue(form, { name: 'Lockbox Austin', brand: null, address: '9 Lake St', city: 'Austin' })
    expect(v.room).toMatchObject({ name: 'The Clockmaker', company: 'Lockbox Austin', city: 'Austin', address: '9 Lake St' })
    expect(newRoomNamed(v, '  Moon Base ').room.name).toBe('Moon Base')
    expect(newRoomNamed(v, 'x').link).toBeNull()
  })
  it('a picked venue is saved by id until its company or city is edited', () => {
    const { form } = draftToForm(sampleDraft(), '2026-10-25')
    const v = linkVenue(form, { id: 'ven_lh', name: 'Escape Room - The Lighthouse', brand: null, address: '', city: 'Oostduinkerke', country: 'BE' })
    expect(v.venue).toEqual({ venueId: 'ven_lh', company: 'Escape Room - The Lighthouse', city: 'Oostduinkerke', country: 'BE' })
    expect(venueMatches(v)).toBe(true)
    const complete = { ...v, review: { ...v.review, escaped: true } }
    complete.review.ratings = { ...complete.review.ratings, storyline: { score: 70, comment: '' } }
    complete.review.puzzles = complete.review.puzzles.map((p) => ({ ...p, type: p.type || 'logic' }))
    const entry = draftToEntry(complete)
    expect(entry.room.venueId).toBe('ven_lh')
    expect(entry.room.id).toMatch(/^room_/)
    // A new room name keeps the venue; a game pick or a different city drops it.
    expect(draftToEntry(newRoomNamed(complete, 'Moon Base')).room.venueId).toBe('ven_lh')
    expect(draftToEntry({ ...complete, room: { ...complete.room, city: 'Ostend' } }).room.venueId).toBeUndefined()
    expect(linkGame(complete, game).venue).toBeNull()
  })
})

describe('privacy page: Near me', () => {
  it('says the position is asked for, rounded and not stored', () => {
    const html = readFileSync(resolve(__dirname, '../../../public/privacy.html'), 'utf8')
    expect(html).toMatch(/Near me/)
    expect(html).toMatch(/rounded to about 1 km/)
    expect(html).toMatch(/don't store it/)
  })
})
