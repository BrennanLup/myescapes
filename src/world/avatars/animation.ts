/**
 * Procedural character animation: a pure pose function of time, walk phase and speed (no three.js;
 * unit-tested). The Character component applies the pose to its joints every frame.
 *
 * Actions are what remote players broadcast (workstream C): `idle` and `walk` come from speed,
 * `wave`, `cheer` and `dance` are emotes that play over the top.
 */
import { PLAYER } from '@/contracts/scene'

export const CHARACTER_ACTIONS = ['idle', 'walk', 'wave', 'cheer', 'dance'] as const
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number]
export type CharacterEmote = Extract<CharacterAction, 'wave' | 'cheer' | 'dance'>

/** Joint angles in radians (x = swing forward/back, z = out to the side), offsets in metres. */
export interface Pose {
  hipL: number
  hipR: number
  kneeL: number
  kneeR: number
  /** Shoulder swing forward (+) / back (-). */
  shoulderL: number
  shoulderR: number
  /** Arm raised out to the side (+ = away from the body). */
  armOutL: number
  armOutR: number
  elbowL: number
  elbowR: number
  /** Whole-body vertical bob. */
  bob: number
  /** Body roll (side sway) and forward lean. */
  sway: number
  lean: number
  /** Body turn around Y (dance twist). */
  twist: number
  /** Head tilt down (+) / up (-), and side tilt. */
  headPitch: number
  headRoll: number
}

/** Metres per full walk cycle (two steps). */
export const STRIDE = PLAYER.stepLength * 2

/** Advance the walk phase (radians) by the distance walked this frame. */
export function advancePhase(phase: number, speed: number, dt: number): number {
  return (phase + (Math.max(0, speed) * Math.max(0, dt) * Math.PI * 2) / STRIDE) % (Math.PI * 2)
}

/** 0 at rest, 1 at walking speed, up to ~1.5 running. */
export function walkAmount(speed: number): number {
  return Math.min(1.5, Math.max(0, speed) / PLAYER.walkSpeed)
}

export interface PoseInput {
  /** Seconds (any running clock). */
  time: number
  /** Walk phase from advancePhase. */
  phase: number
  speed: number
  action?: CharacterAction
  /** Look pitch (the head follows it a little). */
  lookPitch?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function poseAt({ time, phase, speed, action = 'idle', lookPitch = 0 }: PoseInput): Pose {
  const w = walkAmount(speed)
  const swing = Math.sin(phase)
  const legAmp = 0.55 * Math.min(1, w) + 0.15 * Math.max(0, w - 1)
  const armAmp = 0.45 * Math.min(1, w) + 0.2 * Math.max(0, w - 1)
  const breathe = Math.sin(time * 2.1)
  const idle = 1 - Math.min(1, w * 2)

  const p: Pose = {
    hipL: swing * legAmp,
    hipR: -swing * legAmp,
    // Knees bend on the back swing of each leg.
    kneeL: Math.max(0, -Math.cos(phase)) * legAmp * 1.1,
    kneeR: Math.max(0, Math.cos(phase)) * legAmp * 1.1,
    shoulderL: -swing * armAmp,
    shoulderR: swing * armAmp,
    armOutL: 0.08 + idle * 0.02 * breathe,
    armOutR: 0.08 + idle * 0.02 * breathe,
    elbowL: 0.15 + 0.35 * Math.min(1, w),
    elbowR: 0.15 + 0.35 * Math.min(1, w),
    bob: Math.abs(Math.cos(phase)) * 0.035 * Math.min(1, w) + idle * 0.006 * breathe,
    sway: Math.sin(phase) * 0.03 * Math.min(1, w),
    lean: 0.06 * Math.max(0, w - 0.3),
    twist: 0,
    headPitch: clamp(-lookPitch * 0.45, -0.35, 0.4),
    headRoll: idle * 0.02 * Math.sin(time * 0.7),
  }

  // Emotes play on top of standing or walking; they own the arms.
  if (action === 'wave') {
    p.armOutR = 2.5 + Math.sin(time * 9) * 0.35
    p.shoulderR = 0
    p.elbowR = 0.5 + Math.sin(time * 9) * 0.25
    p.headRoll = -0.08
  } else if (action === 'cheer') {
    const hop = Math.max(0, Math.sin(time * 7))
    p.armOutL = 2.7 + Math.sin(time * 7) * 0.15
    p.armOutR = 2.7 + Math.sin(time * 7) * 0.15
    p.shoulderL = p.shoulderR = 0
    p.elbowL = p.elbowR = 0.2
    p.bob += hop * 0.09
    p.headPitch = -0.2
  } else if (action === 'dance') {
    const beat = time * 6
    p.sway = Math.sin(beat) * 0.12
    p.twist = Math.sin(beat / 2) * 0.35
    p.bob += Math.abs(Math.sin(beat)) * 0.05
    p.armOutL = 1.2 + Math.sin(beat) * 0.6
    p.armOutR = 1.2 - Math.sin(beat) * 0.6
    p.elbowL = p.elbowR = 1.1
    p.shoulderL = p.shoulderR = 0.3
    p.hipL = w < 0.2 ? Math.max(0, Math.sin(beat)) * 0.3 : p.hipL
    p.kneeL = w < 0.2 ? Math.max(0, Math.sin(beat)) * 0.5 : p.kneeL
    p.hipR = w < 0.2 ? Math.max(0, -Math.sin(beat)) * 0.3 : p.hipR
    p.kneeR = w < 0.2 ? Math.max(0, -Math.sin(beat)) * 0.5 : p.kneeR
    p.headRoll = Math.sin(beat) * 0.1
  }
  return p
}

/** idle or walk from speed (what a remote player shows when no emote is playing). */
export function locomotionAction(speed: number): CharacterAction {
  return speed > 0.3 ? 'walk' : 'idle'
}
