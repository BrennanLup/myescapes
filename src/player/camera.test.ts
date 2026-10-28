import { describe, expect, it } from 'vitest'
import { HALF_D, HALF_W, ROOM, type Vec3 } from '@/contracts/scene'
import {
  angleDelta,
  clearDistance,
  CRANE,
  craneAmount,
  craneSpot,
  hideDistance,
  DESKTOP_RIG,
  orbitPitch,
  pitchLimits,
  TOUCH_RIG,
  screenY,
  easeBlend,
  followDistance,
  interiorT,
  lookVector,
  rayStartDistance,
  segmentBoxT,
  stepBodyYaw,
  THIRD_PERSON,
  thirdPersonOffset,
  yawOfVelocity,
} from './camera'
import { forwardVector, MAX_PITCH } from './movement'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

describe('vectors', () => {
  it('lookVector matches the movement forward vector on the floor', () => {
    for (const yaw of [0, 0.7, -2, Math.PI]) {
      const f = lookVector(yaw, 0)
      const m = forwardVector(yaw)
      close(f[0], m[0])
      close(f[2], m[1])
      close(f[1], 0)
    }
    close(lookVector(0, Math.PI / 2)[1], 1)
  })

  it('thirdPersonOffset is behind, above and to the right', () => {
    // Looking north (-Z): behind = +Z, right = +X.
    const o = thirdPersonOffset(0, 0)
    close(o[2], THIRD_PERSON.distance)
    close(o[0], THIRD_PERSON.side)
    close(o[1], THIRD_PERSON.up)
    // Looking down tilts the camera up behind the head.
    expect(thirdPersonOffset(0, -0.5)[1]).toBeGreaterThan(THIRD_PERSON.up)
    // Zero distance and side: only the lift remains.
    const z = thirdPersonOffset(1, 0.3, 0, 0, 0)
    close(len(z), 0)
  })
})

describe('segmentBoxT', () => {
  const box = { min: [1, 0, -1] as Vec3, max: [2, 2, 1] as Vec3 }
  it('finds the entry fraction', () => {
    close(segmentBoxT([0, 1, 0], [4, 1, 0], box)!, 0.25)
    close(segmentBoxT([0, 1, 0], [4, 1, 0], box, 0.2)!, 0.2)
  })
  it('misses, stops short, or starts inside', () => {
    expect(segmentBoxT([0, 3, 0], [4, 3, 0], box)).toBeNull()
    expect(segmentBoxT([0, 1, 0], [0.5, 1, 0], box)).toBeNull()
    expect(segmentBoxT([1.5, 1, 0], [4, 1, 0], box)).toBeNull()
    // Parallel to a slab and outside it.
    expect(segmentBoxT([0, 1, 5], [4, 1, 5], box)).toBeNull()
  })
})

describe('interiorT and clearDistance', () => {
  it('keeps the camera inside the room (window openings leave gaps in the wall colliders)', () => {
    const pivot: Vec3 = [0, 1.55, HALF_D - 1]
    const t = interiorT(pivot, [0, 1.55, HALF_D + 2], undefined, 0.2)
    close(pivot[2] + t * 3, HALF_D - 0.2)
    expect(interiorT(pivot, [0, 1.55, 0])).toBe(1)
    // The floor counts too.
    close(interiorT([0, 1, 0], [0, -1, 0], undefined, 0.1), 0.45)
  })

  it('is the full length in open space', () => {
    const o = thirdPersonOffset(0, 0)
    close(clearDistance([0, 1.55, 0], o, []), len(o))
  })

  it('pulls in before a box in the way, keeping the margin', () => {
    // Looking north, the camera goes towards +Z; a box 1 m behind the head.
    const box = { min: [-1, 0, 1] as Vec3, max: [1, 3, 2] as Vec3 }
    const o = thirdPersonOffset(0, 0)
    const d = clearDistance([0, 1.55, 0], o, [box], 0.18)
    const zAtD = (d / len(o)) * o[2]
    close(zAtD, 1 - 0.18, 1e-3)
  })

  it('ignores a box the head is already inside', () => {
    const box = { min: [-1, 0, -1] as Vec3, max: [1, 3, 1] as Vec3 }
    const o = thirdPersonOffset(0, 0)
    close(clearDistance([0, 1.55, 0], o, [box], 0), len(o))
  })

  it('backed into a corner, the camera stays in the room', () => {
    const pivot: Vec3 = [HALF_W - 0.4, 1.55, HALF_D - 0.4]
    const o = thirdPersonOffset(Math.PI / 4 + Math.PI, 0) // looking towards the corner's opposite
    const d = clearDistance(pivot, o, [])
    const p = pivot.map((v, i) => v + (o[i] * d) / len(o))
    expect(p[0]).toBeLessThanOrEqual(HALF_W)
    expect(p[2]).toBeLessThanOrEqual(HALF_D)
  })
})

