/**
 * The read-only room a friend sees when they visit (`GET /api/homes/:handle`). Owned by Phase 3
 * workstream C.
 *
 * Starts from the owner's own `datasetForUser` (so the shape always matches what the 3D room
 * renders) and removes what the visitor may not see:
 *   - visits without a review by the owner that is visible to the visitor (`reviewVisibleTo`:
 *     public or friends-only, never private or hidden), and visits on hidden games or venues;
 *   - the voice transcript (author-only, always blank here);
 *   - comments of a spoiler-flagged review and every puzzle description (SPOILER_PLACEHOLDER), unless `reveal`;
 *   - crew: people with a public name keep it (the visitor sees themselves by name too), other
 *     accounts become "Friend" and guest names become "Guest";
 *   - photo links the visitor could not open (the photo rule: on the visit, or the visit is public).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { SPOILER_PLACEHOLDER } from '../../src/contracts/realtime'
import type { CrewMember, Dataset, Review } from '../../src/contracts/types'
import type { Db } from '../db/client'
import { games, reviews, users, venues, visitParticipants, visits } from '../db/schema'
import { datasetForUser } from '../db/dataset'
import { slugify } from '../db/util'
import { authorIsPublic } from '../auth/users'
import { authorInfo, reviewVisibleTo, withoutComments } from './reviews.lib'

export interface VisitorDatasetOptions {
  /** Show spoiler comments and puzzle descriptions. */
  reveal?: boolean
}

/** Visit ids (of `visitIds`) that have a public review shown on public pages (the photo rule). */
async function publicVisitIds(db: Db, visitIds: string[]): Promise<Set<string>> {
  if (!visitIds.length) return new Set()
  const rows = await db
    .selectDistinct({ id: reviews.visitId })
    .from(reviews)
    .innerJoin(visits, eq(visits.id, reviews.visitId))
    .innerJoin(games, eq(games.id, visits.gameId))
    .innerJoin(venues, eq(venues.id, games.venueId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(
      and(
        inArray(reviews.visitId, visitIds),
        eq(reviews.visibility, 'public'),
        isNull(reviews.hiddenAt),
        authorIsPublic(users),
        sql`${games.status} <> 'hidden'`,
        sql`${venues.status} <> 'hidden'`,
      ),
    )
  return new Set(rows.map((r) => r.id))
}

export async function visitorDataset(db: Db, ownerId: string, viewerId: string, opts: VisitorDatasetOptions = {}): Promise<Dataset> {
  const full = await datasetForUser(db, ownerId)
  const visitIds = full.reviews.map((r) => r.id)
  if (!visitIds.length) return { ...full, rooms: [], reviews: [], crew: [] }

  const [ownerReviews, crewRows, gameRows] = await Promise.all([
    db
      .select({ visitId: reviews.visitId, authorId: reviews.authorId, visibility: reviews.visibility, hiddenAt: reviews.hiddenAt, containsSpoilers: reviews.containsSpoilers })
      .from(reviews)
      .where(and(inArray(reviews.visitId, visitIds), eq(reviews.authorId, ownerId))),
    db
      .select({ visitId: visitParticipants.visitId, userId: visitParticipants.userId, guestName: visitParticipants.guestName, status: visitParticipants.status, handle: users.handle, displayName: users.displayName })
      .from(visitParticipants)
      .leftJoin(users, eq(users.id, visitParticipants.userId))
      .where(inArray(visitParticipants.visitId, visitIds))
      .orderBy(visitParticipants.createdAt),
    db
      .select({ id: games.id, gameStatus: games.status, venueStatus: venues.status })
      .from(games)
      .innerJoin(venues, eq(venues.id, games.venueId))
      .where(inArray(games.id, [...new Set(full.reviews.map((r) => r.roomId))])),
  ])
  const authors = await authorInfo(db, [ownerId])
  // The visitor is the owner's friend (checked by the caller), so the owner is in their friend set.
  const viewerFriends = new Set([ownerId])
  const reviewOf = new Map(ownerReviews.map((r) => [r.visitId, r]))
  const hiddenGames = new Set(gameRows.filter((g) => g.gameStatus === 'hidden' || g.venueStatus === 'hidden').map((g) => g.id))

  const kept = full.reviews.filter((r) => {
    const own = reviewOf.get(r.id)
    return own && !hiddenGames.has(r.roomId) && reviewVisibleTo(own, authors.get(ownerId), viewerId, viewerFriends)
  })
  const keptIds = kept.map((r) => r.id)
  const publicIds = await publicVisitIds(db, keptIds)

  const crewNames = new Map<string, CrewMember>()
  const out: Review[] = kept.map((r) => {
    const own = reviewOf.get(r.id)!
    const people = crewRows.filter((c) => c.visitId === r.id && c.userId !== ownerId && (c.status === 'owner' || c.status === 'accepted'))
    const names = people.map((c) => (c.userId ? (c.handle && c.displayName ? c.displayName : 'Friend') : 'Guest'))
    for (const n of names) if (!crewNames.has(n.toLowerCase())) crewNames.set(n.toLowerCase(), { id: `crew_${slugify(n)}`, name: n })
    const viewerOnVisit = crewRows.some((c) => c.visitId === r.id && c.userId === viewerId && c.status !== 'declined')
    const canSeePhotos = viewerOnVisit || publicIds.has(r.id)
    const spoil = own.containsSpoilers && !opts.reveal
    return {
      ...r,
      crew: names,
      ratings: spoil ? withoutComments(r.ratings) : r.ratings,
      puzzles: r.puzzles.map((p) => ({ ...p, description: opts.reveal ? p.description : SPOILER_PLACEHOLDER })),
      voiceTranscript: '',
      photos: canSeePhotos ? r.photos : [],
    }
  })
  const roomIds = new Set(out.map((r) => r.roomId))
  return {
    rooms: full.rooms.filter((room) => roomIds.has(room.id)),
    reviews: out,
    wishlist: full.wishlist,
    crew: [...crewNames.values()],
    source: full.source,
  }
}
