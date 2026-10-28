// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PublicUser } from '../../src/contracts/models'
import { CLOSE_CODES, REALTIME_LIMITS, ServerMessageSchema, sanitizeChat, type PlayerState, type ServerMessage } from '../../src/contracts/realtime'
import type { HomeOwner, VisitAccess } from './access'
import { RealtimeHub, type Connection, type HubAccess, type HubLimits, type Peer } from './hub'

// ---------------------------------------------------------------------------
// Fakes: a little social graph, a clock and peers that record what they get.
// ---------------------------------------------------------------------------

const person = (id: string): PublicUser => ({ id, handle: id, displayName: id[0].toUpperCase() + id.slice(1), image: null })
const U = { alice: person('alice'), bob: person('bob'), mia: person('mia'), carol: person('carol'), eve: person('eve') }

class Graph implements HubAccess {
  friends = new Set(['alice|bob', 'alice|mia', 'bob|mia'])
  blocked = new Set(['alice|eve'])
  calls = 0
  private key = (a: string, b: string) => [a, b].sort().join('|')
  /** Users who changed their @handle (id -> their user now). */
  renamed = new Map<string, PublicUser>()
  private current(id: string): PublicUser | undefined {
    return this.renamed.get(id) ?? (U as Record<string, PublicUser>)[id]
  }
  async homeOwner(handle: string): Promise<HomeOwner | null> {
    this.calls++
    const h = handle.replace(/^@/, '').toLowerCase()
    const u = Object.keys(U).map((id) => this.current(id)!).find((x) => x.handle?.toLowerCase() === h)
    return u ? { id: u.id, handle: u.handle!, user: u } : null
  }
  async homeOwnerById(id: string): Promise<HomeOwner | null> {
    const u = this.current(id)
    return u ? { id: u.id, handle: u.handle!, user: u } : null
  }
  rename(id: string, handle: string, displayName?: string) {
    const u = this.current(id)!
    this.renamed.set(id, { ...u, handle, displayName: displayName ?? u.displayName })
  }
  async visitAccess(viewer: string, owner: string): Promise<VisitAccess> {
    if (viewer === owner) return 'owner'
    if (this.blocked.has(this.key(viewer, owner))) return 'not_found'
    return this.friends.has(this.key(viewer, owner)) ? 'friend' : 'not_friends'
  }
  async friendIds(user: string): Promise<Set<string>> {
    return new Set([...this.friends].filter((k) => k.split('|').includes(user)).map((k) => k.split('|').find((x) => x !== user)!))
  }
  failBlocks = false
  async blockedIds(user: string): Promise<Set<string>> {
    if (this.failBlocks) throw new Error('db down')
    return new Set([...this.blocked].filter((k) => k.split('|').includes(user)).map((k) => k.split('|').find((x) => x !== user)!))
  }
  unfriend(a: string, b: string) {
    this.friends.delete(this.key(a, b))
  }
  befriend(a: string, b: string) {
    this.friends.add(this.key(a, b))
  }
  block(a: string, b: string) {
    this.blocked.add(this.key(a, b))
  }
  unblock(a: string, b: string) {
    this.blocked.delete(this.key(a, b))
  }
}

class FakePeer implements Peer {
  sent: ServerMessage[] = []
  closed: { code: number; reason: string } | null = null
  terminated = false
  pings = 0
  buffered = 0
  send(data: string) {
    // Every message the hub sends must match the shared contract.
    this.sent.push(ServerMessageSchema.parse(JSON.parse(data)))
  }
  close(code: number, reason: string) {
    this.closed = { code, reason }
  }
  terminate() {
    this.terminated = true
  }
  ping() {
    this.pings++
  }
  bufferedAmount() {
    return this.buffered
  }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1)
  }
  clear() {
    this.sent = []
  }
}

function setup(limits: Partial<HubLimits> = {}) {
  const graph = new Graph()
  let t = 1_000_000
  const hub = new RealtimeHub({ access: graph, now: () => t, limits })
  const advance = (ms: number) => {
    t += ms
  }
  const connect = async (user: PublicUser) => {
    const peer = new FakePeer()
    const conn = hub.connect(user, peer)
    await conn.ready
    return { peer, conn }
  }
  const send = (conn: Connection, msg: unknown) => hub.message(conn, typeof msg === 'string' ? msg : JSON.stringify(msg))
  return { hub, graph, advance, connect, send, now: () => t }
}

const pose = (x: number, z = 0): PlayerState => ({ p: [x, 0, z], yaw: 0.5, pitch: 0, cam: 'third', anim: 'walk', v: 1.4 })

// ---------------------------------------------------------------------------

