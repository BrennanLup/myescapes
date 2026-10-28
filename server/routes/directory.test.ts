// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CityPageSchema, GamePageSchema, GameSchema, VenuePageSchema, VenueSchema } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { games, reviews, sources, venues } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'
import { likeEscape, setTrgmForTests } from './directory.queries'
import { decodeCursor, encodeCursor } from './reviews.lib'
import { safeWebsite, splitPatch } from './directory'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

const U = () => t.fx.users
const get = async (url: string, as?: string) => {
  const res = await t.inject({ method: 'GET', url, as })
  return { status: res.statusCode, body: res.json() }
}
const send = async (method: 'POST' | 'PATCH', url: string, payload: unknown, as?: string) => {
  const res = await t.inject({ method, url, payload: payload as object, as })
  return { status: res.statusCode, body: res.json() }
}

describe('search', () => {
  it('finds venues and games fuzzily (pg_trgm)', async () => {
    const r = await get('/api/directory/search?q=starlite%20escapes')
    expect(r.status).toBe(200)
    const parsed = ROUTES.directorySearch.response.parse(r.body)
    expect(parsed.venues[0]).toMatchObject({ slug: t.fx.venueSlugs.starlight, gameCount: 2, city: 'San Francisco' })
    const g = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=lost%20observatry')).body)
    expect(g.games[0]).toMatchObject({ id: t.fx.games.observatory, venueName: 'Starlight Escapes', venueSlug: t.fx.venueSlugs.starlight })
  })

  it('counts only public, non-copied reviews by onboarded authors in game summaries', async () => {
    const g = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=Haunted%20Lighthouse')).body)
    const lh = g.games.find((x) => x.id === t.fx.games.lighthouse)!
    // alice guest (92) + alice copy (84) public; mia's copy is excluded.
    expect(lh.reviewCount).toBe(2)
    expect(lh.avgOverall).toBe(88)
  })

  it('filters by country and biases by distance', async () => {
    const ca = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=escapes&country=CA')).body)
    expect(ca.venues.every((v) => v.country === 'CA')).toBe(true)
    const near = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=Maple&lat=43.65&lng=-79.38')).body)
    expect(near.venues[0].distanceKm).toBeLessThan(1)
  })

  it('matches a city name', async () => {
    const r = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=toronto')).body)
    expect(r.venues.map((v) => v.id)).toContain(t.fx.venues.maple)
  })

  it('ranks the given city first and ignores leading quote marks when names tie', async () => {
    const vIds = ['ven_t_quoted', 'ven_t_alpha', 'ven_t_zeta']
    const gIds = ['gam_t_abandoned', 'gam_t_zany', 'gam_t_quoted']
    const base = { brand: null, address: '', region: '', postalCode: null, lat: null, lng: null, website: null, phone: null, googlePlaceId: null, fsqId: null }
    await t.db.insert(venues).values([
      { ...base, id: vIds[0], slug: 'my-escape-krakow', name: '"MY Escape" Rooms', city: 'Krakow', citySlug: t.fx.cities.toronto, country: 'PL' },
      { ...base, id: vIds[1], slug: 'alpha-escape-club', name: 'Alpha Escape Club', city: 'Austin', citySlug: t.fx.cities.toronto, country: 'US' },
      { ...base, id: vIds[2], slug: 'zeta-escape-lab', name: 'Zeta Escape Lab', city: 'San Francisco', citySlug: t.fx.cities.sf, country: 'US' },
    ])
    await t.db.insert(games).values([
      { id: gIds[0], venueId: vIds[1], slug: 'abandoned-escape', name: 'Abandoned Escape', genre: 'horror' },
      { id: gIds[1], venueId: vIds[2], slug: 'zany-escape', name: 'Zany Escape', genre: 'comedy' },
      { id: gIds[2], venueId: vIds[0], slug: 'mysterium-escape', name: '"Mysterium" Escape', genre: 'mystery' },
    ])
    try {
      for (const trgm of [null, false] as const) {
        setTrgmForTests(t.db, trgm)
        const plain = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=escape&limit=20')).body)
        const vNames = plain.venues.map((v) => v.name)
        expect(vNames.indexOf('Alpha Escape Club')).toBeLessThan(vNames.indexOf('"MY Escape" Rooms'))
        const gNames = plain.games.map((g) => g.name)
        expect(gNames.indexOf('Abandoned Escape')).toBeLessThan(gNames.indexOf('Zany Escape'))
        expect(gNames.indexOf('"Mysterium" Escape')).toBeGreaterThan(gNames.indexOf('Abandoned Escape'))

        const sf = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=escape&limit=20&city=san%20francisco')).body)
        expect(sf.venues[0].city).toBe('San Francisco')
        expect(sf.games[0].name).toBe('Zany Escape')
        // Soft: the other cities still show.
        expect(sf.venues.map((v) => v.name)).toContain('Alpha Escape Club')
      }
    } finally {
      setTrgmForTests(t.db, null)
      await t.db.delete(games).where(inArray(games.id, gIds))
      await t.db.delete(venues).where(inArray(venues.id, vIds))
    }
  })

  it('works without pg_trgm (ILIKE fallback)', async () => {
    setTrgmForTests(t.db, false)
    try {
      const r = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=starlight')).body)
      expect(r.venues[0].id).toBe(t.fx.venues.starlight)
      const m = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?venue=Starlight&game=Vault')).body)
      expect(m.games[0].game.id).toBe(t.fx.games.vault)
    } finally {
      setTrgmForTests(t.db, null)
    }
  })

  it('treats LIKE wildcards in the query as text', async () => {
    expect(likeEscape('100%_\\')).toBe('100\\%\\_\\\\')
    const r = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=%25%25')).body)
    expect(r.venues).toEqual([])
  })

  it('validates the query', async () => {
    const r = await get('/api/directory/search?q=')
    expect(r.status).toBe(400)
    expect(ApiErrorSchema.parse(r.body).code).toBe('invalid')
    expect((await get('/api/directory/search?q=x&limit=500')).status).toBe(400)
  })

  it('hides hidden venues and games', async () => {
    await t.db.update(games).set({ status: 'hidden' }).where(eq(games.id, t.fx.games.vault))
    try {
      const r = ROUTES.directorySearch.response.parse((await get('/api/directory/search?q=vault')).body)
      expect(r.games.map((g) => g.id)).not.toContain(t.fx.games.vault)
      expect((await get(`/api/games/${t.fx.gameSlugs.vault}`)).status).toBe(404)
      const v = VenuePageSchema.parse((await get(`/api/venues/${t.fx.venueSlugs.starlight}`)).body)
      expect(v.games.map((g) => g.id)).toEqual([t.fx.games.observatory])
    } finally {
      await t.db.update(games).set({ status: 'active' }).where(eq(games.id, t.fx.games.vault))
    }
  })
})

