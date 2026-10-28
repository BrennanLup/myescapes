import { describe, expect, it } from 'vitest'
import { stepMovement, type MoveState } from '@/player/movement'
import { clearDistance, orbitPitch, segmentBoxT, THIRD_PERSON, thirdPersonOffset } from '@/player/camera'
import type { Vec3 } from '@/contracts/scene'
import { BANNER_POS, BELL_POS, BOARD_POS, clueSlots, DR, EXIT_Z, isThroughExit, PENDANT, ROOM_RIGS, roomColliders, SPAWN } from './layout'
import { furnitureColliders } from './Furniture'
import { HIDING_SPOTS } from './search'
import { boxFromCenter } from '@/contracts/colliders'

/** Hold W (and an optional strafe) for `seconds` from `pos` facing `yaw`, with the room's colliders. */
function walk(open: boolean, from: [number, number], yaw: number, seconds: number, strafe = 0) {
  const boxes = [...roomColliders(open), ...furnitureColliders(), boxFromCenter('daily:bell-table', [BELL_POS[0], 0.35, BELL_POS[2]], [0.62, 0.7, 0.62])]
  let s: MoveState = { pos: from, vel: [0, 0], yaw, pitch: 0, bobPhase: 0 }
  let minZ = Infinity
  let maxAbsX = 0
  for (let t = 0; t < seconds; t += 1 / 30) {
    s = stepMovement(s, { forward: 1, strafe, run: false }, 1 / 30, { boxes })
    minZ = Math.min(minZ, s.pos[1])
    maxAbsX = Math.max(maxAbsX, Math.abs(s.pos[0]))
  }
  return { end: s.pos, minZ, maxAbsX }
}

describe('puzzle room layout', () => {
  it('spawns inside the room, clear of every collider, facing the door', () => {
    const [x, , z] = SPAWN.position
    expect(x).toBeGreaterThan(DR.minX)
    expect(x).toBeLessThan(DR.maxX)
    expect(z).toBeGreaterThan(DR.minZ)
    expect(z).toBeLessThan(DR.maxZ)
    for (const b of [...roomColliders(false), ...furnitureColliders()]) {
      const inside = x > b.min[0] - 0.35 && x < b.max[0] + 0.35 && z > b.min[2] - 0.35 && z < b.max[2] + 0.35
      expect(inside, b.id).toBe(false)
    }
    expect(SPAWN.yaw).toBe(0)
  })

  it('a locked door stops you at the north wall', () => {
    const r = walk(false, [SPAWN.position[0], SPAWN.position[2]], 0, 6)
    expect(r.minZ).toBeGreaterThan(DR.minZ - DR.wall)
    expect(isThroughExit([r.end[0], 1.6, r.end[1]], false)).toBe(false)
  })

  it('an open door lets you walk from the spawn down the corridor and out', () => {
    const r = walk(true, [SPAWN.position[0], SPAWN.position[2]], 0, 6)
    expect(r.minZ).toBeLessThan(EXIT_Z)
    expect(isThroughExit([r.end[0], 1.6, r.end[1]], true)).toBe(true)
    // The corridor end wall still holds you.
    expect(r.minZ).toBeGreaterThan(DR.corridorEndZ)
  })

  it('walls hold in every direction', () => {
    for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const r = walk(true, [0, 1], yaw, 6)
      expect(r.end[0]).toBeGreaterThan(DR.minX)
      expect(r.end[0]).toBeLessThan(DR.maxX)
      expect(r.end[1]).toBeLessThan(DR.maxZ)
    }
  })

  it('is never the exit while the door is closed, or beside the corridor', () => {
    expect(isThroughExit([0, 1.6, EXIT_Z - 1], false)).toBe(false)
    expect(isThroughExit([3, 1.6, EXIT_Z - 1], true)).toBe(false)
    expect(isThroughExit([0, 1.6, EXIT_Z + 0.1], true)).toBe(false)
  })

  it('puts clue posters on the west wall, inside the room, without overlapping', () => {
    for (const n of [3, 4]) {
      const slots = clueSlots(n)
      expect(slots).toHaveLength(n)
      for (const s of slots) {
        expect(s[0]).toBeCloseTo(DR.minX, 1)
        expect(s[2] - 0.5).toBeGreaterThan(DR.minZ)
        expect(s[2] + 0.5).toBeLessThan(DR.maxZ)
      }
      // Reading order left to right while facing west: decreasing z.
      for (let i = 1; i < n; i++) expect(slots[i - 1][2] - slots[i][2]).toBeGreaterThan(1.0)
    }
    expect(BOARD_POS[0]).toBeCloseTo(DR.maxX, 1)
  })

  it('keeps every hiding spot inside the room', () => {
    for (const s of HIDING_SPOTS) {
      expect(s.position[0]).toBeGreaterThanOrEqual(DR.minX)
      expect(s.position[0]).toBeLessThanOrEqual(DR.maxX)
      expect(s.position[2]).toBeGreaterThanOrEqual(DR.minZ)
      expect(s.position[2]).toBeLessThanOrEqual(DR.maxZ)
    }
  })
})