describe('realtime hub: connecting and joining', () => {
  it('says hello with the session id and limits', async () => {
    const { connect } = setup()
    const { peer, conn } = await connect(U.alice)
    const hello = peer.last('hello')!
    expect(hello.sid).toBe(conn.sid)
    expect(hello.you).toEqual(U.alice)
    expect(hello.limits.maxPlayersPerHome).toBe(REALTIME_LIMITS.MAX_PLAYERS_PER_HOME)
  })

  it('lets the owner and accepted friends in, and tells everyone', async () => {
    const { connect, send } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice', state: pose(1) })
    const joinedA = a.peer.last('joined')!
    expect(joinedA.isOwner).toBe(true)
    expect(joinedA.home.handle).toBe('alice')
    expect(joinedA.players).toEqual([])

    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: '@Alice', outfit: { hat: 'beanie', top: '#ff0000' } })
    const joinedB = b.peer.last('joined')!
    expect(joinedB.isOwner).toBe(false)
    expect(joinedB.players.map((p) => p.user.id)).toEqual(['alice'])
    expect(joinedB.players[0].state).toEqual(pose(1))
    expect(joinedB.players[0].isOwner).toBe(true)
    const pj = a.peer.last('player_joined')!
    expect(pj.player.user.id).toBe('bob')
    expect(pj.player.outfit).toEqual({ hat: 'beanie', top: '#ff0000' })
  })

  it('refuses strangers, blocked people and unknown handles', async () => {
    const { connect, send } = setup()
    const c = await connect(U.carol)
    await send(c.conn, { type: 'join', home: 'alice' })
    expect(c.peer.last('error')).toMatchObject({ code: 'not_friends', about: 'join' })
    expect(c.peer.of('joined')).toHaveLength(0)

    const e = await connect(U.eve)
    await send(e.conn, { type: 'join', home: 'alice' })
    // A block looks exactly like a home that does not exist.
    expect(e.peer.last('error')).toMatchObject({ code: 'not_found' })

    await send(e.conn, { type: 'join', home: 'nobody-here' })
    expect(e.peer.last('error')).toMatchObject({ code: 'not_found' })
  })

  it('caps players per home, but the owner always gets in', async () => {
    const { connect, send, graph } = setup({ MAX_PLAYERS_PER_HOME: 2 })
    graph.friends.add('alice|carol')
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    const m = await connect(U.mia)
    await send(m.conn, { type: 'join', home: 'alice' })
    const c = await connect(U.carol)
    await send(c.conn, { type: 'join', home: 'alice' })
    expect(c.peer.last('error')).toMatchObject({ code: 'home_full' })
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    expect(a.peer.last('joined')!.players).toHaveLength(2)
  })

  it('joining another home leaves the first; a second tab of the same user replaces the first in a home', async () => {
    const { connect, send, hub } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    await send(b.conn, { type: 'join', home: 'mia' })
    expect(b.peer.last('left')).toEqual({ type: 'left', home: 'alice', reason: 'left' })
    expect(a.peer.last('player_left')).toMatchObject({ sid: b.conn.sid, reason: 'left' })
    expect(hub.peopleInHome('mia').map((u) => u.id)).toEqual(['bob'])

    const b2 = await connect(U.bob)
    await send(b2.conn, { type: 'join', home: 'mia' })
    expect(b.peer.last('left')).toMatchObject({ home: 'mia', reason: 'replaced' })
    expect(hub.peopleInHome('mia').map((u) => u.id)).toEqual(['bob'])
  })

  it('re-sends joined when joining the home you are already in', async () => {
    const { connect, send } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    await send(a.conn, { type: 'join', home: 'alice' })
    expect(a.peer.of('joined')).toHaveLength(2)
    expect(a.peer.of('left')).toHaveLength(0)
  })

  it('leave and disconnect remove the player; an empty home disappears', async () => {
    const { connect, send, hub } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    await send(b.conn, { type: 'leave' })
    expect(b.peer.last('left')).toMatchObject({ reason: 'left' })
    expect(a.peer.last('player_left')).toMatchObject({ userId: 'bob', reason: 'left' })
    await send(b.conn, { type: 'leave' })
    expect(b.peer.last('error')).toMatchObject({ code: 'not_joined' })
    hub.disconnect(a.conn)
    expect(hub.stats()).toEqual({ connections: 1, users: 1, homes: 0, kicks: 0 })
  })

  it('closes the oldest socket past the per-user cap', async () => {
    const { connect } = setup({ MAX_SOCKETS_PER_USER: 2 })
    const one = await connect(U.alice)
    await connect(U.alice)
    expect(one.peer.closed).toBeNull()
    await connect(U.alice)
    expect(one.peer.closed?.code).toBe(CLOSE_CODES.REPLACED)
  })

  it('ignores a slow join that was overtaken by a leave', async () => {
    const { connect, send, graph, hub } = setup()
    const slow = graph.homeOwner.bind(graph)
    let release!: () => void
    graph.homeOwner = (h) => new Promise((res) => (release = () => res(slow(h))))
    const b = await connect(U.bob)
    const pending = send(b.conn, { type: 'join', home: 'alice' })
    hub.disconnect(b.conn)
    release()
    await pending
    expect(b.peer.of('joined')).toHaveLength(0)
    expect(hub.stats().homes).toBe(0)
  })
})

