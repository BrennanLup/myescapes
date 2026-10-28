/**
 * Phase 3, workstream C (client): two signed-in friends in two browsers. The guest opens the
 * host's room at /home/:handle (read-only), each sees the other's character and @handle tag,
 * they chat and wave, the people panel lists who is here and who is online, the guest walks back
 * to their own room and the host visits them there. Settings shows the online dot.
 *
 * Desktop project: two laptops. Mobile project: the guest is on a phone (round buttons, sheets).
 *
 *   E2E_PORT=3205 npx playwright test e2e/multiplayer.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW } from './helpers'
import { newDevice, person, signIn, waitRoom, watchErrors } from './support/morning'

/** Wait until the socket is in `handle`'s home. */
async function waitJoined(page: Page, handle: string) {
  await page.waitForFunction((h) => window.__ESCAPE_NET__?.store.getState().home?.handle === h, handle, { timeout: SLOW })
}

/** Wait until `handle` is in the room with this page and their pose has arrived. */
async function waitSees(page: Page, handle: string) {
  await page.waitForFunction(
    (h) => {
      const net = window.__ESCAPE_NET__
      if (!net) return false
      const p = Object.values(net.store.getState().players).find((x) => x.user.handle === h)
      return !!p && !!net.poses.get(p.sid)?.latest()
    },
    handle,
    { timeout: SLOW },
  )
}

/** Where this page draws `handle` right now (their interpolated feet). */
async function seenAt(page: Page, handle: string): Promise<number[] | null> {
  return page.evaluate((h) => {
    const net = window.__ESCAPE_NET__!
    const p = Object.values(net.store.getState().players).find((x) => x.user.handle === h)
    const latest = p ? net.poses.get(p.sid)?.latest() : null
    return latest ? [...latest.s.p] : null
  }, handle)
}

async function stand(page: Page, at: [number, number, number], yaw: number) {
  await page.evaluate(({ at, yaw }) => window.__ESCAPE__!.requestTeleport(at, yaw, 0), { at, yaw })
}

