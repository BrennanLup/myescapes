/**
 * Phase 3 workstream B: your character, first/third person and the wardrobe, signed in with the
 * test-only login. Runs on both projects: the desktop uses `V` and the mouse-free HUD pills, the
 * phone (Pixel 7) uses the round buttons.
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW, aimAt, storeState, waitHover, waitOverlay } from './helpers'
import { person, signIn, waitRoom, watchErrors } from './support/morning'

const GATE_DOOR: [number, number, number] = [0, 1.2, 8 - 0.05]

async function view(page: Page) {
  return page.evaluate(() => {
    const v = window.__ESCAPE_VIEW__!
    return { mode: v.cameraMode.getState().mode, blend: v.playerView.blend, distance: v.playerView.cameraDistance, rayStart: v.playerView.rayStart }
  })
}

async function waitThird(page: Page) {
  await page.waitForFunction(() => {
    const v = window.__ESCAPE_VIEW__
    return !!v && v.playerView.blend === 1 && v.playerView.cameraDistance > 1
  }, null, { timeout: SLOW })
}

test('third person keeps reach, is remembered, and the wardrobe saves and unlocks looks', async ({ page, context }, info) => {
  const phone = info.project.name === 'mobile'
  const errors: string[] = []
  watchErrors(page, errors)
  const me = person(phone ? 'charp' : 'chard', 'Robin Character', String(Date.now()).slice(-8))
  await signIn(context, me, { onboarded: true })

  await page.goto('/?desktop=1&gate=off')
  await waitRoom(page)
  await expect(page.getByTestId('character-hud')).toBeVisible()
  expect((await view(page)).mode).toBe('first')

  // Switch to third person (V on a laptop, the round eye button on a phone).
  if (phone) await page.getByTestId('camera-toggle').tap()
  else await page.keyboard.press('v')
  await waitThird(page)
  await expect(page.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'true')
  const third = await view(page)
  expect(third.rayStart).toBeGreaterThan(1)

  // Reach still works from the character: aim at the door from 2.5 m and open it.
  await aimAt(page, [0, 1.6, 5.5], GATE_DOOR)
  await waitHover(page, 'gate:door')
  if (phone) await page.getByTestId('interact-tap').tap()
  else await page.keyboard.press('e')
  await waitOverlay(page, 'gate')
  await page.keyboard.press('Escape')
  await waitOverlay(page, null)

  // Too far away is still too far (reach is not measured from the camera).
  await aimAt(page, [0, 1.6, 1.5], GATE_DOOR)
  await page.waitForTimeout(800)
  expect(await storeState<string | null>(page, 'hoveredId')).not.toBe('gate:door')

  // The choice survives a reload.
  await page.reload()
  await waitRoom(page)
  await waitThird(page)

  // Wardrobe: a free look, saved to the account.
  await page.getByTestId('wardrobe-button').click()
  await waitOverlay(page, 'wardrobe')
  const dialog = page.getByTestId('wardrobe-overlay')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('key-balance')).toContainText('20')
  await page.getByTestId('wardrobe-tab-hair').click()
  await page.getByTestId('item-hair-bob').click()
  await page.getByTestId('swatch-teal').click()
  await page.getByTestId('wardrobe-primary').click()
  await waitOverlay(page, null)
  await expect(page.getByTestId('shell-toast')).toContainText('saved')

  // Unlock headphones with the 20 welcome keys and wear them in one step.
  await page.getByTestId('wardrobe-button').click()
  await page.getByTestId('wardrobe-tab-extras').click()
  await expect(page.getByTestId('item-acc-headphones')).toHaveAttribute('data-locked', 'true')
  await page.getByTestId('item-acc-headphones').click()
  await expect(page.getByTestId('wardrobe-primary')).toContainText('Unlock Headphones')
  await page.getByTestId('wardrobe-primary').click()
  await waitOverlay(page, null)

  // Too expensive: the crown stays locked.
  await page.getByTestId('wardrobe-button').click()
  await page.getByTestId('wardrobe-tab-hat').click()
  await page.getByTestId('item-hat-crown').click()
  await expect(page.getByTestId('wardrobe-primary')).toBeDisabled()
  await expect(page.getByTestId('wardrobe-message')).toContainText('more keys')
  if (phone) {
    // The sheet fits the phone screen.
    const box = (await dialog.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(390)
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1)
  }
  await page.getByTestId('wardrobe-close').click()
  await waitOverlay(page, null)

  const saved = await page.evaluate(async () => (await fetch('/api/me/avatar')).json())
  expect(saved.outfit).toMatchObject({ hair: 'hair-bob', hairColor: 'teal', accessory: 'acc-headphones' })
  expect(saved.owned).toEqual(['acc-headphones'])
  expect(saved.keys.balance).toBe(10)

  // Back to first person.
  if (phone) await page.getByTestId('camera-toggle').tap()
  else await page.keyboard.press('v')
  await page.waitForFunction(() => window.__ESCAPE_VIEW__!.playerView.blend === 0, null, { timeout: SLOW })
  expect((await view(page)).rayStart).toBe(0)

  expect(errors).toEqual([])
})