describe('realtime hub: state, chat, emotes', () => {
  async function room() {
    const s = setup()
    const a = await s.connect(U.alice)
    await s.send(a.conn, { type: 'join', home: 'alice' })
    const b = await s.connect(U.bob)
    await s.send(b.conn, { type: 'join', home: 'alice' })
    a.peer.clear()
    b.peer.clear()
    return { ...s, a, b }
  }

  it('coalesces poses and broadcasts the latest one per tick to the others only', async () => {
    const { a, b, send, hub, advance, now } = await room()
    await send(b.conn, { type: 'state', s: pose(1) })
    advance(50)
    await send(b.conn, { type: 'state', s: pose(2) })
    hub.flushStates()
    const states = a.peer.of('states')
    expect(states).toHaveLength(1)
    expect(states[0].players).toEqual([{ sid: b.conn.sid, s: pose(2) }])
    expect(states[0].at).toBe(now())
    expect(b.peer.of('states')).toHaveLength(0)
    // Nothing changed: no message.
    hub.flushStates()
    expect(a.peer.of('states')).toHaveLength(1)
  })

  it('drops poses sent faster than the state rate', async () => {
    const { a, b, send, hub, advance } = await room()
    for (let i = 0; i < 60; i++) {
      await send(b.conn, { type: 'state', s: pose(i) })
      advance(33) // 30 Hz for 2 s (under the flood ceiling)
      if (i % 3 === 2) hub.flushStates()
    }
    hub.flushStates()
    expect(b.peer.closed).toBeNull()
    const accepted = 60 - b.conn.droppedStates
    // 2 s at 1.25 x STATE_HZ plus a burst of 1.5 x STATE_HZ.
    expect(accepted).toBeLessThanOrEqual(Math.ceil(2 * REALTIME_LIMITS.STATE_HZ * 1.25 + REALTIME_LIMITS.STATE_HZ * 1.5) + 1)
    expect(b.conn.droppedStates).toBeGreaterThan(15)
    expect(a.peer.of('states').length).toBeGreaterThan(0)
  })

  it('rejects malformed messages without closing the socket', async () => {
    const { b, send } = await room()
    await send(b.conn, 'not json')
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid' })
    await send(b.conn, { type: 'state', s: { p: [0, 0], yaw: 0, pitch: 0, cam: 'first', anim: 'idle' } })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid', about: 'state' })
    await send(b.conn, { type: 'state', s: { ...pose(1), p: [1e9, 0, 0] } })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid' })
    await send(b.conn, { type: 'emote', emote: 'moonwalk' })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid' })
    await send(b.conn, { type: 'teleport' })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid' })
    await send(b.conn, { type: 'join', home: 'alice', outfit: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 1])) })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid' })
    expect(b.peer.closed).toBeNull()
  })

  it('relays chat to everyone in the home (sender included), cleaned and length-limited', async () => {
    const { a, b, send } = await room()
    await send(b.conn, { type: 'chat', text: '  hi\u0000 there‮   alice  ' + 'x'.repeat(400) })
    const got = a.peer.last('chat')!
    expect(got.text.startsWith('hi there alice x')).toBe(true)
    expect(Array.from(got.text).length).toBe(REALTIME_LIMITS.CHAT_MAX_LENGTH)
    expect(got.user.id).toBe('bob')
    expect(b.peer.last('chat')!.id).toBe(got.id)
    await send(b.conn, { type: 'chat', text: ' ​ ' })
    expect(b.peer.last('error')).toMatchObject({ code: 'invalid', about: 'chat' })
  })

  it('rate-limits chat with a retry hint, then lets it through again', async () => {
    const { a, b, send, advance } = await room()
    for (let i = 0; i < REALTIME_LIMITS.CHAT_BURST; i++) await send(b.conn, { type: 'chat', text: `m${i}` })
    await send(b.conn, { type: 'chat', text: 'one too many' })
    const err = b.peer.last('error')!
    expect(err).toMatchObject({ code: 'rate_limited', about: 'chat' })
    expect(err.retryAfterMs).toBeGreaterThan(0)
    expect(a.peer.of('chat')).toHaveLength(REALTIME_LIMITS.CHAT_BURST)
    advance(REALTIME_LIMITS.CHAT_WINDOW_MS)
    await send(b.conn, { type: 'chat', text: 'later' })
    expect(a.peer.last('chat')!.text).toBe('later')
  })

  it('relays emotes to the others and rate-limits them', async () => {
    const { a, b, send } = await room()
    await send(b.conn, { type: 'emote', emote: 'wave' })
    expect(a.peer.last('emote')).toMatchObject({ sid: b.conn.sid, emote: 'wave' })
    expect(b.peer.of('emote')).toHaveLength(0)
    for (let i = 0; i < REALTIME_LIMITS.EMOTE_BURST; i++) await send(b.conn, { type: 'emote', emote: 'dance' })
    expect(b.peer.last('error')).toMatchObject({ code: 'rate_limited', about: 'emote' })
  })

  it('needs a home for chat and emotes', async () => {
    const { connect, send } = setup()
    const m = await connect(U.mia)
    await send(m.conn, { type: 'chat', text: 'hello?' })
    expect(m.peer.last('error')).toMatchObject({ code: 'not_joined' })
    await send(m.conn, { type: 'emote', emote: 'cheer' })
    expect(m.peer.last('error')).toMatchObject({ code: 'not_joined' })
  })

  it('relays outfit changes', async () => {
    const { a, b, send } = await room()
    await send(b.conn, { type: 'outfit', outfit: { hair: 'bob', hairColor: '#222222' } })
    expect(a.peer.last('outfit')).toEqual({ type: 'outfit', sid: b.conn.sid, outfit: { hair: 'bob', hairColor: '#222222' } })
  })

  it('with saved looks, shows only the saved look and treats outfit messages as "reload mine"', async () => {
    const graph = new Graph()
    const saved = new Map<string, Record<string, string>>([['alice', { hat: 'none' }], ['bob', { hat: 'hat-beanie' }]])
    let failing = false
    const access: HubAccess = {
      homeOwner: (h) => graph.homeOwner(h),
      visitAccess: (v, o) => graph.visitAccess(v, o),
      friendIds: (u) => graph.friendIds(u),
      blockedIds: (u) => graph.blockedIds(u),
      outfitFor: async (id) => {
        if (failing) throw new Error('db down')
        return saved.get(id) ?? null
      },
    }
    const t = 1_000_000
    const hub = new RealtimeHub({ access, now: () => t, log: () => {} })
    const open = async (u: PublicUser) => {
      const peer = new FakePeer()
      const conn = hub.connect(u, peer)
      await conn.ready
      return { peer, conn }
    }
    const send = (conn: Connection, msg: unknown) => hub.message(conn, JSON.stringify(msg))
    const a = await open(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await open(U.bob)
    // A modified client claims a priced hat it never bought.
    await send(b.conn, { type: 'join', home: 'alice', outfit: { hat: 'hat-crown' } })
    expect(a.peer.last('player_joined')!.player.outfit).toEqual({ hat: 'hat-beanie' })
    expect(b.peer.last('joined')!.players[0].outfit).toEqual({ hat: 'none' })

    await send(b.conn, { type: 'outfit', outfit: { hat: 'hat-crown' } })
    expect(a.peer.last('outfit')).toEqual({ type: 'outfit', sid: b.conn.sid, outfit: { hat: 'hat-beanie' } })
    // After a real save the reload shows the new look.
    saved.set('bob', { hat: 'hat-cap' })
    await send(b.conn, { type: 'outfit', outfit: { hat: 'hat-crown' } })
    expect(a.peer.last('outfit')!.outfit).toEqual({ hat: 'hat-cap' })
    // A failed reload keeps the current look and says nothing.
    failing = true
    a.peer.clear()
    await send(b.conn, { type: 'outfit', outfit: { hat: 'hat-crown' } })
    expect(a.peer.of('outfit')).toEqual([])
    expect(b.peer.last('error')).toBeUndefined()
  })

  it('answers ping with pong and the server time', async () => {
    const { b, send, now } = await room()
    await send(b.conn, { type: 'ping', n: 7 })
    expect(b.peer.last('pong')).toEqual({ type: 'pong', n: 7, serverTime: now() })
  })

  it('closes a socket that floods', async () => {
    const { b, send, hub } = await room()
    for (let i = 0; i <= REALTIME_LIMITS.FLOOD_MESSAGES_PER_SECOND; i++) await send(b.conn, { type: 'ping' })
    expect(b.peer.closed?.code).toBe(CLOSE_CODES.FLOOD)
    expect(hub.peopleInHome('alice').map((u) => u.id)).toEqual(['alice'])
  })

  it('never reports a flood close as the owner asking someone to leave', async () => {
    const { a, b, send } = await room()
    for (let i = 0; i <= REALTIME_LIMITS.FLOOD_MESSAGES_PER_SECOND; i++) await send(b.conn, { type: 'ping' })
    expect(b.peer.last('left')).toMatchObject({ reason: 'disconnected' })
    expect(a.peer.last('player_left')).toMatchObject({ userId: 'bob', reason: 'disconnected' })
    expect([...b.peer.of('left'), ...a.peer.of('player_left')].some((m) => m.reason === 'kicked')).toBe(false)
  })

  it('follows an owner who changes @handle mid-visit: guests reconnecting by the old one still get in', async () => {
    const { a, b, send, connect, graph, hub } = await room()
    graph.rename('alice', 'alicia', 'Alicia')
    // Bob's connection drops and comes back, still knowing only the old address.
    hub.disconnect(b.conn)
    const b2 = await connect(U.bob)
    await send(b2.conn, { type: 'join', home: 'alice' })
    expect(b2.peer.last('error')).toBeUndefined()
    expect(b2.peer.last('joined')).toMatchObject({ home: { handle: 'alicia', owner: { displayName: 'Alicia' } } })
    expect(hub.peopleInHome('alice').map((u) => u.id).sort()).toEqual(['alice', 'bob'])
    // The new address works too, and the owner's own resync hears the new handle.
    a.peer.clear()
    await send(a.conn, { type: 'join', home: 'alicia' })
    expect(a.peer.last('joined')).toMatchObject({ home: { handle: 'alicia' } })
    // After that refresh, another reconnect with the old address still finds the room.
    hub.disconnect(b2.conn)
    const b3 = await connect(U.bob)
    await send(b3.conn, { type: 'join', home: 'alice' })
    expect(b3.peer.last('error')).toBeUndefined()
    expect(b3.peer.last('joined')).toMatchObject({ home: { handle: 'alicia' } })
  })

  it('does not resolve a stale @handle once nobody is in that home', async () => {
    const { a, b, send, connect, graph, hub } = await room()
    graph.rename('alice', 'alicia')
    hub.disconnect(a.conn)
    hub.disconnect(b.conn)
    const b2 = await connect(U.bob)
    await send(b2.conn, { type: 'join', home: 'alice' })
    expect(b2.peer.last('error')).toMatchObject({ code: 'not_found' })
  })

  it('lets the owner ask a guest to leave, and nobody else', async () => {
    const { a, b, send, hub } = await room()
    await send(b.conn, { type: 'kick', sid: a.conn.sid })
    expect(b.peer.last('error')).toMatchObject({ code: 'forbidden' })
    await send(a.conn, { type: 'kick', sid: b.conn.sid })
    expect(b.peer.last('left')).toMatchObject({ reason: 'kicked' })
    expect(hub.peopleInHome('alice').map((u) => u.id)).toEqual(['alice'])
    expect(b.peer.closed).toBeNull()
  })

  it('keeps a guest the owner asked to leave out for a while', async () => {
    const { a, b, send, hub, advance, connect } = await room()
    await send(a.conn, { type: 'kick', sid: b.conn.sid })
    await send(b.conn, { type: 'join', home: 'alice' })
    const err = b.peer.last('error')!
    expect(err).toMatchObject({ code: 'forbidden', about: 'join' })
    expect(err.message).toMatch(/asked you to leave/)
    // A new tab does not get round it either.
    const b2 = await connect(U.bob)
    await send(b2.conn, { type: 'join', home: 'alice' })
    expect(b2.peer.last('error')).toMatchObject({ code: 'forbidden' })
    expect(hub.peopleInHome('alice').map((u) => u.id)).toEqual(['alice'])
    // After the cool-down they are welcome again.
    advance(REALTIME_LIMITS.KICK_COOLDOWN_MS + 1)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('joined')).toBeTruthy()
  })

  it('remembers kicks after the home empties (the owner left or visited someone else)', async () => {
    const { a, b, send, hub, advance, connect } = await room()
    await send(a.conn, { type: 'kick', sid: b.conn.sid })
    hub.disconnect(a.conn)
    expect(hub.stats().homes).toBe(0)
    advance(20_000)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('error')).toMatchObject({ code: 'forbidden', about: 'join' })
    expect(hub.stats().homes).toBe(0)
    // The owner is back: still not yet.
    const a2 = await connect(U.alice)
    await send(a2.conn, { type: 'join', home: 'alice' })
    advance(60_000)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('error')).toMatchObject({ code: 'forbidden' })
    expect(hub.peopleInHome('alice').map((u) => u.id)).toEqual(['alice'])
    // Other guests are not affected, and the owner can still get in.
    const m = await connect(U.mia)
    await send(m.conn, { type: 'join', home: 'alice' })
    expect(m.peer.last('joined')).toBeTruthy()
    advance(REALTIME_LIMITS.KICK_COOLDOWN_MS)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('joined')).toBeTruthy()
  })

  it('prunes expired kicks on the heartbeat', async () => {
    const { a, b, send, hub, advance } = await room()
    await send(a.conn, { type: 'kick', sid: b.conn.sid })
    hub.disconnect(a.conn)
    hub.heartbeat()
    expect(hub.stats().kicks).toBe(1)
    advance(REALTIME_LIMITS.KICK_COOLDOWN_MS + 1)
    hub.heartbeat()
    expect(hub.stats().kicks).toBe(0)
  })

})

