/**
 * Mutable, non-reactive per-frame state shared between systems (things that
 * change every frame and must not trigger React renders).
 *
 * Owned by the orchestrator.
 */
import type { Vec3 } from './scene'
import { ANCHORS } from './scene'

export interface PlayerPose {
  /** Eye position, world space. */
  position: Vec3
  /** Yaw in radians; 0 looks towards -Z (north). Positive turns left (counter-clockwise from above). */
  yaw: number
  /** Pitch in radians; positive looks up. */
  pitch: number
  /** True while the player is walking (audio footsteps, head bob). */
  moving: boolean
  /** Horizontal speed m/s. */
  speed: number
}

export const runtime = {
  player: {
    position: [...ANCHORS.spawn.position] as Vec3,
    yaw: ANCHORS.spawn.rotationY,
    pitch: 0,
    moving: false,
    speed: 0,
  } as PlayerPose,
  /** Set by anyone (tests, gate, UI); consumed by the player controller on its next frame. */
  pendingTeleport: null as null | { position: Vec3; yaw?: number; pitch?: number },
  /**
   * Live world positions of each pinned photo's pin head, keyed by roomId.
   * Written every frame by the board (while animating), read by the red string.
   */
  pinPositions: new Map<string, Vec3>(),
  /** Smoothed frames per second, written by the shell's perf monitor. */
  fps: 0,
  /** Touch joystick vector (x = strafe right, y = forward), each in [-1, 1]. Written by mobile UI, read by player. */
  joystick: { x: 0, y: 0 },
  /** Touch look delta accumulator in pixels; the player consumes and zeroes it each frame. */
  lookDelta: { x: 0, y: 0 },
}

export function requestTeleport(position: Vec3, yaw?: number, pitch?: number) {
  runtime.pendingTeleport = { position, yaw, pitch }
}
