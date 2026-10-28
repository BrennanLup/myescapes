/**
 * The in-memory realtime hub (Phase 3, workstream C). One per server process.
 *
 * It knows nothing about websockets: the route (server/realtime/index.ts) wraps each socket in a
 * `Peer` and forwards messages, pongs and closes. Access rules come in through `HubAccess`
 * (server/realtime/access.ts in production, a fake in unit tests), and time through `now()`, so
 * every rule here is testable without a network or a database.
 *
 * What it does (protocol in src/contracts/realtime.ts):
 *   - each connection is a signed-in, onboarded user; it joins at most one home at a time;
 *   - only the owner and accepted friends may join (checked on join, and again every
 *     REVALIDATE_MS for guests, so an unfriend or block removes them within a minute);
 *   - a block between two guests of the same home hides them from each other completely (no
 *     poses, chat, emotes, looks or arrivals either way), like everywhere else in the app;
 *   - a guest the owner asked to leave can't come back for KICK_COOLDOWN_MS, even if the home
 *     empties in between (the cool-downs live on the hub, not on the in-memory Home);
 *   - caps: MAX_PLAYERS_PER_HOME (the owner always gets in), MAX_SOCKETS_PER_USER;
 *   - rate limits: state at STATE_HZ (excess dropped), chat, emotes and joins per window
 *     (`error rate_limited`), and a flood ceiling that closes the socket;
 *   - poses are coalesced and broadcast every STATE_BROADCAST_MS as one `states` message;
 *   - presence: friends hear when you come online, move or go offline; the owner hears when
 *     someone enters their home while they are elsewhere ("visitor");
 *   - idle sockets (no activity: pings don't count) are closed, dead ones (no pong) terminated.
 *
 * Single instance only: homes live in this process's memory. Scaling out to several instances
 * needs a shared pub/sub (see DECISIONS.md).
 */
import { randomBytes } from 'node:crypto'
import type { PublicUser } from '../../src/contracts/models'
import {
  CLOSE_CODES,
  ClientMessageSchema,
  REALTIME_LIMITS,
  sanitizeChat,
  type ClientMessage,
  type LeaveReason,
  type PlayerState,
  type PresenceWhere,
  type RealtimeErrorCode,
  type RealtimeOutfit,
  type RemotePlayer,
  type ServerMessage,
} from '../../src/contracts/realtime'
import type { HomeOwner, VisitAccess } from './access'

/** One end of a socket, as the hub sees it. */
export interface Peer {
  send(data: string): void
  close(code: number, reason: string): void
  /** Drop the connection without a close handshake (dead peers). */
  terminate(): void
  /** Transport-level ping; the peer answers through `hub.pong(conn)`. */
  ping(): void
  /** Bytes queued but not yet sent (backpressure). */
  bufferedAmount(): number
}

export interface HubAccess {
  homeOwner(handle: string): Promise<HomeOwner | null>
  visitAccess(viewerId: string, ownerId: string): Promise<VisitAccess>
  friendIds(userId: string): Promise<Set<string>>
  /**
   * The look `userId` saved (ownership already checked by `PUT /api/me/avatar`). When set, the hub
   * never relays a look a client sent: it shows this one at join and reloads it on `outfit`, so a
   * modified client can't show items it does not own. Unset (unit tests): client looks are relayed.
   */
  outfitFor?(userId: string): Promise<RealtimeOutfit | null>
  /** Everyone with a block between them and `userId`, either direction. */
  blockedIds(userId: string): Promise<Set<string>>
}

export type HubLimits = { -readonly [K in keyof typeof REALTIME_LIMITS]: number }

export interface HubOptions {
  access: HubAccess
  now?: () => number
  limits?: Partial<HubLimits>
  /** Called with short operational lines (never message contents). */
  log?: (line: string) => void
}

/** Skip pose broadcasts to a peer with this much queued; terminate it past the hard limit. */
const SOFT_BUFFER_BYTES = 1_000_000
const HARD_BUFFER_BYTES = 8_000_000

/** Sliding-window counter: at most `max` events per `windowMs`. */
class Window {
  private hits: number[] = []
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  /** Records a hit when allowed. Returns 0 when allowed, else ms until the next slot frees up. */
  take(now: number): number {
    this.hits = this.hits.filter((t) => now - t < this.windowMs)
    if (this.hits.length >= this.max) return this.windowMs - (now - this.hits[0])
    this.hits.push(now)
    return 0
  }
}

