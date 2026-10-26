/**
 * Deterministic test fixtures covering every "Who can do what" case. Load into a test database
 * with `await loadFixtures(db)`; ids are fixed (see `FX`) so tests can refer to them directly.
 *
 * People:
 *   alice  - the main user (Brennan's role). Onboarded.
 *   bob    - alice's friend. Auto-accept off both ways.
 *   mia    - alice's friend. Mia auto-accepts alice's tags (on for her side only).
 *   carol  - a stranger to everyone.
 *   dave   - has sent alice a friend request (pending).
 *   eve    - alice blocked her.
 *   admin  - an admin.
 *   newbie - signed up, not onboarded (no handle / display name).
 *
 * Directory: San Francisco (Starlight Escapes: The Lost Observatory, The Vault) and Toronto
 * (Maple & Key: Haunted Lighthouse).
 *
 * Visits:
 *   together - alice (owner) + bob (accepted), Observatory 2026-10-12. alice review public, bob friends-only. 2 puzzles, 1 photo by bob.
 *   solo     - alice only, The Vault 2026-09-01, private review.
 *   guest    - alice + guest "Mia", Lighthouse 2025-05-01, alice review public (for claim tests).
 *   pending  - alice (owner) + bob (pending tag), The Vault 2026-10-20, alice review public.
 *   copy     - alice (owner) + mia (accepted, review is an untouched copy of alice's), Lighthouse 2026-08-15.
 *   carol    - carol only, Observatory 2026-10-12, public review (same game/day as together).
 */
import type { Db } from './client'
import {
  cities,
  dailyPuzzles,
  dailyResults,
  friendships,
  games,
  invites,
  notifications,
  reports,
  reviews,
  sources,
  users,
  venues,
  visitParticipants,
  visitPhotos,
  visitPuzzles,
  visits,
  wishlistItems,
} from './schema'

export const FX = {
  users: {
    alice: 'usr_alice',
    bob: 'usr_bob',
    mia: 'usr_mia',
    carol: 'usr_carol',
    dave: 'usr_dave',
    eve: 'usr_eve',
    admin: 'usr_admin',
    newbie: 'usr_newbie',
  },
  cities: { sf: 'san-francisco-ca-us', toronto: 'toronto-on-ca' },
  venues: { starlight: 'ven_starlight', maple: 'ven_maple' },
  games: { observatory: 'gam_observatory', vault: 'gam_vault', lighthouse: 'gam_lighthouse' },
  gameSlugs: { observatory: 'the-lost-observatory-starlight-escapes-san-francisco', vault: 'the-vault-starlight-escapes-san-francisco', lighthouse: 'haunted-lighthouse-maple-and-key-toronto' },
  venueSlugs: { starlight: 'starlight-escapes-san-francisco', maple: 'maple-and-key-toronto' },
  visits: { together: 'vis_together', solo: 'vis_solo', guest: 'vis_guest', pending: 'vis_pending', copy: 'vis_copy', carol: 'vis_carol' },
  reviews: {
    aliceTogether: 'rev_alice_together',
    bobTogether: 'rev_bob_together',
    aliceSolo: 'rev_alice_solo',
    aliceGuest: 'rev_alice_guest',
    alicePending: 'rev_alice_pending',
    aliceCopy: 'rev_alice_copy',
    miaCopy: 'rev_mia_copy',
    carol: 'rev_carol',
  },
  participants: { bobPending: 'par_bob_pending', guestMia: 'par_guest_mia', bobTogether: 'par_bob_together' },
  puzzles: { clock: 'pzl_clock', stars: 'pzl_stars' },
  photos: { bobTogether: 'pho_bob_together' },
  invites: { valid: 'INVITEMIA01', expired: 'INVITEOLD01', used: 'INVITEUSED1' },
  reports: { open: 'rpt_open' },
  dailyDay: '2026-10-26',
} as const

const U = FX.users

