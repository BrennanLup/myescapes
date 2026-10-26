/**
 * Directory API: search, nearby, match, venue/game/city pages, user-contributed venues and games.
 * Owned by workstream 5 (server/routes/directory*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function directoryRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.directorySearch,
    ROUTES.directoryNearby,
    ROUTES.directoryMatch,
    ROUTES.venuePage,
    ROUTES.cityPage,
    ROUTES.gamePage,
    ROUTES.createVenue,
    ROUTES.updateVenue,
    ROUTES.createGame,
    ROUTES.updateGame,
  ])
}
