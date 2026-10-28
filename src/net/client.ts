/**
 * The realtime socket client (Phase 3, workstream C): one websocket to `/api/realtime` that
 * reconnects by itself, re-joins the home it was in, keeps under the server's rate limits and
 * measures the server clock. Messages from the server are validated with the shared protocol
 * (src/contracts/realtime.ts); anything that does not parse is ignored.
 *
 * Transport and timers are injectable, so client.test.ts drives it with a fake socket and fake
 * time. The app wires it to its stores in `session.ts`.
 *
 *   const client = new RealtimeClient({ snapshot: () => ({ state, outfit }) })
 *   client.onMessage((m) => ...)
 *   client.start()
 *   client.join('mia')
 */
import {
  CLOSE_CODES,
  REALTIME_LIMITS,
  REALTIME_PATH,
  ServerMessageSchema,
  type ClientMessage,
  type Emote,
  type PlayerState,
  type RealtimeOutfit,
  type ServerMessage,
} from '@/contracts/realtime'
import { ServerClock } from './clock'

export type ConnectionStatus =
  /** Not started, or stopped. */
  | 'idle'
  /** First connection attempt in progress. */
  | 'connecting'
  /** Connected and greeted by the server. */
  | 'open'
  /** Lost the connection; trying again after a short wait. */
  | 'reconnecting'
  /** Another tab or device took over (too many open at once); not retrying. */
  | 'replaced'
  /** The server closed it after a long time without activity; back on the next key, tap or tab switch. */
  | 'paused'

/** The part of the browser WebSocket this client uses. */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: { code: number; reason?: string }) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export interface RealtimeClientOptions {
  /** Full ws(s):// URL. Default: this page's origin + REALTIME_PATH. */
  url?: string
  createSocket?: (url: string) => SocketLike
  now?: () => number
  timers?: Timers
  random?: () => number
  /** The latest local pose and look, sent with every (re)join. */
  snapshot?: () => { state?: PlayerState; outfit?: RealtimeOutfit }
}

/** Waits before reconnecting: 1 s, 2 s, 4 s ... up to 30 s, each +-20 %. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000] as const
/** After this many attempts in a row that never opened (signed out, server down), wait longer. */
export const NEVER_OPENED_LIMIT = 3
export const NEVER_OPENED_WAIT_MS = 60_000
/** Ping cadence (clock sync). Pings don't count as activity for the server's idle timeout. */
export const PING_MS = 20_000
/** Waits before asking again after the server could not answer a join (a cold database after a deploy). */
export const JOIN_RETRY_MS = [2000, 3500, 5000, 10_000, 20_000] as const
/** Join errors that mean "not now", not "never": the client keeps trying. */
const RETRY_JOIN_CODES = new Set(['rate_limited', 'unavailable'])
const STATE_INTERVAL_MS = Math.ceil(1000 / REALTIME_LIMITS.STATE_HZ)
/** The client keeps a little under the server's chat and emote limits. */
const CHAT_LIMIT = { burst: REALTIME_LIMITS.CHAT_BURST, windowMs: REALTIME_LIMITS.CHAT_WINDOW_MS + 250 }
const EMOTE_LIMIT = { burst: REALTIME_LIMITS.EMOTE_BURST, windowMs: REALTIME_LIMITS.EMOTE_WINDOW_MS + 250 }

/** Reconnect delay for the `attempt`-th retry (0-based). */
export function backoffDelay(attempt: number, neverOpened: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
  const jittered = Math.round(base * (0.8 + random() * 0.4))
  return neverOpened >= NEVER_OPENED_LIMIT ? Math.max(jittered, NEVER_OPENED_WAIT_MS) : jittered
}

/** A sliding-window limiter: at most `burst` events per `windowMs`. */
export class WindowLimiter {
  private times: number[] = []
  constructor(
    private burst: number,
    private windowMs: number,
  ) {}
  /** 0 when an event may happen now (and records it), else how long to wait in ms. */
  take(now: number): number {
    this.times = this.times.filter((t) => now - t < this.windowMs)
    if (this.times.length >= this.burst) return this.windowMs - (now - this.times[0])
    this.times.push(now)
    return 0
  }
}