/** Token bucket: `rate` tokens per second, up to `burst`. */
class Bucket {
  private tokens: number
  private at: number
  constructor(
    private rate: number,
    private burst: number,
    now: number,
  ) {
    this.tokens = burst
    this.at = now
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate)
    this.at = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

export class Connection {
  readonly sid: string
  readonly user: PublicUser
  readonly peer: Peer
  readonly openedAt: number
  /** Any message at all (liveness). */
  lastMessageAt: number
  /** The last real activity: join, leave, state, outfit, emote, chat, kick. Pings don't count. */
  lastActivityAt: number
  alive = true
  closed = false
  home: Home | null = null
  joinedAt = 0
  state: PlayerState | null = null
  outfit: RealtimeOutfit | null = null
  stateDirty = false
  /** Resolves once the friend list is loaded and presence was announced. */
  ready: Promise<void> = Promise.resolve()
  /** Bumped on every join/leave so a slow join that lost the race is ignored. */
  joinSeq = 0
  /** Bumped on every outfit reload so an older, slower one never wins. */
  outfitSeq = 0
  droppedStates = 0
  floodWindowStart: number
  floodCount = 0
  readonly chat: Window
  readonly emote: Window
  readonly join: Window
  readonly outfitWindow: Window
  readonly states: Bucket

  constructor(sid: string, user: PublicUser, peer: Peer, now: number, limits: HubLimits) {
    this.sid = sid
    this.user = user
    this.peer = peer
    this.openedAt = now
    this.lastMessageAt = now
    this.lastActivityAt = now
    this.floodWindowStart = now
    this.chat = new Window(limits.CHAT_BURST, limits.CHAT_WINDOW_MS)
    this.emote = new Window(limits.EMOTE_BURST, limits.EMOTE_WINDOW_MS)
    this.join = new Window(limits.JOIN_BURST, limits.JOIN_WINDOW_MS)
    this.outfitWindow = new Window(limits.JOIN_BURST, limits.JOIN_WINDOW_MS)
    // A little slack over STATE_HZ for network jitter; anything faster is dropped.
    this.states = new Bucket(limits.STATE_HZ * 1.25, limits.STATE_HZ * 1.5, now)
  }
}

export class Home {
  readonly members = new Map<string, Connection>()
  constructor(
    readonly ownerId: string,
    readonly handle: string,
    readonly owner: PublicUser,
  ) {}
}

export class RealtimeHub {
  readonly limits: HubLimits
  private readonly access: HubAccess
  private readonly now: () => number
  private readonly log: (line: string) => void
  private readonly connections = new Map<string, Connection>()
  private readonly byUser = new Map<string, Set<Connection>>()
  /** Accepted friends of each online user, refreshed on connect and every REVALIDATE_MS. */
  private readonly friendsOf = new Map<string, Set<string>>()
  /** Blocks (either direction) of each user in a home, loaded on join and every REVALIDATE_MS. */
  private readonly blockedOf = new Map<string, Set<string>>()
  private readonly homes = new Map<string, Home>()
  /**
   * "Ask to leave" cool-downs: owner id -> guest id -> until when. Kept on the hub so they outlive
   * the Home (which is deleted when it empties); expired entries are pruned by `heartbeat()`.
   */
  private readonly kicks = new Map<string, Map<string, number>>()
  private timer: NodeJS.Timeout | null = null
  private lastHeartbeat: number
  private lastRevalidate: number
  private revalidating: Promise<void> | null = null
  private chatSeq = 0
  private stopped = false

  constructor(opts: HubOptions) {
    this.access = opts.access
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? (() => {})
    this.limits = { ...REALTIME_LIMITS, ...opts.limits }
    this.lastHeartbeat = this.now()
    this.lastRevalidate = this.now()
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Run `tick()` every STATE_BROADCAST_MS (unref'd: never keeps the process alive). */
  start(): void {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => this.tick(), this.limits.STATE_BROADCAST_MS)
    this.timer.unref()
  }

  /** Close every socket (server shutting down) and stop the timer. */
  shutdown(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const conn of [...this.connections.values()]) {
      this.drop(conn, 'shutdown')
      try {
        conn.peer.close(CLOSE_CODES.SERVER_SHUTDOWN, 'server restarting')
      } catch {
        /* already gone */
      }
    }
  }

