/**
 * Phase 1 compatibility routes for the 3D room: GET /api/data and POST /api/entries.
 * Signed in: the user's Postgres rows (server/db/dataset.ts). Signed out: the read-only seed demo
 * plus the local overlay, as in Phase 1. Owned by workstream 4; workstream 20 moves the room
 * to the Phase 2 API, after which these can go.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import { seedRepositoryFor } from '../../src/data/server/repository'
import type { AppContext } from '../context'
import { datasetForUser, saveEntryForUser } from '../db/dataset'
import { defineRoute } from '../http'

export async function phase1Routes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.data, async ({ user }) => {
    if (user) return datasetForUser(ctx.db(), user.id)
    return (await seedRepositoryFor(ctx.env.DATA_DIR)).getDataset()
  })
  defineRoute(app, ctx, ROUTES.entries, async ({ user, body }) => {
    if (user) return saveEntryForUser(ctx.db(), user.id, body)
    return (await seedRepositoryFor(ctx.env.DATA_DIR)).saveEntry(body)
  })
}