/** The page's realtime URL (ws: on http, wss: on https). */
export function realtimeUrl(loc: { protocol: string; host: string } = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${REALTIME_PATH}`
}

const OPEN = 1
const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
}

export type SendResult = { ok: true } | { ok: false; reason: 'offline' | 'rate_limited' | 'empty'; retryAfterMs?: number }

export class RealtimeClient {
  readonly clock = new ServerClock()
  status: ConnectionStatus = 'idle'
  /** This connection's id, from `hello`. */
  sid: string | null = null
  /** The home we want to be in (re-joined after a reconnect). */
  wantedHome: string | null = null
  /** The home the server says we are in. */
  currentHome: string | null = null

  private opts: Required<Omit<RealtimeClientOptions, 'url' | 'snapshot'>> & Pick<RealtimeClientOptions, 'url' | 'snapshot'>
  private socket: SocketLike | null = null
  private greeted = false
  private attempt = 0
  private neverOpened = 0
  private retryTimer: unknown = null
  private pingTimer: unknown = null
  private stateTimer: unknown = null
  private joinRetryTimer: unknown = null
  private joinAttempt = 0
  private pendingState: PlayerState | null = null
  private lastStateAt = -Infinity
  private pingSeq = 0
  private pings = new Map<number, number>()
  private chat = new WindowLimiter(CHAT_LIMIT.burst, CHAT_LIMIT.windowMs)
  private emotes = new WindowLimiter(EMOTE_LIMIT.burst, EMOTE_LIMIT.windowMs)
  private messageListeners = new Set<(m: ServerMessage) => void>()
  private statusListeners = new Set<(s: ConnectionStatus) => void>()

  constructor(opts: RealtimeClientOptions = {}) {
    this.opts = {
      url: opts.url,
      snapshot: opts.snapshot,
      createSocket: opts.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike),
      now: opts.now ?? (() => Date.now()),
      timers: opts.timers ?? defaultTimers,
      random: opts.random ?? Math.random,
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.status !== 'idle') return
    this.connect('connecting')
  }

  /** Close for good (page unload, sign-out). */
  stop(): void {
    this.clearTimers()
    this.setStatus('idle')
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = s.onmessage = s.onerror = s.onopen = null
      try {
        s.close(CLOSE_CODES.NORMAL, 'bye')
      } catch {
        /* already closed */
      }
    }
    this.greeted = false
    this.currentHome = null
  }

  /** Skip the wait and try now (the network came back, the tab became visible, the person is back). */
  reconnectNow(): void {
    if (this.status !== 'reconnecting' && this.status !== 'paused') return
    if (this.retryTimer !== null) this.opts.timers.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.attempt = 0
    this.connect('reconnecting')
  }

  /** True when messages can be sent. */
  get ready(): boolean {
    return this.greeted && this.socket?.readyState === OPEN
  }

  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.messageListeners.add(fn)
    return () => this.messageListeners.delete(fn)
  }

  onStatus(fn: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /** Be in `handle`'s home (now, and again after every reconnect). */
  join(handle: string): void {
    this.wantedHome = handle
    this.joinAttempt = 0
    this.sendJoin()
  }

  leave(): void {
    this.wantedHome = null
    if (this.currentHome) this.send({ type: 'leave' })
  }

  /** Share my pose. Throttled to the server's rate; the newest pose always goes out. */
  sendState(s: PlayerState): void {
    this.pendingState = s
    if (!this.currentHome || !this.ready) return
    const wait = this.lastStateAt + STATE_INTERVAL_MS - this.opts.now()
    if (wait <= 0) this.flushState()
    else if (this.stateTimer === null) this.stateTimer = this.opts.timers.setTimeout(() => this.flushState(), wait)
  }

  sendOutfit(outfit: RealtimeOutfit): void {
    if (this.currentHome) this.send({ type: 'outfit', outfit })
  }

  sendChat(raw: string): SendResult {
    const text = raw.trim()
    if (!text) return { ok: false, reason: 'empty' }
    if (!this.ready || !this.currentHome) return { ok: false, reason: 'offline' }
    const wait = this.chat.take(this.opts.now())
    if (wait) return { ok: false, reason: 'rate_limited', retryAfterMs: wait }
    this.send({ type: 'chat', text: text.slice(0, 1000) })
    return { ok: true }
  }

  sendEmote(emote: Emote): SendResult {
    if (!this.ready || !this.currentHome) return { ok: false, reason: 'offline' }
    const wait = this.emotes.take(this.opts.now())
    if (wait) return { ok: false, reason: 'rate_limited', retryAfterMs: wait }
    this.send({ type: 'emote', emote })
    return { ok: true }
  }

  /** The owner removes a guest for this visit. */
  kick(sid: string): void {
    this.send({ type: 'kick', sid })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private send(msg: ClientMessage): boolean {
    const s = this.socket
    if (!s || s.readyState !== OPEN || !this.greeted) return false
    try {
      s.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  private sendJoin(): void {
    if (!this.wantedHome || !this.ready) return
    const snap = this.opts.snapshot?.() ?? {}
    this.send({ type: 'join', home: this.wantedHome, ...(snap.state ? { state: snap.state } : {}), ...(snap.outfit ? { outfit: snap.outfit } : {}) })
  }

  private flushState(): void {
    if (this.stateTimer !== null) this.opts.timers.clearTimeout(this.stateTimer)
    this.stateTimer = null
    const s = this.pendingState
    if (!s || !this.currentHome) return
    if (this.send({ type: 'state', s })) {
      this.pendingState = null
      this.lastStateAt = this.opts.now()
    }
  }

  private ping(): void {
    const n = ++this.pingSeq
    this.pings.set(n, this.opts.now())
    // Forget pings that never came back.
    if (this.pings.size > 8) this.pings.delete(Math.min(...this.pings.keys()))
    this.send({ type: 'ping', n })
  }

  private schedulePings(first: number): void {
    if (this.pingTimer !== null) this.opts.timers.clearTimeout(this.pingTimer)
    this.pingTimer = this.opts.timers.setTimeout(() => {
      this.pingTimer = null
      if (!this.ready) return
      this.ping()
      this.schedulePings(PING_MS)
    }, first)
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return
    this.status = s
    for (const fn of [...this.statusListeners]) fn(s)
  }

  private clearTimers(): void {
    for (const t of [this.retryTimer, this.pingTimer, this.stateTimer, this.joinRetryTimer]) if (t !== null) this.opts.timers.clearTimeout(t)
    this.retryTimer = this.pingTimer = this.stateTimer = this.joinRetryTimer = null
  }

  private connect(status: 'connecting' | 'reconnecting'): void {
    this.setStatus(status)
    const url = this.opts.url ?? realtimeUrl()
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(url)
    } catch {
      this.scheduleReconnect(false)
      return
    }
    this.socket = socket
    this.greeted = false
    let opened = false
    socket.onopen = () => {
      opened = true
    }
    socket.onmessage = (ev) => this.receive(ev.data)
    socket.onerror = () => {
      /* onclose follows */
    }
    socket.onclose = (ev) => {
      if (this.socket !== socket) return
      this.socket = null
      this.greeted = false
      this.currentHome = null
      this.sid = null
      for (const t of [this.pingTimer, this.stateTimer, this.joinRetryTimer]) if (t !== null) this.opts.timers.clearTimeout(t)
      this.pingTimer = this.stateTimer = this.joinRetryTimer = null
      if (ev.code === CLOSE_CODES.REPLACED) {
        this.setStatus('replaced')
        return
      }
      // Closed for being away: don't walk straight back in; the app calls reconnectNow() on activity.
      if (ev.code === CLOSE_CODES.IDLE) {
        this.attempt = 0
        this.setStatus('paused')
        return
      }
      this.scheduleReconnect(opened)
    }
  }

  private scheduleReconnect(opened: boolean): void {
    this.neverOpened = opened ? 0 : this.neverOpened + 1
    const delay = backoffDelay(this.attempt, this.neverOpened, this.opts.random)
    this.attempt++
    this.setStatus('reconnecting')
    this.retryTimer = this.opts.timers.setTimeout(() => {
      this.retryTimer = null
      this.connect('reconnecting')
    }, delay)
  }

  private receive(data: unknown): void {
    let raw: unknown
    try {
      raw = JSON.parse(String(data))
    } catch {
      return
    }
    const parsed = ServerMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const msg = parsed.data
    const now = this.opts.now()
    switch (msg.type) {
      case 'hello':
        this.greeted = true
        this.sid = msg.sid
        this.attempt = 0
        this.neverOpened = 0
        this.clock.seed(msg.serverTime, now)
        this.setStatus('open')
        // Two quick pings for a good clock estimate, then the regular cadence.
        this.ping()
        this.schedulePings(2500)
        this.sendJoin()
        break
      case 'pong': {
        const sentAt = msg.n !== undefined ? this.pings.get(msg.n) : undefined
        if (sentAt !== undefined) {
          this.pings.delete(msg.n!)
          this.clock.sample(msg.serverTime, sentAt, now)
        }
        break
      }
      case 'joined':
        this.currentHome = msg.home.handle
        this.wantedHome = msg.home.handle
        this.joinAttempt = 0
        if (!this.clock.synced) this.clock.seed(msg.serverTime, now)
        // A pose that waited for the join goes out now.
        if (this.pendingState) this.sendState(this.pendingState)
        break
      case 'left':
        this.currentHome = null
        // Removed by the owner or no longer friends: don't walk back in on the next reconnect.
        if (msg.reason === 'kicked' || msg.reason === 'removed' || msg.reason === 'left' || msg.reason === 'replaced') this.wantedHome = null
        break
      case 'error':
        if (msg.about === 'join') {
          if (RETRY_JOIN_CODES.has(msg.code)) {
            // Busy or a passing server problem: try again shortly, a little later each time.
            if (this.wantedHome) {
              const step = JOIN_RETRY_MS[Math.min(this.joinAttempt, JOIN_RETRY_MS.length - 1)]
              const wait = Math.max(msg.retryAfterMs ?? 0, Math.round(step * (0.8 + this.opts.random() * 0.4)))
              this.joinAttempt++
              if (this.joinRetryTimer !== null) this.opts.timers.clearTimeout(this.joinRetryTimer)
              this.joinRetryTimer = this.opts.timers.setTimeout(() => {
                this.joinRetryTimer = null
                this.sendJoin()
              }, wait)
            }
          } else {
            // not_found, not_friends, forbidden, home_full ...: asking again won't change the answer.
            this.wantedHome = null
          }
        }
        break
      default:
        break
    }
    for (const fn of [...this.messageListeners]) fn(msg)
  }
}
