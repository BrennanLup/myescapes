/**
 * HTTP helpers shared by every route module. Owned by foundation.
 *
 * - `HttpError` / `httpError(code, message)`: throw from a handler; the error handler turns it
 *   into an `ApiError` JSON body with the right status.
 * - `defineRoute(app, ctx, ROUTES.x, handler)`: registers a contract route. It enforces the
 *   route's auth level, validates params/query/body with the contract schemas (400 `invalid`),
 *   and parses the handler's return value with the response schema, which also strips any
 *   field the contract doesn't list (so an email can't leak through a PublicUser).
 * - `notImplemented(app, ctx, [ROUTES.a, ...])`: 501 stubs for routes not built yet.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import { ERROR_STATUS, type ApiError, type ErrorCode } from '../src/contracts/errors'
import type { RouteSpec } from '../src/contracts/routes'
import type { AppContext, SessionUser } from './context'

export class HttpError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly extra: Omit<ApiError, 'error' | 'code'>
  constructor(code: ErrorCode, message: string, extra: Omit<ApiError, 'error' | 'code'> = {}, status?: number) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.status = status ?? ERROR_STATUS[code]
    this.extra = extra
  }
  toJSON(): ApiError {
    return { error: this.message, code: this.code, ...this.extra }
  }
}

export const httpError = (code: ErrorCode, message: string, extra?: Omit<ApiError, 'error' | 'code'>) => new HttpError(code, message, extra)

export function zodDetails(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.slice(0, 10).map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }))
}

/** Parse or throw a 400 `invalid` with the issue list. */
export function parseOr400<T extends z.ZodType>(schema: T, value: unknown, what = 'request'): z.output<T> {
  const r = schema.safeParse(value)
  if (!r.success) {
    const details = zodDetails(r.error)
    throw new HttpError('invalid', `Invalid ${what}: ${details.map((d) => `${d.path}: ${d.message}`).join('; ')}`, { details })
  }
  return r.data
}

/**
 * Root error handler: HttpError -> its JSON; Fastify validation/body errors -> 400; anything
 * else -> 500 with a generic message (the detail goes to the server log, never to the client).
 */
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send(err.toJSON())
    const fe = err as FastifyError
    const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500
    if (status === 413) return reply.code(413).send({ error: 'Upload too large.', code: 'too_large' } satisfies ApiError)
    if (status === 429) return reply.code(429).send({ error: 'Too many requests. Slow down a little.', code: 'rate_limited' } satisfies ApiError)
    if (status >= 400 && status < 500) return reply.code(status).send({ error: fe.message || 'Bad request', code: 'invalid' } satisfies ApiError)
    req.log.error(err)
    console.error(`[server] ${req.method} ${req.url.split('?')[0]} failed: ${err.message}`)
    return reply.code(500).send({ error: 'Something went wrong on our side.', code: 'internal' } satisfies ApiError)
  })
}

type Out<S, K extends string> = S extends Record<K, infer T> ? (T extends z.ZodType ? z.output<T> : undefined) : undefined
type UserFor<S extends RouteSpec> = S['auth'] extends 'user' | 'admin' ? SessionUser : SessionUser | null

export interface HandlerInput<S extends RouteSpec> {
  params: Out<S, 'params'>
  query: Out<S, 'query'>
  /** Parsed JSON body; undefined for multipart routes (use `req.file()` / `req.parts()`). */
  body: S['body'] extends z.ZodType ? z.output<S['body']> : undefined
  user: UserFor<S>
  req: FastifyRequest
  reply: FastifyReply
}

export type Handler<S extends RouteSpec> = (input: HandlerInput<S>) => Promise<z.input<S['response']> | FastifyReply>

/** True when test-only routes may exist. */
export function testRoutesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test'
}

export interface RouteOptions {
  /** Fastify route config, e.g. `{ rateLimit: { max: 10, timeWindow: '1 minute' } }` (@fastify/rate-limit). */
  config?: Record<string, unknown>
  /** Per-route JSON body limit in bytes. */
  bodyLimit?: number
}

/** Register a contract route with auth, validation and response parsing. */
export function defineRoute<S extends RouteSpec>(app: FastifyInstance, ctx: AppContext, spec: S, handler: Handler<S>, options: RouteOptions = {}) {
  if (spec.auth === 'test' && !testRoutesEnabled(ctx.env)) return
  app.route({
    method: spec.method,
    url: spec.path,
    ...(options.config ? { config: options.config } : {}),
    ...(options.bodyLimit ? { bodyLimit: options.bodyLimit } : {}),
    handler: async (req, reply) => {
      let user: SessionUser | null = null
      if (spec.auth === 'user') user = await ctx.requireUser(req)
      else if (spec.auth === 'admin') user = await ctx.requireAdmin(req)
      else if (spec.auth === 'optional' || spec.auth === 'test') user = await ctx.getUser(req)
      const params = spec.params ? parseOr400(spec.params, req.params, 'path') : undefined
      const query = spec.query ? parseOr400(spec.query, req.query, 'query') : undefined
      const body = spec.body && spec.body !== 'multipart' ? parseOr400(spec.body, req.body, 'body') : undefined
      const result = await handler({ params, query, body, user, req, reply } as HandlerInput<S>)
      if (reply.sent || result === reply) return reply
      const parsed = spec.response.safeParse(result)
      if (!parsed.success) {
        console.error(`[server] response for ${spec.method} ${spec.path} broke its contract: ${zodDetails(parsed.error).map((d) => `${d.path}: ${d.message}`).join('; ')}`)
        throw new HttpError('internal', 'Something went wrong on our side.')
      }
      if (spec.status) reply.code(spec.status)
      return parsed.data
    },
  })
}

/** 501 stubs for contract routes that aren't built yet. Same auth rules as the real thing. */
export function notImplemented(app: FastifyInstance, ctx: AppContext, specs: readonly RouteSpec[]) {
  for (const spec of specs) {
    defineRoute(app, ctx, spec, async () => {
      throw new HttpError('not_implemented', `${spec.method} ${spec.path} is not built yet (workstream ${spec.ws}).`)
    })
  }
}
