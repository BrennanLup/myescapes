import { describe, expect, it } from 'vitest'
import {
  computeProgress,
  initialGovernor,
  isTypingTarget,
  loadBudgetWarnings,
  parseFlags,
  PERF,
  smoothFps,
  sortForKey,
  stepGovernor,
  sumTransferBytes,
  type GovernorState,
} from './logic'
import type { QualityPreset } from '@/state/store'

describe('computeProgress', () => {
  it('combines assets and data and is capped by the minimum display time', () => {
    const early = computeProgress({ assetProgress: 100, assetActive: false, dataStatus: 'ready', elapsedMs: 300, minMs: 600 })
    expect(early.percent).toBe(50)
    expect(early.ready).toBe(false)
    const done = computeProgress({ assetProgress: 100, assetActive: false, dataStatus: 'ready', elapsedMs: 700, minMs: 600 })
    expect(done).toEqual({ percent: 100, ready: true, error: false })
  })

  it('waits for data and assets', () => {
    expect(computeProgress({ assetProgress: 100, assetActive: false, dataStatus: 'loading', elapsedMs: 5000 })).toMatchObject({ percent: 70, ready: false })
    expect(computeProgress({ assetProgress: 50, assetActive: true, dataStatus: 'ready', elapsedMs: 5000 })).toMatchObject({ percent: 75, ready: false })
    expect(computeProgress({ assetProgress: 100, assetActive: true, dataStatus: 'ready', elapsedMs: 5000 }).ready).toBe(false)
  })

  it('treats an idle loading manager with nothing to load as done', () => {
    expect(computeProgress({ assetProgress: 0, assetActive: false, assetTotal: 0, dataStatus: 'ready', elapsedMs: 900 }).ready).toBe(true)
    expect(computeProgress({ assetProgress: 0, assetActive: true, assetTotal: 0, dataStatus: 'ready', elapsedMs: 900 }).ready).toBe(false)
    expect(computeProgress({ assetProgress: 40, assetActive: false, assetTotal: 5, dataStatus: 'ready', elapsedMs: 900 }).ready).toBe(false)
  })

  it('flags data errors and clamps bad input', () => {
    const r = computeProgress({ assetProgress: NaN, assetActive: false, dataStatus: 'error', elapsedMs: 5000 })
    expect(r.error).toBe(true)
    expect(r.ready).toBe(false)
    expect(r.percent).toBe(0)
    expect(computeProgress({ assetProgress: 250, assetActive: false, dataStatus: 'ready', elapsedMs: 1e6 }).percent).toBe(100)
  })
})

describe('parseFlags', () => {
  it('reads autostart and debug, defaulting autostart to webdriver', () => {
    expect(parseFlags('', false)).toEqual({ autostart: false, debug: false, webdriver: false })
    expect(parseFlags('', true).autostart).toBe(true)
    expect(parseFlags('?autostart=1', false).autostart).toBe(true)
    expect(parseFlags('?autostart=0', true).autostart).toBe(false)
    expect(parseFlags('?debug=1', false).debug).toBe(true)
  })
})

describe('sortForKey', () => {
  it('maps 1-6 to SORT_KEYS in order', () => {
    expect(['1', '2', '3', '4', '5', '6'].map((k) => sortForKey(k))).toEqual(['city', 'brand', 'genre', 'date', 'rating', 'escapeTime'])
  })
  it('accepts codes (numpad, shifted layouts) and ignores others', () => {
    expect(sortForKey('!', 'Digit1')).toBe('city')
    expect(sortForKey('End', 'Numpad6')).toBe('escapeTime')
    expect(sortForKey('7')).toBeNull()
    expect(sortForKey('0')).toBeNull()
    expect(sortForKey('w', 'KeyW')).toBeNull()
  })
  it('detects typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

function run(s: GovernorState, seconds: number, fps: number, quality: QualityPreset = 'medium', enabled = true) {
  let switchTo: QualityPreset | null = null
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const r = stepGovernor(s, { dt, fps, quality, enabled })
    s = r.state
    if (r.switchTo) switchTo = r.switchTo
  }
  return { s, switchTo }
}

describe('stepGovernor', () => {
  it('steps down to low after sustained low fps, once', () => {
    let { s, switchTo } = run(initialGovernor(), PERF.warmupSec, 60)
    expect(switchTo).toBeNull()
    ;({ s, switchTo } = run(s, PERF.sustainSec - 0.5, 25))
    expect(switchTo).toBeNull()
    ;({ s, switchTo } = run(s, 1, 25))
    expect(switchTo).toBe('low')
    expect(s.downgraded).toBe(true)
    // never again, even if the user picks high again
    expect(run(s, 20, 10, 'high').switchTo).toBeNull()
  })

  it('resets when fps recovers', () => {
    let { s } = run(initialGovernor(), PERF.warmupSec, 60)
    ;({ s } = run(s, 4, 30))
    ;({ s } = run(s, 0.1, 58))
    expect(run(s, 4, 30).switchTo).toBeNull()
  })

  it('skips at low quality, during warmup, and when disabled', () => {
    expect(run(initialGovernor(), 20, 10, 'low').switchTo).toBeNull()
    expect(run(initialGovernor(), 20, 10, 'high', false).switchTo).toBeNull()
    expect(run(initialGovernor(), PERF.warmupSec - 0.1, 10, 'high').switchTo).toBeNull()
  })

  it('does not count huge frame gaps as slow time', () => {
    let s = run(initialGovernor(), PERF.warmupSec, 60).s
    const r = stepGovernor(s, { dt: 10, fps: 5, quality: 'high', enabled: true })
    s = r.state
    expect(r.switchTo).toBeNull()
    expect(s.slowFor).toBeLessThan(1)
  })
})

describe('smoothFps', () => {
  it('converges to the instantaneous rate', () => {
    let f = 0
    for (let i = 0; i < 300; i++) f = smoothFps(f, 1 / 30)
    expect(f).toBeCloseTo(30, 1)
    expect(smoothFps(42, 0)).toBe(42)
  })
})

describe('load budget', () => {
  it('sums transfer sizes and warns over budget', () => {
    expect(sumTransferBytes([{ transferSize: 10 }, {}, { transferSize: 5 }])).toBe(15)
    expect(loadBudgetWarnings(10, 10, 100)).toEqual([])
    const w = loadBudgetWarnings(200, 300, 100)
    expect(w).toHaveLength(2)
    expect(w[0]).toContain('manifest')
    expect(w[1]).toContain('transferred')
  })
})
