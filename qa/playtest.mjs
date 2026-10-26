#!/usr/bin/env node
// QA playtest: headless Playwright run of the whole product loop at desktop 1440x900 and mobile 390x844.
//
//   node qa/playtest.mjs                 # both viewports
//   node qa/playtest.mjs desktop         # one viewport
//   QA_PORT=3330 node qa/playtest.mjs    # port (3300-3599)
//   QA_TAG=qa2 node qa/playtest.mjs      # screenshot/results prefix (round 2 uses qa2; default qa)
//
// Starts the app exactly like a user (`NO_OPEN=1 PORT=… DATA_DIR=<fresh temp dir> npm start`), waits for /health,
// then drives the real UI (keyboard / joystick / taps) and polls `window.__ESCAPE__` for state.
// Writes screenshots to qa/screenshots/<tag>-<viewport>-<nn>-<step>.png and machine-readable results to
// qa/playtest-results[-<tag>][-<viewport>].json. Software WebGL (SwiftShader) is slow: everything polls with generous timeouts.
import { chromium, devices } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'qa', 'screenshots')
const PORT = Number(process.env.QA_PORT ?? 3330)
const TAG = process.env.QA_TAG ?? 'qa'
const BASE = `http://localhost:${PORT}`
const SLOW = 120_000
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const RADIUS = 0.35
const HALF_W = 10
const HALF_D = 8
const BODY_Y_MIN = 0.1
const BODY_Y_MAX = 1.8
const BOARD = { y: 2.05, faceZ: -7.98 + 0.072 }
const TAB = { y: BOARD.y + (3 - 0.28) / 2 - 0.13, first: -(6 * 0.62 + 5 * 0.07) / 2 + 0.31, step: 0.69 }
const SORT_ORDER = ['city', 'brand', 'genre', 'date', 'rating', 'escapeTime']

const only = process.argv[2]
const VIEWPORTS = [
  { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  { name: 'mobile', options: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
].filter((v) => !only || v.name === only)

mkdirSync(SHOTS, { recursive: true })
const results = { startedAt: new Date().toISOString(), port: PORT, server: {}, viewports: {} }
const log = (...a) => console.log(`[qa ${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- server

async function startServer() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'myescapes-qa-'))
  const t0 = Date.now()
  const child = spawn('npm', ['start'], {
    cwd: ROOT,
    // Mock + seed mode: blank the keys in case the shell has them.
    env: { ...process.env, NO_OPEN: '1', PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '' },
    detached: true, // own process group, so we can stop npm + node start.mjs + server together
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  for (;;) {
    if (child.exitCode !== null) throw new Error('npm start exited early:\n' + out)
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) break
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 300_000) throw new Error('server never became healthy:\n' + out)
    await sleep(500)
  }
  results.server = { dataDir, startupMs: Date.now() - t0, health: await (await fetch(`${BASE}/health`)).json().catch(() => null) }
  log('server healthy after', results.server.startupMs, 'ms; DATA_DIR', dataDir)
  return {
    child,
    output: () => out,
    stop() {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
    },
  }
}

// ---------------------------------------------------------------- page instrumentation

/** Runs before any page script: counts WebGL draw calls / triangles per animation frame and fps. */
function initScript() {
  const qa = (window.__QA__ = { cur: { calls: 0, tris: 0 }, frames: [], sampling: false, violations: [], sfx: [], frame: 0 })
  const triCount = (mode, count, inst = 1) => (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0) * inst
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue
    const p = C.prototype
    const wrap = (name, tri) => {
      const orig = p[name]
      if (!orig) return
      p[name] = function (...a) {
        qa.cur.calls++
        qa.cur.tris += tri(a)
        return orig.apply(this, a)
      }
    }
    wrap('drawArrays', (a) => triCount(a[0], a[2]))
    wrap('drawElements', (a) => triCount(a[0], a[1]))
    wrap('drawArraysInstanced', (a) => triCount(a[0], a[2], a[3]))
    wrap('drawElementsInstanced', (a) => triCount(a[0], a[1], a[4]))
  }
  const tick = (t) => {
    qa.frame++
    if (qa.sampling) qa.frames.push({ t, calls: qa.cur.calls, tris: qa.cur.tris })
    qa.cur = { calls: 0, tris: 0 }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function attachCollectors(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error') bag.consoleErrors.push(m.text())
    if (m.type() === 'warning') bag.consoleWarnings.push(m.text())
  })
  page.on('pageerror', (e) => bag.pageErrors.push(e.message))
  page.on('requestfailed', (r) => {
    // Aborted fetches from navigation/reload are noise; keep everything else.
    const err = r.failure()?.errorText ?? ''
    bag.failedRequests.push(`${r.method()} ${r.url()} ${err}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) bag.failedRequests.push(`${r.request().method()} ${r.url()} HTTP ${r.status()}`)
  })
}

// ---------------------------------------------------------------- helpers

