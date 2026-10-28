/**
 * Phase 3, workstream C (QA round 2): finding a friend from the phone home, and what happens when
 * the host asks you to leave. The phone's /m home lists the host under "Friends online" with a
 * Visit button; the guest (on a laptop) visits, the host asks them to leave (from the people panel,
 * confirming the question first), and the room closes
 * into the "asked you to leave" page. It stays closed after the host goes away and the guest
 * reloads (the cool-down outlives the empty home).
 *
 *   E2E_PORT=3232 npx playwright test e2e/multiplayer-leave.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW } from './helpers'
import { newDevice, person, signIn, waitRoom, watchErrors } from './support/morning'

async function waitJoined(page: Page, handle: string) {
  await page.waitForFunction((h) => window.__ESCAPE_NET__?.store.getState().home?.handle === h, handle, { timeout: SLOW })
}

test('the phone finds a friend online; a guest asked to leave stays out', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'The test makes its own phone and laptops.')
  test.setTimeout(420_000)
  const baseURL = String(info.project.use.baseURL)
  const run = String(Date.now()).slice(-7)
  const A = person('mlhost', 'Robin Host', run)
  const B = person('mlguest', 'Sam Guest', run)
  const hostCtx = await newDevice(browser, baseURL, 'laptop')
  const phoneCtx = await newDevice(browser, baseURL, 'phone')
  const guestCtx = await newDevice(browser, baseURL, 'laptop')
  for (const ctx of [hostCtx, guestCtx]) await ctx.addInitScript(() => localStorage.setItem('myescapes.settings.v1', JSON.stringify({ quality: 'low' })))
  const errors: string[] = []
  try {
    const hostUser = await signIn(hostCtx, A, { onboarded: true })
    await signIn(phoneCtx, B, { onboarded: true })
    await signIn(guestCtx, B, { onboarded: true })
    expect((await hostCtx.request.post('/api/friends/requests', { data: { handle: B.handle } })).ok()).toBe(true)
    expect((await guestCtx.request.post(`/api/friends/${hostUser.id}/accept`)).ok()).toBe(true)

    // The host is in their own room.
    const host = await hostCtx.newPage()
    watchErrors(host, errors)
    await host.goto('/?autostart=1&gate=off')
    await waitRoom(host)
    await waitJoined(host, A.handle)

    // The guest's phone home shows them online, with a way in.
    const phone = await phoneCtx.newPage()
    watchErrors(phone, errors)
    await phone.goto('/m')
    const online = phone.getByTestId('friends-online')
    await expect(online).toBeVisible({ timeout: SLOW })
    await expect(online).toContainText('Robin Host')
    await expect(online).toContainText('In their room')
    await expect(online.getByRole('link', { name: "Visit Robin Host's room" })).toHaveAttribute('href', `/home/${A.handle}`)
    await phoneCtx.close()

    // The guest visits from a laptop.
    const guest = await guestCtx.newPage()
    watchErrors(guest, errors)
    await guest.goto(`/home/${A.handle}?autostart=1&gate=off`)
    await waitRoom(guest)
    await waitJoined(guest, A.handle)

    // The host asks them to leave: the room closes for the guest.
    await host.waitForFunction((h) => Object.values(window.__ESCAPE_NET__!.store.getState().players).some((p) => p.user.handle === h), B.handle, { timeout: SLOW })
    // From the people panel: "Ask to leave" asks first, and Cancel keeps the guest in.
    await host.getByTestId('people-button').click()
    const row = host.getByTestId('person-row').filter({ hasText: 'Sam Guest' })
    await row.getByTestId('kick-player').click()
    const confirm = host.getByTestId('kick-confirm')
    await expect(confirm).toContainText("Ask Sam to leave? They can't come back for 10 minutes.")
    await host.getByTestId('kick-confirm-cancel').click()
    await expect(confirm).toHaveCount(0)
    await expect(guest.getByTestId('visit-error')).toHaveCount(0)
    await row.getByTestId('kick-player').click()
    await host.getByTestId('kick-confirm-yes').click()
    await expect(guest.getByTestId('visit-error')).toHaveAttribute('data-problem', 'kicked', { timeout: SLOW })
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Robin asked you to leave')
    await expect(guest.locator('canvas')).toHaveCount(0)
    await expect(guest.getByTestId('visit-back')).toHaveAttribute('href', '/?autostart=1')

    // The host leaves (their home empties), the guest reloads: still not back in.
    await host.close()
    await guest.reload()
    await expect(guest.getByTestId('visit-error')).toHaveAttribute('data-problem', 'kicked', { timeout: SLOW })
    await expect(guest.getByTestId('visit-error')).toContainText(/visit again in \d+ minutes?/)

    expect(errors).toEqual([])
  } finally {
    await phoneCtx.close()
    await hostCtx.close()
    await guestCtx.close()
  }
})
