/**
 * Auth (workstream 3): Better Auth + Google, cookie sessions in Postgres, test-only login.
 *
 * - `server/auth/config.ts` builds the Better Auth instance (Google scopes `openid email profile`
 *   only, Drizzle adapter on our plural tables, secure http-only cookies, no telemetry).
 * - `/api/auth/*` is bridged from Fastify to Better Auth's Fetch handler.
 * - `resolveUser` reads the session cookie and maps the user to `SessionUser`.
 * - `ROUTES.testLogin` exists only when NODE_ENV=test (defineRoute skips it otherwise, and the
 *   Better Auth endpoint it uses is only installed in tests and is never routed over HTTP).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { HandleSchema, RESERVED_HANDLES } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext, SessionUser } from '../context'
import type { Db } from '../db/client'
import { newId, users } from '../db/schema'
import { isUniqueViolation } from '../db/util'
import { defineRoute, HttpError } from '../http'
import { authSecret, CLIENT_IP_HEADER, COOKIE_PREFIX, createAuth, googleConfigured, secureCookiesFor, type Auth } from './config'
import { meFromRow } from './users'

export { GOOGLE_SCOPES } from './config'

/** `google` when Google sign-in is configured, `test` when only the test login runs, else `disabled`. */
export function authMode(env: NodeJS.ProcessEnv = process.env): 'google' | 'test' | 'disabled' {
  if (googleConfigured(env)) return 'google'
  if (env.NODE_ENV === 'test') return 'test'
  return 'disabled'
}

// One Better Auth instance per (database, env) pair.
const instances = new WeakMap<Db, WeakMap<NodeJS.ProcessEnv, Auth>>()

/** The Better Auth instance for this context, or null when auth is disabled (no secret). */
export function getAuth(ctx: AppContext): Auth | null {
  if (!authSecret(ctx.env)) return null
  const db = ctx.db()
  let byEnv = instances.get(db)
  if (!byEnv) instances.set(db, (byEnv = new WeakMap()))
  let auth = byEnv.get(ctx.env)
  if (!auth) byEnv.set(ctx.env, (auth = createAuth(db, ctx.env)))
  return auth
}

/** True when the request carries what looks like one of our session cookies. */
export function hasSessionCookie(req: FastifyRequest): boolean {
  const cookie = req.headers.cookie
  return typeof cookie === 'string' && cookie.includes(`${COOKIE_PREFIX}.session_token=`)
}

export function toWebHeaders(raw: FastifyRequest['headers']): Headers {
  const headers = new Headers()
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) headers.append(k, x)
    else headers.set(k, String(v))
  }
  return headers
}

/** Copy a Fetch Response's status, headers (every Set-Cookie) and body onto a Fastify reply. */
export async function sendWebResponse(reply: FastifyReply, res: Response): Promise<FastifyReply> {
  reply.code(res.status)
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    reply.header(key, value)
  })
  const cookies = res.headers.getSetCookie()
  if (cookies.length) reply.header('set-cookie', cookies)
  const body = res.body ? Buffer.from(await res.arrayBuffer()) : null
  return reply.send(body && body.length ? body : null)
}

/** Forward any Set-Cookie headers from a Better Auth call onto the reply. */
export function forwardSetCookies(reply: FastifyReply, headers: Headers | null | undefined) {
  const cookies = headers?.getSetCookie() ?? []
  if (!cookies.length) return
  const existing = reply.getHeader('set-cookie')
  const prev = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)]
  reply.header('set-cookie', [...prev, ...cookies])
}

/** Resolves the signed-in user from the request (session cookie). */
export async function resolveUser(req: FastifyRequest, ctx: AppContext): Promise<SessionUser | null> {
  // No cookie: nobody is signed in, and public pages never touch the database for it.
  if (!hasSessionCookie(req)) return null
  const auth = getAuth(ctx)
  if (!auth) return null
  const result = await auth.api.getSession({ headers: toWebHeaders(req.headers) })
  if (!result?.user) return null
  // Read the row ourselves: the additional fields are ours, and this is the source of truth.
  const row = (await ctx.db().select().from(users).where(eq(users.id, result.user.id)).limit(1))[0]
  return row ? sessionUserFromRow(row) : null
}