describe('smoothing', () => {
  it('followDistance pulls in at once and eases out', () => {
    expect(followDistance(2.6, 1, 1 / 60)).toBe(1)
    const out = followDistance(1, 2.6, 1 / 60)
    expect(out).toBeGreaterThan(1)
    expect(out).toBeLessThan(1.3)
    let d = 1
    for (let i = 0; i < 120; i++) d = followDistance(d, 2.6, 1 / 60)
    close(d, 2.6, 0.01)
  })

  it('easeBlend is clamped smoothstep', () => {
    expect(easeBlend(-1)).toBe(0)
    expect(easeBlend(2)).toBe(1)
    close(easeBlend(0.5), 0.5)
  })

  it('angleDelta wraps', () => {
    close(angleDelta(3, -3), 2 * Math.PI - 6)
    close(angleDelta(0, Math.PI / 2), Math.PI / 2)
    close(Math.abs(angleDelta(Math.PI, -Math.PI)), 0)
  })
})

describe('body yaw', () => {
  it('faces along the velocity (same convention as the look yaw)', () => {
    for (const yaw of [0, 1, -2.5]) {
      const f = forwardVector(yaw)
      close(angleDelta(yawOfVelocity(f[0], f[1]), yaw), 0)
    }
  })

  it('first person follows the look; third person turns towards the walk and holds when still', () => {
    expect(stepBodyYaw(0.3, [1, 0], 1.2, 'first', 1 / 60)).toBe(1.2)
    expect(stepBodyYaw(0.3, [0, 0], 1.2, 'third', 1 / 60)).toBe(0.3)
    let y = 0
    const v = forwardVector(-Math.PI / 2) // walking east
    for (let i = 0; i < 120; i++) y = stepBodyYaw(y, v, 0, 'third', 1 / 60)
    close(angleDelta(y, -Math.PI / 2), 0, 1e-3)
  })
})

describe('rayStartDistance', () => {
  it('is the distance along the view ray to the point nearest the eye', () => {
    const eye: Vec3 = [0, 1.6, 0]
    const o = thirdPersonOffset(0, 0)
    const cam: Vec3 = [eye[0] + o[0], eye[1] + o[1], eye[2] + o[2]]
    close(rayStartDistance(cam, lookVector(0, 0), eye), THIRD_PERSON.distance)
    expect(rayStartDistance(eye, lookVector(0, 0), eye)).toBe(0)
    // Never negative (eye behind the camera).
    expect(rayStartDistance([0, 1.6, -1], lookVector(0, 0), eye)).toBe(0)
  })
})

