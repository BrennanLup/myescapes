/**
 * Phase 3, workstream C (QA round 4): stepping from your room into the puzzle room (the door's
 * "Play in 3D", an in-app move to /daily/room) takes you out of your home on the realtime socket,
 * so a friend visiting there stops seeing you (no puzzle-room coordinates walking your character
 * through their walls). Coming back with the browser's Back button joins the home again.
 *
 *   E2E_PORT=3252 npx playwright test e2e/multiplayer-daily-room.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW } from './helpers'
import { newDevice, person, signIn, waitRoom, watchErrors } from './support/morning'

async function waitJoined(page: Page, handle: string) {
  await page.waitForFunction((h) => window.__ESCAPE_NET__?.store.getState().home?.handle === h, handle, { timeout: SLOW })
}

/** Whether `page` sees the person with `handle` in its room. */
function sees(page: Page, handle: string, yes: boolean) {
  return page.waitForFunction(
    ([h, want]) => Object.values(window.__ESCAPE_NET__!.store.getState().players).some((p) => p.user.handle === h) === want,
    [handle, yes] as const,
    { timeout: SLOW },
  )
}

test('the puzzle room takes you out of your home; Back brings you in again', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'The test makes its own laptops.')
  test.setTimeout(300_000)
  const baseURL = String(info.project.use.baseURL)
  const run = String(Date.now()).slice(-7)
  const A = person('mdhost', 'Robin Host', run)
  const B = person('mdguest', 'Sam Guest', run)
  const hostCtx = await newDevice(browser, baseURL, 'laptop')
  const guestCtx = await newDevice(browser, baseURL, 'laptop')
  for (const ctx of [hostCtx, guestCtx]) await ctx.addInitScript(() => localStorage.setItem('myescapes.settings.v1', JSON.stringify({ quality: 'low' })))
  const errors: string[] = []
  try {
    const hostUser = await signIn(hostCtx, A, { onboarded: true })
    await signIn(guestCtx, B, { onboarded: true })
    expect((await hostCtx.request.post('/api/friends/requests', { data: { handle: B.handle } })).ok()).toBe(true)
    expect((await guestCtx.request.post(`/api/friends/${hostUser.id}/accept`)).ok()).toBe(true)

    const host = await hostCtx.newPage()
    watchErrors(host, errors)
    await host.goto('/?autostart=1&gate=off')
    await waitRoom(host)
    await waitJoined(host, A.handle)

    const guest = await guestCtx.newPage()
    watchErrors(guest, errors)
    await guest.goto(`/home/${A.handle}?autostart=1&gate=off`)
    await waitRoom(guest)
    await waitJoined(guest, A.handle)
    await sees(guest, A.handle, true)

    // The host opens the door's Escape of the Day and picks "Play in 3D" (no page load).
    await host.evaluate(() => window.__ESCAPE__!.store.getState().openOverlay({ kind: 'gate' }))
    await host.getByTestId('daily-play-3d').click()
    await expect(host.getByTestId('daily-room')).toBeVisible({ timeout: SLOW })
    expect(await host.evaluate(() => !!window.__ESCAPE_NET__)).toBe(true)
    await host.getByTestId('daily-room-enter').click({ timeout: SLOW })
    await host.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: SLOW })

    // Out of the home: the guest no longer has the host in the room, and nothing is shared.
    await host.waitForFunction(() => window.__ESCAPE_NET__!.store.getState().home === null, null, { timeout: SLOW })
    await sees(guest, A.handle, false)
    expect(await host.evaluate(() => window.__ESCAPE_NET__!.client()?.currentHome ?? null)).toBeNull()

    // Back to the room: in the home again, and the guest sees the host.
    await host.goBack()
    await waitJoined(host, A.handle)
    await sees(guest, A.handle, true)

    expect(errors).toEqual([])
  } finally {
    await hostCtx.close()
    await guestCtx.close()
  }
})
