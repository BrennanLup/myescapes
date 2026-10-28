import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Game, GameSummary, Venue, VenueSummary } from '../../contracts/models'
import { VenueGameMatcher } from './index'
import { bestGame, gameToSummary, guessCountry, initialQuery, newVenueDefaults, rankGames, validateNewVenue, venueToSummary, type MatchHints } from './logic'

afterEach(cleanup)

export const VENUE: VenueSummary = {
  id: 'ven_starlight', slug: 'starlight-escapes-san-francisco', name: 'Starlight Escapes', brand: null, address: '1420 Valencia St', city: 'San Francisco',
  citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: 37.75, lng: -122.42, status: 'active', gameCount: 2,
}
export const GAME: GameSummary = {
  id: 'gam_observatory', slug: 'the-lost-observatory-starlight-escapes-san-francisco', name: 'The Lost Observatory', genre: 'sci-fi', status: 'active',
  venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 3, avgOverall: 85,
}
const VAULT: GameSummary = { ...GAME, id: 'gam_vault', slug: 'the-vault-starlight-escapes-san-francisco', name: 'The Vault', genre: 'heist' }
const HINTS: MatchHints = { venue: 'Starlight Escapes', game: 'Lost Observatory', city: 'San Francisco', country: null }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('matcher logic', () => {
  it('ranks, de-duplicates and hides hidden games; picks a best match only when strong', () => {
    const ranked = rankGames([
      { game: VAULT, score: 0.3 },
      { game: GAME, score: 0.9 },
      { game: GAME, score: 0.5 },
      { game: { ...VAULT, id: 'gam_hidden', status: 'hidden' }, score: 1 },
    ])
    expect(ranked.map((g) => g.game.id)).toEqual(['gam_observatory', 'gam_vault'])
    expect(bestGame(ranked)?.game.id).toBe('gam_observatory')
    expect(bestGame([{ game: GAME, score: 0.5 }])).toBeNull()
  })

  it('guesses the country from the hint, then the phone locale, then US', () => {
    expect(guessCountry({ country: 'ca' }, ['en-US'])).toBe('CA')
    expect(guessCountry({ country: null }, ['en-GB', 'en'])).toBe('GB')
    expect(guessCountry({ country: 'Canada' }, ['fr'])).toBe('US')
    expect(newVenueDefaults(HINTS, ['en-CA'])).toMatchObject({ name: 'Starlight Escapes', city: 'San Francisco', country: 'CA' })
    expect(validateNewVenue({ name: '', city: ' ', country: 'USA' })).toEqual({ name: expect.any(String), city: expect.any(String), country: expect.any(String) })
    expect(initialQuery(HINTS)).toBe('Lost Observatory')
  })

  it('turns created venues and games into summaries', () => {
    const v: Venue = { ...VENUE, postalCode: null, website: null, phone: null, googlePlaceId: null }
    expect(venueToSummary(v)).toEqual({ ...VENUE, gameCount: 0 })
    const g: Game = { id: 'gam_new', venueId: VENUE.id, slug: 'new-room', name: 'New Room', genre: null, minPlayers: null, maxPlayers: null, durationMinutes: null, description: null, website: null, status: 'active' }
    expect(gameToSummary(g, VENUE)).toMatchObject({ id: 'gam_new', venueName: 'Starlight Escapes', reviewCount: 0, avgOverall: null })
  })
})

