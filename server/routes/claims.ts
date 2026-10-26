/**
 * Guest-name claiming and same-room merge detection.
 * Owned by workstream 34 (server/routes/claims*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function claimsRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.claims,
    ROUTES.claim,
    ROUTES.mergeCandidates,
    ROUTES.joinVisit,
  ])
}