  /** Broadcast poses; every HEARTBEAT_MS ping peers and close idle ones; every REVALIDATE_MS re-check guests. */
  tick(): void {
    const now = this.now()
    this.flushStates()
    if (now - this.lastHeartbeat >= this.limits.HEARTBEAT_MS) {
      this.lastHeartbeat = now
      this.heartbeat()
    }
    if (now - this.lastRevalidate >= this.limits.REVALIDATE_MS) {
      this.lastRevalidate = now
      void this.revalidate()
    }
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  /** A new authenticated socket. Sends `hello`, enforces the per-user cap, announces presence. */
  connect(user: PublicUser, peer: Peer): Connection {
    const now = this.now()
    const conn = new Connection(`rt_${randomBytes(8).toString('base64url')}`, user, peer, now, this.limits)
    if (this.stopped) {
      peer.close(CLOSE_CODES.SERVER_SHUTDOWN, 'server restarting')
      conn.closed = true
      return conn
    }
    const mine = this.byUser.get(user.id) ?? new Set<Connection>()
    const firstSocket = mine.size === 0
    mine.add(conn)
    this.byUser.set(user.id, mine)
    this.connections.set(conn.sid, conn)
    // Over the per-user cap: close the oldest sockets.
    if (mine.size > this.limits.MAX_SOCKETS_PER_USER) {
      const oldest = [...mine].sort((a, b) => a.openedAt - b.openedAt).slice(0, mine.size - this.limits.MAX_SOCKETS_PER_USER)
      for (const old of oldest) this.close(old, CLOSE_CODES.REPLACED, 'too many tabs', 'replaced')
    }
    this.send(conn, {
      type: 'hello',
      sid: conn.sid,
      you: user,
      serverTime: now,
      limits: {
        maxPlayersPerHome: this.limits.MAX_PLAYERS_PER_HOME,
        stateHz: this.limits.STATE_HZ,
        chatMaxLength: this.limits.CHAT_MAX_LENGTH,
        chatBurst: this.limits.CHAT_BURST,
        chatWindowMs: this.limits.CHAT_WINDOW_MS,
        idleTimeoutMs: this.limits.IDLE_TIMEOUT_MS,
      },
    })
    conn.ready = this.loadFriends(conn, firstSocket)
    return conn
  }

  /** Load the user's friend list, then tell online friends they arrived. */
  private async loadFriends(conn: Connection, firstSocket: boolean): Promise<void> {
    const { user } = conn
    try {
      const friends = await this.access.friendIds(user.id)
      if (this.byUser.has(user.id)) this.friendsOf.set(user.id, friends)
    } catch (err) {
      this.log(`[realtime] friend list for ${user.id} failed: ${(err as Error).message}`)
    }
    if (conn.closed) return
    if (firstSocket) this.announce(user)
    // And tell this socket who is already online: a friend whose own list loaded before ours
    // skipped us in their announce, and nothing else would tell us about them.
    this.presenceSnapshot(conn)
  }

  /** Send `conn` one presence line per online friend (mutual in both loaded lists). */
  private presenceSnapshot(conn: Connection): void {
    const { user } = conn
    for (const friendId of this.friendsOf.get(user.id) ?? []) {
      const conns = this.byUser.get(friendId)
      if (!conns?.size || !this.friendsOf.get(friendId)?.has(user.id)) continue
      const friend = [...conns][0].user
      const where = this.whereFor(friendId, user.id)
      if (where !== 'offline') this.send(conn, { type: 'presence', user: friend, online: true, where })
    }
  }

  /** The socket closed (or errored). */
  disconnect(conn: Connection, reason: LeaveReason = 'disconnected'): void {
    this.drop(conn, reason)
  }

  /** The peer answered a transport ping. */
  pong(conn: Connection): void {
    conn.alive = true
  }

  /** A raw message from the socket. Never throws. */
  async message(conn: Connection, raw: string): Promise<void> {
    if (conn.closed) return
    const now = this.now()
    conn.lastMessageAt = now
    conn.alive = true
    // Flood ceiling: count messages per one-second window.
    if (now - conn.floodWindowStart >= 1000) {
      conn.floodWindowStart = now
      conn.floodCount = 0
    }
    if (++conn.floodCount > this.limits.FLOOD_MESSAGES_PER_SECOND) {
      this.log(`[realtime] ${conn.user.handle ?? conn.user.id} closed for flooding`)
      this.close(conn, CLOSE_CODES.FLOOD, 'too many messages', 'kicked')
      return
    }
    if (raw.length > this.limits.MAX_MESSAGE_BYTES) return this.error(conn, 'invalid', 'Message too large.')
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return this.error(conn, 'invalid', 'Messages must be JSON.')
    }
    const parsed = ClientMessageSchema.safeParse(json)
    if (!parsed.success) {
      const t = (json as { type?: unknown } | null)?.type
      return this.error(conn, 'invalid', `Invalid message: ${parsed.error.issues[0]?.path.join('.') || 'type'} ${parsed.error.issues[0]?.message ?? ''}`.trim(), typeof t === 'string' ? t.slice(0, 20) : undefined)
    }
    if (parsed.data.type !== 'ping') conn.lastActivityAt = now
    try {
      await this.handle(conn, parsed.data, now)
    } catch (err) {
      this.log(`[realtime] ${parsed.data.type} failed: ${(err as Error).message}`)
      this.error(conn, 'unavailable', 'Something went wrong on our side. Try again in a moment.', parsed.data.type)
    }
  }

