/** Round 3 probe: does aiming at the puzzle room's lock hover it, in first and third person, laptop and phone? */
import { chromium, devices } from 'playwright'
const BASE = process.env.QA_BASE ?? 'http://localhost:3301'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const kind of ['laptop', 'phone']) {
  const ctx = await browser.newContext({ ...(kind === 'phone' ? devices['Pixel 7'] : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }), baseURL: BASE })
  const p = await ctx.newPage()
  await p.goto('/daily/room')
  await p.getByTestId('daily-room-enter').click()
  await p.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: 120000 })
  await p.waitForTimeout(1500)
  const aim = async (from, target) => p.evaluate(({ from, target }) => { const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2]; window.__ESCAPE__.requestTeleport(from, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))) }, { from, target })
  const LOCK = [1.18, 1.3, -2.99]
  for (const mode of ['first', 'third']) {
    if (mode === 'third') {
      if (kind === 'phone') await p.getByTestId('camera-toggle').tap()
      else await p.keyboard.press('v')
      await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 1, null, { timeout: 60000 })
    }
    for (const from of mode === 'first' ? [[1.0, 1.6, -1.6]] : [[1.0, 1.6, -1.6], [0.5, 1.6, 0.2]]) {
      await aim(from, LOCK)
      let ok = await p.waitForFunction(() => window.__ESCAPE__.store.getState().hoveredId === 'daily:lock', null, { timeout: 4000 }).then(() => true).catch(() => false)
      // Third person: the reticle is the camera's centre, not the eye's look line, so sweep the look
      // around the target the way a person nudges the reticle onto it.
      if (!ok && mode === 'third') {
        const sweep = await p.evaluate(async ({ from, target }) => {
          const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2]
          const yaw0 = Math.atan2(-dx, -dz), pitch0 = Math.atan2(dy, Math.hypot(dx, dz))
          const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          for (let dyw = -0.45; dyw <= 0.2; dyw += 0.05) for (let dp = -0.35; dp <= 0.15; dp += 0.05) {
            window.__ESCAPE__.requestTeleport(from, yaw0 + dyw, pitch0 + dp)
            await frame()
            if (window.__ESCAPE__.store.getState().hoveredId === 'daily:lock') return { dyw: +dyw.toFixed(2), dp: +dp.toFixed(2) }
          }
          return null
        }, { from, target: LOCK })
        console.log('  sweep found', JSON.stringify(sweep))
        ok = !!sweep
      }
      const st = await p.evaluate(() => ({ h: window.__ESCAPE__.store.getState().hoveredId, pos: window.__ESCAPE__.runtime.player.position.map((x) => +x.toFixed(2)), d: window.__ESCAPE_VIEW__?.playerView.cameraDistance?.toFixed(2) }))
      console.log(kind, mode, 'from', JSON.stringify(from), 'hover lock:', ok, JSON.stringify(st))
      await p.screenshot({ path: `qa/phase3/r3/probe-lock-${kind}-${mode}-${from[2]}.jpg`, type: 'jpeg', quality: 60 })
    }
  }
  await ctx.close()
}
await browser.close()
