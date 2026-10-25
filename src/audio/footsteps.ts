/**
 * Pure footstep scheduling: when should the next step sound play?
 */

/** Average stride length in metres (one footfall per stride). */
export const STRIDE_M = 0.72
export const MIN_STEP_MS = 260
export const MAX_STEP_MS = 680
/** Below this speed (m/s) we treat the player as standing still. */
export const MIN_SPEED = 0.15

/** Milliseconds between footfalls for a horizontal speed in m/s. */
export function stepIntervalMs(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return MAX_STEP_MS
  const ms = (STRIDE_M / speed) * 1000
  return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, ms))
}

/**
 * Stateful scheduler fed with (now, moving, speed) samples from a poll loop.
 * `tick` returns true when a footstep should play right now.
 * The first step comes shortly after starting to walk; stopping resets it.
 */
export class FootstepScheduler {
  private nextAt: number | null = null

  /** Delay before the very first step after starting to walk. */
  constructor(private readonly firstStepDelayMs = 120) {}

  tick(now: number, moving: boolean, speed: number): boolean {
    if (!moving || speed < MIN_SPEED) {
      this.nextAt = null
      return false
    }
    if (this.nextAt === null) {
      this.nextAt = now + this.firstStepDelayMs
      return false
    }
    if (now < this.nextAt) {
      // Speed changed a lot (e.g. sprint): never wait longer than the current interval.
      const cap = now + stepIntervalMs(speed)
      if (this.nextAt > cap) this.nextAt = cap
      return false
    }
    const interval = stepIntervalMs(speed)
    // If we fell far behind (tab hidden), don't machine-gun steps to catch up.
    this.nextAt = Math.max(this.nextAt + interval, now + interval * 0.5)
    return true
  }

  reset() {
    this.nextAt = null
  }
}

/** Random pitch multiplier for one step, e.g. 0.92..1.08. */
export function stepPitch(rand: () => number = Math.random, spread = 0.08): number {
  return 1 + (rand() * 2 - 1) * spread
}