describe('VenueGameMatcher', () => {
  it('shows directory matches for the hints and picks the best one', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directory/match')) return json({ venues: [{ venue: VENUE, score: 0.9 }], games: [{ game: VAULT, score: 0.4 }, { game: GAME, score: 0.92 }] })
      return json({ error: 'nope' }, 404)
    })
    const onPick = vi.fn()
    render(<VenueGameMatcher hints={HINTS} onPick={onPick} fetch={fetchMock as unknown as typeof fetch} />)
    await waitFor(() => expect(screen.getByTestId('match-game-gam_observatory')).toBeTruthy())
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ venue: 'Starlight Escapes', game: 'Lost Observatory', city: 'San Francisco' })
    expect(screen.getByTestId('match-game-gam_observatory').textContent).toContain('Best match')
    await userEvent.click(screen.getByTestId('match-game-gam_observatory'))
    expect(onPick).toHaveBeenCalledWith({ venue: VENUE, game: GAME })
  })

  it('a venue line never repeats the city its address already names', async () => {
    const full = { ...VENUE, address: '77 Ledger Lane, San Francisco, CA' }
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('/api/directory/match') ? json({ venues: [{ venue: full, score: 0.9 }, { venue: { ...VENUE, id: 'ven_b' }, score: 0.5 }], games: [] }) : json({ error: 'nope' }, 404)))
    render(<VenueGameMatcher hints={HINTS} onPick={vi.fn()} fetch={fetchMock as unknown as typeof fetch} />)
    expect((await screen.findByTestId('match-venue-ven_starlight')).textContent).toContain('77 Ledger Lane, San Francisco, CA · 2 rooms')
    expect(screen.getByTestId('match-venue-ven_b').textContent).toContain('1420 Valencia St, San Francisco · 2 rooms')
  })

  it('loads the venue when a matched game\'s venue was not in the list', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directory/match')) return json({ venues: [], games: [{ game: GAME, score: 0.6 }] })
      if (url === `/api/venues/${VENUE.slug}`) return json({ venue: { ...VENUE, postalCode: null, website: null, phone: null, googlePlaceId: null }, games: [GAME], attribution: [], googleMapsUrl: null })
      return json({ error: 'nope' }, 404)
    })
    const onPick = vi.fn()
    render(<VenueGameMatcher hints={HINTS} onPick={onPick} fetch={fetchMock as unknown as typeof fetch} />)
    await userEvent.click(await screen.findByTestId('match-game-gam_observatory'))
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onPick.mock.calls[0][0].venue).toEqual({ ...VENUE, gameCount: 0 })
  })

  it('searches, opens a venue and lists its games', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directory/match')) return json({ venues: [], games: [] })
      if (url.startsWith('/api/directory/search')) return json({ venues: [VENUE], games: [] })
      if (url === `/api/venues/${VENUE.slug}`) return json({ venue: { ...VENUE, postalCode: null, website: null, phone: null, googlePlaceId: null }, games: [GAME, VAULT], attribution: [], googleMapsUrl: null })
      return json({ error: 'nope' }, 404)
    })
    const onPick = vi.fn()
    render(<VenueGameMatcher hints={{ venue: null, game: null, city: null, country: null }} onPick={onPick} fetch={fetchMock as unknown as typeof fetch} />)
    expect(await screen.findByTestId('matcher-empty')).toBeTruthy()
    await userEvent.type(screen.getByTestId('matcher-search'), 'starlight{Enter}')
    await userEvent.click(await screen.findByTestId('match-venue-ven_starlight'))
    await userEvent.click(await screen.findByTestId('venue-game-gam_vault'))
    expect(onPick).toHaveBeenCalledWith({ venue: VENUE, game: VAULT })
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/directory/search?q=starlight&limit=20')).toBe(true)
  })

  it("searches with the transcript's city so rooms there rank first", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directory/match')) return json({ venues: [], games: [] })
      if (url.startsWith('/api/directory/search')) return json({ venues: [VENUE], games: [] })
      return json({ error: 'nope' }, 404)
    })
    render(<VenueGameMatcher hints={HINTS} onPick={vi.fn()} fetch={fetchMock as unknown as typeof fetch} />)
    await userEvent.clear(await screen.findByTestId('matcher-search'))
    await userEvent.type(screen.getByTestId('matcher-search'), 'escape{Enter}')
    await screen.findByTestId('match-venue-ven_starlight')
    const call = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/directory/search'))!
    expect(Object.fromEntries(new URL(call, 'http://x').searchParams)).toEqual({ q: 'escape', limit: '20', city: 'San Francisco' })
  })

  it('creates a new venue and then a new game in it', async () => {
    const created: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/directory/match')) return json({ venues: [], games: [] })
      if (url === '/api/venues' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        created.push(body)
        return json({ id: 'ven_new', slug: 'tiny-rooms-austin', brand: null, address: '', citySlug: 'austin-tx-us', postalCode: null, lat: null, lng: null, website: null, phone: null, googlePlaceId: null, status: 'active', ...body }, 201)
      }
      if (url === '/api/venues/tiny-rooms-austin') return json({ venue: {}, games: [], attribution: [], googleMapsUrl: null })
      if (url === '/api/games' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        created.push(body)
        return json({ id: 'gam_new', slug: 'the-attic-tiny-rooms-austin', minPlayers: null, maxPlayers: null, durationMinutes: null, description: null, website: null, status: 'active', ...body }, 201)
      }
      return json({ error: 'nope' }, 404)
    })
    const onPick = vi.fn()
    render(<VenueGameMatcher hints={{ venue: 'Tiny Rooms', game: 'The Attic', city: 'Austin', country: 'us' }} onPick={onPick} fetch={fetchMock as unknown as typeof fetch} />)
    await userEvent.click(await screen.findByTestId('new-venue'))
    expect((screen.getByTestId('new-venue-name') as HTMLInputElement).value).toBe('Tiny Rooms')
    expect((screen.getByTestId('new-venue-country') as HTMLInputElement).value).toBe('US')
    await userEvent.type(screen.getByTestId('new-venue-region'), 'TX')
    await userEvent.click(screen.getByTestId('new-venue-submit'))
    expect(await screen.findByTestId('new-game-form')).toBeTruthy()
    expect((screen.getByTestId('new-game-name') as HTMLInputElement).value).toBe('The Attic')
    await userEvent.selectOptions(screen.getByTestId('new-game-genre'), 'horror')
    await userEvent.click(screen.getByTestId('new-game-submit'))
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(created).toEqual([
      { name: 'Tiny Rooms', city: 'Austin', region: 'TX', country: 'US', address: '', website: null },
      { venueId: 'ven_new', name: 'The Attic', genre: 'horror' },
    ])
    const pick = onPick.mock.calls[0][0]
    expect(pick.venue).toMatchObject({ id: 'ven_new', name: 'Tiny Rooms', gameCount: 0 })
    expect(pick.game).toMatchObject({ id: 'gam_new', name: 'The Attic', venueId: 'ven_new', venueSlug: 'tiny-rooms-austin' })
  })

  it('validates the new venue form and shows server errors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directory/match')) return json({ error: 'not built', code: 'not_implemented' }, 501)
      return json({ error: 'Sign in first', code: 'unauthorized' }, 401)
    })
    render(<VenueGameMatcher hints={{ venue: null, game: null, city: null, country: null }} onPick={vi.fn()} fetch={fetchMock as unknown as typeof fetch} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/not available yet/)
    await userEvent.click(screen.getByTestId('new-venue'))
    await userEvent.click(screen.getByTestId('new-venue-submit'))
    expect(screen.getByText('Name the venue')).toBeTruthy()
    await userEvent.type(screen.getByTestId('new-venue-name'), 'X')
    await userEvent.type(screen.getByTestId('new-venue-city'), 'Y')
    await userEvent.click(screen.getByTestId('new-venue-submit'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sign in again/)
  })
})