describe('nearby', () => {
  it('lists venues nearest first within the radius', async () => {
    const r = ROUTES.directoryNearby.response.parse((await get('/api/directory/nearby?lat=37.79&lng=-122.39&radiusKm=10')).body)
    expect(r.venues.map((v) => v.id)).toEqual([t.fx.venues.starlight])
    expect(r.venues[0].distanceKm).toBeLessThan(1)
    const wide = ROUTES.directoryNearby.response.parse((await get('/api/directory/nearby?lat=40&lng=-100&radiusKm=200')).body)
    expect(wide.venues).toEqual([])
  })

  it('requires a point', async () => {
    expect((await get('/api/directory/nearby?lat=37')).status).toBe(400)
  })
})

describe('match', () => {
  it('scores the right venue and game first from extraction hints', async () => {
    const r = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?venue=Starlight%20Escape&game=The%20Lost%20Observatory&city=San%20Francisco&country=US')).body)
    expect(r.venues[0].venue.id).toBe(t.fx.venues.starlight)
    expect(r.venues[0].score).toBeGreaterThan(0.7)
    expect(r.games[0].game.id).toBe(t.fx.games.observatory)
    expect(r.games[0].score).toBeGreaterThan(r.games[1]?.score ?? 0)
  })

  it('offers the games of a matched venue without a game hint', async () => {
    const r = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?venue=Maple%20and%20Key')).body)
    expect(r.venues[0].venue.id).toBe(t.fx.venues.maple)
    expect(r.games.map((g) => g.game.id)).toEqual([t.fx.games.lighthouse])
  })

  it('finds a game by name alone, and venues near a point alone', async () => {
    const g = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?game=haunted%20lighthouse')).body)
    expect(g.games[0].game.id).toBe(t.fx.games.lighthouse)
    const p = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?lat=43.652&lng=-79.381')).body)
    expect(p.venues[0].venue.id).toBe(t.fx.venues.maple)
    const none = ROUTES.directoryMatch.response.parse((await get('/api/directory/match')).body)
    expect(none).toEqual({ venues: [], games: [] })
  })

  it('keeps every score within 0..1', async () => {
    const r = ROUTES.directoryMatch.response.parse((await get('/api/directory/match?venue=x&game=y&city=z&lat=0&lng=0')).body)
    for (const v of [...r.venues, ...r.games]) expect(v.score >= 0 && v.score <= 1).toBe(true)
  })
})

