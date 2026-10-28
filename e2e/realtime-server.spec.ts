/**
 * Phase 3, workstream C (server half): two signed-in people in two browser contexts become friends,
 * open the realtime websocket with their real session cookies, meet in one home and chat. The 3D
 * client (remote players, name tags, the visit UI) has its own spec once it lands; this one proves
 * the server end through a real browser: cookie auth, same-origin check, friends-only joins.
 *
 *   E2E_PORT=3203 npx playwright test e2e/realtime-server.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const stamp = Date.now().toString(36).slice(-5)
const A = { email: `rt-host-${stamp}@example.com`, name: 'Robin Host', handle: `rthost${stamp}` }
const B = { email: `rt-guest-${stamp}@example.com`, name: 'Sam Guest', handle: `rtguest${stamp}` }
const C = { email: `rt-stranger-${stamp}@example.com`, name: 'Kim Stranger', handle: `rtstr${stamp}` }

async function signIn(ctx: BrowserContext, p: typeof A): Promise<string> {
  const res = await ctx.request.post('/api/test/login', { data: { email: p.email, name: p.name, handle: p.handle } })
  expect(res.status(), 'test login is enabled (NODE_ENV=test)').toBe(200)
  return (await res.json()).user.id as string
}

type Msg = { type: string; [k: string]: unknown }
declare global {
  interface Window {
    __rt?: { ws: WebSocket; messages: Msg[]; opened: boolean; closed: number | null }
  }
}

/** Open the realtime socket from the page, like the app will. */
async function connect(page: Page) {
  await page.evaluate(() => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/realtime`)
    const state = { ws, messages: [] as Msg[], opened: false, closed: null as number | null }
    ws.onopen = () => (state.opened = true)
    ws.onmessage = (ev) => state.messages.push(JSON.parse(String(ev.data)))
    ws.onclose = (ev) => (state.closed = ev.code)
    window.__rt = state
  })
}

const send = (page: Page, msg: Msg) => page.evaluate((m) => window.__rt!.ws.send(JSON.stringify(m)), msg)

async function waitFor(page: Page, type: string, match: Record<string, unknown> = {}): Promise<Msg> {
  const handle = await page.waitForFunction(
    ({ type, match }) =>
      window.__rt?.messages.find((m) => m.type === type && Object.entries(match).every(([k, v]) => JSON.stringify(m[k]) === JSON.stringify(v))) ?? null,
    { type, match },
    { timeout: 15_000 },
  )
  return (await handle.jsonValue()) as Msg
}

test('two friends meet in one home over the realtime socket', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'Protocol check; the desktop project is enough.')
  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  const strangerCtx = await browser.newContext()
  const anonCtx = await browser.newContext()
  try {
    const hostId = await signIn(hostCtx, A)
    const guestId = await signIn(guestCtx, B)
    await signIn(strangerCtx, C)
    expect((await hostCtx.request.post('/api/friends/requests', { data: { handle: B.handle } })).ok()).toBe(true)
    expect((await guestCtx.request.post(`/api/friends/${hostId}/accept`)).ok()).toBe(true)

    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()
    const stranger = await strangerCtx.newPage()
    const anon = await anonCtx.newPage()
    for (const p of [host, guest, stranger, anon]) await p.goto('/about')

    // Signed out: no socket.
    await connect(anon)
    await anon.waitForFunction(() => window.__rt!.closed !== null, null, { timeout: 15_000 })
    expect(await anon.evaluate(() => window.__rt!.opened)).toBe(false)

    await connect(host)
    await waitFor(host, 'hello')
    await send(host, { type: 'join', home: A.handle, state: { p: [0, 0, 3.5], yaw: 0, pitch: 0, cam: 'first', anim: 'idle' } })
    expect((await waitFor(host, 'joined')).isOwner).toBe(true)

    await connect(guest)
    await waitFor(guest, 'hello')
    // The host hears the guest come online.
    await waitFor(host, 'presence', { online: true })
    await send(guest, { type: 'join', home: A.handle })
    const joined = await waitFor(guest, 'joined')
    expect((joined.players as { user: { handle: string } }[]).map((p) => p.user.handle)).toEqual([A.handle])
    await waitFor(host, 'player_joined')

    await send(guest, { type: 'state', s: { p: [1, 0, 2], yaw: 1, pitch: 0, cam: 'third', anim: 'walk', v: 1.4 } })
    const states = await waitFor(host, 'states')
    expect((states.players as { s: { p: number[] } }[])[0].s.p).toEqual([1, 0, 2])

    await send(guest, { type: 'chat', text: 'Love the board!' })
    expect((await waitFor(host, 'chat')).text).toBe('Love the board!')
    await send(host, { type: 'emote', emote: 'wave' })
    expect((await waitFor(guest, 'emote')).emote).toBe('wave')

    // HTTP side: presence and the read-only home.
    const presence = await (await hostCtx.request.get('/api/presence')).json()
    expect(presence.friends).toEqual([expect.objectContaining({ online: true, where: 'your_home', user: expect.objectContaining({ id: guestId }) })])
    expect(presence.here.map((u: { handle: string }) => u.handle)).toEqual([B.handle])
    const homeRes = await guestCtx.request.get(`/api/homes/${A.handle}`)
    expect(homeRes.status()).toBe(200)
    expect(await homeRes.json()).toMatchObject({ isOwner: false, readOnly: true, presence: { ownerOnline: true } })

    // A stranger can open a socket but not join, and cannot read the home.
    await connect(stranger)
    await waitFor(stranger, 'hello')
    await send(stranger, { type: 'join', home: A.handle })
    expect((await waitFor(stranger, 'error')).code).toBe('not_friends')
    expect((await strangerCtx.request.get(`/api/homes/${A.handle}`)).status()).toBe(403)

    // The guest leaves: the host is told.
    await guest.evaluate(() => window.__rt!.ws.close())
    expect((await waitFor(host, 'player_left')).reason).toBe('disconnected')
  } finally {
    for (const c of [hostCtx, guestCtx, strangerCtx, anonCtx]) await c.close()
  }
})