  private async handle(conn: Connection, msg: ClientMessage, now: number): Promise<void> {
    switch (msg.type) {
      case 'join':
        return this.joinHome(conn, msg.home, msg.state, msg.outfit, now)
      case 'leave':
        if (!conn.home) return this.error(conn, 'not_joined', 'You are not in a home.', 'leave')
        conn.joinSeq++
        return this.leaveHome(conn, 'left')
      case 'state':
        if (!conn.home) return
        if (!conn.states.take(now)) {
          conn.droppedStates++
          return
        }
        conn.state = msg.s
        conn.stateDirty = true
        return
      case 'outfit': {
        const wait = conn.outfitWindow.take(now)
        if (wait) return this.error(conn, 'rate_limited', 'Changing clothes too fast.', 'outfit', wait)
        // With saved looks available, an 'outfit' message only means "I saved a new look".
        const seq = ++conn.outfitSeq
        const outfit = await this.trustedOutfit(conn, msg.outfit)
        if (conn.closed || seq !== conn.outfitSeq || !outfit) return
        conn.outfit = outfit
        if (conn.home) this.broadcast(conn.home, { type: 'outfit', sid: conn.sid, outfit }, conn, conn)
        return
      }
      case 'emote': {
        if (!conn.home) return this.error(conn, 'not_joined', 'Join a home first.', 'emote')
        const wait = conn.emote.take(now)
        if (wait) return this.error(conn, 'rate_limited', 'Easy! Try that again in a moment.', 'emote', wait)
        this.broadcast(conn.home, { type: 'emote', sid: conn.sid, emote: msg.emote, at: now }, conn, conn)
        return
      }
      case 'chat': {
        if (!conn.home) return this.error(conn, 'not_joined', 'Join a home first.', 'chat')
        const text = sanitizeChat(msg.text)
        if (!text) return this.error(conn, 'invalid', 'Say something first.', 'chat')
        const wait = conn.chat.take(now)
        if (wait) return this.error(conn, 'rate_limited', `You're sending messages quickly. Wait ${Math.ceil(wait / 1000)} s, then send it again.`, 'chat', wait)
        this.broadcast(conn.home, { type: 'chat', id: `c${++this.chatSeq}`, sid: conn.sid, user: conn.user, text, at: now }, undefined, conn)
        return
      }
      case 'kick': {
        const home = conn.home
        if (!home || home.ownerId !== conn.user.id) return this.error(conn, 'forbidden', 'Only the owner can ask someone to leave.', 'kick')
        const target = home.members.get(msg.sid)
        if (!target || target.user.id === conn.user.id) return this.error(conn, 'not_found', 'That player is not here.', 'kick')
        // Not straight back in (a reload or a scripted join): the home remembers for a while.
        let kicks = this.kicks.get(home.ownerId)
        if (!kicks) this.kicks.set(home.ownerId, (kicks = new Map()))
        kicks.set(target.user.id, now + this.limits.KICK_COOLDOWN_MS)
        for (const m of [...home.members.values()]) {
          if (m.user.id !== target.user.id) continue
          m.joinSeq++
          this.leaveHome(m, 'kicked')
        }
        return
      }
      case 'ping':
        this.send(conn, { type: 'pong', n: msg.n, serverTime: now })
        return
    }
  }