describe('realtime hub: presence, idle and revalidation', () => {
  it('two friends connecting at the same time both see each other online', async () => {
    const { hub } = setup()
    const pa = new FakePeer()
    const pb = new FakePeer()
    // Neither friend list has loaded when the second socket arrives.
    const a = hub.connect(U.alice, pa)
    const b = hub.connect(U.bob, pb)
    await Promise.all([a.ready, b.ready])
    expect(pa.of('presence').some((m) => (m as { user: PublicUser }).user.id === 'bob')).toBe(true)
    expect(pb.of('presence').some((m) => (m as { user: PublicUser }).user.id === 'alice')).toBe(true)
  })

  it('a refused join leaves the pose used in the current home alone', async () => {
    const { connect, send } = setup({ MAX_PLAYERS_PER_HOME: 2 })
    const a = await connect(U.alice)
    const m = await connect(U.mia)
    const b = await connect(U.bob)
    await send(a.conn, { type: 'join', home: 'alice' })
    await send(m.conn, { type: 'join', home: 'alice' })
    await send(b.conn, { type: 'join', home: 'bob', state: pose(1) })
    await send(b.conn, { type: 'join', home: 'alice', state: pose(9) })
    expect(b.peer.last('error')).toMatchObject({ code: 'home_full' })
    expect(b.conn.state).toEqual(pose(1))
  })

  it('tells online friends (only) when someone comes online, moves and leaves', async () => {
    const { connect, send, hub } = setup()
    const a = await connect(U.alice)
    const c = await connect(U.carol)
    const b = await connect(U.bob)
    expect(a.peer.last('presence')).toEqual({ type: 'presence', user: U.bob, online: true, where: 'lobby' })
    expect(c.peer.of('presence')).toHaveLength(0)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(a.peer.last('presence')).toMatchObject({ where: 'your_home' })
    // Alice is not in her home, so she also gets the "visitor" line.
    expect(a.peer.last('visitor')).toEqual({ type: 'visitor', user: U.bob, joined: true })
    expect(hub.whereFor('bob', 'mia')).toBe('elsewhere')
    await send(b.conn, { type: 'join', home: 'bob' })
    expect(a.peer.last('presence')).toMatchObject({ where: 'own_home' })
    expect(a.peer.last('visitor')).toEqual({ type: 'visitor', user: U.bob, joined: false })
    hub.disconnect(b.conn)
    expect(a.peer.last('presence')).toEqual({ type: 'presence', user: U.bob, online: false, where: 'offline' })
    expect(hub.isOnline('bob')).toBe(false)
    expect(c.peer.of('presence')).toHaveLength(0)
  })

  it('does not send the visitor line to the owner while they are in the home', async () => {
    const { connect, send } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(a.peer.of('visitor')).toHaveLength(0)
    expect(a.peer.of('player_joined')).toHaveLength(1)
  })

  it('pings peers, terminates the ones that never answer, and closes idle ones', async () => {
    const { connect, hub, advance, send } = setup({ HEARTBEAT_MS: 1000, IDLE_TIMEOUT_MS: 8000, REVALIDATE_MS: 1e9 })
    const a = await connect(U.alice)
    const b = await connect(U.bob)
    advance(1000)
    hub.tick()
    expect(a.peer.pings).toBe(1)
    hub.pong(a.conn)
    advance(1000)
    hub.tick()
    expect(b.peer.terminated).toBe(true)
    expect(hub.isOnline('bob')).toBe(false)
    expect(a.peer.terminated).toBe(false)
    // Alice answers pings but sends nothing: idle after IDLE_TIMEOUT_MS.
    for (let i = 0; i < 3; i++) {
      hub.pong(a.conn)
      advance(1000)
      hub.tick()
    }
    expect(a.peer.closed).toBeNull()
    // Real activity (joining, moving, chat) resets the idle clock ...
    await send(a.conn, { type: 'join', home: 'alice' })
    for (let i = 0; i < 7; i++) {
      // ... but the client's clock-sync pings don't: an AFK tab still counts as idle.
      await send(a.conn, { type: 'ping' })
      hub.pong(a.conn)
      advance(1000)
      hub.tick()
    }
    expect(a.peer.closed).toBeNull()
    hub.pong(a.conn)
    advance(1000)
    hub.tick()
    expect(a.peer.closed?.code).toBe(CLOSE_CODES.IDLE)
    expect(hub.stats().homes).toBe(0)
  })

  it('removes a guest within one revalidation after an unfriend', async () => {
    const { connect, send, hub, graph } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    graph.unfriend('alice', 'bob')
    await hub.revalidate()
    expect(b.peer.last('left')).toMatchObject({ home: 'alice', reason: 'removed' })
    expect(a.peer.last('player_left')).toMatchObject({ userId: 'bob', reason: 'removed' })
    // And they no longer hear each other's presence.
    a.peer.clear()
    hub.disconnect(b.conn)
    expect(a.peer.of('presence')).toHaveLength(0)
  })

  it('skips pose updates to a backed-up peer and terminates a hopeless one', async () => {
    const { connect, send, hub } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    a.peer.buffered = 2_000_000
    await send(b.conn, { type: 'state', s: pose(3) })
    hub.flushStates()
    expect(a.peer.of('states')).toHaveLength(0)
    await send(b.conn, { type: 'chat', text: 'still get chat' })
    expect(a.peer.last('chat')).toBeTruthy()
    a.peer.buffered = 9_000_000
    await send(b.conn, { type: 'chat', text: 'too much' })
    expect(a.peer.terminated).toBe(true)
    expect(hub.isOnline('alice')).toBe(false)
  })

  it('shuts down cleanly', async () => {
    const { connect, send, hub } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    hub.shutdown()
    expect(a.peer.closed?.code).toBe(CLOSE_CODES.SERVER_SHUTDOWN)
    expect(a.peer.last('left')).toMatchObject({ reason: 'shutdown' })
    expect(hub.stats()).toEqual({ connections: 0, users: 0, homes: 0, kicks: 0 })
    const late = new FakePeer()
    hub.connect(U.bob, late)
    expect(late.closed?.code).toBe(CLOSE_CODES.SERVER_SHUTDOWN)
  })

  it('keeps friend lists only for people still connected, and tells both sides when friendships change', async () => {
    const { connect, hub, graph } = setup()
    const a = await connect(U.alice)
    const c = await connect(U.carol)
    // Bob disconnects while his friend list is being reloaded.
    const b = await connect(U.bob)
    const slow = graph.friendIds.bind(graph)
    graph.friendIds = async (user) => {
      if (user === 'bob') hub.disconnect(b.conn)
      return slow(user)
    }
    a.peer.clear()
    c.peer.clear()
    graph.befriend('alice', 'carol')
    await hub.revalidate()
    expect((hub as unknown as { friendsOf: Map<string, Set<string>> }).friendsOf.has('bob')).toBe(false)
    expect(a.peer.of('friends_changed')).toHaveLength(1)
    expect(c.peer.of('friends_changed')).toHaveLength(1)
    // The new friends hear each other online without waiting for the presence poll.
    expect(a.peer.of('presence').some((m) => m.user.id === 'carol' && m.online)).toBe(true)
    expect(c.peer.of('presence').some((m) => m.user.id === 'alice' && m.online)).toBe(true)
  })

  it('one failed friend list does not skip the rest of the revalidation', async () => {
    const { connect, send, hub, graph } = setup()
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'alice' })
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    const real = graph.friendIds.bind(graph)
    graph.friendIds = async (user) => {
      if (user === 'alice') throw new Error('db hiccup')
      return real(user)
    }
    graph.unfriend('alice', 'bob')
    await hub.revalidate()
    expect(b.peer.last('left')).toMatchObject({ reason: 'removed' })
  })

  it('reports an unavailable database as an error message, not a crash', async () => {
    const { connect, send, graph } = setup()
    graph.homeOwner = async () => {
      throw new Error('db down')
    }
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('error')).toMatchObject({ code: 'unavailable', about: 'join' })
  })
})

