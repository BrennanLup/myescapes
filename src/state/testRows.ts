/**
 * Test helpers: Phase 2 `LogRow`s and participants for the 3D room's crew tests.
 * Not imported by app code.
 */
import type { LogRow, Participant, PublicUser, ReviewV2 } from '@/contracts/models'

export function user(id: string, displayName: string, image: string | null = null, handle: string | null = displayName.toLowerCase()): PublicUser {
  return { id, displayName, handle, image }
}

export function friend(u: PublicUser, status: Participant['status'] = 'accepted'): Participant {
  return { id: 'par_' + u.id, user: u, guestName: null, status, addedBy: null }
}

export function guest(name: string, status: Participant['status'] = 'accepted'): Participant {
  return { id: 'par_g_' + name, user: null, guestName: name, status, addedBy: null }
}

const R = (score: number) => ({ score, comment: '' })

export function myReview(visitId: string, createdAt: string, author: PublicUser = user('usr_me', 'Me')): ReviewV2 {
  return {
    id: 'rev_' + visitId,
    visitId,
    author,
    ratings: { overall: R(80), puzzles: R(80), setting: R(80), storyline: R(80), difficulty: R(80) },
    transcript: null,
    memorablePuzzleIds: [],
    visibility: 'public',
    containsSpoilers: false,
    scoresCopied: false,
    copiedFromReviewId: null,
    hidden: false,
    createdAt,
    updatedAt: createdAt,
  }
}

export function logRow(visitId: string, gameId: string, crew: Participant[], createdAt = '2026-10-01T12:00:00.000Z', date = '2026-10-01'): LogRow {
  return {
    visitId,
    date,
    game: {
      id: gameId,
      slug: gameId.replace(/[^a-z0-9]+/g, '-'),
      name: 'Game ' + gameId,
      genre: null,
      status: 'active',
      venueId: 'ven_1',
      venueName: 'Venue',
      venueSlug: 'venue',
      city: 'Toronto',
      country: 'CA',
      reviewCount: 0,
      avgOverall: null,
    },
    venue: {
      id: 'ven_1',
      slug: 'venue',
      name: 'Venue',
      brand: null,
      address: '',
      city: 'Toronto',
      citySlug: 'toronto-on-ca',
      region: 'ON',
      country: 'CA',
      lat: null,
      lng: null,
      status: 'active',
      gameCount: 1,
    },
    escaped: true,
    escapeTimeMinutes: 50,
    myReview: myReview(visitId, createdAt),
    crew,
    coverPhotoUrl: null,
  }
}