  // -------------------------------------------------------------------------
  // Homes
  // -------------------------------------------------------------------------

  /**
   * The look to show for `conn`: its saved one when the access layer can load it (whatever the
   * client sent is ignored), otherwise the one it sent. Null keeps the current look.
   */
  private async trustedOutfit(conn: Connection, sent: RealtimeOutfit | undefined): Promise<RealtimeOutfit | null> {
    if (!this.access.outfitFor) return sent ?? null
    try {
      return await this.access.outfitFor(conn.user.id)
    } catch (err) {
      this.log(`[realtime] loading a saved look failed: ${(err as Error).message}`)
      return null
    }
  }

  private async joinHome(conn: Connection, handle: string, state: PlayerState | undefined, sentOutfit: RealtimeOutfit | undefined, now: number): Promise<void> {
    const wait = conn.join.take(now)
    if (wait) return this.error(conn, 'rate_limited', 'Too many joins. Wait a moment.', 'join', wait)
    const seq = ++conn.joinSeq
    const owner = await this.access.homeOwner(handle)
    if (conn.closed || seq !== conn.joinSeq) return
    if (!owner) return this.error(conn, 'not_found', 'There is no room with that @handle.', 'join')
    const outfitSeq = ++conn.outfitSeq
    const [access, loaded] = await Promise.all([
      owner.id === conn.user.id ? ('owner' as const) : this.access.visitAccess(conn.user.id, owner.id),
      this.trustedOutfit(conn, sentOutfit),
    ])
    if (conn.closed || seq !== conn.joinSeq) return
    // A later outfit reload (or join) already decided the look.
    const outfit = outfitSeq === conn.outfitSeq ? loaded : null
    if (access === 'not_found') return this.error(conn, 'not_found', 'There is no room with that @handle.', 'join')
    if (access === 'not_friends') return this.error(conn, 'not_friends', `Only @${owner.handle}'s friends can visit their room.`, 'join')
    // Who this person must not meet in there (a block with another guest).
    const blocked = await this.access.blockedIds(conn.user.id)
    if (conn.closed || seq !== conn.joinSeq) return
    if (this.byUser.has(conn.user.id)) this.blockedOf.set(conn.user.id, blocked)

    let home = this.homes.get(owner.id)
    const kickedUntil = this.kicks.get(owner.id)?.get(conn.user.id) ?? 0
    if (access !== 'owner' && kickedUntil > now) {
      const mins = Math.max(1, Math.ceil((kickedUntil - now) / 60_000))
      return this.error(conn, 'forbidden', `${owner.user.displayName} asked you to leave. You can come back in ${mins} min.`, 'join', kickedUntil - now)
    }
    if (conn.home && conn.home === home) {
      // Already there: take the pose and outfit it sent, let the others see them, and answer
      // again so a reconnecting client can resync.
      if (outfit) {
        conn.outfit = outfit
        this.broadcast(home, { type: 'outfit', sid: conn.sid, outfit }, conn, conn)
      }
      if (state) {
        conn.state = state
        conn.stateDirty = true
      }
      this.send(conn, this.joinedMessage(home, conn))
      return
    }
    const sameUser = home ? [...home.members.values()].find((m) => m.user.id === conn.user.id) : undefined
    const occupied = (home?.members.size ?? 0) - (sameUser ? 1 : 0)
    if (access !== 'owner' && occupied >= this.limits.MAX_PLAYERS_PER_HOME) {
      return this.error(conn, 'home_full', `@${owner.handle}'s room is full (${this.limits.MAX_PLAYERS_PER_HOME} people). Try again soon.`, 'join')
    }
    if (conn.home) this.leaveHome(conn, 'left')
    if (sameUser) {
      sameUser.joinSeq++
      this.leaveHome(sameUser, 'replaced')
    }
    home = this.homes.get(owner.id)
    if (!home) {
      home = new Home(owner.id, owner.handle, owner.user)
      this.homes.set(owner.id, home)
    }
    // Only now that the join can't fail: a refused join must not change the pose used where it is.
    if (outfit) conn.outfit = outfit
    if (state) {
      conn.state = state
      conn.stateDirty = false
    }
    conn.home = home
    conn.joinedAt = now
    home.members.set(conn.sid, conn)
    this.send(conn, this.joinedMessage(home, conn))
    this.broadcast(home, { type: 'player_joined', player: this.remote(conn) }, conn, conn)
    if (home.ownerId !== conn.user.id) this.notifyOwner(home, conn.user, true)
    this.announce(conn.user)
  }

