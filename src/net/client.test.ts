import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_CODES, REALTIME_LIMITS, type PlayerState, type ServerMessage } from '@/contracts/realtime'
import { backoffDelay, BACKOFF_MS, JOIN_RETRY_MS, NEVER_OPENED_WAIT_MS, RealtimeClient, realtimeUrl, WindowLimiter, type SocketLike } from './client'

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  closedWith: number | null = null
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code = 1000) {
    this.closedWith = code
    this.readyState = 3
  }
  // server side
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  serverSays(m: ServerMessage | Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  types() {
    return this.sent.map((m) => m.type)
  }
}

const me = { id: 'u1', handle: 'robin', displayName: 'Robin', image: null }
const hello = (sid = 's1'): ServerMessage => ({ type: 'hello', sid, you: me, serverTime: Date.now() + 5000, limits: {} })
const joined = (handle = 'robin'): ServerMessage => ({ type: 'joined', home: { handle, owner: me }, sid: 's1', isOwner: true, players: [], serverTime: Date.now() + 5000 })
const pose = (x: number): PlayerState => ({ p: [x, 0, 0], yaw: 0, pitch: 0, cam: 'first', anim: 'walk', v: 1 })

function make(snapshot?: () => { state?: PlayerState }) {
  return new RealtimeClient({ url: 'ws://test/api/realtime', createSocket: (u) => new FakeSocket(u), random: () => 0.5, snapshot })
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1]

