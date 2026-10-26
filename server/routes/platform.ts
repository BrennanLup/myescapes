// Platform routes: /health and /api/status. Owned by workstream 27 (foundation).
// /health never touches the database, so Railway's health check passes while Postgres warms up.
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import { authMode } from '../auth'
import type { AppContext } from '../context'
import { appVersion } from '../env'
import { defineRoute } from '../http'
import { extractionMode } from './extract'
import { transcriptionMode } from './transcribe'

export async function platformRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(ROUTES.health.path, async () => ({ ok: true as const }))
  defineRoute(app, ctx, ROUTES.status, async () => ({
    extraction: extractionMode(),
    transcription: transcriptionMode(),
    storage: ctx.dbKind(),
    database: ctx.dbState.status,
    auth: authMode(ctx.env),
    version: appVersion(),
  }))
}