describe("third-person pitch (no worm's-eye view)", () => {
  const deg = (d: number) => (d * Math.PI) / 180

  it('narrows the look pitch smoothly while blending into third person', () => {
    expect(pitchLimits(0, MAX_PITCH)).toEqual([-MAX_PITCH, MAX_PITCH])
    const [lo, hi] = pitchLimits(1, MAX_PITCH)
    close(lo, -THIRD_PERSON.maxPitchDown)
    close(hi, THIRD_PERSON.maxPitchUp)
    const mid = pitchLimits(0.5, MAX_PITCH)
    expect(mid[1]).toBeLessThan(MAX_PITCH)
    expect(mid[1]).toBeGreaterThan(THIRD_PERSON.maxPitchUp)
  })

  it('never puts the camera more than minBelowPivot under the head, however far up you look', () => {
    for (const rig of [DESKTOP_RIG, TOUCH_RIG]) {
      const pivotY = 1.55
      const o = orbitPitch(THIRD_PERSON.maxPitchUp, pivotY, rig)
      expect(o).toBeLessThan(THIRD_PERSON.maxPitchUp)
      const off = thirdPersonOffset(0, o, rig.distance, rig.side, rig.up)
      expect(off[1]).toBeGreaterThanOrEqual(-THIRD_PERSON.minBelowPivot - 1e-9)
      // The camera stays well out: it tilts instead of diving to the floor.
      expect(Math.hypot(off[0], off[1], off[2])).toBeGreaterThan(rig.distance * 0.8)
    }
  })

  it('stops rising before the ceiling when looking down, instead of pulling into the head', () => {
    const pivotY = 1.55
    const o = orbitPitch(-deg(55), pivotY, DESKTOP_RIG)
    const off = thirdPersonOffset(0, o, DESKTOP_RIG.distance, DESKTOP_RIG.side, DESKTOP_RIG.up)
    expect(pivotY + off[1]).toBeLessThanOrEqual(ROOM.height - THIRD_PERSON.margin + 1e-9)
    close(clearDistance([0, pivotY, 0], off, []), len(off), 1e-6)
    // Gentle pitches are left alone.
    close(orbitPitch(deg(-10), pivotY, DESKTOP_RIG), deg(-10))
    close(orbitPitch(deg(5), pivotY, DESKTOP_RIG), deg(5))
  })

  it('touch centres the character and sits further back', () => {
    expect(TOUCH_RIG.side).toBe(0)
    expect(TOUCH_RIG.distance).toBeGreaterThan(DESKTOP_RIG.distance)
    expect(DESKTOP_RIG.tilt).toBe(0)
  })

  it('touch puts the character in the lower third, clear of the reticle, and under the ceiling', () => {
    const pivotY = 1.55
    for (const pitch of [0, deg(-10), deg(10)]) {
      const o = orbitPitch(pitch, pivotY, TOUCH_RIG)
      const off = thirdPersonOffset(0, o, TOUCH_RIG.distance, TOUCH_RIG.side, TOUCH_RIG.up)
      const cam = [off[0], pivotY + off[1], off[2]]
      expect(cam[1]).toBeLessThanOrEqual(ROOM.height - THIRD_PERSON.margin + 1e-9)
      const viewPitch = pitch - TOUCH_RIG.tilt
      // Angle below the view direction of a point straight ahead of the camera (yaw 0 looks to -Z).
      const below = (y: number) => viewPitch - Math.atan2(y - cam[1], cam[2])
      const hatTop = screenY(below(pivotY + 0.4))
      const feet = screenY(below(0))
      if (pitch === 0) {
        expect(hatTop).toBeGreaterThan(0.57)
        expect(feet).toBeLessThan(0.97)
      }
      // Never on the reticle, whatever the look pitch.
      expect(hatTop).toBeGreaterThan(0.53)
    }
  })
})