export function sessionUserFromRow(u: typeof users.$inferSelect): SessionUser {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    name: u.name,
    handle: u.handle,
    displayName: u.displayName,
    image: u.image,
    isAdmin: u.isAdmin,
    onboarded: Boolean(u.handle && u.displayName),
  }
}

/** The Fastify -> Fetch bridge for Better Auth. */
async function handleAuthRequest(req: FastifyRequest, reply: FastifyReply, ctx: AppContext) {
  const auth = getAuth(ctx)
  if (!auth) throw new HttpError('not_found', 'Sign-in is not configured on this server.')
  const url = new URL(req.url, ctx.origin(req))
  const method = req.method.toUpperCase()
  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined && req.body !== null) {
    body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body)
  }
  const headers = toWebHeaders(req.headers)
  headers.delete('content-length')
  // The address Fastify trusts (server/proxy.ts), for Better Auth's per-client rate limiter.
  headers.delete(CLIENT_IP_HEADER)
  if (req.ip) headers.set(CLIENT_IP_HEADER, req.ip)
  const res = await auth.handler(new Request(url, { method, headers, body }))
  return sendWebResponse(reply, res)
}

/** Every cookie name Better Auth may have set for us (with and without the __Secure- prefix). */
export function sessionCookieNames(): string[] {
  const base = ['session_token', 'session_data', 'dont_remember'].map((n) => `${COOKIE_PREFIX}.${n}`)
  return [...base, ...base.map((n) => `__Secure-${n}`)]
}

/** Expire the session cookies on this reply (after account deletion). */
export function clearSessionCookies(reply: FastifyReply, env: NodeJS.ProcessEnv) {
  const secure = secureCookiesFor(env)
  const cookies = sessionCookieNames().map((n) => `${n}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure || n.startsWith('__Secure-') ? '; Secure' : ''}`)
  const existing = reply.getHeader('set-cookie')
  const prev = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)]
  reply.header('set-cookie', [...prev, ...cookies])
}

/** Strips and validates an optional handle for the test login. */
function testHandle(raw: string | undefined): string | null {
  if (!raw) return null
  const r = HandleSchema.safeParse(raw)
  if (!r.success || (RESERVED_HANDLES as readonly string[]).includes(r.data)) throw new HttpError('invalid', 'Invalid handle.')
  return r.data
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  // Better Auth reads bodies itself; accept form posts as raw strings in this scope.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: (req, reply) => handleAuthRequest(req, reply, ctx),
  })

  // Test-only sign-in. defineRoute registers nothing unless NODE_ENV=test.
  defineRoute(app, ctx, ROUTES.testLogin, async ({ body, reply }) => {
    const auth = getAuth(ctx)
    if (!auth) throw new HttpError('internal', 'Auth is not configured.')
    const db = ctx.db()
    const email = body.email.trim().toLowerCase()
    const handle = testHandle(body.handle)
    let row = (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0]
    if (!row) {
      const name = body.name ?? email.split('@')[0]
      const id = newId('usr')
      try {
        row = (
          await db
            .insert(users)
            .values({
              id,
              email,
              name,
              emailVerified: true,
              handle,
              displayName: handle ? name : null,
              onboardedAt: handle ? ctx.now() : null,
              isAdmin: body.isAdmin ?? false,
            })
            .returning()
        )[0]
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError('handle_taken', 'That handle is taken.')
        throw err
      }
    } else if (body.isAdmin !== undefined && body.isAdmin !== row.isAdmin) {
      row = (await db.update(users).set({ isAdmin: body.isAdmin }).where(eq(users.id, row.id)).returning())[0]
    }
    // The endpoint exists only on test instances (see config.ts) and is server-only.
    const api = auth.api as unknown as { testSignIn?: (o: { body: { userId: string }; returnHeaders: true }) => Promise<{ headers: Headers }> }
    if (!api.testSignIn) throw new HttpError('not_found', 'Not found.')
    const { headers } = await api.testSignIn({ body: { userId: row.id }, returnHeaders: true })
    forwardSetCookies(reply, headers)
    return { user: meFromRow(row) }
  })
}
