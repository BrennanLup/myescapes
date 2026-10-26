/** Game, venue and city pages (workstreams 16, 17) against a stubbed API. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CITY_PAGE, GAME_PAGE, VENUE_PAGE, fetchStub } from './shared/fixtures'
import { GamePage } from './game'
import { VenuePage, sortGames } from './venue'
import { CityPage, filterVenues } from './city'

vi.mock('../auth', () => ({ useSession: () => ({ status: 'signed-out', user: null }), signInWithGoogle: vi.fn(), signOut: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const props = (slug: string) => ({ params: { slug }, rest: '/' })

describe('GamePage', () => {
  it('shows the game, venue, aggregate, reviews, maps link and attribution', async () => {
    const stub = fetchStub({ '/api/games/the-lost-observatory': { body: GAME_PAGE } })
    vi.stubGlobal('fetch', stub.fn)
    render(<GamePage {...props('the-lost-observatory')} />)
    expect(screen.getByTestId('public-loading')).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'The Lost Observatory' })).toBeTruthy()
    expect(document.title).toBe('The Lost Observatory at Starlight Escapes · My Escapes')
    const page = screen.getByTestId('game-page')
    expect(page.textContent).toContain('Sci-fi · 2-6 players · 60 min')
    expect(screen.getByRole('link', { name: 'Starlight Escapes' }).getAttribute('href')).toBe('/venues/starlight-escapes-san-francisco')
    expect(screen.getByRole('link', { name: 'San Francisco, CA' }).getAttribute('href')).toBe('/cities/san-francisco-ca-us')
    expect(screen.getByTestId('google-maps-link').getAttribute('href')).toBe(GAME_PAGE.googleMapsUrl)
    expect(screen.getByTestId('aggregate-overall').textContent).toContain('84')
    expect(screen.getAllByTestId('review-card')).toHaveLength(3)
    expect(screen.getByTestId('directory-attribution').textContent).toContain('Foursquare Open Source Places')
    expect(page.textContent).not.toMatch(/@example\.com/)
  })

  it('hides puzzle details behind "Show spoilers"', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/games/the-lost-observatory': { body: GAME_PAGE } }).fn)
    render(<GamePage {...props('the-lost-observatory')} />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText('Set the telescope clock to 4:35')).toBeNull()
    expect(screen.queryByText(/hidden in the star chart/)).toBeNull()
    const box = screen.getByTestId('puzzle-spoilers')
    fireEvent.click(within(box).getByRole('button', { name: 'Show spoilers' }))
    expect(screen.getByText('Set the telescope clock to 4:35')).toBeTruthy()
    expect(screen.getByText(/hidden in the star chart/)).toBeTruthy()
    // Revealing puzzles doesn't reveal spoiler reviews.
    expect(screen.queryByText(/astronomer was the thief/)).toBeNull()
  })

  it('has a report button for the game', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/games/the-lost-observatory': { body: GAME_PAGE } }).fn)
    render(<GamePage {...props('the-lost-observatory')} />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('button', { name: 'Report a problem with this game' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Report' })).toHaveLength(3)
  })

  it('builds a Maps search link when the server has no Google URL', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/games/x': { body: { ...GAME_PAGE, googleMapsUrl: null } } }).fn)
    render(<GamePage {...props('x')} />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('google-maps-link').getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Starlight%20Escapes%2C%2012%20Main%20St%2C%20San%20Francisco',
    )
  })

  it('shows not found for a 404 and a retry for other errors', async () => {
    vi.stubGlobal('fetch', fetchStub({}).fn)
    render(<GamePage {...props('nope')} />)
    expect(await screen.findByTestId('public-not-found')).toBeTruthy()
    cleanup()

    let calls = 0
    vi.stubGlobal(
      'fetch',
      fetchStub({ '/api/games/flaky': () => (++calls === 1 ? { status: 503, body: { error: 'db down', code: 'db_unavailable' } } : { body: GAME_PAGE }) }).fn,
    )
    render(<GamePage {...props('flaky')} />)
    expect((await screen.findByTestId('public-error')).textContent).toContain('waking up')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'The Lost Observatory' })).toBeTruthy()
  })

  it('URL-encodes the slug', async () => {
    const stub = fetchStub({})
    vi.stubGlobal('fetch', stub.fn)
    render(<GamePage {...props('a/b?c')} />)
    await screen.findByTestId('public-not-found')
    expect(stub.calls[0].url).toBe('/api/games/a%2Fb%3Fc')
  })
})

describe('VenuePage', () => {
  it('lists games (open first, hidden never), with links, maps and attribution', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/venues/starlight-escapes-san-francisco': { body: VENUE_PAGE } }).fn)
    render(<VenuePage {...props('starlight-escapes-san-francisco')} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Starlight Escapes' })).toBeTruthy()
    const rows = screen.getAllByTestId('game-row')
    expect(rows.map((r) => r.querySelector('a')?.textContent)).toEqual(['The Lost Observatory', 'The Vault', 'Old Mine'])
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/games/the-lost-observatory')
    expect(rows[2].textContent).toContain('Closed')
    expect(screen.queryByText('Hidden Game')).toBeNull()
    expect(screen.getByTestId('google-maps-link').getAttribute('href')).toContain('query_place_id=ChIJfixtureStarlight')
    expect(screen.getByRole('link', { name: 'starlight.example.com' }).getAttribute('href')).toBe('https://starlight.example.com/')
    const attribution = screen.getByTestId('directory-attribution').textContent ?? ''
    expect(attribution).toContain('Foursquare Open Source Places')
    expect(attribution).toContain('© OpenStreetMap contributors')
    expect(screen.getByRole('button', { name: 'Report a problem with this venue' })).toBeTruthy()
  })

  it('sortGames keeps hidden games out', () => {
    expect(sortGames(VENUE_PAGE.games).map((g) => g.id)).toEqual(['gam_obs', 'gam_vault', 'gam_old'])
  })
})

describe('CityPage', () => {
  it('lists venues and shows default directory attribution', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/cities/san-francisco-ca-us': { body: CITY_PAGE } }).fn)
    render(<CityPage {...props('san-francisco-ca-us')} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Escape rooms in San Francisco' })).toBeTruthy()
    const rows = screen.getAllByTestId('venue-row')
    expect(rows.map((r) => r.querySelector('a')?.textContent)).toEqual(['B Escapes', 'A Escapes', 'C Escapes'])
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/venues/b-escapes')
    expect(screen.getByTestId('city-page').textContent).toContain('3 venues in the directory')
    const attribution = screen.getByTestId('directory-attribution').textContent ?? ''
    expect(attribution).toContain('Foursquare')
    expect(attribution).toContain('OpenStreetMap')
  })

  it('filterVenues matches name, brand or address', () => {
    expect(filterVenues(CITY_PAGE.venues, 'second').map((v) => v.id)).toEqual(['ven_b'])
    expect(filterVenues(CITY_PAGE.venues, 'hidden')).toEqual([])
  })

  it('shows not found for an unknown city', async () => {
    vi.stubGlobal('fetch', fetchStub({}).fn)
    render(<CityPage {...props('atlantis')} />)
    expect(await screen.findByTestId('public-not-found')).toBeTruthy()
  })
})
