/**
 * Smooth movement for other players (Phase 3, workstream C).
 *
 * The server sends each player's pose at most 10 times a second, stamped with server time, and
 * only when it changed. `PoseBuffer` keeps a short history per player and is sampled a little in
 * the past (`INTERP_DELAY_MS`), so there are almost always two poses around the render time to
 * blend between: position is lerped, yaw takes the short way round (slerp on the circle).
 *
 * Gaps: a player who stood still sends nothing, so a new pose after a pause is anchored by a copy
 * of the previous one just before it; that way they start walking when they really did instead of
 * gliding across the whole pause. Big jumps (a teleport) snap. Past the newest pose the buffer
 * extrapolates a little while the player was moving, then holds.
 *
 * Pure (no three.js, no timers): tested in interpolation.test.ts.
 */
import { REALTIME_LIMITS, type Animation, type CameraMode, type PlayerState } from '@/contracts/realtime'

/** How far in the past remote players are drawn. About one broadcast interval of safety. */
export const INTERP_DELAY_MS = 100
/** Keep at most this many poses per player. */
export const MAX_SNAPSHOTS = 24
/** Past the newest pose, keep moving along the last velocity for at most this long. */
export const MAX_EXTRAPOLATE_MS = 150
/** A jump longer than this (metres) between two poses is a teleport: snap instead of sliding. */
export const SNAP_DISTANCE = 3
/** Two poses further apart than this (ms) are a pause, not one movement. */
export const GAP_MS = REALTIME_LIMITS.STATE_BROADCAST_MS * 2.5

export interface Snapshot {
  /** Server time, ms. */
  at: number
  s: PlayerState
}

export interface SampledPose {
  p: [number, number, number]
  yaw: number
  pitch: number
  /** Horizontal speed, m/s (from the pose, else from the movement between poses). */
  speed: number
  anim: Animation
  cam: CameraMode
}

const TAU = Math.PI * 2

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU
  if (r <= -Math.PI) r += TAU
  else if (r > Math.PI) r -= TAU
  return r
}

/** Interpolate between two angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function distance2D(a: PlayerState, b: PlayerState): number {
  return Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2])
}

function poseOf(s: PlayerState, speed = s.v ?? 0): SampledPose {
  return { p: [s.p[0], s.p[1], s.p[2]], yaw: s.yaw, pitch: s.pitch, speed, anim: s.anim, cam: s.cam }
}

export class PoseBuffer {
  private snaps: Snapshot[] = []
  /** The pose received just before the newest one (kept for extrapolation after it is dropped). */
  private beforeLatest: Snapshot | null = null

  get size(): number {
    return this.snaps.length
  }

  /** The newest pose received, or null. */
  latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null
  }

  clear(): void {
    this.snaps = []
    this.beforeLatest = null
  }

  /** Add a pose stamped with server time `at`. Out-of-order and duplicate stamps are ignored. */
  push(at: number, s: PlayerState): void {
    const last = this.latest()
    if (last && at <= last.at) {
      // Same stamp (e.g. the join snapshot and a broadcast): the newer message wins.
      if (at === last.at) last.s = s
      return
    }
    this.beforeLatest = last
    if (last) {
      if (distance2D(last.s, s) > SNAP_DISTANCE) {
        // Teleport: forget the path so the player appears at the new spot.
        this.snaps = []
        this.beforeLatest = null
      } else if (at - last.at > GAP_MS) {
        // A pause: hold the old pose until just before the new one.
        const anchorAt = at - REALTIME_LIMITS.STATE_BROADCAST_MS
        if (anchorAt > last.at) this.snaps.push({ at: anchorAt, s: { ...last.s, v: 0, anim: last.s.anim === 'emote' ? 'emote' : 'idle' } })
      }
    }
    this.snaps.push({ at, s })
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.splice(0, this.snaps.length - MAX_SNAPSHOTS)
  }

  /**
   * The pose at server time `t` (normally `serverNow - INTERP_DELAY_MS`). Null when nothing has
   * been received yet. Also drops poses that are too old to matter.
   */
  sample(t: number): SampledPose | null {
    const snaps = this.snaps
    if (!snaps.length) return null
    // Drop everything before the last pose at or before t (it is the start of the current segment).
    let i = 0
    while (i + 1 < snaps.length && snaps[i + 1].at <= t) i++
    if (i > 0) snaps.splice(0, i)

    const a = snaps[0]
    if (t <= a.at || snaps.length === 1) {
      if (snaps.length === 1 && t > a.at) return this.extrapolate(t)
      return poseOf(a.s)
    }
    const b = snaps[1]
    const span = b.at - a.at
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.at) / span)) : 1
    const moved = distance2D(a.s, b.s)
    const measured = span > 0 ? (moved / span) * 1000 : 0
    const speed = b.s.v ?? a.s.v ?? measured
    return {
      p: [lerp(a.s.p[0], b.s.p[0], k), lerp(a.s.p[1], b.s.p[1], k), lerp(a.s.p[2], b.s.p[2], k)],
      yaw: lerpAngle(a.s.yaw, b.s.yaw, k),
      pitch: lerp(a.s.pitch, b.s.pitch, k),
      speed: lerp(a.s.v ?? speed, b.s.v ?? speed, k),
      anim: k < 0.5 ? a.s.anim : b.s.anim,
      cam: b.s.cam,
    }
  }

  /** Only the newest pose is left and t is past it: carry on a little along the last movement. */
  private extrapolate(t: number): SampledPose {
    const last = this.snaps[0]
    const prev = this.beforeLatest
    const pose = poseOf(last.s)
    if (!prev || (last.s.v ?? 0) < 0.1) return pose
    const span = last.at - prev.at
    if (span <= 0 || span > GAP_MS) return pose
    const ahead = Math.min(t - last.at, MAX_EXTRAPOLATE_MS) / span
    pose.p = [last.s.p[0] + (last.s.p[0] - prev.s.p[0]) * ahead, last.s.p[1], last.s.p[2] + (last.s.p[2] - prev.s.p[2]) * ahead]
    return pose
  }
}
