// Dev helper: node scripts/screenshot.mjs <url> <out.png> [width] [height] [waitMs] [jsToEvalBeforeShot]
// Uses the preinstalled Chromium with software WebGL. Prints console errors.
import { chromium } from '@playwright/test'
const [url, out, w = '1440', h = '900', wait = '4000', js] = process.argv.slice(2)
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${m.type()}]`, m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(url)
await page.waitForTimeout(Number(wait))
if (js) {
  console.log('eval ->', await page.evaluate(js))
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
