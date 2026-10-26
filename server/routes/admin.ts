/**
 * Moderation: reports and admin hide.
 * Owned by workstream 25 (server/routes/admin*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.report,
    ROUTES.adminReports,
    ROUTES.adminResolveReport,
    ROUTES.adminHide,
  ])
}