describe('third-person camera in the puzzle room', () => {
  const boxes = () => [...roomColliders(false), ...furnitureColliders()]
  const pivot: Vec3 = [SPAWN.position[0], SPAWN.position[1] - THIRD_PERSON.pivotDrop, SPAWN.position[2]]
  /** Where the camera sits at the spawn with a rig, and how much of the rig's distance it keeps. */
  function cameraAtSpawn(rig: { distance: number; side: number; up: number }) {
    const orbit = orbitPitch(SPAWN.pitch, pivot[1], rig, DR.height)
    const want = thirdPersonOffset(SPAWN.yaw, orbit, rig.distance, rig.side, rig.up)
    const len = Math.hypot(...want)
    const clear = Math.min(len, clearDistance(pivot, want, boxes()))
    const k = clear / len
    const cam: Vec3 = [pivot[0] + want[0] * k, pivot[1] + want[1] * k, pivot[2] + want[2] * k]
    return { cam, clear, len }
  }

  it('keeps (nearly) its full distance at the spawn: the south wall does not pull it into your back', () => {
    for (const rig of [ROOM_RIGS.touch, ROOM_RIGS.desktop]) {
      const { clear, len } = cameraAtSpawn(rig)
      expect(clear / len).toBeGreaterThan(0.9)
      expect(clear).toBeGreaterThan(1.9)
    }
  })

  it('the phone rig is closer and higher than the main room one', () => {
    expect(ROOM_RIGS.touch.distance).toBeLessThan(THIRD_PERSON.distance)
    expect(ROOM_RIGS.touch.up).toBeGreaterThan(THIRD_PERSON.up)
  })

  it('the pendant lamp never hides the banner above the door from the spawn', () => {
    const shade: Vec3 = [PENDANT.x, DR.height - PENDANT.drop, PENDANT.z]
    const lampBox = { min: [shade[0] - 0.4, shade[1] - 0.25, shade[2] - 0.4] as Vec3, max: [shade[0] + 0.4, shade[1] + 0.25, shade[2] + 0.4] as Vec3 }
    // The banner's corners and centre (2.0 x 0.5 m).
    const targets: Vec3[] = []
    for (const dx of [-1, 0, 1]) for (const dy of [-0.25, 0, 0.25]) targets.push([BANNER_POS[0] + dx, BANNER_POS[1] + dy, BANNER_POS[2]])
    const eyes: Vec3[] = [SPAWN.position, cameraAtSpawn(ROOM_RIGS.touch).cam, cameraAtSpawn(ROOM_RIGS.desktop).cam]
    for (const eye of eyes) for (const t of targets) expect(segmentBoxT(eye, t, lampBox), `${eye} -> ${t}`).toBeNull()
  })
})
