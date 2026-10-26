/**
 * Visits and participants: create, read, shared-fact edits with history, delete, leave, tag, respond, inbox, crew chips.
 * Owned by workstream 32 (server/routes/visits*). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function visitsRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.createVisit,
    ROUTES.visit,
    ROUTES.updateVisit,
    ROUTES.visitEdits,
    ROUTES.deleteVisit,
    ROUTES.leaveVisit,
    ROUTES.tagParticipants,
    ROUTES.respondToTag,
    ROUTES.pendingTags,
    ROUTES.crewSuggestions,
  ])
}
