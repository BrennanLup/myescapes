// QA screenshots for the player controller.
// node src/player/qa-screenshots.mjs <baseUrl> <outDir>
// 1) desktop 1440x900: hold W for ~1.5 s via the page keyboard, report the distance walked.
// 2) mobile 390x844: touch mode on, joystick visible, drag the joystick forward.
import { chromium } from '@playwright/test'

const [url = 'http://localhost:4108', outDir = 'qa/screenshots'] = process.argv.slice(2)
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const log = (page) => {
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${m.type()}]`, m.text()))
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
}
const pose = (page) => page.evaluate(() => JSON.stringify(window.__ESCAPE__.runtime.player))

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  log(page)
  await page.goto(url)
  await page.waitForTimeout(5000)
  await page.evaluate(() => window.__ESCAPE__.store.getState().closeOverlay())
  console.log('desktop start', await pose(page))
  await page.mouse.click(720, 450) // request pointer lock (falls back to drag look headless)
  console.log('pointerLocked', await page.evaluate(() => window.__ESCAPE__.store.getState().pointerLocked))
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  await page.waitForTimeout(400)
  console.log('desktop after W', await pose(page))
  // Run into the north wall with Shift+W for a while; must stay inside.
  await page.keyboard.down('Shift')
  await page.keyboard.down('w')
  await page.waitForTimeout(3000)
  await page.keyboard.up('w')
  await page.keyboard.up('Shift')
  console.log('desktop after run north', await pose(page))
  await page.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 5.5], 0, 0))
  await page.waitForTimeout(300)
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  await page.waitForTimeout(500)
  console.log('desktop final', await pose(page))
  await page.screenshot({ path: `${outDir}/ws-8-player-desktop.png` })
  await page.close()
}

{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  log(page)
  await page.goto(url)
  await page.waitForTimeout(5000)
  await page.evaluate(() => {
    const s = window.__ESCAPE__.store.getState()
    s.closeOverlay()
    s.setTouch(true)
  })
  await page.waitForTimeout(500)
  const box = await page.locator('[data-joystick]').boundingBox()
  console.log('joystick box', JSON.stringify(box), 'look surface', await page.locator('[data-look-surface]').count())
  if (box) {
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // Drive the joystick with a mouse pointer (Playwright has no touch-drag API); the code path is the same pointer events.
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 10, cy - 60, { steps: 4 })
    await page.waitForTimeout(1200)
    console.log('mobile joystick', await page.evaluate(() => JSON.stringify(window.__ESCAPE__.runtime.joystick)))
    console.log('mobile pose', await pose(page))
    await page.screenshot({ path: `${outDir}/ws-8-player-mobile.png` })
    await page.mouse.up()
  } else {
    await page.screenshot({ path: `${outDir}/ws-8-player-mobile.png` })
  }
  await page.close()
}
await browser.close()
console.log('done')