  /** Take a connection out of its home, telling it and everyone else there. */
  private leaveHome(conn: Connection, reason: LeaveReason): void {
    const home = conn.home
    if (!home) return
    home.members.delete(conn.sid)
    conn.home = null
    conn.stateDirty = false
    if (!conn.closed) this.send(conn, { type: 'left', home: home.handle, reason })
    this.broadcast(home, { type: 'player_left', sid: conn.sid, userId: conn.user.id, reason }, undefined, conn)
    if (!home.members.size) this.homes.delete(home.ownerId)
    if (home.ownerId !== conn.user.id && ![...home.members.values()].some((m) => m.user.id === conn.user.id)) this.notifyOwner(home, conn.user, false)
    this.announce(conn.user)
  }

  private joinedMessage(home: Home, conn: Connection): ServerMessage {
    return {
      type: 'joined',
      home: { handle: home.handle, owner: home.owner },
      sid: conn.sid,
      isOwner: home.ownerId === conn.user.id,
      players: [...home.members.values()].filter((m) => m !== conn && !this.hidden(m, conn)).map((m) => this.remote(m)),
      serverTime: this.now(),
    }
  }

  private remote(conn: Connection): RemotePlayer {
    return {
      sid: conn.sid,
      user: conn.user,
      isOwner: conn.home?.ownerId === conn.user.id,
      state: conn.state,
      outfit: conn.outfit,
      joinedAt: conn.joinedAt,
    }
  }

  /** Tell the owner's sockets that are not in the home that someone came or went. */
  private notifyOwner(home: Home, visitor: PublicUser, joined: boolean): void {
    for (const c of this.byUser.get(home.ownerId) ?? []) {
      if (c.home !== home) this.send(c, { type: 'visitor', user: visitor, joined })
    }
  }

  // -------------------------------------------------------------------------
  // Periodic work
  // -------------------------------------------------------------------------

  /** One `states` message per home with the poses that changed since the last flush. */
  flushStates(): void {
    const at = this.now()
    for (const home of this.homes.values()) {
      const changed: { from: Connection; sid: string; s: PlayerState }[] = []
      for (const m of home.members.values()) {
        if (m.stateDirty && m.state) changed.push({ from: m, sid: m.sid, s: m.state })
        m.stateDirty = false
      }
      if (!changed.length) continue
      for (const m of home.members.values()) {
        const others = changed.filter((c) => c.from !== m && !this.hidden(c.from, m)).map(({ sid, s }) => ({ sid, s }))
        if (others.length) this.send(m, { type: 'states', at, players: others }, true)
      }
    }
  }

  /** Terminate peers that missed the last ping, close idle ones, ping the rest. */
  heartbeat(): void {
    const now = this.now()
    this.pruneKicks(now)
    for (const conn of [...this.connections.values()]) {
      if (!conn.alive) {
        this.drop(conn, 'disconnected')
        try {
          conn.peer.terminate()
        } catch {
          /* gone */
        }
        continue
      }
      if (now - conn.lastActivityAt >= this.limits.IDLE_TIMEOUT_MS) {
        this.close(conn, CLOSE_CODES.IDLE, 'idle', 'idle')
        continue
      }
      conn.alive = false
      try {
        conn.peer.ping()
      } catch {
        /* the close event will follow */
      }
    }
  }

