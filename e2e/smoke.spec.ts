import { test, expect } from '@playwright/test'

test('app shell loads with a canvas and healthy server', async ({ page, request }) => {
  const health = await request.get('/health')
  expect(health.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForFunction(() => !!window.__ESCAPE__)
})
