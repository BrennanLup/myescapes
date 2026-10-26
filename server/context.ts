/**
 * What every route module receives: database access, the signed-in user, env and a clock.
 * Owned by workstream 27 / foundation. Route modules read from it and never import each other.
 */
import type { FastifyRequest } from 'fastify'
import type { Db, DbHandle, DbKind } from './db/client'
import { HttpError } from './http'

/** The signed-in user as the server sees it. Email is private: never put it in a public response. */
export interface SessionUser {
  id: string
  email: string
  name: string
  handle: string | null
  displayName: string | null
  image: string | null
  isAdmin: boolean
  /** True once a display name and @handle are set. */
  onboarded: boolean
}

/**
 * Admins by email: `ADMIN_EMAILS` is a comma- or space-separated list (case-insensitive). A user whose
 * email is listed is an admin even when `users.is_admin` is false (added by workstream 25).
 */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  )
}

export function isAdminEmail(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(email) && adminEmails(env).has(email!.trim().toLowerCase())
}

export type DbStatus = 'none' | 'migrating' | 'ready' | 'unavailable'

/** Mutable database state: the server can start before the database is reachable. */
export interface DbState {
  status: DbStatus
  handle: DbHandle | null
  /** Last error message (no secrets: never the connection string). */
  error: string | null
}

export type UserResolver = (req: FastifyRequest, ctx: AppContext) => Promise<SessionUser | null>

export interface AppContext {
  /** The database, or a 503 `db_unavailable` HttpError when it isn't ready. */
  db(): Db
  readonly dbState: DbState
  dbKind(): DbKind | 'none'
  /** The signed-in user, or null. Memoised per request. */
  getUser(req: FastifyRequest): Promise<SessionUser | null>
  /** The signed-in user, or a 401 `unauthorized` HttpError. */
  requireUser(req: FastifyRequest): Promise<SessionUser>
  /** A signed-in admin, or 401/403. */
  requireAdmin(req: FastifyRequest): Promise<SessionUser>
  env: NodeJS.ProcessEnv
  now(): Date
  /** Public origin for absolute links (invite URLs): PUBLIC_URL, else the request's host. */
  origin(req: FastifyRequest): string
}

export interface CreateContextOptions {
  dbState?: DbState
  /** Resolves the session user. Defaults to "nobody signed in" until auth (workstream 3) supplies one. */
  resolveUser?: UserResolver
  env?: NodeJS.ProcessEnv
  now?: () => Date
}

export function createContext(opts: CreateContextOptions = {}): AppContext {
  const dbState: DbState = opts.dbState ?? { status: 'none', handle: null, error: null }
  const env = opts.env ?? process.env
  const resolveUser: UserResolver = opts.resolveUser ?? (async () => null)
  const cache = new WeakMap<FastifyRequest, Promise<SessionUser | null>>()

  const ctx: AppContext = {
    dbState,
    env,
    now: opts.now ?? (() => new Date()),
    db() {
      if (dbState.status !== 'ready' || !dbState.handle) {
        throw new HttpError('db_unavailable', dbState.status === 'migrating' ? 'The database is starting up. Try again in a moment.' : 'The database is not available right now.')
      }
      return dbState.handle.db
    },
    dbKind() {
      return dbState.handle?.kind ?? 'none'
    },
    getUser(req) {
      let p = cache.get(req)
      if (!p) {
        p = resolveUser(req, ctx).then((u) => (u && !u.isAdmin && isAdminEmail(u.email, env) ? { ...u, isAdmin: true } : u))
        cache.set(req, p)
      }
      return p
    },
    async requireUser(req) {
      const user = await ctx.getUser(req)
      if (!user) throw new HttpError('unauthorized', 'Please sign in first.')
      return user
    },
    async requireAdmin(req) {
      const user = await ctx.requireUser(req)
      if (!user.isAdmin) throw new HttpError('forbidden', 'Admins only.')
      return user
    },
    origin(req) {
      const configured = env.PUBLIC_URL?.replace(/\/+$/, '')
      if (configured) return configured
      const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol || 'http'
      return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'}`
    },
  }
  return ctx
}
