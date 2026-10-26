/**
 * Transcription: audio upload -> OpenAI transcript, under the per-user and global spending caps.
 * Owned by workstream 10 (server/routes/transcribe*). STUB: POST /api/transcribe answers 501.
 *
 * Rules: never store the raw audio (privacy policy); reserve usage with `reserveUsage` from
 * server/db/usage.ts before calling OpenAI and `releaseUsage` if the call fails; over a cap,
 * throw `spendingCapError(cap)` (429, fallback: typing).
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { usageSummary } from '../db/usage'
import { defineRoute, notImplemented } from '../http'

export function transcriptionMode(env: NodeJS.ProcessEnv = process.env): 'openai' | 'mock' {
  return env.OPENAI_API_KEY ? 'openai' : 'mock'
}

export async function transcribeRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [ROUTES.transcribe])
  defineRoute(app, ctx, ROUTES.usage, async ({ user }) => usageSummary(ctx.db(), user.id, ctx.now()))
}