  /** Forget "ask to leave" cool-downs that have run out. */
  private pruneKicks(now: number): void {
    for (const [ownerId, kicks] of this.kicks) {
      for (const [userId, until] of kicks) if (until <= now) kicks.delete(userId)
      if (!kicks.size) this.kicks.delete(ownerId)
    }
  }

  /**
   * Refresh online users' friend lists and remove guests who may no longer be in a home
   * (unfriended or blocked since they joined). Runs at most once at a time.
   */
  revalidate(): Promise<void> {
    if (!this.revalidating) {
      this.revalidating = this.doRevalidate().finally(() => {
        this.revalidating = null
      })
    }
    return this.revalidating
  }

  private async doRevalidate(): Promise<void> {
    // Friend lists: keep only people still connected, and tell anyone whose list changed.
    const changed: string[] = []
    for (const userId of [...this.byUser.keys()]) {
      let next: Set<string>
      try {
        next = await this.access.friendIds(userId)
      } catch (err) {
        this.log(`[realtime] revalidate friends failed: ${(err as Error).message}`)
        continue
      }
      if (!this.byUser.has(userId)) continue
      const prev = this.friendsOf.get(userId)
      this.friendsOf.set(userId, next)
      if (prev && !sameSet(prev, next)) changed.push(userId)
    }
    for (const userId of changed) {
      const conns = this.byUser.get(userId)
      if (!conns?.size) continue
      for (const c of conns) this.send(c, { type: 'friends_changed' })
      // New friends hear where this person is now (each side's snapshot covers the other way).
      this.announce([...conns][0].user)
    }

    // Blocks between people sharing a home: hide new pairs from each other, show unblocked ones.
    const before = new Map<Home, Set<string>>()
    for (const home of this.homes.values()) before.set(home, this.hiddenPairs(home))
    const inHomes = new Set<string>()
    for (const home of this.homes.values()) for (const m of home.members.values()) inHomes.add(m.user.id)
    for (const userId of inHomes) {
      try {
        const blocked = await this.access.blockedIds(userId)
        if (this.byUser.has(userId)) this.blockedOf.set(userId, blocked)
      } catch (err) {
        this.log(`[realtime] revalidate blocks failed: ${(err as Error).message}`)
      }
    }
    for (const home of [...this.homes.values()]) {
      const was = before.get(home) ?? new Set<string>()
      const hiddenNow = this.hiddenPairs(home)
      for (const [x, y] of pairs(home)) {
        const key = pairKey(x, y)
        if (hiddenNow.has(key) && !was.has(key)) {
          this.send(x, { type: 'player_left', sid: y.sid, userId: y.user.id, reason: 'left' })
          this.send(y, { type: 'player_left', sid: x.sid, userId: x.user.id, reason: 'left' })
        } else if (!hiddenNow.has(key) && was.has(key)) {
          this.send(x, { type: 'player_joined', player: this.remote(y) })
          this.send(y, { type: 'player_joined', player: this.remote(x) })
        }
      }
    }

    // Guests' right to be in each home.
    for (const home of [...this.homes.values()]) {
      for (const m of [...home.members.values()]) {
        if (m.user.id === home.ownerId) continue
        let access: VisitAccess
        try {
          access = await this.access.visitAccess(m.user.id, home.ownerId)
        } catch {
          continue
        }
        if (access !== 'friend' && m.home === home) {
          m.joinSeq++
          this.leaveHome(m, 'removed')
        }
      }
    }
  }

  /** True when a block stands between these two people (they must not see each other). */
  private hidden(a: Connection, b: Connection): boolean {
    if (a.user.id === b.user.id) return false
    return Boolean(this.blockedOf.get(a.user.id)?.has(b.user.id) || this.blockedOf.get(b.user.id)?.has(a.user.id))
  }

  /** Keys of the member pairs of `home` that are hidden from each other. */
  private hiddenPairs(home: Home): Set<string> {
    const out = new Set<string>()
    for (const [x, y] of pairs(home)) if (this.hidden(x, y)) out.add(pairKey(x, y))
    return out
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0
  }

