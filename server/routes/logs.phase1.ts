/**
 * Phase 1 compatibility routes for the 3D room: GET /api/data and POST /api/entries.
 * Signed in: the user's Postgres rows (server/db/dataset.ts). Signed out: the seed demo plus the
 * local overlay, as in Phase 1. In production the signed-out demo is read-only (401 on writes, the
 * client keeps the change in the page): the overlay is shared by every signed-out visitor. Owned by workstream 4; workstream 20 moves the room
 * to the Phase 2 API, after which these can go.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import { seedRepositoryFor } from '../../src/data/server/repository'
import type { AppContext } from '../context'
import { datasetForUser, saveEntryForUser } from '../db/dataset'
import { defineRoute, HttpError } from '../http'

export async function phase1Routes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.data, async ({ user }) => {
    if (user) return datasetForUser(ctx.db(), user.id)
    return (await seedRepositoryFor(ctx.env.DATA_DIR)).getDataset()
  })
  defineRoute(app, ctx, ROUTES.entries, async ({ user, body }) => {
    if (user) return saveEntryForUser(ctx.db(), user.id, body)
    assertDemoWritable(ctx)
    return (await seedRepositoryFor(ctx.env.DATA_DIR)).saveEntry(body)
  })
}

/**
 * Signed-out writes go to a seed overlay every signed-out visitor reads, so they are allowed only
 * on a local or test server: never with NODE_ENV=production, and never on a Railway deploy (Railway
 * injects RAILWAY_ENVIRONMENT_NAME / RAILWAY_PUBLIC_DOMAIN) even if NODE_ENV was left unset there.
 */
export function demoWritesAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') return false
  if (env.NODE_ENV === 'test') return true
  return !(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_PROJECT_ID)
}

export function assertDemoWritable(ctx: AppContext) {
  if (!demoWritesAllowed(ctx.env)) throw new HttpError('unauthorized', 'Sign in to save. The demo room keeps changes on this page only.')
}
