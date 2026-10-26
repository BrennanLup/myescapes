#!/usr/bin/env node
// Plays today's Escape of the Day to the end on a deployed URL, signed out (progress stays in the
// browser; nothing is written on the server), on a laptop and a phone, and checks the share text.
//
//   node qa/live-daily.mjs [baseUrl]     # default https://bubbly-hope-production.up.railway.app
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'qa', 'screenshots', 'phase2')
const BASE = (process.argv[2] ?? 'https://bubbly-hope-production.up.railway.app').replace(/\/$/, '')
mkdirSync(SHOTS, { recursive: true })
let failed = 0
const errors = []
function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
}

async function solve(page) {
  await page.getByTestId('daily-start').click()
  const hook = await page.evaluate(() => ({ kind: window.__ESCAPE_DAILY__.kind, mode: window.__ESCAPE_DAILY__.mode, answer: window.__ESCAPE_DAILY__.answer() }))
  if (hook.kind === 'search') {
    for (const id of hook.answer) await page.getByTestId(`gate-target-${id}`).click()
  } else if (hook.kind === 'sequence' && hook.mode === 'shape') {
    for (const id of hook.answer) await page.getByTestId(`daily-choice-${id}`).click()
    await page.getByTestId('daily-submit').click()
  } else if (hook.kind === 'sequence') {
    for (let i = 0; i < hook.answer.length; i++) await page.getByTestId(`daily-input-${i}`).fill(hook.answer[i])
    await page.getByTestId('daily-submit').click()
  } else {
    await page.getByTestId('daily-input').fill(hook.answer.join(''))
    await page.getByTestId('daily-submit').click()
  }
  await page.getByTestId('daily-finished').waitFor({ timeout: 30_000 })
  return hook.kind
}

const browser = await chromium.launch()
for (const [tag, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['mobile', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }],
]) {
  const ctx = await browser.newContext(opts)
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`${tag}: ${m.text()}`))
  try {
    await page.goto(`${BASE}/daily`)
    await page.getByTestId('daily-page').waitFor({ timeout: 30_000 })
    const kind = await solve(page)
    const text = await page.getByTestId('daily-finished').innerText()
    await page.screenshot({ path: path.join(SHOTS, `live-${tag}-daily-solved.jpg`), type: 'jpeg', quality: 50, scale: 'css' })
    check(`${tag}: solved today's ${kind} puzzle`, true, text.replace(/\s+/g, ' ').slice(0, 120))
    const share = (await page.getByTestId('daily-share-text').textContent()) ?? ''
    check(`${tag}: share text is spoiler-free with the /daily link`, (/Escape #\d+/.test(share) && share.includes('/daily')), share.replace(/\n/g, ' | '))
    check(`${tag}: streak shown`, /streak/i.test(text), '')
    await page.reload()
    await page.getByTestId('daily-page').waitFor()
    const again = await page.getByTestId('daily-finished').waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check(`${tag}: reload keeps today's result`, again)
  } catch (e) {
    check(`${tag}: daily`, false, String(e.message).split('\n')[0])
  }
  await ctx.close()
}
await browser.close()
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '))
process.exit(failed ? 1 : 0)
