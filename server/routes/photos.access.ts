/**
 * Who may see or add photos on a visit (workstream 24). Shared by the photo and report routes.
 *
 * - Add: the visit's owner or an accepted participant ("Who can do what").
 * - See: anyone on the visit (owner, accepted, or pending, who must decide "that was me"), or
 *   anyone at all when the visit has a public, non-hidden review, its game is not hidden and the
 *   photo itself is not hidden. A visit with only private or friends-only reviews never shows publicly.
 * - Remove: only the uploader.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { games, reviews, visitParticipants, visitPhotos, visits } from '../db/schema'

export type ParticipantStatus = 'owner' | 'accepted' | 'pending' | 'declined'

export async function participantStatus(db: Db, visitId: string, userId: string | null | undefined): Promise<ParticipantStatus | null> {
  if (!userId) return null
  const row = (
    await db
      .select({ status: visitParticipants.status })
      .from(visitParticipants)
      .where(and(eq(visitParticipants.visitId, visitId), eq(visitParticipants.userId, userId)))
      .limit(1)
  )[0]
  return row?.status ?? null
}

export const canAddPhotos = (s: ParticipantStatus | null) => s === 'owner' || s === 'accepted'
export const canSeeVisitPhotos = (s: ParticipantStatus | null) => s === 'owner' || s === 'accepted' || s === 'pending'

/** True when the visit shows on public pages: a public review that is not hidden, on a game that is not hidden. */
export async function visitIsPublic(db: Db, visitId: string): Promise<boolean> {
  const row = (
    await db
      .select({ id: reviews.id })
      .from(reviews)
      .innerJoin(visits, eq(visits.id, reviews.visitId))
      .innerJoin(games, eq(games.id, visits.gameId))
      .where(and(eq(reviews.visitId, visitId), eq(reviews.visibility, 'public'), isNull(reviews.hiddenAt), sql`${games.status} <> 'hidden'`))
      .limit(1)
  )[0]
  return Boolean(row)
}

export type PhotoRow = typeof visitPhotos.$inferSelect

/** The photo if `viewerId` may see it, else null (callers answer 404 either way, never revealing it exists). */
export async function viewablePhoto(db: Db, photoId: string, viewerId: string | null): Promise<PhotoRow | null> {
  const photo = (await db.select().from(visitPhotos).where(eq(visitPhotos.id, photoId)).limit(1))[0]
  if (!photo) return null
  if (photo.uploaderId === viewerId) return photo
  if (canSeeVisitPhotos(await participantStatus(db, photo.visitId, viewerId))) return photo
  if (!photo.hiddenAt && (await visitIsPublic(db, photo.visitId))) return photo
  return null
}