describe('venue and city pages', () => {
  it('returns the venue, its games, attribution and the Google Maps link', async () => {
    const r = await get(`/api/venues/${t.fx.venueSlugs.starlight}`)
    expect(r.status).toBe(200)
    const page = VenuePageSchema.parse(r.body)
    expect(page.venue).toMatchObject({ id: t.fx.venues.starlight, googlePlaceId: 'ChIJfixtureStarlight' })
    expect(page.games.map((g) => g.name)).toEqual(['The Lost Observatory', 'The Vault'])
    expect(page.attribution).toEqual([{ source: 'foursquare', license: 'Apache-2.0', text: 'Venue data from Foursquare Open Source Places', url: 'https://opensource.foursquare.com/os-places/' }])
    expect(page.googleMapsUrl).toContain('query_place_id=ChIJfixtureStarlight')
  })

  it('credits OpenStreetMap where it was the source', async () => {
    const page = VenuePageSchema.parse((await get(`/api/venues/${t.fx.venueSlugs.maple}`)).body)
    expect(page.attribution[0]).toMatchObject({ source: 'osm', license: 'ODbL-1.0', text: '© OpenStreetMap contributors' })
    expect(page.googleMapsUrl).toBeNull()
  })

  it('returns a city with its venues', async () => {
    const page = CityPageSchema.parse((await get(`/api/cities/${t.fx.cities.sf}`)).body)
    expect(page.city).toMatchObject({ name: 'San Francisco', country: 'US' })
    expect(page.venues.map((v) => v.id)).toEqual([t.fx.venues.starlight])
    expect(page.attribution.map((a) => a.source)).toEqual(['foursquare'])
  })

  it('404s for unknown or hidden pages', async () => {
    expect((await get('/api/venues/nope')).status).toBe(404)
    expect((await get('/api/cities/nope')).status).toBe(404)
    expect((await get('/api/games/nope')).status).toBe(404)
    await t.db.update(venues).set({ status: 'hidden' }).where(eq(venues.id, t.fx.venues.maple))
    try {
      expect((await get(`/api/venues/${t.fx.venueSlugs.maple}`)).status).toBe(404)
      expect((await get(`/api/games/${t.fx.gameSlugs.lighthouse}`)).status).toBe(404)
      expect((await get(`/api/cities/${t.fx.cities.toronto}`)).status).toBe(404)
    } finally {
      await t.db.update(venues).set({ status: 'active' }).where(eq(venues.id, t.fx.venues.maple))
    }
  })
})

