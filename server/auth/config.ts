/**
 * Better Auth configuration (workstream 3): Google sign-in (openid email profile only), cookie
 * sessions stored in Postgres through the Drizzle adapter, and, only when NODE_ENV=test, a
 * server-only endpoint the test login route uses to mint a real session.
 *
 * One Better Auth instance per database handle (the server can start before the database is
 * ready, so the instance is created on first use).
 */
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import type { Db } from '../db/client'
import { accounts, newId, sessions, users, verifications } from '../db/schema'

/** Only these Google scopes, ever. Non-sensitive, so the consent screen needs no verification review. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile'] as const

export const COOKIE_PREFIX = 'myescapes'

/** Session lifetime: 30 days, refreshed at most once a day while in use. */
export const SESSION_EXPIRES_IN = 60 * 60 * 24 * 30
export const SESSION_UPDATE_AGE = 60 * 60 * 24
/**
 * The header our Fastify bridge sets to the client address Fastify resolved (`request.ip`, see
 * server/proxy.ts) before handing a request to Better Auth. Any copy the client sent is replaced.
 * Better Auth's own reader only trusts a single-value X-Forwarded-For, and Railway's edge sends a
 * chain, so without this every visitor shared one sign-in rate-limit bucket.
 */
export const CLIENT_IP_HEADER = 'x-myescapes-client-ip'

/**
 * A fixed secret for NODE_ENV=test only, so tests can sign cookies without real credentials.
 * Never used outside tests: `authSecret` returns null instead and auth is disabled.
 */
const TEST_ONLY_SECRET = 'test-only-secret-not-for-production-use-0123456789'

/**
 * Better Auth endpoints we don't use. Disabled so nobody can call them: they would let a user
 * change fields we manage, read OAuth tokens, or link other providers.
 */
export const DISABLED_AUTH_PATHS = [
  '/update-user',
  '/change-email',
  '/change-password',
  '/set-password',
  '/delete-user',
  '/delete-user/callback',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/get-access-token',
  '/refresh-token',
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/reset-password',
  '/send-verification-email',
  '/verify-email',
]

export function authSecret(env: NodeJS.ProcessEnv): string | null {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET
  if (env.NODE_ENV === 'test') return TEST_ONLY_SECRET
  return null
}

export function googleConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.BETTER_AUTH_SECRET)
}

/**
 * The public base URL Better Auth builds the Google callback from:
 * PUBLIC_URL, else BETTER_AUTH_URL, else Railway's injected RAILWAY_PUBLIC_DOMAIN (https).
 * Undefined means "infer from the request" (local runs).
 */
export function authBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = (env.PUBLIC_URL || env.BETTER_AUTH_URL)?.replace(/\/+$/, '')
  if (explicit) return explicit
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN.replace(/\/+$/, '')}`
  return undefined
}

/** Secure cookies in production and whenever the public URL is https (privacy policy promise). */
export function secureCookiesFor(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || Boolean(authBaseUrl(env)?.startsWith('https://'))
}

const PREFIX: Record<string, string> = { user: 'usr', session: 'ses', account: 'acc', verification: 'ver' }

/** We never call Google APIs, so we don't keep Google's tokens. */
const stripTokens = <T extends Record<string, unknown>>(data: T): T => ({ ...data, accessToken: null, refreshToken: null, idToken: null })

/** Server-only endpoint (never routed over HTTP) that signs a user in. Added only when NODE_ENV=test. */
function testSignInPlugin(): BetterAuthPlugin {
  return {
    id: 'myescapes-test-sign-in',
    endpoints: {
      testSignIn: createAuthEndpoint(
        '/test/sign-in',
        { method: 'POST', body: z.object({ userId: z.string().min(1) }), metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId)
          if (!user) throw new Error('test sign-in: unknown user')
          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          return ctx.json({ ok: true })
        },
      ),
    },
  }
}

export function authOptions(db: Db, env: NodeJS.ProcessEnv) {
  const secret = authSecret(env)
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  const baseURL = authBaseUrl(env)
  const isTest = env.NODE_ENV === 'test'
  const options = {
    appName: 'My Escapes',
    secret,
    ...(baseURL ? { baseURL } : {}),
    basePath: '/api/auth',
    trustedOrigins: baseURL ? [baseURL] : [],
    database: drizzleAdapter(db, { provider: 'pg', usePlural: true, schema: { users, sessions, accounts, verifications } }),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              scope: [...GOOGLE_SCOPES],
              disableDefaultScope: true,
              prompt: 'select_account' as const,
            },
          }
        : {},
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        // `input: false`: set by our own API (onboarding, admin), never by a sign-in payload.
        handle: { type: 'string', required: false, input: false },
        displayName: { type: 'string', required: false, input: false },
        isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
        onboardedAt: { type: 'date', required: false, input: false },
      },
    },
    session: { expiresIn: SESSION_EXPIRES_IN, updateAge: SESSION_UPDATE_AGE },
    account: { accountLinking: { enabled: false } },
    databaseHooks: {
      user: {
        // Refuse sign-ups whose provider did not verify the email (Google's email_verified=false):
        // the email is not proven to be theirs. Better Auth then ends the sign-in with "unable to create user".
        create: { before: async (data: Record<string, unknown>) => (data.emailVerified === true ? { data } : false) },
      },
      // Sessions never store the client address: /privacy only promises it in short-lived server logs.
      session: {
        create: { before: async (data: Record<string, unknown>) => ({ data: { ...data, ipAddress: null } }) },
      },
      account: {
        create: { before: async (data: Record<string, unknown>) => ({ data: stripTokens(data) }) },
        update: { before: async (data: Record<string, unknown>) => ({ data: stripTokens(data) }) },
      },
    },
    disabledPaths: DISABLED_AUTH_PATHS,
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      useSecureCookies: secureCookiesFor(env),
      // Better Auth skips origin/callbackURL checks under NODE_ENV=test by default; keep them on so tests see production behaviour.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' as const, path: '/' },
      database: { generateId: ({ model }: { model: string }) => newId(PREFIX[model] ?? model.slice(0, 3)) },
    },
    // In-memory limiter for the sign-in endpoints; tests sign in many times quickly.
    rateLimit: { enabled: !isTest, window: 60, max: 60 },
    telemetry: { enabled: false },
    logger: { level: isTest ? ('error' as const) : ('warn' as const) },
    plugins: isTest ? [testSignInPlugin()] : [],
  } satisfies BetterAuthOptions
  return options
}

export function createAuth(db: Db, env: NodeJS.ProcessEnv) {
  return betterAuth(authOptions(db, env))
}

export type Auth = ReturnType<typeof createAuth>