describe('crane over the head when a wall squeezes the camera (QA r3)', () => {
  it('blends in only once the normal spot is squeezed', () => {
    expect(craneAmount(3.1)).toBe(0)
    expect(craneAmount(CRANE.startBelow)).toBe(0)
    expect(craneAmount(0.9)).toBeGreaterThan(0.3)
    expect(craneAmount(0.9)).toBeLessThan(0.7)
    expect(craneAmount(CRANE.fullBelow)).toBe(1)
    expect(craneAmount(0.2)).toBe(1)
  })

  /** Angle (radians) of the head pivot below the view centre, seen from `cam` looking at `pitch` along yaw 0 (north). */
  const headBelowCentre = (cam: Vec3, pivot: Vec3, pitch: number) => {
    const depth = cam[2] - pivot[2]
    return Math.atan2(cam[1] - pivot[1], Math.max(depth, 1e-6)) + pitch
  }

  it('back to the south wall (QA r4 spot): keeps looking into the room, slides over the shoulder, head still in view', () => {
    // The QA spot: (0, 1.6, 7.4) looking north (yaw 0), so the wall is right behind.
    const pivot: Vec3 = [0, 1.55, 7.4]
    const offset = thirdPersonOffset(0, 0, DESKTOP_RIG.distance, DESKTOP_RIG.side, DESKTOP_RIG.up)
    const squeezed = clearDistance(pivot, offset, [])
    expect(squeezed).toBeLessThan(THIRD_PERSON.hideBelow)
    expect(craneAmount(squeezed)).toBe(1)
    const out: Vec3 = [0, 0, 0]
    const spot = craneSpot(pivot, 0, [], out, undefined, undefined, undefined, CRANE.side)
    // Never a top-down view: at most 25 degrees down, so the room ahead fills most of the screen.
    expect(spot.pitch).toBeGreaterThanOrEqual(-CRANE.maxTilt - 1e-9)
    expect(spot.pitch).toBeLessThanOrEqual(0)
    // Slid to the right shoulder, inside the wall margin, not straight over the head.
    close(out[0], CRANE.side)
    expect(out[2]).toBeLessThanOrEqual(HALF_D - THIRD_PERSON.margin + 1e-9)
    expect(out[2]).toBeGreaterThan(pivot[2])
    expect(out[1] - pivot[1]).toBeLessThan(0.7)
    // The head sits in the lower part of the view, still on screen, and your character shows.
    const below = headBelowCentre(out, pivot, spot.pitch)
    expect(below).toBeGreaterThan(0.15)
    expect(below).toBeLessThanOrEqual(CRANE.headLowest + 1e-6)
    expect(screenY(below)).toBeLessThan(0.9)
    expect(spot.distance).toBeGreaterThan(hideDistance(1))
    // A level look puts the reticle on the floor over 4 m ahead at the most (r3: under 2 m, at your feet).
    expect(out[1] / Math.tan(-spot.pitch)).toBeGreaterThan(4)
  })

  it('the phone rig stays centred against the wall, also looking at most 25 degrees down', () => {
    const pivot: Vec3 = [0, 1.55, 7.4]
    const out: Vec3 = [0, 0, 0]
    const spot = craneSpot(pivot, 0, [], out)
    close(out[0], 0)
    expect(spot.pitch).toBeGreaterThanOrEqual(-CRANE.maxTilt - 1e-9)
    expect(headBelowCentre(out, pivot, spot.pitch)).toBeLessThanOrEqual(CRANE.headLowest + 1e-6)
    expect(spot.distance).toBeGreaterThan(hideDistance(1))
  })

  it('pressed flat to the wall: a short over-the-shoulder view of the room, not of the floor', () => {
    // As close as the collision radius allows.
    const pivot: Vec3 = [0, 1.55, HALF_D - 0.35]
    const out: Vec3 = [0, 0, 0]
    const spot = craneSpot(pivot, 0, [], out, undefined, undefined, undefined, CRANE.side)
    expect(out[1] - pivot[1]).toBeCloseTo(CRANE.minRise)
    expect(spot.pitch).toBeGreaterThanOrEqual(-CRANE.maxTilt - 1e-9)
    // Too close to show yourself: the character hides and the room ahead fills the view.
    expect(spot.distance).toBeLessThan(hideDistance(1))
  })

  it('a corner: backs off diagonally as far as both walls allow and keeps the look pitch', () => {
    const pivot: Vec3 = [HALF_W - 0.7, 1.55, HALF_D - 0.7]
    const out: Vec3 = [0, 0, 0]
    // Looking diagonally into the room (yaw PI/4: towards -x, -z).
    const spot = craneSpot(pivot, Math.PI / 4, [], out)
    expect(out[0]).toBeLessThanOrEqual(HALF_W - THIRD_PERSON.margin + 1e-9)
    expect(out[2]).toBeLessThanOrEqual(HALF_D - THIRD_PERSON.margin + 1e-9)
    expect(out[0]).toBeGreaterThan(pivot[0])
    expect(spot.pitch).toBeGreaterThanOrEqual(-CRANE.maxTilt - 1e-9)
    expect(spot.distance).toBeGreaterThan(hideDistance(1))
  })

  it('a corner with the wall on the right shoulder: slides to the left instead', () => {
    // Back to the south wall, pressed against the east wall on the right, looking north.
    const pivot: Vec3 = [HALF_W - 0.35, 1.55, 7.4]
    const out: Vec3 = [0, 0, 0]
    craneSpot(pivot, 0, [], out, undefined, undefined, undefined, CRANE.side)
    close(out[0], pivot[0] - CRANE.side)
    // With room on the right, it keeps the right shoulder.
    craneSpot([0, 1.55, 7.4], 0, [], out, undefined, undefined, undefined, CRANE.side)
    close(out[0], CRANE.side)
  })

  it('plenty of room behind: rises up to CRANE.rise, still no steeper than 25 degrees', () => {
    const pivot: Vec3 = [0, 1.55, 0]
    const out: Vec3 = [0, 0, 0]
    const spot = craneSpot(pivot, 0, [], out)
    close(out[1], pivot[1] + CRANE.rise)
    close(out[2], CRANE.back)
    close(spot.pitch, -CRANE.maxTilt)
  })

  it('hides your character closer in while craned', () => {
    expect(hideDistance(0)).toBe(THIRD_PERSON.hideBelow)
    expect(hideDistance(1)).toBe(CRANE.hideBelow)
    expect(hideDistance(0.5)).toBeGreaterThan(CRANE.hideBelow)
    expect(hideDistance(0.5)).toBeLessThan(THIRD_PERSON.hideBelow)
  })

  it('something overhead or a low ceiling limits the rise', () => {
    const pivot: Vec3 = [0, 1.55, 0]
    const out: Vec3 = [0, 0, 0]
    const shelf = { min: [-1, 2.2, -1] as Vec3, max: [1, 2.4, 1] as Vec3 }
    craneSpot(pivot, 0, [shelf], out)
    expect(out[1]).toBeLessThanOrEqual(2.2 - THIRD_PERSON.margin + 1e-9)
    craneSpot(pivot, 0, [], out, 2.5)
    expect(out[1]).toBeCloseTo(2.5 - THIRD_PERSON.margin)
  })
})
