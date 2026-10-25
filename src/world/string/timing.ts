/** Pure: animation timing for tying, untying and twanging string. All times in seconds. */

export const TIMING = {
  /** Old strings untie and fade over this long after a re-sort. */
  retract: 0.45,
  /** New strings start drawing this long after the re-sort began (overlaps the fade a bit). */
  drawDelay: 0.35,
  /** All new strings finish drawing within this window (staggered). */
  drawTotal: 0.95,
  /** One string takes this long to draw from pin to pin. */
  segment: 0.32,
  /** A newly pinned photo's string. */
  single: 0.5,
  /** Give up waiting for a new pin to land after this long. */
  landTimeout: 3,
  /** If the board publishes no new pins after a re-sort, redraw the old layout after this long. */
  pinsTimeout: 0.6,
} as const

/** Sag multiplier while a string is being pulled out (it is held fairly taut). */
export const TAUT = 0.35

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3
export const easeInOutQuad = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/** Delay before string i of n starts drawing so all of them end within `total`. */
export function staggerDelay(i: number, n: number, total: number = TIMING.drawTotal, segment: number = TIMING.segment) {
  if (n <= 1) return 0
  return (Math.max(0, total - segment) * Math.min(i, n - 1)) / (n - 1)
}

/** Draw-out progress (0..1, eased) of string i of n, `elapsed` seconds after drawing began. */
export function drawProgress(elapsed: number, i: number, n: number, total: number = TIMING.drawTotal, segment: number = TIMING.segment) {
  return easeOutCubic((elapsed - staggerDelay(i, n, total, segment)) / segment)
}

/** Untie progress: 1 (fully tied) down to 0 (gone). */
export function retractProgress(elapsed: number, duration: number = TIMING.retract) {
  return 1 - easeInOutQuad(elapsed / duration)
}

/** Opacity of untying strings. */
export function fadeAlpha(elapsed: number, duration: number = TIMING.retract) {
  return 1 - clamp01(elapsed / duration) ** 1.5
}

/**
 * Sag multiplier after a string goes tight: starts at TAUT, overshoots and settles to 1
 * (a damped twang).
 */
export function twangFactor(sinceTight: number) {
  if (sinceTight <= 0) return TAUT
  return 1 - (1 - TAUT) * Math.exp(-5.5 * sinceTight) * Math.cos(24 * sinceTight)
}
