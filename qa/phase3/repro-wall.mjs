// QA round 2 repro: third person with your back to a wall, on a phone and a laptop.
//   QA_BASE=http://localhost:3301 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node qa/phase3/repro-wall.mjs phone,laptop
import { chromium, devices } from 'playwright'
const BASE = process.env.QA_BASE ?? 'http://localhost:3301'
const OUT = 'qa/phase3/r2'
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const kind of (process.argv[2] ?? 'phone,laptop').split(',')) {
  const ctx = await b.newContext({ ...(kind === 'phone' ? { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } : { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }), baseURL: BASE })
  const h = `rw${kind[0]}_${Date.now().toString(36).slice(-5)}`
  await ctx.request.post('/api/test/login', { data: { email: h + '@example.com', name: 'Wall Test', handle: h } })
  await ctx.addInitScript(() => localStorage.setItem('myescapes.settings.v1', JSON.stringify({ quality: 'low' })))
  const p = await ctx.newPage()
  await p.goto('/?desktop=1&gate=off&autostart=1')
  await p.waitForFunction(() => { const s = window.__ESCAPE__?.store.getState(); return s?.worldReady && s.dataStatus === 'ready' }, null, { timeout: 240000 })
  await p.getByTestId('camera-toggle').click()
  await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 1, null, { timeout: 60000 })
  const spots = [['south-door', [0, 1.6, 7.4], 0], ['south-off-door', [4, 1.6, 7.4], 0], ['east', [9.4, 1.6, 0], Math.PI / 2], ['corner', [9.3, 1.6, 7.3], Math.PI / 4]]
  for (const [name, at, yaw] of spots) {
    await p.evaluate(({ at, yaw }) => window.__ESCAPE__.requestTeleport(at, yaw, 0), { at, yaw })
    await p.waitForTimeout(3000)
    const st = await p.evaluate(() => { const v = window.__ESCAPE_VIEW__.playerView; return { dist: +v.cameraDistance.toFixed(2), player: window.__ESCAPE__.runtime.player.position.map((x) => +x.toFixed(2)), view: JSON.stringify(v).slice(0, 300) } })
    console.log(kind, name, JSON.stringify(st))
    await p.screenshot({ path: `${OUT}/repro-wall-${kind}-${name}.jpg`, type: 'jpeg', quality: 70, timeout: 60000 }).catch((e) => console.log('shot', e.message.slice(0, 80)))
  }
  await ctx.close()
}
await b.close()
