/**
 * Reviews: my review per visit, visibility, spoilers, copied-score flag, public review pages and aggregates.
 * Owned by workstream 33 (server/routes/reviews*). Shared helpers (visibility rule, aggregates,
 * puzzle highlights, cursors): reviews.lib.ts.
 *
 * - One review per author per visit; only its author writes or edits it.
 * - Writing needs owner/accepted on the visit. A public review needs onboarding (@handle).
 * - A copied review (`scoresCopied`) stays out of public averages until a score changes.
 * - Public responses blank the comments of spoiler-flagged reviews unless `?spoilers=1`.
 */
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { games, reviews, venues } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { friendIds } from './friends.lib'
import {
  authorInfo,
  publicReviewPage,
  reviewVisibleTo,
  toReviewV2,
  upsertReview,
  wantsSpoilers,
  type ReviewRow,
} from './reviews.lib'
import { inTx, MEMBER_STATUSES, visitForViewer } from './visits.lib'

export async function reviewsRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.putMyReview, async ({ params, body, user }) => {
    const db = ctx.db()
    if (body.visibility === 'public' && !user.onboarded) {
      throw new HttpError('onboarding_required', 'Choose a display name and @handle before posting a public review.')
    }
    const row = await inTx(db, async (tx) => {
      await visitForViewer(tx, params.id, user.id, MEMBER_STATUSES)
      return upsertReview(tx, params.id, user.id, body)
    })
    return (await toReviewV2(db, [row], user.id))[0]
  })

  defineRoute(app, ctx, ROUTES.review, async ({ params, user, req }) => {
    const db = ctx.db()
    const row = (await db.select().from(reviews).where(eq(reviews.id, params.id)).limit(1))[0]
    const viewer = user?.id ?? null
    if (!row || !(await canSee(row, viewer))) throw new HttpError('not_found', 'Review not found.')
    return (await toReviewV2(db, [row], viewer, { hideSpoilerComments: !wantsSpoilers(req.query) }))[0]
  })

  defineRoute(app, ctx, ROUTES.updateReview, async ({ params, body, user }) => {
    const db = ctx.db()
    const row = (await db.select().from(reviews).where(eq(reviews.id, params.id)).limit(1))[0]
    if (!row || !(await canSee(row, user.id))) throw new HttpError('not_found', 'Review not found.')
    if (row.authorId !== user.id) throw new HttpError('forbidden', 'Only the author can change a review.')
    if (body.visibility === 'public' && !user.onboarded) {
      throw new HttpError('onboarding_required', 'Choose a display name and @handle before making a review public.')
    }
    const set: Partial<ReviewRow> = {}
    if (body.visibility !== undefined) set.visibility = body.visibility
    if (body.containsSpoilers !== undefined) set.containsSpoilers = body.containsSpoilers
    const updated = Object.keys(set).length ? (await db.update(reviews).set(set).where(eq(reviews.id, row.id)).returning())[0] : row
    return (await toReviewV2(db, [updated], user.id))[0]
  })

  defineRoute(app, ctx, ROUTES.gameReviews, async ({ params, query, user, req }) => {
    const db = ctx.db()
    const game = (
      await db
        .select({ id: games.id, status: games.status, venueStatus: venues.status })
        .from(games)
        .innerJoin(venues, eq(venues.id, games.venueId))
        .where(eq(games.slug, params.slug))
        .limit(1)
    )[0]
    // Same 404 as the game page for a hidden game or a game at a hidden venue.
    if (!game || game.status === 'hidden' || game.venueStatus === 'hidden') throw new HttpError('not_found', 'Game not found.')
    return publicReviewPage(db, game.id, user?.id ?? null, { cursor: query.cursor, limit: query.limit, revealSpoilers: wantsSpoilers(req.query) })
  })

  async function canSee(row: ReviewRow, viewer: string | null): Promise<boolean> {
    const db = ctx.db()
    const [authors, friends] = await Promise.all([authorInfo(db, [row.authorId]), friendIds(db, viewer)])
    return reviewVisibleTo(row, authors.get(row.authorId), viewer, friends)
  }
}