describe('game page', () => {
  it('shows aggregates from public, non-copied reviews and counts each visit once', async () => {
    const page = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}`)).body)
    expect(page.game.id).toBe(t.fx.games.observatory)
    expect(page.venue.id).toBe(t.fx.venues.starlight)
    // Public reviews: alice (together, 88) and carol (65). Bob's is friends-only.
    expect(page.aggregate).toMatchObject({ reviewCount: 2, visitCount: 2, escapeRate: 0.5, avgEscapeMinutes: 52 })
    expect(page.aggregate.avg.overall).toBe(76.5)
    expect(page.googleMapsUrl).toContain('ChIJfixtureStarlight')
    expect(page.attribution.map((a) => a.source)).toEqual(['foursquare'])
  })

  it('shows puzzle highlights as spoilers, most memorable first', async () => {
    // Spoiler text is blanked server-side until the caller asks for it (?spoilers=1, reviews.lib).
    const hidden = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}`)).body)
    expect(hidden.puzzles.map((p) => [p.description, p.notes, p.memorableCount, p.spoiler])).toEqual([
      ['', '', 1, true],
      ['', '', 0, true],
    ])
    const page = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}?spoilers=1`)).body)
    expect(page.puzzles.map((p) => [p.description, p.memorableCount, p.spoiler])).toEqual([
      ['Set the telescope clock to 4:35', 1, true],
      ['Match the constellations to the keypad', 0, true],
    ])
  })

  it('lists public reviews for everyone, and friends-only ones for friends', async () => {
    const anon = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}`)).body)
    expect(anon.reviews.reviews.map((r) => r.id).sort()).toEqual([t.fx.reviews.aliceTogether, t.fx.reviews.carol].sort())
    const together = anon.reviews.reviews.find((r) => r.id === t.fx.reviews.aliceTogether)!
    expect(together.author).toEqual({ id: U().alice, handle: 'alice', displayName: 'Alice', image: null })
    expect(together.playedWith).toEqual([])
    expect(together.photos.map((p) => p.url)).toEqual([`/api/photos/${t.fx.photos.bobTogether}`])
    expect(together.ratings.overall).toEqual({ score: 88, comment: 'Great fun.' })
    expect(anon.reviews.nextCursor).toBeNull()

    const alice = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}`, U().alice)).body)
    const ids = alice.reviews.reviews.map((r) => r.id)
    expect(ids).toContain(t.fx.reviews.bobTogether)
    expect(alice.reviews.reviews.find((r) => r.id === t.fx.reviews.aliceTogether)!.playedWith.map((p) => p.reviewId)).toEqual([t.fx.reviews.bobTogether])
    // carol is nobody's friend: she sees only public reviews.
    const carol = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.observatory}`, U().carol)).body)
    expect(carol.reviews.reviews.map((r) => r.id)).not.toContain(t.fx.reviews.bobTogether)
  })

  it('never exposes private reviews, transcripts or emails', async () => {
    const res = await t.inject({ method: 'GET', url: `/api/games/${t.fx.gameSlugs.vault}`, as: U().carol })
    const text = res.body
    expect(text).not.toContain('@example.com')
    expect(text).not.toContain('transcript')
    expect(text).not.toContain(t.fx.reviews.aliceSolo)
    const page = GamePageSchema.parse(res.json())
    // The pending-tag visit's public review shows; the private solo review does not.
    expect(page.reviews.reviews.map((r) => r.id)).toEqual([t.fx.reviews.alicePending])
    const own = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.vault}`, U().alice)).body)
    expect(own.reviews.reviews.map((r) => r.id)).toEqual([t.fx.reviews.alicePending])
  })

  it('skips hidden reviews and marks copied scores', async () => {
    const page = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.lighthouse}`)).body)
    const mia = page.reviews.reviews.find((r) => r.id === t.fx.reviews.miaCopy)!
    expect(mia.scoresCopied).toBe(true)
    expect(page.aggregate.reviewCount).toBe(2)
    await t.db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, t.fx.reviews.aliceGuest))
    try {
      const again = GamePageSchema.parse((await get(`/api/games/${t.fx.gameSlugs.lighthouse}`)).body)
      expect(again.reviews.reviews.map((r) => r.id)).not.toContain(t.fx.reviews.aliceGuest)
      expect(again.aggregate.reviewCount).toBe(1)
    } finally {
      await t.db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, t.fx.reviews.aliceGuest))
    }
  })

  it('round-trips review page cursors', () => {
    // The game page and GET /api/games/:slug/reviews share reviews.lib's keyset cursor.
    const ts = '2026-10-12 10:00:00.123+00'
    expect(decodeCursor(encodeCursor(ts, 'rev_x'))).toEqual({ ts, id: 'rev_x' })
    expect(decodeCursor('garbage')).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
  })
})

