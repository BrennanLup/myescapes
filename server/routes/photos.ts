/**
 * Photo upload (multipart), serving and deletion.
 * Owned by workstream 24 (server/routes/photos*, src/ui/photos). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function photosRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.uploadPhoto,
    ROUTES.photo,
    ROUTES.deletePhoto,
  ])
}
