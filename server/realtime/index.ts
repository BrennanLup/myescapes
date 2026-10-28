/**
 * The websocket endpoint `GET /api/realtime` (Phase 3, workstream C) and the per-server hub.
 *
 * The upgrade is authenticated like any API call: the session cookie must belong to a signed-in,
 * onboarded user (401 / 403 before any socket exists, so signed-out demo visitors never get one).
 * Browsers must come from our own origin (cross-site websocket hijacking guard). A plain GET
 * without an upgrade answers 426.
 *
 * `hubFor(ctx)` returns the one hub of a server, so `GET /api/presence` and `GET /api/homes/:handle`
 * (server/routes/homes.ts) can read who is online without importing this module's state.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify'
import type { PublicUser } from '../../src/contracts/models'
import { CLOSE_CODES, REALTIME_PATH, type RealtimeOutfit } from '../../src/contracts/realtime'
import type { AppContext } from '../context'
import { httpError } from '../http'
import { outfitForUser } from '../routes/avatar.lib'
import { acceptedFriendIds, homeOwnerByHandle, visitAccess } from './access'
import { RealtimeHub, type HubAccess, type HubLimits } from './hub'

const hubs = new WeakMap<AppContext, RealtimeHub>()

/** The hub of the server built with `ctx` (created on first use). */
export function hubFor(ctx: AppContext, limits?: Partial<HubLimits>): RealtimeHub {
  let hub = hubs.get(ctx)
  if (!hub) {
    hub = new RealtimeHub({ access: dbAccess(ctx), limits, log: (line) => console.log(line) })
    hubs.set(ctx, hub)
  }
  return hub
}

/** The hub of `ctx` if one was created (null: realtime never started, e.g. in a unit test). */
export function existingHub(ctx: AppContext): RealtimeHub | null {
  return hubs.get(ctx) ?? null
}

export function dbAccess(ctx: AppContext): HubAccess {
  return {
    homeOwner: (handle) => homeOwnerByHandle(ctx.db(), handle),
    visitAccess: (viewerId, ownerId) => visitAccess(ctx.db(), viewerId, ownerId),
    friendIds: (userId) => acceptedFriendIds(ctx.db(), userId),
    // Others only ever see the look you saved (and so own), never one a client made up.
    outfitFor: async (userId) => (await outfitForUser(ctx.db(), userId)).outfit as RealtimeOutfit,
  }
}

/** Hosts a browser may open the socket from: our public origin(s) and the request's own host. */
export function originAllowed(req: FastifyRequest, env: NodeJS.ProcessEnv): boolean {
  const origin = req.headers.origin
  // Non-browser clients send no Origin; they still need the session cookie.
  if (!origin) return true
  let host: string
  let hostname: string
  try {
    const u = new URL(origin)
    host = u.host.toLowerCase()
    hostname = u.hostname.toLowerCase()
  } catch {
    return false
  }
  const allowed = new Set<string>()
  const add = (h: string | undefined) => {
    for (const part of (h ?? '').split(',')) if (part.trim()) allowed.add(part.trim().toLowerCase())
  }
  add(req.headers.host)
  add(req.headers['x-forwarded-host'] as string | undefined)
  for (const url of [env.PUBLIC_URL, env.BETTER_AUTH_URL]) {
    try {
      if (url) allowed.add(new URL(url).host.toLowerCase())
    } catch {
      /* ignore a malformed variable */
    }
  }
  if (env.RAILWAY_PUBLIC_DOMAIN) allowed.add(env.RAILWAY_PUBLIC_DOMAIN.toLowerCase())
  if (allowed.has(host)) return true
  // Local development: Vite on another port proxies the socket.
  const local = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  const reqHost = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '')
  return env.NODE_ENV !== 'production' && local(hostname) && local(reqHost)
}

/** Minimal view of a `ws` WebSocket (the package ships no types here). */
interface WsSocket {
  readonly bufferedAmount: number
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate(): void
  ping(): void
  on(event: 'message', fn: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): void
  on(event: 'pong', fn: () => void): void
  on(event: 'close', fn: () => void): void
  on(event: 'error', fn: (err: Error) => void): void
}

const USER_KEY = Symbol('realtimeUser')
type WithUser = FastifyRequest & { [USER_KEY]?: PublicUser }

function toText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

export async function realtimeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const hub = hubFor(ctx)
  hub.start()
  app.addHook('onClose', async () => hub.shutdown())

  const options = {
    method: 'GET',
    url: REALTIME_PATH,
    // Connection attempts (not messages): a reconnect loop gone wrong can't hammer the auth lookup.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preValidation: async (req: FastifyRequest) => {
      if (!originAllowed(req, ctx.env)) throw httpError('forbidden', 'Connect from the My Escapes site.')
      const user = await ctx.requireUser(req)
      if (!user.onboarded || !user.handle) throw httpError('onboarding_required', 'Choose a display name and @handle first.')
      ;(req as WithUser)[USER_KEY] = { id: user.id, handle: user.handle, displayName: user.displayName ?? user.handle, image: user.image }
    },
    handler: async (_req: FastifyRequest, reply: FastifyReply) => reply.code(426).header('upgrade', 'websocket').send({ error: 'Open this address as a websocket.', code: 'invalid' }),
    wsHandler: (rawSocket: unknown, req: FastifyRequest) => {
      const socket = rawSocket as WsSocket
      const user = (req as WithUser)[USER_KEY]
      if (!user) {
        socket.close(CLOSE_CODES.INVALID, 'not signed in')
        return
      }
      const conn = hub.connect(user, {
        send: (data) => socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        terminate: () => socket.terminate(),
        ping: () => socket.ping(),
        bufferedAmount: () => socket.bufferedAmount,
      })
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          void hub.message(conn, '\u0000binary')
          return
        }
        void hub.message(conn, toText(data))
      })
      socket.on('pong', () => hub.pong(conn))
      socket.on('close', () => hub.disconnect(conn))
      socket.on('error', () => hub.disconnect(conn))
    },
  }
  app.route(options as unknown as RouteOptions)
}
