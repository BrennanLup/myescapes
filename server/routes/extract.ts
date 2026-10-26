/**
 * POST /api/extract: transcript -> ReviewDraft with directory hints (extraction v2).
 * Owned by workstream 11. The logic lives in server/extract/service.ts.
 *
 * Auth is optional (the Phase 1 3D room still drafts reviews when signed out). Over a spending
 * cap the answer is still 200: a mock draft plus a friendly `notice` (contract: fallback mock).
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { defineRoute, httpError } from '../http'
import { extractV2, extractionMode as modeFromEnv, type ExtractDeps } from '../extract/service'

export function extractionMode(env: NodeJS.ProcessEnv = process.env): 'claude' | 'mock' {
  return modeFromEnv(env)
}

export type ExtractRoutesOptions = ExtractDeps

/** Per-IP burst limit on top of the daily caps. */
export const EXTRACT_RATE_LIMIT = { max: 20, timeWindow: '1 minute' }

export async function extractRoutes(app: FastifyInstance, ctx: AppContext, opts: ExtractRoutesOptions = {}) {
  defineRoute(
    app,
    ctx,
    ROUTES.extract,
    async ({ body, user }) => {
      if (!body.transcript.trim()) throw httpError('invalid', 'Transcript required.')
      return extractV2({ transcript: body.transcript, lat: body.lat, lng: body.lng, user, ctx, deps: opts })
    },
    { config: { rateLimit: EXTRACT_RATE_LIMIT } },
  )
}
