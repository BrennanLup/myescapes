/**
 * Auth: Better Auth + Google, cookie sessions in Postgres, test-only login.
 * Owned by workstream 3. STUB: replace the bodies, keep the exports.
 *
 * Plan:
 * - `betterAuth({ database: drizzleAdapter(db, { provider: 'pg', usePlural: true, schema }), socialProviders: { google } })`
 *   with scopes `openid email profile` only, `user.additionalFields` for handle/displayName/isAdmin/onboardedAt,
 *   secret from BETTER_AUTH_SECRET, base URL from PUBLIC_URL (or the request origin).
 * - Mount the handler at `/api/auth/*` (Fastify -> Fetch Request bridge).
 * - `resolveUser`: read the session cookie via `auth.api.getSession({ headers })` and map to `SessionUser`.
 * - `ROUTES.testLogin` exists only when NODE_ENV=test (defineRoute enforces it); a guard test must
 *   prove it is absent in production.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext, SessionUser } from '../context'
import { HttpError, notImplemented } from '../http'

/** `google` when Google sign-in is configured, `test` when only the test login runs, else `disabled`. */
export function authMode(env: NodeJS.ProcessEnv = process.env): 'google' | 'test' | 'disabled' {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.BETTER_AUTH_SECRET) return 'google'
  if (env.NODE_ENV === 'test') return 'test'
  return 'disabled'
}

/** Resolves the signed-in user from the request (session cookie). STUB: nobody is signed in. */
export async function resolveUser(_req: FastifyRequest, _ctx: AppContext): Promise<SessionUser | null> {
  return null
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.all('/api/auth/*', async () => {
    throw new HttpError('not_implemented', 'Sign-in is not built yet (workstream 3).')
  })
  notImplemented(app, ctx, [ROUTES.testLogin])
}
