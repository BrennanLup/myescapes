/**
 * Shared Playwright helpers. Software WebGL (SwiftShader) is slow, so every
 * helper polls app state through `window.__ESCAPE__` instead of sleeping.
 */
import { expect, type Page } from '@playwright/test'

type Vec3 = [number, number, number]

/** Generous budget for anything that waits on the 3D world. */
export const SLOW = 90_000

/** Load the app and wait until the world is entered and the board has laid out its pins. */
export async function openApp(page: Page, query = '?gate=off') {
  await page.goto('/' + query)
  await page.waitForFunction(
    () => {
      const s = window.__ESCAPE__?.store.getState()
      return !!s && s.worldReady && s.dataStatus === 'ready' && s.boardPins.length > 0
    },
    null,
    { timeout: SLOW },
  )
}

export function storeState<T>(page: Page, pick: string): Promise<T> {
  return page.evaluate((expr) => {
    const s = window.__ESCAPE__!.store.getState() as unknown as Record<string, unknown>
    return expr.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], s)
  }, pick) as Promise<T>
}

export async function waitOverlay(page: Page, kind: string | null, timeout = SLOW) {
  await page.waitForFunction((k) => (window.__ESCAPE__!.store.getState().overlay?.kind ?? null) === k, kind, { timeout })
}

/** Teleport the player to `from` (eye position) and point the camera at `target`. */
export async function aimAt(page: Page, from: Vec3, target: Vec3) {
  await page.evaluate(
    ({ from, target }) => {
      const dx = target[0] - from[0]
      const dy = target[1] - from[1]
      const dz = target[2] - from[2]
      const yaw = Math.atan2(-dx, -dz)
      const pitch = Math.atan2(dy, Math.hypot(dx, dz))
      window.__ESCAPE__!.requestTeleport(from, yaw, pitch)
    },
    { from, target },
  )
}

/** Wait until the centre-screen raycast hovers the interactable with this id. */
export async function waitHover(page: Page, id: string, timeout = SLOW) {
  await page.waitForFunction((i) => window.__ESCAPE__!.store.getState().hoveredId === i, id, { timeout })
}

export async function playerPosition(page: Page): Promise<Vec3> {
  return page.evaluate(() => [...window.__ESCAPE__!.runtime.player.position] as [number, number, number])
}

/** Solve today's gate, whichever generator it picked, through the real UI. */
export async function solveGate(page: Page) {
  const overlay = page.getByTestId('gate-overlay')
  await expect(overlay).toBeVisible({ timeout: SLOW })
  const answer = await page.evaluate(() => window.__ESCAPE_GATE__!.answer())
  if (Array.isArray(answer)) {
    for (const i of answer) await page.getByTestId(`gate-target-${i}`).click()
  } else if ((await page.locator(`[data-choice-id="${answer}"]`).count()) > 0) {
    await page.locator(`[data-choice-id="${answer}"]`).click()
  } else {
    await page.getByTestId('gate-answer').fill(String(answer))
    await page.getByTestId('gate-submit').click()
  }
  await page.getByTestId('gate-continue').click({ timeout: SLOW })
  await waitOverlay(page, null)
}

/** Fill every required field the confirm form still reports as missing. */
export async function fillMissingConfirmFields(page: Page) {
  for (let guard = 0; guard < 40; guard++) {
    const missing = await page.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid')!.slice('error-'.length)))
    if (missing.length === 0) return
    const path = missing[0]
    const field = page.locator(`[data-testid="field-${path}"]`)
    if (/\.(escaped|visibleTimer|multiRoom|flashlights|liveActors)$/.test(path)) {
      await page.locator(`[data-testid="field-${path}-yes"]`).click()
    } else if (path === 'room.genre') {
      await field.selectOption('mystery')
    } else if (/^review\.puzzles\.\d+\.type$/.test(path)) {
      await field.selectOption('logic')
    } else if (/\.score$/.test(path)) {
      await field.fill('75')
    } else if (path === 'review.date') {
      await field.fill('2026-10-24')
    } else if (/^review\.puzzles\.\d+\.description$/.test(path)) {
      await field.fill('A puzzle we solved together')
    } else {
      await field.fill('Filled by e2e')
    }
  }
  throw new Error('confirm form never became valid')
}