function makeHelpers(page, vp, bag) {
  let shotN = 0
  const isMobile = vp.name === 'mobile'
  const H = {
    isMobile,
    async shot(step) {
      shotN++
      const file = `qa/screenshots/${TAG}-${vp.name}-${String(shotN).padStart(2, '0')}-${step}.png`
      try {
        await page.screenshot({ path: path.join(ROOT, file), timeout: 60_000 })
      } catch (e) {
        bag.notes.push(`screenshot ${file} failed: ${e.message}`)
      }
      bag.shots.push(file)
      return file
    },
    state: (expr) =>
      page.evaluate((expr) => {
        const s = window.__ESCAPE__.store.getState()
        return expr.split('.').reduce((o, k) => o?.[k], s)
      }, expr),
    pos: () => page.evaluate(() => [...window.__ESCAPE__.runtime.player.position]),
    frame: () => page.evaluate(() => window.__QA__.frame),
    /** Wait until `n` more animation frames have rendered (software GL can be < 1 fps). */
    async frames(n = 2) {
      const f0 = await H.frame()
      await page.waitForFunction((t) => window.__QA__.frame >= t, f0 + n, { timeout: SLOW, polling: 50 })
    },
    /** Hold forward until the player stops moving for 3 consecutive 2-frame windows (or maxMs). */
    async pushUntilBlocked(maxMs = 60_000) {
      await H.forwardDown()
      let prev = await H.pos()
      let still = 0
      const t0 = Date.now()
      while (Date.now() - t0 < maxMs && still < 3) {
        await H.frames(2)
        const p = await H.pos()
        still = Math.hypot(p[0] - prev[0], p[2] - prev[2]) < 0.01 ? still + 1 : 0
        prev = p
      }
      return prev
    },
    yaw: () => page.evaluate(() => window.__ESCAPE__.runtime.player.yaw),
    waitOverlay: (kind, timeout = SLOW) => page.waitForFunction((k) => (window.__ESCAPE__.store.getState().overlay?.kind ?? null) === k, kind, { timeout }),
    waitHover: (id, timeout = 60_000) => page.waitForFunction((i) => window.__ESCAPE__.store.getState().hoveredId === i, id, { timeout }),
    async teleport(pos, yaw, pitch = 0) {
      await page.evaluate(({ pos, yaw, pitch }) => window.__ESCAPE__.requestTeleport(pos, yaw, pitch), { pos, yaw, pitch })
      await page.waitForFunction(
        ({ pos, yaw }) => {
          const p = window.__ESCAPE__.runtime.player
          return Math.hypot(p.position[0] - pos[0], p.position[2] - pos[2]) < 0.02 && (yaw === undefined || Math.abs(p.yaw - yaw) < 0.02)
        },
        { pos, yaw },
        { timeout: SLOW },
      )
    },
    /** Teleport to `from` and look at `target` (yaw + pitch). */
    async aimAt(from, target) {
      const dx = target[0] - from[0]
      const dy = target[1] - from[1]
      const dz = target[2] - from[2]
      await H.teleport(from, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
    },
    /** Turn in place (rotation-only teleport). */
    async face(target, pitchTarget) {
      const p = await H.pos()
      const yaw = Math.atan2(-(target[0] - p[0]), -(target[1] - p[2]))
      const pitch = pitchTarget === undefined ? 0 : Math.atan2(pitchTarget - p[1], Math.hypot(target[0] - p[0], target[1] - p[2]))
      await page.evaluate(({ p, yaw, pitch }) => window.__ESCAPE__.requestTeleport(p, yaw, pitch), { p, yaw, pitch })
      await page.waitForFunction((yaw) => Math.abs(window.__ESCAPE__.runtime.player.yaw - yaw) < 0.02, yaw, { timeout: SLOW })
    },
    async joystick(phase, dx = 0, dy = 0) {
      await page.evaluate(
        ({ phase, dx, dy }) => {
          const el = document.querySelector('[data-joystick]')
          if (!el) throw new Error('no joystick')
          const r = el.getBoundingClientRect()
          const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy }
          el.dispatchEvent(new PointerEvent(phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup', init))
        },
        { phase, dx, dy },
      )
    },
    /** Start pushing forward (W key on desktop, joystick full forward on mobile). */
    async forwardDown() {
      if (isMobile) {
        await H.joystick('down', 0, 0)
        await H.joystick('move', 0, -70)
      } else await page.keyboard.down('KeyW')
    },
    async forwardUp() {
      if (isMobile) await H.joystick('up', 0, -70)
      else await page.keyboard.up('KeyW')
      await page.waitForFunction(() => window.__ESCAPE__.runtime.player.speed < 0.05, null, { timeout: SLOW }).catch(() => {})
    },
    /** Start a collision monitor that samples the pose every 50 ms and records violations. */
    async monitorStart() {
      await page.evaluate(
        ({ RADIUS, HALF_W, HALF_D, BODY_Y_MIN, BODY_Y_MAX }) => {
          const qa = window.__QA__
          clearInterval(qa.monitor)
          qa.monitor = setInterval(() => {
            const p = window.__ESCAPE__.runtime.player.position
            const [x, , z] = p
            if (Math.abs(x) > HALF_W - RADIUS + 0.03 || Math.abs(z) > HALF_D - RADIUS + 0.03) qa.violations.push({ kind: 'bounds', p: [...p] })
            for (const b of window.__ESCAPE__.colliders.all()) {
              if (b.id.startsWith('room:wall') || !(b.max[1] > BODY_Y_MIN && b.min[1] < BODY_Y_MAX)) continue
              const cx = Math.max(b.min[0], Math.min(x, b.max[0]))
              const cz = Math.max(b.min[2], Math.min(z, b.max[2]))
              const d = Math.hypot(x - cx, z - cz)
              if (d < RADIUS - 0.03) qa.violations.push({ kind: 'collider', id: b.id, d: +d.toFixed(3), p: [+x.toFixed(3), +z.toFixed(3)] })
            }
          }, 50)
        },
        { RADIUS, HALF_W, HALF_D, BODY_Y_MIN, BODY_Y_MAX },
      )
    },
    monitorTake: () =>
      page.evaluate(() => {
        const v = window.__QA__.violations
        window.__QA__.violations = []
        return v
      }),
    /** Walk (real input) towards the floor point [x, z]; returns how it went. Re-aims when off course. */
    async walkTo(target, { tol = 0.5, maxMs = 180_000, stuckMs = 3500 } = {}) {
      const start = await H.pos()
      const t0 = Date.now()
      let last = start
      let lastProgress = Date.now()
      let lastProgressFrame = await H.frame()
      let pushing = false
      let stuck = false
      for (;;) {
        const p = await H.pos()
        const d = Math.hypot(target[0] - p[0], target[1] - p[2])
        if (d < tol) break
        if (Date.now() - t0 > maxMs) {
          stuck = true
          break
        }
        const want = Math.atan2(-(target[0] - p[0]), -(target[1] - p[2]))
        const yaw = await H.yaw()
        let diff = Math.abs(((want - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (diff > 0.12 || !pushing) {
          if (pushing) await H.forwardUp()
          pushing = false
          await H.face(target)
          await H.forwardDown()
          pushing = true
        }
        const fr = await H.frame()
        if (Math.hypot(p[0] - last[0], p[2] - last[2]) > 0.05) {
          last = p
          lastProgress = Date.now()
          lastProgressFrame = fr
        } else if (Date.now() - lastProgress > stuckMs && fr - lastProgressFrame >= 8) {
          stuck = true
          break
        }
        // One frame at a time near the goal so a slow frame doesn't overshoot it.
        if (d < 1.2) await H.frames(1)
        else await sleep(150)
      }
      if (pushing) await H.forwardUp()
      const end = await H.pos()
      const walked = Math.hypot(end[0] - start[0], end[2] - start[2])
      const remaining = Math.hypot(target[0] - end[0], target[1] - end[2])
      let teleported = false
      if (remaining > 0.9) {
        await H.teleport([target[0], 1.6, target[1]])
        teleported = true
      }
      return { walked: +walked.toFixed(2), remaining: +remaining.toFixed(2), stuck, teleported, end: end.map((n) => +n.toFixed(2)) }
    },
    /** Hold forward for `ms` after first reaching steady state; returns the samples. */
    async pushFor(ms) {
      await H.forwardDown()
      const samples = []
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        await sleep(200)
        samples.push(await H.pos())
      }
      await H.forwardUp()
      return samples
    },
    /** Interact with what the reticle is on: E on desktop, tap (on the thing) on mobile. */
    async interact(mode = 'auto') {
      if (!isMobile) return page.keyboard.press('KeyE')
      if (mode === 'button') return page.getByTestId('interact-tap').click()
      const vpSize = page.viewportSize()
      return page.touchscreen.tap(vpSize.width / 2, vpSize.height / 2)
    },
    async closeOverlay(label) {
      if (!isMobile) await page.keyboard.press('Escape')
      else await page.getByRole('button', { name: label }).first().click()
      await H.waitOverlay(null)
    },
    async measurePerf(seconds = 5) {
      await page.evaluate(() => {
        window.__QA__.frames = []
        window.__QA__.sampling = true
      })
      await sleep(seconds * 1000)
      return page.evaluate(() => {
        const qa = window.__QA__
        qa.sampling = false
        const f = qa.frames.slice(1)
        const span = f.length > 1 ? (f[f.length - 1].t - f[0].t) / 1000 : 0
        const renderFrames = f.filter((x) => x.calls > 0)
        const avg = (k) => (renderFrames.length ? renderFrames.reduce((s, x) => s + x[k], 0) / renderFrames.length : 0)
        const max = (k) => renderFrames.reduce((m, x) => Math.max(m, x[k]), 0)
        const readout = document.querySelector('[data-testid=perf-readout]')?.textContent ?? null
        return {
          rafFps: span ? +((f.length - 1) / span).toFixed(2) : 0,
          runtimeFps: +window.__ESCAPE__.runtime.fps.toFixed(2),
          frames: f.length,
          drawCallsAvg: Math.round(avg('calls')),
          drawCallsMax: max('calls'),
          trianglesAvg: Math.round(avg('tris')),
          trianglesMax: max('tris'),
          debugReadout: readout,
          quality: window.__ESCAPE__.store.getState().settings.quality,
        }
      })
    },
  }
  return H
}

/** Pass/fail recorder. Each step runs isolated; a throw marks it failed and the run continues. */
function makeRecorder(bag) {
  return async function step(name, fn) {
    const t0 = Date.now()
    const rec = { step: name, status: 'pass', checks: [], details: {}, ms: 0 }
    const check = (label, ok, info) => {
      rec.checks.push({ label, ok: !!ok, info: info === undefined ? undefined : info })
      if (!ok) rec.status = 'fail'
      return ok
    }
    try {
      await fn({ check, details: rec.details })
    } catch (e) {
      rec.status = 'fail'
      rec.error = String(e?.message ?? e).split('\n').slice(0, 6).join('\n')
    }
    rec.ms = Date.now() - t0
    bag.steps.push(rec)
    log(`${bag.viewport} ${name}: ${rec.status.toUpperCase()} (${rec.ms} ms)${rec.error ? ' ' + rec.error.split('\n')[0] : ''}`)
    for (const c of rec.checks.filter((c) => !c.ok)) log(`   x ${c.label}`, c.info === undefined ? '' : JSON.stringify(c.info).slice(0, 300))
    return rec
  }
}

// ---------------------------------------------------------------- gate

async function gateKind(page) {
  return page.getByTestId('gate-overlay').getAttribute('data-gate-kind')
}

async function solveGate(page) {
  const answer = await page.evaluate(() => window.__ESCAPE_GATE__.answer())
  if (Array.isArray(answer)) {
    for (const id of answer) {
      // answer holds target ids; map to their index-based testids.
      const byId = page.locator(`[data-target-id="${id}"]`)
      if (await byId.count()) await byId.first().click()
      else await page.getByTestId(`gate-target-${id}`).click()
    }
  } else if ((await page.locator(`[data-choice-id="${answer}"]`).count()) > 0) {
    await page.locator(`[data-choice-id="${answer}"]`).click()
  } else {
    await page.getByTestId('gate-answer').fill(String(answer))
    await page.getByTestId('gate-submit').click()
  }
  return answer
}

async function missGate(page) {
  const answer = await page.evaluate(() => window.__ESCAPE_GATE__.answer())
  if (Array.isArray(answer)) {
    // Click the search picture away from every target.
    const box = await page.locator('[data-testid=gate-overlay] svg[role=img]').first().boundingBox()
    await page.mouse.click(box.x + 3, box.y + 3)
    return 'clicked empty picture corner'
  }
  const choices = page.locator('[data-choice-id]')
  if ((await choices.count()) > 0) {
    const n = await choices.count()
    for (let i = 0; i < n; i++) {
      const id = await choices.nth(i).getAttribute('data-choice-id')
      if (id !== answer) {
        await choices.nth(i).click()
        return 'choice ' + id
      }
    }
  }
  const s = String(answer)
  const wrong = /^\d+$/.test(s) ? (s[0] === '1' ? '2' : '1').repeat(s.length) : 'ZZQX'
  await page.getByTestId('gate-answer').fill(wrong)
  await page.getByTestId('gate-submit').click()
  return 'typed ' + wrong
}

// ---------------------------------------------------------------- the run

async function runViewport(browser, vp) {
  const bag = { viewport: vp.name, steps: [], shots: [], notes: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], perf: {} }
  results.viewports[vp.name] = bag
  const step = makeRecorder(bag)
  const ctx = await browser.newContext(vp.options)
  await ctx.addInitScript(initScript)
  const page = await ctx.newPage()
  page.setDefaultTimeout(60_000)
  attachCollectors(page, bag)
  const H = makeHelpers(page, vp, bag)

  // 1. Load + measurements -------------------------------------------------
  await step('1-load', async ({ check, details }) => {
    const t0 = Date.now()
    const encodings = []
    const onResp = async (r) => {
      const u = new URL(r.url())
      if (!/\.(js|css|html)$|^\/$/.test(u.pathname)) return
      const h = await r.allHeaders().catch(() => ({}))
      encodings.push({ path: u.pathname, status: r.status(), encoding: h['content-encoding'] ?? null, length: h['content-length'] ?? null, vary: h['vary'] ?? null })
    }
    page.on('response', onResp)
    await page.goto(BASE + '/?demo=1', { waitUntil: 'commit', timeout: SLOW })
    await page.waitForSelector('[data-testid=loading-screen]', { state: 'attached', timeout: SLOW }).catch(() => {})
    await H.shot('loading')
    // Ready = world built + loading screen gone. The gate may already be up.
    const readyAt = await page.waitForFunction(
      () => {
        const s = window.__ESCAPE__?.store.getState()
        return s && s.worldReady && !document.querySelector('[data-testid=loading-screen]') ? performance.now() : false
      },
      null,
      { timeout: 240_000, polling: 100 },
    )
    details.loadMs = Math.round(await readyAt.jsonValue())
    details.wallClockLoadMs = Date.now() - t0
    const worldReadyAt = await page.evaluate(() => performance.now())
    details.dataStatus = await H.state('dataStatus')
    details.rooms = (await H.state('rooms')).length
    check('world ready and loading screen gone', true, details.loadMs)
    check('data loaded', details.dataStatus === 'ready', details.dataStatus)
    await sleep(2500)
    const bytes = await page.evaluate(() => {
      const e = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
      const sum = (k) => e.reduce((s, x) => s + (x[k] || 0), 0)
      const top = e
        .map((x) => ({ name: x.name.replace(location.origin, ''), transfer: x.transferSize, body: x.encodedBodySize }))
        .sort((a, b) => b.transfer - a.transfer)
        .slice(0, 8)
      return { transfer: sum('transferSize'), encoded: sum('encodedBodySize'), decoded: sum('decodedBodySize'), count: e.length, top }
    })
    details.bytes = bytes
    check('total transferred < 15 MB', bytes.transfer > 0 && bytes.transfer < 15 * 1024 * 1024, bytes.transfer)
    page.off('response', onResp)
    details.encodings = encodings
    const js = encodings.filter((e) => e.path.endsWith('.js'))
    check('JS bundle served br/gzip compressed (content-encoding)', js.length > 0 && js.every((e) => /^(br|gzip)$/.test(e.encoding ?? '')), js)
    const jsTiming = bytes.top.find((x) => x.name.endsWith('.js'))
    // Also verify directly with explicit Accept-Encoding headers (what a non-Chromium client gets).
    if (jsTiming) {
      const url = BASE + jsTiming.name
      // Node fetch transparently decodes; use the raw content-length header instead.
      const head = async (ae) => {
        const r = await fetch(url, { headers: { 'accept-encoding': ae } })
        const len = r.headers.get('content-length')
        await r.arrayBuffer()
        return { ae, encoding: r.headers.get('content-encoding'), contentLength: len ? Number(len) : null, vary: r.headers.get('vary') }
      }
      details.jsProbe = [await head('br'), await head('gzip'), await head('identity')]
      check('JS: br when accepted, gzip when only gzip, identity otherwise', details.jsProbe[0].encoding === 'br' && details.jsProbe[1].encoding === 'gzip' && !details.jsProbe[2].encoding, details.jsProbe)
    }
    details.gateOpenAtReady = (await H.state('overlay.kind')) === 'gate'
    void worldReadyAt
  })

  // 2. Daily gate ------------------------------------------------------------
  await step('2-gate', async ({ check, details }) => {
    await page.getByTestId('gate-overlay').waitFor({ state: 'visible', timeout: SLOW })
    check('gate auto-opens on a fresh profile', true)
    details.kind = await gateKind(page)
    await H.shot('gate-open')
    details.answer = await solveGate(page)
    await page.getByTestId('gate-reveal').waitFor({ timeout: SLOW })
    await page
      .waitForFunction(() => document.querySelector('[data-testid=gate-overlay]').getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 15_000 })
      .catch(() => {})
    await H.shot('gate-solved')
    details.revealText = (await page.getByTestId('gate-reveal').innerText()).replace(/\s+/g, ' ').trim()
    check('reveal says it opened', /opens|Solved/i.test(details.revealText))
    check('reveal shows no raw id slug (e.g. lock-and-key)', !/\b[a-z]+(?:-[a-z]+){2,}\b/.test(details.revealText), details.revealText)
    await page.getByTestId('gate-continue').click()
    await H.waitOverlay(null)
    check('gate stored as solved today', !!(await page.evaluate(() => localStorage.getItem('myescapes.gate.lastSolved'))))
    await page.waitForFunction(() => window.__ESCAPE__.store.getState().boardPins.length > 0, null, { timeout: SLOW })
    await H.shot('room-after-gate')
    // Reload in the same context: no gate.
    await page.reload({ waitUntil: 'commit' })
    await page.waitForFunction(() => {
      const s = window.__ESCAPE__?.store.getState()
      return s && s.worldReady && s.dataStatus === 'ready' && !document.querySelector('[data-testid=loading-screen]')
    }, null, { timeout: 240_000 })
    let reopened = false
    for (let i = 0; i < 12; i++) {
      if ((await H.state('overlay.kind')) === 'gate' || (await page.getByTestId('gate-overlay').count()) > 0) reopened = true
      await sleep(400)
    }
    check('gate does not show again after reload', !reopened)
    await H.shot('reload-no-gate')
  })

  // HUD layout: mobile buttons sit in one row along the top edge; the help card stays clear of the joystick.
  await step('1c-hud-layout', async ({ check, details }) => {
    const vpSize = page.viewportSize()
    const rects = await page.evaluate(() => {
      const r = (el) => {
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }
      }
      const btns = [...document.querySelectorAll('[data-testid=hud] button')].map((b) => ({ id: b.getAttribute('data-testid'), ...r(b) }))
      return { hud: r(document.querySelector('[data-testid=hud-row]')), btns, joystick: r(document.querySelector('[data-joystick]')), tap: r(document.querySelector('[data-testid=interact-tap]')) }
    })
    details.rects = rects
    const lowest = Math.max(...rects.btns.map((b) => b.bottom))
    details.lowestHudButton = lowest
    if (H.isMobile) {
      check('mobile: HUD row exists', !!rects.hud)
      // Row buttons only (the DEMO MODE badge on the title line is a button too); centres within 4 px.
      const row = rects.btns.filter((b) => b.y > rects.hud.y - 2 && b.bottom < rects.hud.bottom + 2)
      const mids = row.map((b) => b.y + b.h / 2)
      details.rowButtons = row.map((b) => `${b.id}@${b.y}+${b.h}`)
      check('mobile: all HUD row buttons on one line (centres within 4 px)', row.length >= 6 && Math.max(...mids) - Math.min(...mids) <= 4, details.rowButtons)
      check('mobile: HUD buttons stay in the top 15% of the screen', lowest <= vpSize.height * 0.15, { lowest, limit: vpSize.height * 0.15 })
      check('mobile: HUD row fits the width', rects.btns.every((b) => b.x >= 0 && b.right <= vpSize.width), rects.btns)
    } else {
      check('desktop: HUD buttons stay in the top 20% of the screen', lowest <= vpSize.height * 0.2, lowest)
    }
    // Open the help card and check it against the joystick / Tap button.
    await page.getByTestId('help-button').click()
    await page.getByTestId('controls-hint').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(800)
    const hint = await page.getByTestId('controls-hint').evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom) }
    })
    details.hint = hint
    await H.shot('hud-help-card')
    const overlap = (a, b) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom
    const gap = (a, b) => (a && b ? Math.max(b.y - a.bottom, a.y - b.bottom, b.x - a.right, a.x - b.right) : null)
    details.hintJoystickGap = gap(hint, rects.joystick)
    if (H.isMobile) {
      check('mobile: help card does not overlap the joystick', !overlap(hint, rects.joystick), { hint, joystick: rects.joystick })
      check('mobile: help card keeps >= 8 px from the joystick', details.hintJoystickGap >= 8, details.hintJoystickGap)
      check('mobile: help card does not overlap the Tap button', !overlap(hint, rects.tap), { hint, tap: rects.tap })
    }
    await page.getByTestId('hint-close').click().catch(() => {})
    await page.getByTestId('controls-hint').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
  })

  // Perf: fps + draw calls at spawn, per quality preset (debug readout too).
  await step('1b-perf', async ({ check, details }) => {
    await page.goto(BASE + '/?demo=1&debug=1', { waitUntil: 'commit' })
    await page.waitForFunction(() => {
      const s = window.__ESCAPE__?.store.getState()
      return s && s.worldReady && s.boardPins.length > 0 && !document.querySelector('[data-testid=loading-screen]')
    }, null, { timeout: 240_000 })
    await sleep(2000)
    const out = {}
    for (const q of ['medium', 'low', 'high', 'medium']) {
      await page.evaluate((q) => window.__ESCAPE__.store.getState().updateSettings({ quality: q }), q)
      await sleep(3000)
      await H.frames(2)
      const m = await H.measurePerf(6)
      if (out[q]) out[q + '-again'] = m
      else out[q] = m
    }
    await page.evaluate(() => window.__ESCAPE__.store.getState().updateSettings({ quality: 'medium' }))
    details.perf = out
    bag.perf = out
    await H.shot('debug-readout')
    const m = out['medium-again'] ?? out.medium
    check('medium < 300 draw calls per frame', m.drawCallsAvg > 0 && m.drawCallsAvg < 300, m.drawCallsAvg)
    check('medium < 500k triangles per frame', m.trianglesAvg < 500_000, m.trianglesAvg)
    const readCalls = Number(/(\d+) draws/.exec(m.debugReadout ?? '')?.[1] ?? NaN)
    check('?debug=1 readout draw calls match WebGL (within 50%)', Number.isFinite(readCalls) && Math.abs(readCalls - m.drawCallsAvg) <= m.drawCallsAvg * 0.5, { readout: m.debugReadout, measured: m.drawCallsAvg })
    check('runtime.fps roughly matches rAF fps', Math.abs(m.runtimeFps - m.rafFps) < Math.max(1.5, m.rafFps * 0.4), { runtime: m.runtimeFps, raf: m.rafFps })
  })

  // 3. Walk to every anchor + collisions ------------------------------------
  await step('3a-look-input', async ({ check, details }) => {
    await H.teleport([0, 1.6, 3.5], 0)
    const y0 = await H.yaw()
    if (H.isMobile) {
      // Drag on the look surface.
      await page.evaluate(() => {
        const el = document.querySelector('[data-look-surface]')
        const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: false, bubbles: true, clientX: x, clientY: 400 }))
        fire('pointerdown', 300)
        for (let x = 290; x >= 200; x -= 10) fire('pointermove', x)
        fire('pointerup', 200)
      })
    } else {
      // Headless Chromium grants pointer lock but synthesises bogus movementX (+-300 px), which the app rightly
      // discards, so locked mouse-look can't be verified here. Test the click-and-drag fallback instead
      // (what users get when the browser refuses pointer lock).
      await page.evaluate(() => {
        window.__QA__.origLock = HTMLCanvasElement.prototype.requestPointerLock
        HTMLCanvasElement.prototype.requestPointerLock = function () {
          return Promise.reject(new Error('qa: pointer lock unavailable'))
        }
      })
      await page.mouse.move(720, 450)
      await page.mouse.down()
      for (let x = 705; x >= 570; x -= 15) {
        await page.mouse.move(x, 450)
        await sleep(40)
      }
      await page.mouse.up()
      await page.evaluate(() => (HTMLCanvasElement.prototype.requestPointerLock = window.__QA__.origLock))
      details.mode = 'drag fallback (pointer lock stubbed to fail)'
    }
    await H.frames(3)
    const y1 = await H.yaw()
    details.yawDelta = +(y1 - y0).toFixed(3)
    check('dragging left turns the camera left (yaw increases)', y1 - y0 > 0.05, details.yawDelta)
  })

  const route = [
    { name: 'bulletin-board', way: [[0, -4]], look: [-1.8, 2.35, -7.9], hover: /^photo:/ },
    { name: 'desk', way: [[-7.6, -3]], look: [-9.4, 0.95, -3], hover: 'desk:terminal' },
    { name: 'wrap-trophy', way: [[-7, 3.5]], look: [-10, 1.2, 3.5], hover: 'wrap:trophy' },
    { name: 'gate-door', way: [[-1.5, 4.5], [0, 5.6]], look: [0, 1.4, 8], hover: /^gate/ },
    { name: 'living-area', way: [[1, 4.5], [1.2, -1.0], [3.5, -1.2]], look: [3.5, 0.3, 1.6], hover: null },
    { name: 'shelves', way: [[7.6, -1.2], [7.8, 4]], look: [10, 1.2, 4], hover: null },
    { name: 'wishlist-board', way: [[7.8, -1.2], [6.5, -3]], look: [10, 1.9, -3], hover: 'wishlist:board' },
  ]
  await step('3b-walk-anchors', async ({ check, details }) => {
    await H.teleport([0, 1.6, 3.5], 0)
    await H.monitorStart()
    details.legs = []
    for (const a of route) {
      const legs = []
      for (const w of a.way) legs.push(await H.walkTo(w))
      const p = await H.pos()
      if (a.name === 'bulletin-board') {
        // Aim at a real photo (the layout depends on the room count).
        const pins = await H.state('boardPins')
        const pin = pins.reduce((best, q) => (Math.abs(q.target[0] + 1.8) < Math.abs(best.target[0] + 1.8) ? q : best), pins[0])
        a.look = [pin.target[0], pin.target[1] - 0.3, pin.target[2]]
      }
      await H.face([a.look[0], a.look[2]], a.look[1])
      await H.frames(3)
      if (a.hover) {
        await page
          .waitForFunction((re) => new RegExp(re).test(window.__ESCAPE__.store.getState().hoveredId ?? ''), typeof a.hover === 'string' ? '^' + a.hover.replace(/[.:]/g, '\\$&') + '$' : a.hover.source, { timeout: 30_000 })
          .catch(() => {})
      }
      const hovered = await H.state('hoveredId')
      const shot = await H.shot(`anchor-${a.name}`)
      const walked = legs.reduce((s, l) => s + l.walked, 0)
      const tp = legs.some((l) => l.teleported)
      details.legs.push({ anchor: a.name, walked: +walked.toFixed(2), teleported: tp, legs, at: p.map((n) => +n.toFixed(2)), hovered, shot })
      check(`reached ${a.name} by walking${tp ? ' (needed teleport)' : ''}`, !tp, legs)
      if (a.hover) check(`${a.name} is hoverable from the stand point`, typeof a.hover === 'string' ? hovered === a.hover : a.hover.test(hovered ?? ''), hovered)
    }
    const v = await H.monitorTake()
    details.violations = v.slice(0, 20)
    check('no collider/bounds violations while walking the route', v.length === 0, v.slice(0, 5))
  })

  await step('3c-collisions', async ({ check, details }) => {
    const tests = [
      { name: 'north-wall', start: [-7.5, 1.6, -6], yaw: 0 },
      { name: 'south-wall', start: [-3, 1.6, 6.3], yaw: Math.PI },
      { name: 'east-wall', start: [8.3, 1.6, -6], yaw: -Math.PI / 2 },
      { name: 'west-wall', start: [-8.3, 1.6, 0], yaw: Math.PI / 2 },
      { name: 'nw-corner', start: [-8.5, 1.6, -6.5], yaw: Math.PI / 4 },
      { name: 'couch', start: [7.6, 1.6, 1.5], yaw: Math.PI / 2, box: 'living:couch' },
      { name: 'desk', start: [-7.5, 1.6, -3.6], yaw: Math.PI / 2, box: 'desk:desk' },
      { name: 'gate-door', start: [0, 1.6, 5.3], yaw: Math.PI, box: 'gate:door' },
      { name: 'bookshelf', start: [8, 1.6, 4], yaw: -Math.PI / 2, box: 'living:bookshelf' },
      { name: 'coffee-table', start: [4.25, 1.6, -0.8], yaw: Math.PI, box: 'living:coffee-table' },
      { name: 'board', start: [0, 1.6, -6], yaw: 0, box: 'board:north' },
      { name: 'wishlist-board', start: [8.3, 1.6, -3], yaw: -Math.PI / 2, box: 'wishlist:board' },
    ]
    const boxes = await page.evaluate(() => window.__ESCAPE__.colliders.all())
    details.colliderCount = boxes.length
    const body = boxes.filter((b) => !b.id.startsWith('room:wall') && b.max[1] > BODY_Y_MIN && b.min[1] < BODY_Y_MAX)
    details.runs = []
    await H.monitorStart()
    for (const t of tests) {
      await H.teleport(t.start, t.yaw)
      // Walk until contact, then 2.5 s more of pushing.
      await H.pushUntilBlocked(60_000)
      // Keep pushing for 2.5 s and at least 6 more frames.
      const samples = []
      const t1 = Date.now()
      const f1 = await H.frame()
      while (Date.now() - t1 < 2500 || (await H.frame()) - f1 < 6) {
        await H.frames(1)
        samples.push(await H.pos())
      }
      await H.forwardUp()
      let worstInside = null
      let outOfBounds = 0
      for (const [x, , z] of samples) {
        if (Math.abs(x) > HALF_W - RADIUS + 0.02 || Math.abs(z) > HALF_D - RADIUS + 0.02) outOfBounds++
        for (const b of body) {
          const cx = Math.max(b.min[0], Math.min(x, b.max[0]))
          const cz = Math.max(b.min[2], Math.min(z, b.max[2]))
          const d = Math.hypot(x - cx, z - cz)
          if (d < RADIUS - 0.02 && (!worstInside || d < worstInside.d)) worstInside = { id: b.id, d: +d.toFixed(3) }
        }
      }
      const last = samples[samples.length - 1].map((n) => +n.toFixed(3))
      const travelled = +Math.hypot(last[0] - t.start[0], last[2] - t.start[2]).toFixed(2)
      details.runs.push({ test: t.name, last, travelled, outOfBounds, worstInside })
      check(`${t.name}: stays in bounds and outside colliders while pushing 2.5 s`, outOfBounds === 0 && !worstInside && travelled > 0.2, { last, travelled, outOfBounds, worstInside })
      if (['north-wall', 'couch', 'gate-door'].includes(t.name)) await H.shot(`push-${t.name}`)
    }
    const v = await H.monitorTake()
    check('collision monitor: no violations', v.length === 0, v.slice(0, 5))
  })

  await step('3d-ten-steps', async ({ check, details }) => {
    details.rays = []
    for (const [dir, yaw] of [['north', 0], ['south', Math.PI], ['east', -Math.PI / 2], ['west', Math.PI / 2]]) {
      const best = []
      for (const off of [0, 1.2, -1.2]) {
        const start = dir === 'north' || dir === 'south' ? [off, 1.6, 0] : [0, 1.6, off]
        await H.teleport(start, yaw)
        await H.pushUntilBlocked(120_000)
        await H.forwardUp()
        const p = await H.pos()
        const dist = +Math.hypot(p[0] - start[0], p[2] - start[2]).toFixed(2)
        best.push({ off, dist, steps: +(dist / 0.75).toFixed(1), end: p.map((n) => +n.toFixed(2)) })
      }
      details.rays.push({ dir, runs: best })
      check(`${dir}: 10+ steps (7.5 m) straight from the exact centre`, best[0].dist >= 7.5, best[0])
      check(`${dir}: 10+ steps from centre within ±1.2 m lane`, best.some((b) => b.dist >= 7.5), best)
    }
  })

  // 4. Reviews + sorting ------------------------------------------------------
  await step('4a-reviews', async ({ check, details }) => {
    const pins = (await H.state('boardPins')).slice().sort((a, b) => a.order - b.order)
    const rooms = await H.state('rooms')
    const picks = [pins[0], pins[Math.floor(pins.length / 2)], pins[pins.length - 1]]
    details.opened = []
    for (const [i, pin] of picks.entries()) {
      await H.aimAt([pin.target[0], 1.6, -4.5], [pin.target[0], pin.target[1] - 0.25, pin.target[2]])
      await H.waitHover('photo:' + pin.roomId)
      const how = H.isMobile ? (i === 1 ? 'button' : 'tap') : 'E'
      await H.interact(how === 'button' ? 'button' : 'auto')
      await H.waitOverlay('review', 30_000)
      const overlay = page.getByTestId('review-overlay')
      await overlay.waitFor({ state: 'visible' })
      await sleep(800)
      const shownId = await H.state('overlay.roomId')
      const title = (await overlay.locator('h2').first().innerText()).trim()
      const room = rooms.find((r) => r.id === pin.roomId)
      const text = await overlay.innerText()
      const shot = await H.shot(`review-${i + 1}`)
      details.opened.push({ roomId: pin.roomId, how, title, shownId, shot })
      check(`review ${i + 1} (${how}) opens the aimed room`, shownId === pin.roomId, { shownId, want: pin.roomId })
      check(`review ${i + 1} title matches room name`, title === room?.name, { title, want: room?.name })
      check(`review ${i + 1} shows company + city`, text.includes(room.company) && text.includes(room.city))
      const cityRe = new RegExp(room.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const repeatLines = text.split('\n').filter((l) => (l.match(cityRe) ?? []).length > 1)
      details.opened[details.opened.length - 1].addressLines = text.split('\n').filter((l) => /\d/.test(l) && l.toLowerCase().includes(room.city.toLowerCase())).slice(0, 3)
      check(`review ${i + 1}: no line repeats the city (address)`, repeatLines.length === 0, repeatLines)
      const overflow = await overlay.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth }
      })
      check(`review ${i + 1} fits the viewport horizontally`, overflow.scrollW <= overflow.vw + 1, overflow)
      await H.closeOverlay('Close review')
    }
  })

  await step('4b-sorting', async ({ check, details }) => {
    let sfx = 0
    await page.evaluate(() => {
      window.__QA__.sfx = []
      window.__ESCAPE__.bus.on('sfx', (e) => window.__QA__.sfx.push(e.name))
    })
    const groupOk = {
      genre: `(p, r) => p.group.toLowerCase().replace(/[^a-z]/g, '') === r.genre.toLowerCase().replace(/[^a-z]/g, '')`,
      date: `(p) => /^\\d{4}$|undated/i.test(p.group)`,
      rating: `(p) => /\\d/.test(p.group) || /unrated|no rating/i.test(p.group)`,
      city: `(p, r) => p.group === r.city`,
    }
    const changes = [
      { key: 'genre', via: 'hud' },
      { key: 'date', via: 'world-tab' },
      { key: 'rating', via: H.isMobile ? 'world-tab' : 'hud' },
      { key: 'city', via: 'world-tab' },
    ]
    details.changes = []
    for (const c of changes) {
      const before = (await H.state('boardPins')).slice().sort((a, b) => a.order - b.order).map((p) => p.roomId)
      const sfxBefore = await page.evaluate(() => window.__QA__.sfx.filter((n) => n === 'string').length)
      if (c.via === 'hud') {
        await H.teleport([0, 1.6, -2.0], 0, 0.05)
        if (H.isMobile) {
          await page.getByTestId('sort-button').click()
          await page.getByTestId(`sort-${c.key}`).click()
        } else await page.getByTestId(`sort-${c.key}`).click()
      } else {
        const i = SORT_ORDER.indexOf(c.key)
        const tabX = TAB.first + i * TAB.step
        await H.aimAt([tabX, 1.6, -4.5], [tabX, TAB.y, BOARD.faceZ])
        await H.waitHover('sort:' + c.key)
        await H.interact()
        await page.waitForFunction((k) => window.__ESCAPE__.store.getState().sort === k, c.key, { timeout: 30_000 })
        await H.teleport([0, 1.6, -2.0], 0, 0.05)
      }
      await page.waitForFunction((k) => window.__ESCAPE__.store.getState().sort === k, c.key, { timeout: 30_000 })
      await H.frames(1)
      const midMoving = await page.evaluate(() => {
        const s = window.__ESCAPE__.store.getState()
        return s.boardPins.filter((p) => {
          const live = window.__ESCAPE__.runtime.pinPositions.get(p.roomId)
          return live && Math.hypot(live[0] - p.target[0], live[1] - p.target[1]) > 0.02
        }).length
      })
      const midShot = await H.shot(`sort-${c.key}-mid`)
      const ok = await page
        .waitForFunction(
          ({ fn }) => {
            const f = new Function('return ' + fn)()
            const s = window.__ESCAPE__.store.getState()
            const byId = new Map(s.rooms.map((r) => [r.id, r]))
            return s.boardPins.length === s.rooms.length && s.boardPins.every((p) => f(p, byId.get(p.roomId)))
          },
          { fn: groupOk[c.key] },
          { timeout: 60_000 },
        )
        .then(() => true)
        .catch(() => false)
      const settled = await page
        .waitForFunction(
          () => {
            const s = window.__ESCAPE__.store.getState()
            return s.boardPins.every((p) => {
              const live = window.__ESCAPE__.runtime.pinPositions.get(p.roomId)
              return live && Math.hypot(live[0] - p.target[0], live[1] - p.target[1], live[2] - p.target[2]) < 0.02
            })
          },
          null,
          { timeout: 90_000 },
        )
        .then(() => true)
        .catch(() => false)
      await sleep(2500) // let the string finish re-tying
      const after = (await H.state('boardPins')).slice().sort((a, b) => a.order - b.order).map((p) => p.roomId)
      const groups = [...new Set((await H.state('boardPins')).map((p) => p.group))]
      const sfxAfter = await page.evaluate(() => window.__QA__.sfx.filter((n) => n === 'string').length)
      const settledShot = await H.shot(`sort-${c.key}-settled`)
      const pressed = H.isMobile ? null : await page.getByTestId(`sort-${c.key}`).getAttribute('aria-pressed')
      details.changes.push({ ...c, groups, orderChanged: before.join() !== after.join(), midMoving, stringSfx: sfxAfter - sfxBefore, midShot, settledShot, pressed })
      sfx += sfxAfter - sfxBefore
      check(`sort ${c.key} via ${c.via}: pins regroup by ${c.key}`, ok, groups)
      check(`sort ${c.key}: pins animate (moving one frame after the change) and settle on targets`, settled && midMoving > 0, { settled, midMoving })
      check(`sort ${c.key}: order changed`, before.join() !== after.join())
      check(`sort ${c.key}: string re-tie sfx fired`, sfxAfter - sfxBefore > 0, sfxAfter - sfxBefore)
      if (!H.isMobile) check(`sort ${c.key}: HUD chip shows pressed`, pressed === 'true', pressed)
    }
    void sfx
  })

  // 5. Add entry (mock) ---------------------------------------------------------
  await step('5-add-entry', async ({ check, details }) => {
    await H.aimAt([-7.6, 1.6, -3], [-9.4, 0.95, -3])
    await H.waitHover('desk:terminal')
    await H.interact()
    await H.waitOverlay('record', 30_000)
    await page.getByTestId('record-overlay').waitFor()
    await sleep(600)
    // The tap that opened the overlay must not also "click" whatever is now under the finger.
    details.promptsTickedOnOpen = await page.$$eval('[data-testid^="prompt-"][aria-pressed="true"]', (els) => els.map((e) => e.getAttribute('data-testid')))
    check('opening tap does not tick a checklist prompt (no ghost click)', details.promptsTickedOnOpen.length === 0, details.promptsTickedOnOpen)
    await H.shot('record-overlay')
    if (H.isMobile) {
      const transcript =
        'Last Saturday we did The Clockmaker’s Attic by Puzzle Forge in Oakland. It was a steampunk mystery, we escaped in 52 minutes with two hints. ' +
        'Me, Sam and Priya played. Favourite puzzle was a gear alignment lock. I would rate it 88 overall, puzzles 90, setting 85.'
      await page.getByTestId('transcript-input').fill(transcript)
      details.transcript = 'typed'
    } else {
      await page.getByTestId('sample-transcript').click()
      details.transcript = 'sample button'
    }
    check('transcript filled', (await page.getByTestId('transcript-input').inputValue()).length > 40)
    await H.shot('record-transcript')
    await page.getByTestId('extract-submit').click()
    await H.waitOverlay('confirm', 60_000)
    await sleep(800)
    details.mode = await page.getByTestId('confirm-mode').innerText().catch(() => null)
    details.uiDraft = await page.evaluate(() => {
      const v = (id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? null
      return {
        date: v('field-review.date'),
        comments: ['overall', 'puzzles', 'setting', 'storyline', 'difficulty'].map((k) => v(`field-review.ratings.${k}.comment`)),
        overlayText: document.querySelector('[data-testid=confirm-overlay]')?.innerText.slice(0, 2000) ?? null,
      }
    })
    check('confirm screen says mock extractor', /mock/i.test(details.mode ?? ''), details.mode)
    await H.shot('confirm-initial')
    // QA #9: the casual transcript ("Me, Sam and Priya played", "last Saturday", per-rating comments) through the real endpoint.
    {
      const casual =
        'Last Saturday we did The Clockmaker’s Attic by Puzzle Forge in Oakland. It was a steampunk mystery, we escaped in 52 minutes with two hints. ' +
        'Me, Sam and Priya played. Favourite puzzle was a gear alignment lock. I would rate it 88 overall, puzzles 90, setting 85.'
      const draft = await (await fetch(`${BASE}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: casual }) })).json()
      const now = new Date()
      const lastSat = new Date(now)
      lastSat.setDate(now.getDate() - (((now.getDay() + 1) % 7) || 7))
      const want = `${lastSat.getFullYear()}-${String(lastSat.getMonth() + 1).padStart(2, '0')}-${String(lastSat.getDate()).padStart(2, '0')}`
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const comments = Object.fromEntries(Object.entries(draft.review.ratings).map(([k, r]) => [k, r]))
      const scored = Object.values(draft.review.ratings).filter((r) => r.score !== null)
      const cmts = scored.map((r) => r.comment).filter(Boolean)
      details.casualDraft = { room: draft.room, date: draft.review.date, crew: draft.review.crew, ratings: comments, flags: draft.flags, escapeTime: draft.review.escapeTimeMinutes }
      check('mock: crew from "Me, Sam and Priya played" includes Sam + Priya', ['Sam', 'Priya'].every((n) => draft.review.crew.includes(n)), draft.review.crew)
      check(`mock: "last Saturday" -> ${want} (not today ${today})`, draft.review.date === want, draft.review.date)
      check('mock: scores 88 / 90 / 85 extracted', draft.review.ratings.overall.score === 88 && draft.review.ratings.puzzles.score === 90 && draft.review.ratings.setting.score === 85, scored.map((r) => r.score))
      check('mock: rating comments not duplicated across ratings', new Set(cmts).size === cmts.length, cmts)
      if (H.isMobile) {
        check('UI (typed casual transcript): date field = last Saturday', details.uiDraft.date === want, details.uiDraft.date)
        check('UI: crew chips show Sam and Priya', /Sam/.test(details.uiDraft.overlayText ?? '') && /Priya/.test(details.uiDraft.overlayText ?? ''))
      }
    }
    const missingInitially = await page.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid')))
    details.missingInitially = missingInitially
    details.saveEnabledInitially = await page.getByTestId('confirm-save').isEnabled()
    // Fill required.
    for (let guard = 0; guard < 40; guard++) {
      const missing = await page.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice('error-'.length)))
      if (missing.length === 0) break
      const p = missing[0]
      const field = page.locator(`[data-testid="field-${p}"]`)
      if (/\.(escaped|visibleTimer|multiRoom|flashlights|liveActors)$/.test(p)) await page.locator(`[data-testid="field-${p}-yes"]`).click()
      else if (p === 'room.genre') await field.selectOption('mystery')
      else if (/^review\.puzzles\.\d+\.type$/.test(p)) await field.selectOption('logic')
      else if (/\.score$/.test(p)) await field.fill('75')
      else if (p === 'review.date') await field.fill('2026-10-24')
      else await field.fill('Filled by QA')
      if (guard === 39) throw new Error('confirm form never became valid')
    }
    const name = `QA ${vp.name} Vault ${Date.now() % 100000}`
    await page.getByTestId('field-room.name').fill(name)
    details.name = name
    await H.shot('confirm-filled')
    check('save enabled after filling required', await page.getByTestId('confirm-save').isEnabled())
    const roomsBefore = (await H.state('rooms')).length
    await page.getByTestId('confirm-save').click()
    await H.waitOverlay(null, 60_000)
    await H.teleport([0, 1.6, -3.0], 0, 0.1)
    await H.shot('pin-flying')
    const newId = await H.state('lastAddedRoomId')
    details.newId = newId
    check('room count +1', (await H.state('rooms')).length === roomsBefore + 1)
    const landed = await page
      .waitForFunction(
        (id) => {
          const pin = window.__ESCAPE__.store.getState().boardPins.find((p) => p.roomId === id)
          const live = window.__ESCAPE__.runtime.pinPositions.get(id)
          return !!pin && !!live && Math.hypot(live[0] - pin.target[0], live[1] - pin.target[1], live[2] - pin.target[2]) < 0.02
        },
        newId,
        { timeout: 120_000 },
      )
      .then(() => true)
      .catch(() => false)
    check('new pin is on the board and landed', landed)
    const pin = (await H.state('boardPins')).find((p) => p.roomId === newId)
    if (pin) {
      await H.aimAt([pin.target[0], 1.6, pin.target[2] + 2.2], [pin.target[0], pin.target[1] - 0.25, pin.target[2]])
      await sleep(1500)
      details.hoverNew = await H.state('hoveredId')
      check('new pin is hoverable', details.hoverNew === 'photo:' + newId, details.hoverNew)
    }
    await H.shot('pin-landed')
    const data = await (await fetch(`${BASE}/api/data`)).json()
    check('persists in /api/data', data.rooms.some((r) => r.name === name), data.rooms.length)
    check('review saved in /api/data', data.reviews.some((r) => r.roomId === newId))
    // Survives a reload.
    await page.reload({ waitUntil: 'commit' })
    await page.waitForFunction(() => window.__ESCAPE__?.store.getState().boardPins.length > 0, null, { timeout: 240_000 })
    check('new pin still on board after reload', (await H.state('boardPins')).some((p) => p.roomId === newId))
    await page.waitForFunction(() => !document.querySelector('[data-testid=loading-screen]'), null, { timeout: SLOW })
  })

  // 6. Wish list + wrap --------------------------------------------------------
  await step('6a-wishlist', async ({ check, details }) => {
    // Unhovered view first (reticle just right of the board) to judge chalk legibility without the hover tint.
    await H.aimAt([6.0, 1.6, -3], [10, 1.9, -0.6])
    await H.frames(3)
    await H.shot('wishlist-board-unhovered')
    await H.aimAt([6.5, 1.6, -3], [10, 1.9, -3])
    await H.waitHover('wishlist:board')
    await H.shot('wishlist-board')
    await H.interact()
    await H.waitOverlay('wishlist', 30_000)
    await page.getByTestId('wishlist-overlay').waitFor()
    await sleep(600)
    await H.shot('wishlist-open')
    if (await page.getByTestId('wishlist-add-open').isVisible().catch(() => false)) await page.getByTestId('wishlist-add-open').click()
    const wish = `QA Wish ${vp.name} ${Date.now() % 100000}`
    await page.getByTestId('wishlist-add-name').fill(wish)
    await H.shot('wishlist-adding')
    await page.getByTestId('wishlist-add-submit').click()
    await page.waitForFunction((n) => window.__ESCAPE__.store.getState().wishlist.some((w) => w.name === n), wish, { timeout: 30_000 })
    let list = await H.state('wishlist')
    const item = list.find((w) => w.name === wish)
    const idx0 = list.findIndex((w) => w.id === item.id)
    details.added = { id: item.id, index: idx0, total: list.length }
    check('item added', !!item)
    // Reorder: move it up (or down if first).
    const dir = idx0 > 0 ? 'up' : 'down'
    await page.getByTestId(`wishlist-${dir}-${item.id}`).click()
    await sleep(500)
    list = await H.state('wishlist')
    const idx1 = list.findIndex((w) => w.id === item.id)
    check(`reorder ${dir} moves the item`, dir === 'up' ? idx1 === idx0 - 1 : idx1 === idx0 + 1, { idx0, idx1 })
    await page.getByTestId(`wishlist-done-${item.id}`).click()
    await sleep(500)
    list = await H.state('wishlist')
    check('mark done', list.find((w) => w.id === item.id)?.done === true)
    await H.shot('wishlist-edited')
    await sleep(1500)
    const data = await (await fetch(`${BASE}/api/data`)).json()
    const saved = data.wishlist.find((w) => w.id === item.id)
    details.server = saved
    check('wish list persisted (added + done + order)', !!saved && saved.done === true && data.wishlist.findIndex((w) => w.id === item.id) === idx1, { saved, serverIdx: data.wishlist.findIndex((w) => w.id === item.id), idx1 })
    await H.closeOverlay('Close wish list')
    await page.getByTestId('wishlist-button').click()
    await H.waitOverlay('wishlist', 30_000)
    check('HUD wish list button opens it', true)
    await H.closeOverlay('Close wish list')
  })

  await step('6b-wrap', async ({ check, details }) => {
    await H.aimAt([-7, 1.6, 3.5], [-10, 1.2, 3.5])
    await H.waitHover('wrap:trophy')
    await H.interact()
    await H.waitOverlay('wrap', 30_000)
    await page.getByTestId('wrap-overlay').waitFor()
    const counter = page.getByTestId('wrap-counter')
    await sleep(800)
    const first = await counter.innerText()
    const total = Number(/\/\s*(\d+)/.exec(first)?.[1] ?? 0)
    details.total = total
    check('wrap starts at card 1', /^1\s*\//.test(first), first)
    const seen = []
    details.blankCards = []
    for (let i = 1; i <= total; i++) {
      // Let the staggered entry animations finish (the main thread is slow under software GL).
      await page
        .waitForFunction(() => document.querySelector('[data-testid=wrap-stage]').getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 15_000 })
        .catch(() => {})
      await sleep(400)
      seen.push((await counter.innerText()).trim())
      const txt = (await page.getByTestId('wrap-stage').innerText().catch(() => '')).trim()
      const visibleText = await page.getByTestId('wrap-stage').evaluate((el) => {
        let n = 0
        for (const e of el.querySelectorAll('*')) {
          if (!e.children.length && e.textContent.trim() && Number(getComputedStyle(e).opacity) > 0.5) {
            let o = 1
            for (let p = e; p && p !== el; p = p.parentElement) o *= Number(getComputedStyle(p).opacity)
            if (o > 0.5) n++
          }
        }
        return n
      })
      if (!txt || visibleText === 0) details.blankCards.push({ card: i, txt: txt.slice(0, 60), visibleText })
      ;(details.cardTexts ??= []).push(txt.replace(/\s+/g, ' ').slice(0, 400))
      await H.shot(`wrap-card-${i}`)
      if (i < total) await page.getByTestId('wrap-next').click()
    }
    details.seen = seen
    check('stepped through every card', seen.length === total && seen.every((s, i) => s.startsWith(`${i + 1}`)), seen)
    check('every card shows visible text once its animation settles', details.blankCards.length === 0, details.blankCards)
    await page.getByTestId('wrap-prev').click()
    await sleep(500)
    check('prev goes back', (await counter.innerText()).startsWith(`${total - 1}`))
    await page.getByTestId('wrap-close').click()
    await H.waitOverlay(null)
    await page.getByTestId('wrap-button').click()
    await H.waitOverlay('wrap', 30_000)
    check('HUD wrap button opens it', true)
    await page.getByTestId('wrap-close').click()
    await H.waitOverlay(null)
    await H.shot('end-hud')
  })

  // Wrong-answer gate flow in a fresh context ---------------------------------
  await step('2b-gate-wrong-answers', async ({ check, details }) => {
    const ctx2 = await browser.newContext(vp.options)
    const p2 = await ctx2.newPage()
    attachCollectors(p2, bag)
    try {
      await p2.goto(BASE + '/?demo=1', { waitUntil: 'commit' })
      await p2.getByTestId('gate-overlay').waitFor({ state: 'visible', timeout: 240_000 })
      details.kind = await gateKind(p2)
      details.miss1 = await missGate(p2)
      await sleep(600)
      check('no hints after 1 miss', (await p2.getByTestId('gate-hints').count()) === 0)
      details.miss2 = await missGate(p2)
      await sleep(600)
      const hints = await p2.getByTestId('gate-hints').count()
      check('2 wrong answers reveal hints', hints > 0)
      if (hints) {
        await p2.waitForFunction(() => document.querySelector('[data-testid=gate-hints]').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 30_000 }).catch(() => {})
        const h = await p2.getByTestId('gate-hints').evaluate((el) => ({ text: el.innerText, opacity: getComputedStyle(el.querySelector('li')).opacity }))
        details.hint = h
        check('hint text is visible (opacity 1, non-empty)', h.text.trim().length > 5 && Number(h.opacity) > 0.9, h)
      }
      details.skipAfter2 = await p2.getByTestId('gate-skip').isVisible().catch(() => false)
      await p2.screenshot({ path: path.join(ROOT, `qa/screenshots/${TAG}-${vp.name}-90-gate-two-misses.png`) })
      bag.shots.push(`qa/screenshots/${TAG}-${vp.name}-90-gate-two-misses.png`)
      if (!details.skipAfter2) {
        details.miss3 = await missGate(p2)
        await sleep(600)
      }
      const skipVisible = await p2.getByTestId('gate-skip').isVisible().catch(() => false)
      check('skip becomes available (after 2 misses, or after the 3rd)', skipVisible, { after2: details.skipAfter2 })
      await p2.getByTestId('gate-skip').click()
      // Skip closes the gate straight away (no reveal card); accept either.
      await p2.waitForFunction(
        () => (window.__ESCAPE__.store.getState().overlay?.kind ?? null) === null || !!document.querySelector('[data-testid=gate-reveal]'),
        null,
        { timeout: SLOW },
      )
      details.skipShowsReveal = (await p2.getByTestId('gate-reveal').count()) > 0
      if (details.skipShowsReveal) await p2.getByTestId('gate-continue').click()
      await p2.waitForFunction(() => (window.__ESCAPE__.store.getState().overlay?.kind ?? null) === null, null, { timeout: SLOW })
      await sleep(1500)
      await p2.screenshot({ path: path.join(ROOT, `qa/screenshots/${TAG}-${vp.name}-91-gate-skipped.png`) })
      bag.shots.push(`qa/screenshots/${TAG}-${vp.name}-91-gate-skipped.png`)
      check('skip enters the room', true)
      details.lastSolvedAfterSkip = await p2.evaluate(() => localStorage.getItem('myescapes.gate.lastSolved'))
    } finally {
      await ctx2.close()
    }
  })

  // Every gate generator once (layout check), forced via ?gate=force&gateType=.
  await step('2c-gate-kinds', async ({ check, details }) => {
    const ctx3 = await browser.newContext(vp.options)
    const p3 = await ctx3.newPage()
    attachCollectors(p3, bag)
    details.kinds = {}
    try {
      for (const [i, k] of ['lock', 'cipher', 'sequence', 'search', 'recall'].entries()) {
        await p3.goto(`${BASE}/?demo=1&gate=force&gateType=${k}`, { waitUntil: 'commit' })
        await p3.getByTestId('gate-overlay').waitFor({ state: 'visible', timeout: 240_000 })
        await sleep(1200)
        const kind = await gateKind(p3)
        const fit = await p3.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }))
        const file = `qa/screenshots/${TAG}-${vp.name}-${92 + i}-gate-kind-${k}.png`
        await p3.screenshot({ path: path.join(ROOT, file) })
        bag.shots.push(file)
        let solved = false
        try {
          await solveGate(p3)
          await p3.getByTestId('gate-reveal').waitFor({ timeout: 20_000 })
          solved = /opens|Solved/i.test(await p3.getByTestId('gate-reveal').innerText())
        } catch (e) {
          details.kinds[k + '-error'] = String(e.message).split('\n')[0]
        }
        details.kinds[k] = { kind, fit, solved }
        check(`gate ${k}: renders as ${k}`, kind === k, kind)
        check(`gate ${k}: solvable through UI`, solved)
        check(`gate ${k}: no horizontal overflow`, fit.sw <= fit.vw + 1, fit)
      }
    } finally {
      await ctx3.close()
    }
  })

  await ctx.close()
}

// ---------------------------------------------------------------- main

let server
try {
  server = await startServer()
  const browser = await chromium.launch({ args: GL_ARGS })
  try {
    for (const vp of VIEWPORTS) await runViewport(browser, vp)
  } finally {
    await browser.close()
  }
} catch (e) {
  results.fatal = String(e?.stack ?? e)
  console.error(e)
} finally {
  if (server) {
    results.server.log = server.output().split('\n').slice(-40).join('\n')
    server.stop()
  }
  results.finishedAt = new Date().toISOString()
  const file = path.join(ROOT, 'qa', `playtest-results${TAG !== 'qa' ? '-' + TAG : ''}${only ? '-' + only : ''}.json`)
  writeFileSync(file, JSON.stringify(results, null, 2))
  log('results ->', path.relative(ROOT, file))
  const summary = Object.values(results.viewports).flatMap((b) => b.steps.map((s) => `${b.viewport.padEnd(8)} ${s.step.padEnd(24)} ${s.status}`))
  console.log(summary.join('\n'))
}
