/**
 * Account, profile, export, deletion and my-rooms routes.
 * Owned by workstream 4 (server/routes/logs*, wishlist*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function logsRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.me,
    ROUTES.updateMe,
    ROUTES.handleAvailable,
    ROUTES.exportMe,
    ROUTES.deleteMe,
    ROUTES.logs,
  ])
}
