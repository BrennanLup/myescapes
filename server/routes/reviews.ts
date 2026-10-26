/**
 * Reviews: my review per visit, visibility, spoilers, copied-score flag, public review pages and aggregates.
 * Owned by workstream 33 (server/routes/reviews*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function reviewsRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.putMyReview,
    ROUTES.review,
    ROUTES.updateReview,
    ROUTES.gameReviews,
  ])
}