describe('contributions', () => {
  const newVenue = { name: 'Clue Castle', address: '1 Castle Rd', city: 'Austin', region: 'TX', country: 'us', lat: 30.27, lng: -97.74, website: 'clue.example.com' }

  it('requires sign-in', async () => {
    expect((await send('POST', '/api/venues', newVenue)).status).toBe(401)
    expect((await send('POST', '/api/games', { venueId: t.fx.venues.maple, name: 'X' })).status).toBe(401)
    expect((await send('PATCH', `/api/venues/id/${t.fx.venues.maple}`, { phone: '1' })).status).toBe(401)
    expect((await send('PATCH', `/api/games/id/${t.fx.games.vault}`, { durationMinutes: 60 })).status).toBe(401)
  })

  it('creates a venue with a slug, a city and a user source record', async () => {
    const r = await send('POST', '/api/venues', newVenue, U().bob)
    expect(r.status).toBe(201)
    const v = VenueSchema.parse(r.body)
    expect(v).toMatchObject({ slug: 'clue-castle-austin', country: 'US', citySlug: 'austin-tx-us', website: 'https://clue.example.com/', status: 'active' })
    const src = await t.db.select().from(sources).where(and(eq(sources.entityId, v.id), eq(sources.source, 'user')))
    expect(src).toHaveLength(1)
    expect(src[0]).toMatchObject({ sourceId: U().bob, license: 'user-contribution', userId: U().bob })
    const city = CityPageSchema.parse((await get('/api/cities/austin-tx-us')).body)
    expect(city.venues.map((x) => x.id)).toEqual([v.id])
    expect(city.attribution.map((a) => a.source)).toEqual(['user'])
  })

  it('returns the existing venue instead of creating a duplicate', async () => {
    const again = VenueSchema.parse((await send('POST', '/api/venues', { ...newVenue, name: 'clue castle' }, U().carol)).body)
    expect(again.slug).toBe('clue-castle-austin')
    const near = VenueSchema.parse((await send('POST', '/api/venues', { ...newVenue, name: 'Clue Castles', city: 'Austin TX', lat: 30.2703 }, U().carol)).body)
    expect(near.slug).toBe('clue-castle-austin')
    const other = VenueSchema.parse((await send('POST', '/api/venues', { ...newVenue, name: 'Clue Castle', city: 'Dallas', lat: 32.7, lng: -96.8 }, U().carol)).body)
    expect(other.slug).toBe('clue-castle-dallas')
  })

  it('rejects half a coordinate and unsafe websites', async () => {
    expect((await send('POST', '/api/venues', { ...newVenue, name: 'Half', lat: 1, lng: null }, U().bob)).status).toBe(400)
    const v = VenueSchema.parse((await send('POST', '/api/venues', { ...newVenue, name: 'Unsafe Link', website: 'javascript:alert(1)' }, U().bob)).body)
    expect(v.website).toBeNull()
    expect(safeWebsite('ftp://x.example')).toBeNull()
  })

  it('lets the creator edit freely and others only fill gaps (the rest is a suggestion)', async () => {
    const v = (await t.db.select().from(venues).where(eq(venues.slug, 'clue-castle-austin')))[0]
    const byCreator = VenueSchema.parse((await send('PATCH', `/api/venues/id/${v.id}`, { name: 'Clue Castle Escapes', phone: '512-555-0100' }, U().bob)).body)
    expect(byCreator).toMatchObject({ name: 'Clue Castle Escapes', phone: '512-555-0100', slug: 'clue-castle-austin' })
    const byOther = VenueSchema.parse((await send('PATCH', `/api/venues/id/${v.id}`, { name: 'Vandalised', postalCode: '78701' }, U().carol)).body)
    expect(byOther).toMatchObject({ name: 'Clue Castle Escapes', postalCode: '78701' })
    const carolSrc = (await t.db.select().from(sources).where(and(eq(sources.entityId, v.id), eq(sources.sourceId, U().carol))))[0]
    expect(carolSrc.fields).toMatchObject({ applied: { postalCode: '78701' }, suggested: { name: 'Vandalised' } })
    const byAdmin = VenueSchema.parse((await send('PATCH', `/api/venues/id/${v.id}`, { city: 'Round Rock' }, U().admin)).body)
    // Only the fields sent change: address and region keep their values.
    expect(byAdmin).toMatchObject({ city: 'Round Rock', citySlug: 'round-rock-tx-us', address: '1 Castle Rd', region: 'TX' })
    expect((await send('PATCH', '/api/venues/id/ven_nope', { phone: '1' }, U().bob)).status).toBe(404)
  })

  it('creates games once per venue name, and edits them under the same rules', async () => {
    const r = await send('POST', '/api/games', { venueId: t.fx.venues.maple, name: 'Sunken Ship', genre: 'adventure', minPlayers: 2, maxPlayers: 6 }, U().bob)
    expect(r.status).toBe(201)
    const g = GameSchema.parse(r.body)
    expect(g).toMatchObject({ slug: 'sunken-ship-maple-and-key-toronto', genre: 'adventure', venueId: t.fx.venues.maple })
    const dup = GameSchema.parse((await send('POST', '/api/games', { venueId: t.fx.venues.maple, name: 'SUNKEN SHIP' }, U().carol)).body)
    expect(dup.id).toBe(g.id)
    expect((await send('POST', '/api/games', { venueId: 'ven_nope', name: 'X' }, U().bob)).status).toBe(404)
    expect((await send('POST', '/api/games', { venueId: t.fx.venues.maple, name: 'Bad Range', minPlayers: 6, maxPlayers: 2 }, U().bob)).status).toBe(400)
    expect((await send('POST', '/api/games', { venueId: t.fx.venues.maple, name: 'Bad Genre', genre: 'romance' }, U().bob)).status).toBe(400)

    const edit = GameSchema.parse((await send('PATCH', `/api/games/id/${g.id}`, { durationMinutes: 75, name: 'The Sunken Ship' }, U().bob)).body)
    expect(edit).toMatchObject({ durationMinutes: 75, name: 'The Sunken Ship', slug: g.slug })
    const other = GameSchema.parse((await send('PATCH', `/api/games/id/${g.id}`, { durationMinutes: 30, description: 'Water everywhere.' }, U().carol)).body)
    expect(other).toMatchObject({ durationMinutes: 75, description: 'Water everywhere.' })
    expect((await send('PATCH', `/api/games/id/${g.id}`, { name: 'Haunted Lighthouse' }, U().bob)).status).toBe(409)
    const venuePage = VenuePageSchema.parse((await get(`/api/venues/${t.fx.venueSlugs.maple}`)).body)
    expect(venuePage.games.map((x) => x.name)).toEqual(['Haunted Lighthouse', 'The Sunken Ship'])
    const gp = GamePageSchema.parse((await get(`/api/games/${g.slug}`)).body)
    expect(gp.aggregate).toMatchObject({ reviewCount: 0, visitCount: 0, escapeRate: null })
    expect(gp.attribution.map((a) => a.source)).toEqual(['osm', 'user'])
  })

  it('splitPatch applies changes for editors and only gap-fills for others', () => {
    const cur = { a: 'x', b: null as string | null, c: '' }
    expect(splitPatch(cur, { a: 'y', b: 'z', c: 'w' }, true)).toEqual({ apply: { a: 'y', b: 'z', c: 'w' }, suggest: {} })
    expect(splitPatch(cur, { a: 'y', b: 'z', c: 'w' }, false)).toEqual({ apply: { b: 'z', c: 'w' }, suggest: { a: 'y' } })
    expect(splitPatch(cur, { a: 'x' }, false)).toEqual({ apply: {}, suggest: {} })
  })
})
