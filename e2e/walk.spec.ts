import { expect, test, type Page } from '@playwright/test'
import { SLOW, openApp, playerPosition } from './helpers'

const HALF_W = 10
const HALF_D = 8
const RADIUS = 0.35

/** Teleport to `start`, hold W until the player is within 0.12 m of `wall` on `axis`, then keep pushing and sample. */
async function pushInto(page: Page, start: [number, number, number], yaw: number, axis: 0 | 2, wall: number) {
  await page.evaluate(({ start, yaw }) => window.__ESCAPE__!.requestTeleport(start, yaw, 0), { start, yaw })
  await page.waitForFunction(
    (s) => {
      const p = window.__ESCAPE__!.runtime.player.position
      return Math.hypot(p[0] - s[0], p[2] - s[2]) < 0.01
    },
    start,
    { timeout: SLOW },
  )
  await page.keyboard.down('KeyW')
  // Software WebGL runs at a few fps, so walking is slow: poll until the player reaches the wall.
  await page.waitForFunction(
    ({ axis, wall }) => Math.abs(window.__ESCAPE__!.runtime.player.position[axis] - wall) < 0.12,
    { axis, wall },
    { timeout: SLOW * 2 },
  )
  const samples: [number, number, number][] = []
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250)
    samples.push(await playerPosition(page))
  }
  await page.keyboard.up('KeyW')
  return samples
}

test.describe('walking and collision', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard walking is desktop-only; mobile uses the joystick spec')

  test('walking into the west wall stops at the wall', async ({ page }) => {
    await openApp(page)
    // Yaw +PI/2 looks west (-X). z = 0 is clear wall between the desk and the trophy shelf.
    const samples = await pushInto(page, [-8.8, 1.6, 0], Math.PI / 2, 0, -HALF_W + RADIUS)
    for (const [x, , z] of samples) {
      expect(x).toBeGreaterThanOrEqual(-HALF_W + RADIUS - 0.02)
      expect(Math.abs(z)).toBeLessThan(HALF_D)
    }
  })

  test('walking into the south wall stays inside the room', async ({ page }) => {
    await openApp(page)
    // Yaw PI looks south (+Z), between the gate door and the window.
    const samples = await pushInto(page, [-3, 1.6, 6.6], Math.PI, 2, HALF_D - RADIUS)
    for (const [x, , z] of samples) {
      expect(z).toBeLessThanOrEqual(HALF_D - RADIUS + 0.02)
      expect(Math.abs(x)).toBeLessThan(HALF_W)
    }
  })
})
