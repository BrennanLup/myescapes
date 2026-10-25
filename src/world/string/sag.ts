/** Pure: the hanging-string curve. A parabola is close enough to a catenary for short, taut string. */

/** Drop at the midpoint as a fraction of the span length. */
export const SAG_RATIO = 0.045
/** Never droop more than this (metres), even for very long spans. */
export const MAX_DROP = 0.09

export function sagDrop(length: number, factor = 1) {
  return Math.min(MAX_DROP, Math.max(0, length) * SAG_RATIO) * factor
}

/** Writes the curve point at parameter t (0 = a, 1 = b) into out[o..o+2]. */
export function sagPointInto(
  out: { [i: number]: number },
  o: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
  drop: number,
) {
  out[o] = ax + (bx - ax) * t
  out[o + 1] = ay + (by - ay) * t - 4 * drop * t * (1 - t)
  out[o + 2] = az + (bz - az) * t
}

/** Convenience (allocates): n points from a to b, sagging by `drop` at the middle. */
export function sagCurve(a: readonly number[], b: readonly number[], n: number, drop: number): [number, number, number][] {
  const pts: [number, number, number][] = []
  const tmp = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    sagPointInto(tmp, 0, a[0], a[1], a[2], b[0], b[1], b[2], n === 1 ? 0 : i / (n - 1), drop)
    pts.push([tmp[0], tmp[1], tmp[2]])
  }
  return pts
}
