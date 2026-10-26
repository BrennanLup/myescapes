import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { shouldRedirectToMobile } from './device'

// The Phase 1 QA harness (qa/playtest.mjs) drives the 3D room in a Pixel 7 viewport. Phones on `/`
// are sent to /m, so every room URL it opens must opt out with desktop=1 (as e2e/helpers.ts roomUrl()
// does), or the mobile joystick/tap/HUD/wrap/wish-list checks never reach the room.
const PIXEL_7 = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const harness = readFileSync(resolve(__dirname, '../../../qa/playtest.mjs'), 'utf8')

/** Every path+query the harness passes to goto(), e.g. "/?demo=1" or "/daily". */
function gotoTargets(src: string): string[] {
  const out: string[] = []
  const re = /\.goto\(\s*(?:BASE\s*\+\s*(['"`])(.*?)\1|`\$\{BASE\}(.*?)`)/g
  for (const m of src.matchAll(re)) out.push(m[2] ?? m[3])
  return out
}

beforeEach(() => localStorage.clear())

describe('qa/playtest.mjs room URLs', () => {
  const targets = gotoTargets(harness)
  const roomTargets = targets.filter((t) => new URL(t, 'http://x').pathname === '/')

  it('finds the room URLs the harness opens', () => {
    expect(roomTargets.length).toBeGreaterThanOrEqual(3)
  })

  it.each(roomTargets)('%s reaches the 3D room on a phone in a fresh browser', (target) => {
    localStorage.clear()
    const u = new URL(target, 'http://x')
    expect(shouldRedirectToMobile({ pathname: u.pathname, search: u.search }, { userAgent: PIXEL_7 })).toBe(false)
  })

  it('sanity: without desktop=1 a Pixel 7 on / goes to /m', () => {
    expect(shouldRedirectToMobile({ pathname: '/', search: '?demo=1' }, { userAgent: PIXEL_7 })).toBe(true)
  })
})