/** 1x1 transparent PNG. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
)

function scores(o: number, p: number, s: number, st: number, d: number, comment = 'Great fun.') {
  return {
    overallScore: o, overallComment: comment,
    puzzlesScore: p, puzzlesComment: '',
    settingScore: s, settingComment: '',
    storylineScore: st, storylineComment: '',
    difficultyScore: d, difficultyComment: '',
  }
}

/** Order a pair the way `friendships` stores it (userA < userB). */
export function pair(x: string, y: string): { userA: string; userB: string; xIsA: boolean } {
  return x < y ? { userA: x, userB: y, xIsA: true } : { userA: y, userB: x, xIsA: false }
}

export async function loadFixtures(db: Db): Promise<typeof FX> {
  const t0 = new Date('2026-10-01T12:00:00Z')
  const person = (id: string, name: string, handle: string | null, extra: Partial<typeof users.$inferInsert> = {}) => ({
    id,
    name,
    email: `${handle ?? id}@example.com`,
    emailVerified: true,
    handle,
    displayName: handle ? name : null,
    onboardedAt: handle ? t0 : null,
    createdAt: t0,
    updatedAt: t0,
    ...extra,
  })
  await db.insert(users).values([
    person(U.alice, 'Alice', 'alice'),
    person(U.bob, 'Bob', 'bob'),
    person(U.mia, 'Mia', 'mia'),
    person(U.carol, 'Carol', 'carol'),
    person(U.dave, 'Dave', 'dave'),
    person(U.eve, 'Eve', 'eve'),
    person(U.admin, 'Admin', 'site_admin', { isAdmin: true }),
    person(U.newbie, 'Newbie Google Name', null),
  ])

  const f = (x: string, y: string, status: 'pending' | 'accepted' | 'blocked', by: string, autoX = false, autoY = false) => {
    const p = pair(x, y)
    return {
      userA: p.userA,
      userB: p.userB,
      status,
      requestedBy: by,
      blockedBy: status === 'blocked' ? by : null,
      aAutoAccepts: p.xIsA ? autoX : autoY,
      bAutoAccepts: p.xIsA ? autoY : autoX,
      acceptedAt: status === 'accepted' ? t0 : null,
    }
  }
  await db.insert(friendships).values([
    f(U.alice, U.bob, 'accepted', U.alice),
    // mia auto-accepts alice's tags; alice does not auto-accept mia's.
    f(U.alice, U.mia, 'accepted', U.alice, false, true),
    f(U.dave, U.alice, 'pending', U.dave),
    f(U.alice, U.eve, 'blocked', U.alice),
  ])

  await db.insert(cities).values([
    { slug: FX.cities.sf, name: 'San Francisco', region: 'CA', country: 'US', lat: 37.7749, lng: -122.4194 },
    { slug: FX.cities.toronto, name: 'Toronto', region: 'ON', country: 'CA', lat: 43.6532, lng: -79.3832 },
  ])
  await db.insert(venues).values([
    {
      id: FX.venues.starlight, slug: FX.venueSlugs.starlight, name: 'Starlight Escapes', brand: 'Starlight Escapes', address: '12 Main St',
      city: 'San Francisco', citySlug: FX.cities.sf, region: 'CA', country: 'US', postalCode: '94105', lat: 37.7897, lng: -122.3942,
      website: 'https://starlight.example.com', phone: null, googlePlaceId: 'ChIJfixtureStarlight', fsqId: 'fsq_starlight',
    },
    {
      id: FX.venues.maple, slug: FX.venueSlugs.maple, name: 'Maple & Key', brand: null, address: '10 Queen St W',
      city: 'Toronto', citySlug: FX.cities.toronto, region: 'ON', country: 'CA', postalCode: null, lat: 43.6519, lng: -79.3817,
      website: null, phone: null, googlePlaceId: null, osmId: 'node/123456',
    },
  ])
  await db.insert(sources).values([
    { entityType: 'venue', entityId: FX.venues.starlight, source: 'foursquare', sourceId: 'fsq_starlight', license: 'Apache-2.0', attribution: 'Foursquare Open Source Places' },
    { entityType: 'venue', entityId: FX.venues.maple, source: 'osm', sourceId: 'node/123456', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
  ])
  await db.insert(games).values([
    { id: FX.games.observatory, venueId: FX.venues.starlight, slug: FX.gameSlugs.observatory, name: 'The Lost Observatory', genre: 'sci-fi', minPlayers: 2, maxPlayers: 6, durationMinutes: 60 },
    { id: FX.games.vault, venueId: FX.venues.starlight, slug: FX.gameSlugs.vault, name: 'The Vault', genre: 'heist', durationMinutes: 60 },
    { id: FX.games.lighthouse, venueId: FX.venues.maple, slug: FX.gameSlugs.lighthouse, name: 'Haunted Lighthouse', genre: 'horror', createdBy: U.alice },
  ])

  const V = FX.visits
  const facts = (date: string, escaped: boolean | null, minutes: number | null) => ({
    date, escaped, escapeTimeMinutes: minutes, visibleTimer: true, multiRoom: false, flashlights: false, liveActors: false, toolsUsed: ['keypads'],
  })
  await db.insert(visits).values([
    { id: V.together, gameId: FX.games.observatory, createdBy: U.alice, ...facts('2026-10-12', true, 52) },
    { id: V.solo, gameId: FX.games.vault, createdBy: U.alice, ...facts('2026-09-01', false, 60) },
    { id: V.guest, gameId: FX.games.lighthouse, createdBy: U.alice, ...facts('2025-05-01', true, 48) },
    { id: V.pending, gameId: FX.games.vault, createdBy: U.alice, ...facts('2026-10-20', true, 55) },
    { id: V.copy, gameId: FX.games.lighthouse, createdBy: U.alice, ...facts('2026-08-15', true, 50) },
    { id: V.carol, gameId: FX.games.observatory, createdBy: U.carol, ...facts('2026-10-12', false, 60) },
  ])
  await db.insert(visitParticipants).values([
    { visitId: V.together, userId: U.alice, status: 'owner', addedBy: U.alice },
    { id: FX.participants.bobTogether, visitId: V.together, userId: U.bob, status: 'accepted', addedBy: U.alice, respondedAt: t0 },
    { visitId: V.solo, userId: U.alice, status: 'owner', addedBy: U.alice },
    { visitId: V.guest, userId: U.alice, status: 'owner', addedBy: U.alice },
    { id: FX.participants.guestMia, visitId: V.guest, guestName: 'Mia', status: 'accepted', addedBy: U.alice },
    { visitId: V.pending, userId: U.alice, status: 'owner', addedBy: U.alice },
    { id: FX.participants.bobPending, visitId: V.pending, userId: U.bob, status: 'pending', addedBy: U.alice },
    { visitId: V.copy, userId: U.alice, status: 'owner', addedBy: U.alice },
    { visitId: V.copy, userId: U.mia, status: 'accepted', addedBy: U.alice, respondedAt: t0 },
    { visitId: V.carol, userId: U.carol, status: 'owner', addedBy: U.carol },
  ])
  await db.insert(visitPuzzles).values([
    { id: FX.puzzles.clock, visitId: V.together, position: 0, description: 'Set the telescope clock to 4:35', type: 'lock-and-key', notes: 'The hands were hidden in the star chart.', createdBy: U.alice },
    { id: FX.puzzles.stars, visitId: V.together, position: 1, description: 'Match the constellations to the keypad', type: 'logic', createdBy: U.alice },
  ])
  const R = FX.reviews
  await db.insert(reviews).values([
    { id: R.aliceTogether, visitId: V.together, authorId: U.alice, ...scores(88, 90, 85, 80, 70), transcript: 'Alice private transcript', memorablePuzzleIds: [FX.puzzles.clock], visibility: 'public' },
    { id: R.bobTogether, visitId: V.together, authorId: U.bob, ...scores(80, 75, 90, 70, 60, 'Bob thought the ending twist was great.'), transcript: 'Bob private transcript', visibility: 'friends', containsSpoilers: true },
    { id: R.aliceSolo, visitId: V.solo, authorId: U.alice, ...scores(60, 55, 70, 50, 85), visibility: 'private' },
    { id: R.aliceGuest, visitId: V.guest, authorId: U.alice, ...scores(92, 90, 95, 88, 75), visibility: 'public' },
    { id: R.alicePending, visitId: V.pending, authorId: U.alice, ...scores(70, 70, 70, 70, 70), visibility: 'public' },
    { id: R.aliceCopy, visitId: V.copy, authorId: U.alice, ...scores(84, 80, 88, 82, 77), visibility: 'public' },
    { id: R.miaCopy, visitId: V.copy, authorId: U.mia, ...scores(84, 80, 88, 82, 77), visibility: 'public', scoresCopied: true, copiedFromReviewId: R.aliceCopy },
    { id: R.carol, visitId: V.carol, authorId: U.carol, ...scores(65, 60, 70, 55, 80), visibility: 'public' },
  ])
  await db.insert(visitPhotos).values([
    { id: FX.photos.bobTogether, visitId: V.together, uploaderId: U.bob, mime: 'image/png', bytes: TINY_PNG, sizeBytes: TINY_PNG.length, width: 1, height: 1, caption: 'We escaped!' },
  ])

  const day = 24 * 3600 * 1000
  await db.insert(invites).values([
    { code: FX.invites.valid, inviterId: U.alice, guestName: 'Mia', expiresAt: new Date(Date.now() + 30 * day) },
    { code: FX.invites.expired, inviterId: U.alice, guestName: null, expiresAt: new Date(Date.now() - day) },
    { code: FX.invites.used, inviterId: U.alice, guestName: null, expiresAt: new Date(Date.now() + 30 * day), usedBy: U.mia, usedAt: t0 },
  ])
  await db.insert(notifications).values([
    { userId: U.bob, type: 'tagged', actorId: U.alice, visitId: V.pending, payload: { gameName: 'The Vault', date: '2026-10-20' } },
    { userId: U.alice, type: 'friend_request', actorId: U.dave, payload: {} },
  ])
  await db.insert(wishlistItems).values([
    { id: 'wsh_alice_1', userId: U.alice, name: 'Sky Pirates', city: 'San Francisco', priority: 1, addedBy: 'Alice' },
    { id: 'wsh_alice_2', userId: U.alice, name: 'The Vault', city: 'San Francisco', priority: 2, gameId: FX.games.vault },
    { id: 'wsh_bob_1', userId: U.bob, name: 'Moon Base', city: 'Toronto', priority: 1 },
  ])
  await db.insert(dailyPuzzles).values([
    { day: FX.dailyDay, number: 1, kind: 'combination', seed: 'fixture-seed-1', maxGuesses: 6, gameId: FX.games.observatory, theme: { gameName: 'The Lost Observatory', venueName: 'Starlight Escapes', city: 'San Francisco', gameSlug: FX.gameSlugs.observatory } },
  ])
  await db.insert(dailyResults).values([
    { userId: U.alice, day: FX.dailyDay, number: 1, timeZone: 'America/Los_Angeles', startedAt: new Date('2026-10-26T15:00:00Z'), finishedAt: new Date('2026-10-26T15:02:00Z'), solved: true, guesses: 3, hintsUsed: 0, timeMs: 120_000, score: 900, grid: [['miss', 'close'], ['close', 'hit'], ['hit', 'hit']] },
  ])
  await db.insert(reports).values([
    { id: FX.reports.open, reporterId: U.carol, targetType: 'review', targetId: R.aliceGuest, reason: 'spam', note: 'fixture' },
  ])
  return FX
}