test('friends meet in a room, chat, wave and visit each other', async ({ browser }, info) => {
  // Two software-rendered 3D rooms at once, and five room loads in all.
  test.setTimeout(600_000)
  const phone = info.project.name === 'mobile'
  const baseURL = String(info.project.use.baseURL)
  const run = String(Date.now()).slice(-7)
  const A = person(phone ? 'mphost' : 'mhost', 'Robin Host', run)
  const B = person(phone ? 'mpguest' : 'mguest', 'Sam Guest', run)
  const hostCtx = await newDevice(browser, baseURL, 'laptop')
  const guestCtx = await newDevice(browser, baseURL, phone ? 'phone' : 'laptop')
  // Low quality keeps two SwiftShader rooms responsive.
  for (const ctx of [hostCtx, guestCtx]) await ctx.addInitScript(() => localStorage.setItem('myescapes.settings.v1', JSON.stringify({ quality: 'low' })))
  const errors: string[] = []
  try {
    const hostUser = await signIn(hostCtx, A, { onboarded: true })
    await signIn(guestCtx, B, { onboarded: true })
    expect((await hostCtx.request.post('/api/friends/requests', { data: { handle: B.handle } })).ok()).toBe(true)
    expect((await guestCtx.request.post(`/api/friends/${hostUser.id}/accept`)).ok()).toBe(true)

    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()
    watchErrors(host, errors)
    watchErrors(guest, errors)

    // The host is in their own room.
    await host.goto('/?autostart=1&gate=off')
    await waitRoom(host)
    await waitJoined(host, A.handle)
    await stand(host, [0, 1.6, 3], 0)

    // The guest opens the host's room: read-only, with the visiting banner.
    await guest.goto(`/home/${A.handle}?autostart=1&gate=off`)
    await waitRoom(guest)
    // Phones show the first name so the banner fits.
    await expect(guest.getByTestId('visit-banner')).toContainText(phone ? "Robin's room" : "Robin Host's room")
    await expect(guest.getByTestId('record-button')).toHaveCount(0)
    await expect(guest.getByTestId('wishlist-button')).toHaveCount(0)
    expect(await guest.evaluate(() => window.__ESCAPE__!.store.getState().visiting?.handle)).toBe(A.handle)
    await waitJoined(guest, A.handle)
    // Stand in front of the host, facing them.
    await stand(guest, [0, 1.6, 0], Math.PI)

    // Each sees the other: pose, character and @handle tag.
    await waitSees(host, B.handle)
    await waitSees(guest, A.handle)
    await expect(host.locator(`[data-testid="remote-player-tag"][data-handle="${B.handle}"]`)).toHaveCount(1, { timeout: SLOW })
    await expect(guest.locator(`[data-testid="remote-player-tag"][data-handle="${A.handle}"]`)).toHaveCount(1, { timeout: SLOW })
    await expect.poll(async () => (await seenAt(host, B.handle))?.[2], { timeout: SLOW }).toBeCloseTo(0, 1)

    // The guest walks: the host sees them move.
    await stand(guest, [1.5, 1.6, 0.5], Math.PI)
    await expect.poll(async () => (await seenAt(host, B.handle))?.[0], { timeout: SLOW }).toBeCloseTo(1.5, 1)

    // Chat: the guest says hi (T on a laptop, the chat button on a phone); the host reads it.
    if (phone) await guest.getByTestId('chat-button').tap()
    else await guest.keyboard.press('t')
    await guest.getByTestId('chat-input').fill('Love the board!')
    await guest.getByTestId('chat-input').press('Enter')
    await expect(host.getByTestId('chat-log')).toContainText('Love the board!', { timeout: SLOW })
    await expect(host.getByTestId('chat-bubble')).toContainText('Love the board!')
    await expect(host.getByTestId('chat-unread')).toHaveText('1')
    if (phone) await guest.getByLabel('Close chat').tap()
    else await guest.keyboard.press('Escape')

    // An emote.
    if (phone) {
      await guest.getByTestId('emote-button').tap()
      await guest.getByTestId('emote-wave').tap()
    } else {
      await guest.getByTestId('emote-wave').click()
    }
    await host.waitForFunction(
      (h) => {
        const st = window.__ESCAPE_NET__!.store.getState()
        const p = Object.values(st.players).find((x) => x.user.handle === h)
        return !!p && st.emotes[p.sid]?.emote === 'wave'
      },
      B.handle,
      { timeout: SLOW },
    )
    await host.screenshot({ path: info.outputPath('host-sees-guest.png') })
    await guest.screenshot({ path: info.outputPath('guest-in-host-room.png') })

    // The host's people panel: who is here, and the guest is online in "your room".
    await host.keyboard.press('f')
    await expect(host.getByTestId('people-panel')).toBeVisible()
    await expect(host.locator(`[data-testid="person-row"][data-handle="${B.handle}"]`)).toBeVisible()
    await expect(host.locator(`[data-testid="visit-friend"][data-handle="${B.handle}"]`)).toHaveAttribute('data-online', 'true', { timeout: SLOW })
    const guestRow = host.locator(`[data-testid="visit-friend"][data-handle="${B.handle}"]`)
    await expect(guestRow).toContainText('Here with you')
    // No Visit button for someone already in your room (it would take you to their empty one).
    await expect(guestRow.getByTestId('visit-friend-button')).toHaveCount(0)
    await host.screenshot({ path: info.outputPath('host-people-panel.png') })
    await host.keyboard.press('Escape')

    // Back to my room: the guest leaves, the host sees it.
    await guest.getByTestId('visit-back-home').click()
    if (phone) {
      // Phones go home to the phone app, as everywhere else.
      await guest.waitForURL(/\/m/, { timeout: SLOW })
    } else {
      await guest.waitForURL((u) => u.pathname === '/', { timeout: SLOW })
      await waitRoom(guest)
      expect(await guest.evaluate(() => window.__ESCAPE__!.store.getState().visiting)).toBeNull()
      await waitJoined(guest, B.handle)
    }
    await host.waitForFunction(() => Object.keys(window.__ESCAPE_NET__!.store.getState().players).length === 0, null, { timeout: SLOW })

    if (!phone) {
      // The host visits the guest from the people panel; the guest gets them in their room.
      await host.getByTestId('people-button').click()
      await host.locator(`[data-testid="visit-friend"][data-handle="${B.handle}"]`).getByTestId('visit-friend-button').click()
      await host.waitForURL((u) => u.pathname === `/home/${B.handle}`, { timeout: SLOW })
      await waitRoom(host)
      await waitJoined(host, B.handle)
      await stand(host, [0, 1.6, 2], 0)
      await waitSees(guest, A.handle)
    }

    // Settings: the friends list shows who is online, with a way into their room.
    await host.goto('/settings')
    const row = host.locator(`[data-testid="friend-row"]`).filter({ hasText: B.handle })
    await expect(row.getByTestId('presence-dot')).toHaveAttribute('data-online', phone ? 'false' : 'true', { timeout: SLOW })
    await expect(row.getByTestId('friend-visit')).toHaveAttribute('href', `/home/${B.handle}`)

    expect(errors).toEqual([])
  } finally {
    await hostCtx.close()
    await guestCtx.close()
  }
})

test('a stranger gets a friendly page, not the room', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'One project is enough for an error page.')
  const baseURL = String(info.project.use.baseURL)
  const run = String(Date.now()).slice(-7)
  const A = person('mown', 'Robin Owner', run)
  const C = person('mstr', 'Kim Stranger', run)
  const ownerCtx = await newDevice(browser, baseURL, 'laptop')
  const strangerCtx = await newDevice(browser, baseURL, 'laptop')
  try {
    await signIn(ownerCtx, A, { onboarded: true })
    await signIn(strangerCtx, C, { onboarded: true })
    const page = await strangerCtx.newPage()
    await page.goto(`/home/${A.handle}`)
    await expect(page.getByTestId('visit-error')).toHaveAttribute('data-problem', 'forbidden')
    await expect(page.getByRole('heading')).toContainText(`Only @${A.handle}'s friends can come in`)
    await page.goto('/home/nobody_here_at_all')
    await expect(page.getByTestId('visit-error')).toHaveAttribute('data-problem', 'not_found')
  } finally {
    await ownerCtx.close()
    await strangerCtx.close()
  }
})
