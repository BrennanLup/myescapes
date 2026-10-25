import { describe, expect, it } from 'vitest'
import type { AppEvent } from '@/contracts/events'
import { createCueDeduper, cueForEvent } from './cues'
import { FootstepScheduler, MAX_STEP_MS, MIN_STEP_MS, STRIDE_M, stepIntervalMs, stepPitch } from './footsteps'
import { crackleSamples, karplusStrong, masterLevel, midiToHz } from './dsp'
import { AudioEngine, getAudioContextCtor } from './engine'

const ev = (e: AppEvent) => e

describe('cueForEvent', () => {
  it('maps domain events to cues', () => {
    expect(cueForEvent(ev({ type: 'entry:saved', payload: { entry: {} as never } }))).toBe('pin')
    expect(cueForEvent(ev({ type: 'review:open', payload: { roomId: 'r1' } }))).toBe('paper')
    expect(cueForEvent(ev({ type: 'sort:changed', payload: { sort: 'city', previous: 'genre' } }))).toBe('string')
    expect(cueForEvent(ev({ type: 'gate:solved', payload: { skipped: false } }))).toBe('unlock')
    expect(cueForEvent(ev({ type: 'gate:solved', payload: { skipped: true } }))).toBeNull()
    expect(cueForEvent(ev({ type: 'gate:miss', payload: { misses: 1 } }))).toBe('error')
    expect(cueForEvent(ev({ type: 'interact', payload: { id: 'x', kind: 'photo' } }))).toBe('click')
  })

  it('passes sfx names straight through', () => {
    for (const name of ['footstep', 'pin', 'paper', 'string', 'unlock', 'click', 'error', 'chalk', 'whoosh'] as const) {
      expect(cueForEvent({ type: 'sfx', payload: { name } })).toBe(name)
    }
  })

  it('whooshes on overlay opens, silent on everything else', () => {
    for (const type of ['record:open', 'gate:open', 'wishlist:open', 'wrap:open', 'settings:open'] as const) {
      expect(cueForEvent({ type, payload: {} } as AppEvent)).toBe('whoosh')
    }
    expect(cueForEvent({ type: 'overlay:close', payload: {} })).toBeNull()
    expect(cueForEvent({ type: 'user:gesture', payload: {} })).toBeNull()
    expect(cueForEvent({ type: 'hover:changed', payload: { id: null, kind: null } })).toBeNull()
    expect(cueForEvent({ type: 'record:stop', payload: { transcript: '' } })).toBeNull()
  })
})

describe('createCueDeduper', () => {
  it('drops a repeat within the window but not after, and never footsteps', () => {
    const d = createCueDeduper(70)
    expect(d('pin', 0)).toBe(true)
    expect(d('pin', 30)).toBe(false)
    expect(d('paper', 30)).toBe(true)
    expect(d('pin', 100)).toBe(true)
    expect(d('footstep', 100)).toBe(true)
    expect(d('footstep', 101)).toBe(true)
  })
})

describe('stepIntervalMs', () => {
  it('follows stride / speed, clamped', () => {
    expect(stepIntervalMs(2)).toBeCloseTo((STRIDE_M / 2) * 1000)
    expect(stepIntervalMs(100)).toBe(MIN_STEP_MS)
    expect(stepIntervalMs(0.1)).toBe(MAX_STEP_MS)
    expect(stepIntervalMs(0)).toBe(MAX_STEP_MS)
    expect(stepIntervalMs(NaN)).toBe(MAX_STEP_MS)
    expect(stepIntervalMs(3)).toBeLessThan(stepIntervalMs(1.5))
  })
})

describe('FootstepScheduler', () => {
  const run = (s: FootstepScheduler, from: number, to: number, moving: boolean, speed: number, dt = 10) => {
    const hits: number[] = []
    for (let t = from; t <= to; t += dt) if (s.tick(t, moving, speed)) hits.push(t)
    return hits
  }

  it('is silent while standing', () => {
    expect(run(new FootstepScheduler(), 0, 3000, false, 0)).toEqual([])
    expect(run(new FootstepScheduler(), 0, 3000, true, 0.05)).toEqual([])
  })

  it('first step comes shortly after starting, then at the speed cadence', () => {
    const s = new FootstepScheduler(120)
    const hits = run(s, 0, 2000, true, 2)
    expect(hits[0]).toBe(120)
    const gaps = hits.slice(1).map((h, i) => h - hits[i])
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(360 - 10)
    for (const g of gaps) expect(g).toBeLessThanOrEqual(360 + 10)
  })

  it('faster walking means more steps', () => {
    const slow = run(new FootstepScheduler(), 0, 5000, true, 1.2).length
    const fast = run(new FootstepScheduler(), 0, 5000, true, 3.5).length
    expect(fast).toBeGreaterThan(slow)
  })

  it('stopping resets; no burst after a long gap', () => {
    const s = new FootstepScheduler(100)
    run(s, 0, 1000, true, 2)
    expect(run(s, 1010, 1500, false, 0)).toEqual([])
    const after = run(s, 1510, 1700, true, 2)
    expect(after).toEqual([1610])
    // Simulate a hidden tab: a 10 s jump yields one step, not dozens.
    const s2 = new FootstepScheduler(0)
    s2.tick(0, true, 2)
    expect(s2.tick(10, true, 2)).toBe(true)
    expect(run(s2, 10_000, 10_100, true, 2, 10).length).toBe(1)
  })

  it('stepPitch stays within the spread', () => {
    expect(stepPitch(() => 0)).toBeCloseTo(0.92)
    expect(stepPitch(() => 1)).toBeCloseTo(1.08)
    expect(stepPitch(() => 0.5)).toBe(1)
  })
})

describe('dsp', () => {
  it('masterLevel respects mute and clamps', () => {
    expect(masterLevel(0.6, true)).toBe(0)
    expect(masterLevel(1, false)).toBe(1)
    expect(masterLevel(0.5, false)).toBeCloseTo(0.25)
    expect(masterLevel(2, false)).toBe(1)
    expect(masterLevel(-1, false)).toBe(0)
    expect(masterLevel(NaN, false)).toBe(0)
  })

  it('karplusStrong decays and stays bounded', () => {
    const s = karplusStrong(8000, 200, 1)
    expect(s.length).toBe(8000)
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length)
    expect(rms(s.subarray(6000, 7000))).toBeLessThan(rms(s.subarray(0, 1000)))
    expect(Math.max(...s.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(Math.abs(s[s.length - 1])).toBe(0)
  })

  it('crackle is sparse', () => {
    const c = crackleSamples(8000, 2, 5)
    const nonZero = c.filter((v) => v !== 0).length
    expect(nonZero).toBeGreaterThan(0)
    expect(nonZero / c.length).toBeLessThan(0.05)
  })

  it('midiToHz', () => {
    expect(midiToHz(69)).toBe(440)
    expect(midiToHz(81)).toBeCloseTo(880)
  })
})

describe('AudioEngine without AudioContext (jsdom)', () => {
  it('is a safe no-op', () => {
    expect(getAudioContextCtor()).toBeNull()
    const e = new AudioEngine()
    expect(e.unlock()).toBe(false)
    expect(e.started).toBe(false)
    e.setVolume(0.5, false)
    e.play('unlock')
    e.play('footstep')
    e.dispose()
  })
})