  /** Where `userId` is, as `viewerId` should hear it. */
  whereFor(userId: string, viewerId: string): PresenceWhere {
    const conns = this.byUser.get(userId)
    if (!conns?.size) return 'offline'
    let where: PresenceWhere = 'lobby'
    for (const c of conns) {
      if (!c.home) continue
      if (c.home.ownerId === viewerId) return 'your_home'
      if (c.home.ownerId === userId) where = 'own_home'
      else if (where === 'lobby') where = 'elsewhere'
    }
    return where
  }

  /** Distinct people in `ownerId`'s home right now. */
  peopleInHome(ownerId: string): PublicUser[] {
    const home = this.homes.get(ownerId)
    if (!home) return []
    const seen = new Map<string, PublicUser>()
    for (const m of home.members.values()) seen.set(m.user.id, m.user)
    return [...seen.values()]
  }

  /** Counts for tests and the status line. */
  stats(): { connections: number; users: number; homes: number; kicks: number } {
    let kicks = 0
    for (const k of this.kicks.values()) kicks += k.size
    return { connections: this.connections.size, users: this.byUser.size, homes: this.homes.size, kicks }
  }

  /** Tell each online friend of `userId` where they are now. */
  private announce(user: PublicUser): void {
    const userId = user.id
    const friends = this.friendsOf.get(userId)
    if (!friends?.size) return
    for (const friendId of friends) {
      const conns = this.byUser.get(friendId)
      if (!conns?.size) continue
      // Only if the friendship is mutual in the friend's (possibly older) list too.
      if (!this.friendsOf.get(friendId)?.has(userId)) continue
      const where = this.whereFor(userId, friendId)
      for (const c of conns) this.send(c, { type: 'presence', user, online: where !== 'offline', where })
    }
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /** Close a socket with a code, removing it from the hub first. */
  private close(conn: Connection, code: number, reason: string, leave: LeaveReason): void {
    this.drop(conn, leave)
    try {
      conn.peer.close(code, reason)
    } catch {
      /* already closed */
    }
  }

  /** Remove a connection from everything. Idempotent. */
  private drop(conn: Connection, reason: LeaveReason): void {
    if (conn.closed) return
    conn.joinSeq++
    if (conn.home) this.leaveHome(conn, reason)
    conn.closed = true
    this.connections.delete(conn.sid)
    const mine = this.byUser.get(conn.user.id)
    mine?.delete(conn)
    if (mine && !mine.size) {
      this.byUser.delete(conn.user.id)
      this.announce(conn.user)
      this.friendsOf.delete(conn.user.id)
      this.blockedOf.delete(conn.user.id)
    }
  }

  /** Send to everyone in `home` but `except`, and to nobody a block hides `from` from. */
  private broadcast(home: Home, msg: ServerMessage, except?: Connection, from?: Connection): void {
    const data = JSON.stringify(msg)
    for (const m of home.members.values()) {
      if (m === except || (from && this.hidden(from, m))) continue
      this.sendRaw(m, data, false)
    }
  }

  private send(conn: Connection, msg: ServerMessage, droppable = false): void {
    this.sendRaw(conn, JSON.stringify(msg), droppable)
  }

  private sendRaw(conn: Connection, data: string, droppable: boolean): void {
    if (conn.closed) return
    let queued = 0
    try {
      queued = conn.peer.bufferedAmount()
    } catch {
      queued = 0
    }
    if (queued > HARD_BUFFER_BYTES) {
      this.drop(conn, 'disconnected')
      try {
        conn.peer.terminate()
      } catch {
        /* gone */
      }
      return
    }
    if (droppable && queued > SOFT_BUFFER_BYTES) return
    try {
      conn.peer.send(data)
    } catch {
      /* the close event will clean up */
    }
  }

  private error(conn: Connection, code: RealtimeErrorCode, message: string, about?: string, retryAfterMs?: number): void {
    this.send(conn, { type: 'error', code, message, ...(about ? { about } : {}), ...(retryAfterMs ? { retryAfterMs: Math.ceil(retryAfterMs) } : {}) })
  }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** Every unordered pair of members of a home. */
function pairs(home: Home): [Connection, Connection][] {
  const list = [...home.members.values()]
  const out: [Connection, Connection][] = []
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]])
  return out
}

function pairKey(a: Connection, b: Connection): string {
  return a.sid < b.sid ? `${a.sid}|${b.sid}` : `${b.sid}|${a.sid}`
}