beforeEach(() => {
  FakeSocket.all = []
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('helpers', () => {
  it('builds ws/wss URLs from the page', () => {
    expect(realtimeUrl({ protocol: 'https:', host: 'x.app' })).toBe('wss://x.app/api/realtime')
    expect(realtimeUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe('ws://localhost:3000/api/realtime')
  })

  it('backs off exponentially with jitter, and slowly when it never connects', () => {
    expect(backoffDelay(0, 0, () => 0.5)).toBe(BACKOFF_MS[0])
    expect(backoffDelay(3, 0, () => 0)).toBe(Math.round(BACKOFF_MS[3] * 0.8))
    expect(backoffDelay(99, 0, () => 1)).toBe(Math.round(BACKOFF_MS[BACKOFF_MS.length - 1] * 1.2))
    expect(backoffDelay(0, 3, () => 0.5)).toBe(NEVER_OPENED_WAIT_MS)
  })

  it('limits bursts in a sliding window', () => {
    const l = new WindowLimiter(2, 1000)
    expect(l.take(0)).toBe(0)
    expect(l.take(10)).toBe(0)
    expect(l.take(20)).toBe(980)
    expect(l.take(1001)).toBe(0)
  })
})

describe('RealtimeClient', () => {
  it('connects, joins the wanted home with the current pose after hello, and syncs the clock', () => {
    const c = make(() => ({ state: pose(1) }))
    const statuses: string[] = []
    c.onStatus((s) => statuses.push(s))
    c.join('robin')
    c.start()
    const s = last()
    expect(s.url).toBe('ws://test/api/realtime')
    s.open()
    expect(s.sent).toEqual([])
    s.serverSays(hello())
    expect(c.status).toBe('open')
    expect(statuses).toEqual(['connecting', 'open'])
    expect(s.types()).toEqual(['ping', 'join'])
    expect(s.sent[1]).toMatchObject({ type: 'join', home: 'robin', state: { p: [1, 0, 0] } })
    // Pong 40 ms later: offset = serverTime + 20 - receivedAt.
    vi.advanceTimersByTime(40)
    s.serverSays({ type: 'pong', n: s.sent[0].n as number, serverTime: Date.now() + 7000 })
    expect(c.clock.synced).toBe(true)
    expect(c.clock.offset).toBe(7020)
  })

  it('ignores messages that do not match the protocol', () => {
    const c = make()
    const got: string[] = []
    c.onMessage((m) => got.push(m.type))
    c.start()
    last().open()
    last().onmessage?.({ data: 'not json' })
    last().serverSays({ type: 'states', at: 'soon', players: [] } as Record<string, unknown>)
    last().serverSays({ type: 'nope' })
    last().serverSays(hello())
    expect(got).toEqual(['hello'])
  })

  it('throttles poses to the server rate and always sends the newest', () => {
    const c = make()
    c.join('robin')
    c.start()
    const s = last()
    s.open()
    s.serverSays(hello())
    // Not in a home yet: held back.
    c.sendState(pose(0))
    expect(s.types()).not.toContain('state')
    s.serverSays(joined())
    expect(s.sent.filter((m) => m.type === 'state')).toHaveLength(1)
    c.sendState(pose(1))
    c.sendState(pose(2))
    c.sendState(pose(3))
    expect(s.sent.filter((m) => m.type === 'state')).toHaveLength(1)
    vi.advanceTimersByTime(1000 / REALTIME_LIMITS.STATE_HZ)
    const states = s.sent.filter((m) => m.type === 'state')
    expect(states).toHaveLength(2)
    expect(states[1]).toMatchObject({ s: { p: [3, 0, 0] } })
  })

  it('keeps chat and emotes under the limits and refuses when not in a home', () => {
    const c = make()
    c.join('robin')
    c.start()
    expect(c.sendChat('hi')).toEqual({ ok: false, reason: 'offline' })
    last().open()
    last().serverSays(hello())
    last().serverSays(joined())
    expect(c.sendChat('   ')).toEqual({ ok: false, reason: 'empty' })
    for (let i = 0; i < REALTIME_LIMITS.CHAT_BURST; i++) expect(c.sendChat(`hi ${i}`).ok).toBe(true)
    const r = c.sendChat('one more')
    expect(r.ok).toBe(false)
    expect(r.ok ? 0 : r.retryAfterMs).toBeGreaterThan(0)
    for (let i = 0; i < REALTIME_LIMITS.EMOTE_BURST; i++) expect(c.sendEmote('wave').ok).toBe(true)
    expect(c.sendEmote('dance')).toMatchObject({ ok: false, reason: 'rate_limited' })
  })

  it('reconnects with backoff and joins the same home again', () => {
    const c = make()
    c.join('mia')
    c.start()
    last().open()
    last().serverSays(hello())
    last().serverSays(joined('mia'))
    last().drop()
    expect(c.status).toBe('reconnecting')
    expect(c.currentHome).toBeNull()
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(BACKOFF_MS[0])
    expect(FakeSocket.all).toHaveLength(2)
    last().open()
    last().serverSays(hello('s2'))
    expect(last().sent.find((m) => m.type === 'join')).toMatchObject({ home: 'mia' })
  })

  it('reconnects at once when asked (network back, tab shown)', () => {
    const c = make()
    c.start()
    last().drop()
    expect(FakeSocket.all).toHaveLength(1)
    c.reconnectNow()
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('slows down when the socket never opens (signed out, server down)', () => {
    const c = make()
    c.start()
    for (let i = 0; i < 3; i++) {
      last().drop()
      vi.advanceTimersByTime(BACKOFF_MS[i] * 1.2)
    }
    const before = FakeSocket.all.length
    last().drop()
    vi.advanceTimersByTime(BACKOFF_MS[3] * 1.2)
    expect(FakeSocket.all.length).toBe(before)
    vi.advanceTimersByTime(NEVER_OPENED_WAIT_MS)
    expect(FakeSocket.all.length).toBe(before + 1)
  })

  it('stops when another tab takes over, and on stop()', () => {
    const c = make()
    c.start()
    last().open()
    last().serverSays(hello())
    last().drop(CLOSE_CODES.REPLACED)
    expect(c.status).toBe('replaced')
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(1)

    const d = make()
    d.start()
    const s = last()
    s.open()
    d.stop()
    expect(s.closedWith).toBe(CLOSE_CODES.NORMAL)
    expect(d.status).toBe('idle')
    vi.advanceTimersByTime(120_000)
    expect(last()).toBe(s)
  })

  it('does not walk back into a home it was refused or removed from', () => {
    const c = make()
    c.join('mia')
    c.start()
    last().open()
    last().serverSays(hello())
    last().serverSays({ type: 'error', code: 'not_friends', message: 'Only friends', about: 'join' })
    expect(c.wantedHome).toBeNull()

    c.join('mia')
    last().serverSays(joined('mia'))
    last().serverSays({ type: 'left', home: 'mia', reason: 'kicked' })
    expect(c.wantedHome).toBeNull()
    expect(c.currentHome).toBeNull()
  })

  it('retries a rate-limited join after the wait the server gave', () => {
    const c = make()
    c.join('mia')
    c.start()
    last().open()
    last().serverSays(hello())
    const joins = () => last().sent.filter((m) => m.type === 'join').length
    expect(joins()).toBe(1)
    last().serverSays({ type: 'error', code: 'rate_limited', message: 'Too many joins', about: 'join', retryAfterMs: 2000 })
    vi.advanceTimersByTime(1999)
    expect(joins()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(joins()).toBe(2)
  })

  it('keeps asking, a little slower each time, when the server could not answer a join', () => {
    const c = make()
    c.join('mia')
    c.start()
    last().open()
    last().serverSays(hello())
    const joins = () => last().sent.filter((m) => m.type === 'join').length
    const fail = () => last().serverSays({ type: 'error', code: 'unavailable', message: 'Something went wrong', about: 'join' })
    fail()
    expect(c.wantedHome).toBe('mia')
    vi.advanceTimersByTime(JOIN_RETRY_MS[0] - 1)
    expect(joins()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(joins()).toBe(2)
    fail()
    vi.advanceTimersByTime(JOIN_RETRY_MS[0])
    expect(joins()).toBe(2)
    vi.advanceTimersByTime(JOIN_RETRY_MS[1] - JOIN_RETRY_MS[0])
    expect(joins()).toBe(3)
    last().serverSays(joined('mia'))
    expect(c.currentHome).toBe('mia')
    // A refusal that won't change still ends it.
    last().serverSays({ type: 'error', code: 'home_full', message: 'Full', about: 'join' })
    expect(c.wantedHome).toBeNull()
  })

  it('pauses instead of reconnecting when closed for being idle, and comes back when asked', () => {
    const c = make()
    c.join('robin')
    c.start()
    last().open()
    last().serverSays(hello())
    last().drop(CLOSE_CODES.IDLE)
    expect(c.status).toBe('paused')
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(1)
    c.reconnectNow()
    expect(FakeSocket.all).toHaveLength(2)
    last().open()
    last().serverSays(hello('s2'))
    expect(c.status).toBe('open')
    expect(last().sent.some((m) => m.type === 'join' && m.home === 'robin')).toBe(true)
  })

  it('pings regularly while open', () => {
    const c = make()
    c.start()
    last().open()
    last().serverSays(hello())
    const pings = () => last().sent.filter((m) => m.type === 'ping').length
    expect(pings()).toBe(1)
    vi.advanceTimersByTime(2500)
    expect(pings()).toBe(2)
    vi.advanceTimersByTime(20_000)
    expect(pings()).toBe(3)
  })
})
