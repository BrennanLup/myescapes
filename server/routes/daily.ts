/**
 * Escape of the Day results API: today (server day per user), start, submit, streak, friends leaderboard.
 * Owned by workstream 23 (server/routes/daily*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function dailyRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.dailyToday,
    ROUTES.dailyStart,
    ROUTES.dailySubmit,
    ROUTES.dailyStreak,
    ROUTES.dailyLeaderboard,
  ])
}
