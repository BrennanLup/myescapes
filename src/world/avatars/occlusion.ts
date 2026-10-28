/**
 * When is your own character in the way? Pure maths (no three.js), unit-tested in occlusion.test.ts.
 *
 * Your character is treated as an upright capsule. It is "in the way" when the centre view ray
 * (what the reticle and the interaction ray aim at) passes through it, or when the line from the
 * camera to another player passes through it before reaching them. LocalAvatar then fades it to
 * `FADE_OPACITY` so you can see what you aim at and who you walk up to.
 */
export type V3 = readonly [number, number, number]

/** Your character as a capsule: bottom and top of the axis above the feet (metres), radius. */
export const BODY = { bottom: 0.2, top: 1.75, radius: 0.3 } as const
/** How see-through your character gets when it is in the way. */
export const FADE_OPACITY = 0.4
/** How far along the view ray to look (metres). */
const RAY_LENGTH = 30

/**
 * Closest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Returns the distance and the parameters (0..1) of the closest points on each segment.
 */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3): { dist: number; s: number; t: number } {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]]
  const d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]]
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  let s = 0
  let t = 0
  const EPS = 1e-9
  if (a <= EPS && e <= EPS) {
    s = t = 0
  } else if (a <= EPS) {
    t = clamp(f / e)
  } else {
    const c = dot(d1, r)
    if (e <= EPS) {
      s = clamp(-c / a)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom > EPS ? clamp((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp((b - c) / a)
      }
    }
  }
  const x = p1[0] + d1[0] * s - (p2[0] + d2[0] * t)
  const y = p1[1] + d1[1] * s - (p2[1] + d2[1] * t)
  const z = p1[2] + d1[2] * s - (p2[2] + d2[2] * t)
  return { dist: Math.hypot(x, y, z), s, t }
}

function axis(feet: V3): [V3, V3] {
  return [
    [feet[0], feet[1] + BODY.bottom, feet[2]],
    [feet[0], feet[1] + BODY.top, feet[2]],
  ]
}

/** Whether the view ray from `camera` along unit `forward` passes through the character at `feet`. */
export function blocksView(camera: V3, forward: V3, feet: V3): boolean {
  const end: V3 = [camera[0] + forward[0] * RAY_LENGTH, camera[1] + forward[1] * RAY_LENGTH, camera[2] + forward[2] * RAY_LENGTH]
  const [a, b] = axis(feet)
  return segmentDistance(camera, end, a, b).dist < BODY.radius
}

/**
 * Whether the character at `feet` hides another player standing at `other` (their feet): the
 * line from the camera to their chest or head passes through you on the way.
 */
export function blocksPlayer(camera: V3, feet: V3, other: V3): boolean {
  const [a, b] = axis(feet)
  for (const h of [1.2, 1.7]) {
    const target: V3 = [other[0], other[1] + h, other[2]]
    const hit = segmentDistance(camera, target, a, b)
    // Near the far end means they are beside you, not behind you.
    if (hit.dist < BODY.radius && hit.s < 0.92) return true
  }
  return false
}
