/**
 * Test fixtures for the public pages (used by the *.test.tsx files in src/public). Shapes are
 * validated with the contract schemas so they stay in step with src/contracts/models.ts.
 */
import { CityPageSchema, GamePageSchema, VenuePageSchema, type CityPage, type GamePage, type PublicReview, type PublicUser, type VenuePage } from '../../contracts/models'

export const ALICE: PublicUser = { id: 'usr_alice', handle: 'alice', displayName: 'Alice A.', image: null }
export const BOB: PublicUser = { id: 'usr_bob', handle: 'bob', displayName: 'Bob', image: 'https://lh3.googleusercontent.com/a/bob' }
export const MIA: PublicUser = { id: 'usr_mia', handle: 'mia', displayName: 'Mia', image: null }

const ratings = (o: number, comment = '') => ({
  overall: { score: o, comment },
  puzzles: { score: o - 2, comment: '' },
  setting: { score: o + 1, comment: '' },
  storyline: { score: o - 5, comment: '' },
  difficulty: { score: 60, comment: '' },
})

export function review(over: Partial<PublicReview> & Pick<PublicReview, 'id' | 'author'>): PublicReview {
  return {
    visitId: 'vis_1',
    date: '2026-10-12',
    ratings: ratings(88, 'Loved the telescope room.'),
    containsSpoilers: false,
    scoresCopied: false,
    escaped: true,
    escapeTimeMinutes: 52,
    playedWith: [],
    photos: [],
    createdAt: '2026-10-12T20:00:00Z',
    ...over,
  }
}

export const REVIEWS: PublicReview[] = [
  review({ id: 'rev_alice', author: ALICE, playedWith: [{ reviewId: 'rev_bob', author: BOB }] }),
  review({
    id: 'rev_bob',
    author: BOB,
    ratings: ratings(80, 'The twist at the end: the astronomer was the thief all along.'),
    containsSpoilers: true,
    playedWith: [{ reviewId: 'rev_alice', author: ALICE }],
  }),
  review({ id: 'rev_mia', author: MIA, visitId: 'vis_2', ratings: ratings(88, 'Loved the telescope room.'), scoresCopied: true }),
]

export const GAME_PAGE: GamePage = GamePageSchema.parse({
  game: {
    id: 'gam_observatory',
    venueId: 'ven_starlight',
    slug: 'the-lost-observatory',
    name: 'The Lost Observatory',
    genre: 'sci-fi',
    minPlayers: 2,
    maxPlayers: 6,
    durationMinutes: 60,
    description: 'Find the missing astronomer before the comet passes.',
    website: 'https://starlight.example.com/observatory',
    status: 'active',
  },
  venue: {
    id: 'ven_starlight',
    slug: 'starlight-escapes-san-francisco',
    name: 'Starlight Escapes',
    brand: 'Starlight Escapes',
    address: '12 Main St',
    city: 'San Francisco',
    citySlug: 'san-francisco-ca-us',
    region: 'CA',
    country: 'US',
    lat: 37.79,
    lng: -122.39,
    status: 'active',
    gameCount: 2,
  },
  aggregate: { reviewCount: 2, visitCount: 2, escapeRate: 0.5, avgEscapeMinutes: 52, avg: { overall: 84, puzzles: 82, setting: 85, storyline: 79, difficulty: 60 } },
  puzzles: [
    { description: 'Set the telescope clock to 4:35', type: 'lock-and-key', notes: 'The hands were hidden in the star chart.', memorableCount: 2, spoiler: true },
    { description: 'Match the constellations to the keypad', type: 'logic', notes: '', memorableCount: 0, spoiler: true },
  ],
  reviews: { reviews: REVIEWS, nextCursor: 'cur_2' },
  attribution: [{ source: 'foursquare', license: 'Apache-2.0', text: 'Foursquare Open Source Places' }],
  googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Starlight&query_place_id=ChIJfixture',
})

export const VENUE_PAGE: VenuePage = VenuePageSchema.parse({
  venue: {
    id: 'ven_starlight',
    slug: 'starlight-escapes-san-francisco',
    name: 'Starlight Escapes',
    brand: null,
    address: '12 Main St',
    city: 'San Francisco',
    citySlug: 'san-francisco-ca-us',
    region: 'CA',
    country: 'US',
    postalCode: '94105',
    lat: 37.79,
    lng: -122.39,
    website: 'starlight.example.com',
    phone: null,
    googlePlaceId: 'ChIJfixtureStarlight',
    status: 'active',
  },
  games: [
    { id: 'gam_vault', slug: 'the-vault', name: 'The Vault', genre: 'heist', status: 'active', venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 1, avgOverall: 70 },
    { id: 'gam_old', slug: 'old-mine', name: 'Old Mine', genre: null, status: 'closed', venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 9, avgOverall: 90 },
    { id: 'gam_obs', slug: 'the-lost-observatory', name: 'The Lost Observatory', genre: 'sci-fi', status: 'active', venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 2, avgOverall: 84.4 },
    { id: 'gam_hidden', slug: 'hidden-game', name: 'Hidden Game', genre: null, status: 'hidden', venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 0, avgOverall: null },
  ],
  attribution: [
    { source: 'foursquare', license: 'Apache-2.0', text: 'Foursquare Open Source Places' },
    { source: 'osm', license: 'ODbL-1.0', text: 'OpenStreetMap' },
  ],
  googleMapsUrl: null,
})

export const CITY_PAGE: CityPage = CityPageSchema.parse({
  city: { slug: 'san-francisco-ca-us', name: 'San Francisco', region: 'CA', country: 'US', lat: 37.77, lng: -122.42 },
  venues: [
    { id: 'ven_a', slug: 'a-escapes', name: 'A Escapes', brand: null, address: '1 First St', city: 'San Francisco', citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 1 },
    { id: 'ven_b', slug: 'b-escapes', name: 'B Escapes', brand: null, address: '2 Second St', city: 'San Francisco', citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 4 },
    { id: 'ven_c', slug: 'c-escapes', name: 'C Escapes', brand: null, address: '', city: 'San Francisco', citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'closed', gameCount: 9 },
    { id: 'ven_h', slug: 'h-escapes', name: 'Hidden Escapes', brand: null, address: '', city: 'San Francisco', citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'hidden', gameCount: 1 },
  ],
  attribution: [],
})

/** A `fetch` stub answering JSON by URL. Unknown URLs answer 404. Records every call. */
export function fetchStub(routes: Record<string, { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown })>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const hit = routes[url]
    const r = typeof hit === 'function' ? hit(init) : (hit ?? { status: 404, body: { error: 'not found', code: 'not_found' } })
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { fn: fn as typeof fetch, calls }
}
