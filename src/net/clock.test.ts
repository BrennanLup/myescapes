import { describe, expect, it } from 'vitest'
import { CLOCK_SAMPLES, ServerClock } from './clock'

describe('ServerClock', () => {
  it('starts at the local clock, then takes a rough offset from hello', () => {
    const c = new ServerClock()
    expect(c.now(1000)).toBe(1000)
    c.seed(5000, 1000)
    expect(c.offset).toBe(4000)
    expect(c.synced).toBe(false)
  })

  it('uses the round trip with the smallest delay', () => {
    const c = new ServerClock()
    c.seed(99_999, 0)
    // Slow trip: sent 0, back 400, server said 10_300 -> offset 10_300 + 200 - 400 = 10_100.
    c.sample(10_300, 0, 400)
    // Fast trip: sent 1000, back 1020, server said 11_010 -> offset 11_010 + 10 - 1020 = 10_000.
    c.sample(11_010, 1000, 1020)
    expect(c.synced).toBe(true)
    expect(c.offset).toBe(10_000)
    expect(c.now(2000)).toBe(12_000)
  })

  it('ignores impossible samples and keeps a few', () => {
    const c = new ServerClock()
    c.sample(100, 50, 10)
    c.sample(Number.NaN, 0, 10)
    expect(c.synced).toBe(false)
    for (let i = 0; i < CLOCK_SAMPLES + 4; i++) c.sample(1000 + i, i, i + 100 - i)
    expect(c.synced).toBe(true)
    c.reset()
    expect(c.offset).toBe(0)
  })
})