describe('realtime hub: blocks between guests', () => {
  /** Mia hosts; Alice and Eve are both her friends, and Alice has blocked Eve. */
  async function shared() {
    const s = setup()
    s.graph.befriend('mia', 'eve')
    const m = await s.connect(U.mia)
    await s.send(m.conn, { type: 'join', home: 'mia' })
    const a = await s.connect(U.alice)
    await s.send(a.conn, { type: 'join', home: 'mia', state: pose(1) })
    const e = await s.connect(U.eve)
    await s.send(e.conn, { type: 'join', home: 'mia', state: pose(2) })
    return { ...s, m, a, e }
  }

  it('lets both in, but neither sees the other', async () => {
    const { m, a, e } = await shared()
    expect(e.peer.last('joined')!.players.map((p) => p.user.id)).toEqual(['mia'])
    expect(a.peer.of('player_joined').map((x) => x.player.user.id)).not.toContain('eve')
    // The host sees both.
    expect(m.peer.of('player_joined').map((x) => x.player.user.id)).toEqual(['alice', 'eve'])
  })

  it('hides poses, chat, emotes and looks both ways', async () => {
    const { hub, send, m, a, e } = await shared()
    for (const p of [m, a, e]) p.peer.clear()
    await send(e.conn, { type: 'state', s: pose(5) })
    await send(a.conn, { type: 'state', s: pose(6) })
    hub.flushStates()
    expect(a.peer.of('states').flatMap((x) => x.players.map((p) => p.sid))).not.toContain(e.conn.sid)
    expect(e.peer.of('states').flatMap((x) => x.players.map((p) => p.sid))).not.toContain(a.conn.sid)
    expect(m.peer.last('states')!.players.map((p) => p.sid).sort()).toEqual([a.conn.sid, e.conn.sid].sort())
    await send(e.conn, { type: 'chat', text: 'hello all' })
    await send(e.conn, { type: 'emote', emote: 'wave' })
    await send(e.conn, { type: 'outfit', outfit: { hat: 'cap' } })
    await send(a.conn, { type: 'chat', text: 'hi mia' })
    expect(a.peer.of('chat').map((c) => c.text)).toEqual(['hi mia'])
    expect(e.peer.of('chat').map((c) => c.text)).toEqual(['hello all'])
    expect(a.peer.of('emote')).toHaveLength(0)
    expect(a.peer.of('outfit')).toHaveLength(0)
    expect(m.peer.of('chat')).toHaveLength(2)
    hub.disconnect(e.conn)
    expect(a.peer.of('player_left')).toHaveLength(0)
    expect(m.peer.last('player_left')).toMatchObject({ userId: 'eve' })
  })

  it('a block made while both are in the room takes effect at the next revalidation, and so does an unblock', async () => {
    const { hub, graph, send, connect } = setup()
    graph.befriend('mia', 'carol')
    const m = await connect(U.mia)
    await send(m.conn, { type: 'join', home: 'mia' })
    const a = await connect(U.alice)
    await send(a.conn, { type: 'join', home: 'mia' })
    const c = await connect(U.carol)
    await send(c.conn, { type: 'join', home: 'mia' })
    expect(a.peer.last('player_joined')!.player.user.id).toBe('carol')
    graph.block('alice', 'carol')
    await hub.revalidate()
    expect(a.peer.last('player_left')).toMatchObject({ sid: c.conn.sid })
    expect(c.peer.last('player_left')).toMatchObject({ sid: a.conn.sid })
    m.peer.clear()
    a.peer.clear()
    await send(c.conn, { type: 'chat', text: 'still here' })
    expect(a.peer.of('chat')).toHaveLength(0)
    expect(m.peer.of('chat')).toHaveLength(1)
    graph.unblock('alice', 'carol')
    await hub.revalidate()
    expect(a.peer.last('player_joined')!.player.sid).toBe(c.conn.sid)
    expect(c.peer.last('player_joined')!.player.sid).toBe(a.conn.sid)
  })

  it('a failing block lookup refuses the join as unavailable', async () => {
    const { connect, send, graph } = setup()
    graph.failBlocks = true
    const b = await connect(U.bob)
    await send(b.conn, { type: 'join', home: 'alice' })
    expect(b.peer.last('error')).toMatchObject({ code: 'unavailable', about: 'join' })
  })
})

describe('sanitizeChat', () => {
  it('normalises, strips control and invisible characters, and trims', () => {
    expect(sanitizeChat('  a\tb\n\nc  ')).toBe('a b c')
    expect(sanitizeChat('​‎⁦x⁩')).toBe('x')
    expect(sanitizeChat('café')).toBe('café')
    expect(sanitizeChat('')).toBe('')
    expect(Array.from(sanitizeChat('😀'.repeat(300)))).toHaveLength(REALTIME_LIMITS.CHAT_MAX_LENGTH)
  })
})
