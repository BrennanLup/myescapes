// @vitest-environment node
/**
 * The websocket endpoint end to end: real server, PGlite fixtures (alice, bob and mia are friends
 * of alice; carol is a stranger; alice blocked eve; newbie is not onboarded), sockets through
 * Node's WebSocket on a real port.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { ServerMessageSchema, type ServerMessage } from '../../src/contracts/realtime'
import { friendships } from '../db/schema'
import { pair } from '../db/fixtures'
import { buildTestApp, TEST_USER_HEADER, type TestApp } from '../testing'
import { hubFor, originAllowed } from './index'

class Client {
  messages: ServerMessage[] = []
  closedWith: number | null = null
  private waiters: { test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  readonly opened: Promise<boolean>
  constructor(readonly ws: WebSocket) {
    this.opened = new Promise((resolve) => {
      ws.onopen = () => resolve(true)
      ws.onerror = () => resolve(false)
    })
    ws.onmessage = (ev) => {
      const msg = ServerMessageSchema.parse(JSON.parse(String(ev.data)))
      this.messages.push(msg)
      this.waiters = this.waiters.filter((w) => (w.test(msg) ? (w.resolve(msg), false) : true))
    }
    ws.onclose = (ev) => {
      this.closedWith = ev.code
    }
  }
  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  close() {
    this.ws.close()
  }
  /** The first message of a type (and matching `where`) received at or after index `after`. */
  next<T extends ServerMessage['type']>(type: T, where: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, after = 0): Promise<Extract<ServerMessage, { type: T }>> {
    const test = (m: ServerMessage) => m.type === type && where(m as Extract<ServerMessage, { type: T }>)
    const seen = this.messages.slice(after).find(test)
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { type: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}; got ${this.messages.map((m) => m.type).join(',')}`)), 3000)
      this.waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Extract<ServerMessage, { type: T }>)
        },
      })
    })
  }
  async closed(): Promise<number> {
    for (let i = 0; i < 100 && this.closedWith === null; i++) await new Promise((r) => setTimeout(r, 20))
    return this.closedWith ?? -1
  }
}

let t: TestApp
let base = ''
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
  const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
  base = address.replace(/^http/, 'ws')
})
afterAll(async () => {
  await t?.close()
})

/** Node's WebSocket (undici) accepts extra headers, like a browser's cookie. */
function socket(as?: string, headers: Record<string, string> = {}): Client {
  const init = { headers: { ...(as ? { [TEST_USER_HEADER]: as } : {}), ...headers } }
  return new Client(new WebSocket(`${base}/api/realtime`, init as unknown as string[]))
}

async function open(as?: string, headers: Record<string, string> = {}): Promise<Client> {
  const c = socket(as, headers)
  await c.next('hello')
  return c
}

/** Wait until the hub has seen a user go offline (the server side of a close is asynchronous). */
async function offline(userId: string) {
  for (let i = 0; i < 100 && hubFor(t.ctx).isOnline(userId); i++) await new Promise((r) => setTimeout(r, 20))
  expect(hubFor(t.ctx).isOnline(userId)).toBe(false)
}

describe('GET /api/realtime: who gets a socket', () => {
  // The same preValidation guards the upgrade and a plain GET, so plain requests show the status.
  it('refuses signed-out visitors (401) and users without a handle (403)', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/realtime' })).statusCode).toBe(401)
    const newbie = await t.inject({ method: 'GET', url: '/api/realtime', as: t.fx.users.newbie })
    expect(newbie.statusCode).toBe(403)
    expect(newbie.json().code).toBe('onboarding_required')
    // And over a real upgrade, no socket opens.
    expect(await socket().opened).toBe(false)
    expect(await socket(t.fx.users.newbie).opened).toBe(false)
  })

  it('refuses a browser on another site', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/realtime', as: t.fx.users.alice, headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(403)
    expect(await socket(t.fx.users.alice, { origin: 'https://evil.example' }).opened).toBe(false)
    const ok = await open(t.fx.users.alice, { origin: base.replace(/^ws/, 'http') })
    ok.close()
    await offline(t.fx.users.alice)
  })

  it('answers a plain GET with 426', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/realtime', as: t.fx.users.alice })
    expect(res.statusCode).toBe(426)
    expect(res.json().code).toBe('invalid')
  })

  it('says hello with my public face (never my email)', async () => {
    const c = await open(t.fx.users.alice)
    const hello = await c.next('hello')
    expect(hello.you).toEqual({ id: t.fx.users.alice, handle: 'alice', displayName: 'Alice', image: null })
    expect(JSON.stringify(c.messages)).not.toContain('@example.com')
    c.close()
    await offline(t.fx.users.alice)
  })
})

describe('homes over the socket', () => {
  it('two friends see each other move, chat and emote', async () => {
    const alice = await open(t.fx.users.alice)
    alice.send({ type: 'join', home: 'alice', state: { p: [0, 0, 3.5], yaw: 0, pitch: 0, cam: 'first', anim: 'idle' } })
    const joinedA = await alice.next('joined')
    expect(joinedA.isOwner).toBe(true)

    const bob = await open(t.fx.users.bob)
    bob.send({ type: 'join', home: 'alice' })
    const joinedB = await bob.next('joined')
    expect(joinedB.players.map((p) => p.user.handle)).toEqual(['alice'])
    expect((await alice.next('player_joined')).player.user.handle).toBe('bob')

    bob.send({ type: 'state', s: { p: [1, 0, 2], yaw: 1, pitch: 0.1, cam: 'third', anim: 'walk', v: 1.5 } })
    const states = await alice.next('states', (m) => m.players.some((p) => p.sid === joinedB.sid))
    expect(states.players[0].s.p).toEqual([1, 0, 2])

    bob.send({ type: 'chat', text: 'Nice board!' })
    expect((await alice.next('chat')).text).toBe('Nice board!')
    expect((await bob.next('chat')).user.handle).toBe('bob')

    alice.send({ type: 'emote', emote: 'wave' })
    expect((await bob.next('emote')).emote).toBe('wave')

    bob.close()
    const left = await alice.next('player_left')
    expect(left).toMatchObject({ sid: joinedB.sid, reason: 'disconnected' })
    alice.close()
    await offline(t.fx.users.alice)
  })

  it('keeps strangers and blocked users out; pending requests are not friends', async () => {
    const carol = await open(t.fx.users.carol)
    carol.send({ type: 'join', home: 'alice' })
    expect(await carol.next('error')).toMatchObject({ code: 'not_friends' })
    const eve = await open(t.fx.users.eve)
    eve.send({ type: 'join', home: 'alice' })
    expect(await eve.next('error')).toMatchObject({ code: 'not_found' })
    const dave = await open(t.fx.users.dave)
    dave.send({ type: 'join', home: 'alice' })
    expect(await dave.next('error')).toMatchObject({ code: 'not_friends' })
    for (const c of [carol, eve, dave]) c.close()
  })

  it('validates messages and keeps the socket open', async () => {
    const mia = await open(t.fx.users.mia)
    mia.send('{nope')
    expect(await mia.next('error')).toMatchObject({ code: 'invalid' })
    mia.send({ type: 'state', s: { p: ['a', 0, 0] } })
    expect(await mia.next('error', (e) => e.about === 'state')).toMatchObject({ code: 'invalid' })
    expect(mia.closedWith).toBeNull()
    mia.close()
    await offline(t.fx.users.mia)
  })

  it('closes a socket that sends a message over the size limit', async () => {
    const mia = await open(t.fx.users.mia)
    mia.send({ type: 'chat', text: 'x'.repeat(5000) })
    expect(await mia.closed()).toBe(1009)
    await offline(t.fx.users.mia)
  })

  it('removes a guest after an unfriend at the next revalidation, and presence follows', async () => {
    const alice = await open(t.fx.users.alice)
    alice.send({ type: 'join', home: 'alice' })
    await alice.next('joined')
    const mia = await open(t.fx.users.mia)
    // Alice hears Mia come online.
    expect(await alice.next('presence', (p) => p.user.handle === 'mia' && p.online)).toBeTruthy()
    mia.send({ type: 'join', home: 'alice' })
    await mia.next('joined')

    const p = pair(t.fx.users.alice, t.fx.users.mia)
    const row = (await t.db.select().from(friendships).where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB))))[0]
    await t.db.delete(friendships).where(eq(friendships.id, row.id))
    try {
      await hubFor(t.ctx).revalidate()
      expect(await mia.next('left')).toMatchObject({ home: 'alice', reason: 'removed' })
      expect(await alice.next('player_left')).toMatchObject({ reason: 'removed' })
    } finally {
      await t.db.insert(friendships).values(row)
    }
    mia.close()
    alice.close()
    await offline(t.fx.users.mia)
    await offline(t.fx.users.alice)
  })
})

describe('originAllowed', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never
  it('accepts no origin, the same host, and the public URL; rejects others', () => {
    expect(originAllowed(req({ host: 'a.example' }), {})).toBe(true)
    expect(originAllowed(req({ host: 'a.example', origin: 'https://a.example' }), {})).toBe(true)
    expect(originAllowed(req({ host: 'internal:8080', origin: 'https://my.example' }), { PUBLIC_URL: 'https://my.example' })).toBe(true)
    expect(originAllowed(req({ host: 'internal:8080', 'x-forwarded-host': 'my.example', origin: 'https://my.example' }), {})).toBe(true)
    expect(originAllowed(req({ host: 'a.example', origin: 'https://b.example' }), {})).toBe(false)
    expect(originAllowed(req({ host: 'a.example', origin: 'null' }), {})).toBe(false)
  })
  it('allows the Vite dev server on localhost, never in production', () => {
    expect(originAllowed(req({ host: 'localhost:3000', origin: 'http://localhost:5173' }), { NODE_ENV: 'development' })).toBe(true)
    expect(originAllowed(req({ host: 'localhost:3000', origin: 'http://localhost:5173' }), { NODE_ENV: 'production' })).toBe(false)
    expect(originAllowed(req({ host: 'my.example', origin: 'http://localhost:5173' }), { NODE_ENV: 'development' })).toBe(false)
  })
})
