/**
 * Layout of the Escape of the Day puzzle room (pure, no React or three.js), so tests can check
 * the colliders, the exit and where every prop stands.
 *
 * The room is an 8 x 8 m box inside the shared player bounds (the player controller always clamps to
 * the main room's 20 x 16 m interior, so this room is built inside that space and walled off with its
 * own colliders). North (-Z) holds the exit door, which leads into a short lit corridor: walking down
 * the corridor once the door is open takes you home.
 *
 *            corridor (exit trigger at z < EXIT_Z)
 *                 |  |
 *   +-------------+==+-------------+  z = -3  (north wall, door at x = 0)
 *   | clue wall                     |
 *   | (west, x = -4)   chalkboard   |
 *   |                  (east, x = 4) |
 *   |            spawn              |
 *   +-------------------------------+  z = 5
 */
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { PLAYER, type Vec3 } from '@/contracts/scene'

export const DR = {
  minX: -4,
  maxX: 4,
  minZ: -3,
  maxZ: 5,
  height: 3.2,
  wall: 0.3,
  /** Door opening in the north wall, centred on x = 0. */
  doorW: 1.1,
  doorH: 2.2,
  /** Corridor behind the door. */
  corridorHalfW: 0.95,
  corridorEndZ: -6.8,
} as const

export const ROOM_CENTER: Vec3 = [(DR.minX + DR.maxX) / 2, 0, (DR.minZ + DR.maxZ) / 2]

/** Where you stand when you enter: near the south wall, facing the door. */
export const SPAWN = { position: [0, PLAYER.eyeHeight, 3.6] as Vec3, yaw: 0, pitch: -0.04 }

/** Crossing this line (heading north, door open) takes you home. */
export const EXIT_Z = -4.5

/** Hinge of the door leaf (west edge of the opening); the leaf swings out into the corridor. */
export const DOOR_HINGE: Vec3 = [-DR.doorW / 2, 0, DR.minZ - DR.wall / 2]
export const DOOR_LEAF_T = 0.08

/** The lock box on the wall right of the door (centre of its back plate, on the wall surface). */
export const LOCK_POS: Vec3 = [1.18, 1.3, DR.minZ + 0.01]

const box = (id: string, min: Vec3, max: Vec3): AABB => ({ id, min, max })

/** Walls of the room and the corridor, plus the door leaf (closed across the opening, or open against the corridor wall). */
export function roomColliders(doorOpen: boolean): AABB[] {
  const { minX, maxX, minZ, maxZ, height: h, wall: t, doorW, corridorHalfW: cw, corridorEndZ: ez } = DR
  const half = doorW / 2
  const out: AABB[] = [
    box('daily:wall:south', [minX - t, 0, maxZ], [maxX + t, h, maxZ + t]),
    box('daily:wall:west', [minX - t, 0, minZ - t], [minX, h, maxZ + t]),
    box('daily:wall:east', [maxX, 0, minZ - t], [maxX + t, h, maxZ + t]),
    box('daily:wall:north-w', [minX - t, 0, minZ - t], [-half, h, minZ]),
    box('daily:wall:north-e', [half, 0, minZ - t], [maxX + t, h, minZ]),
    box('daily:corridor:w', [-cw - t, 0, ez], [-cw, h, minZ - t]),
    box('daily:corridor:e', [cw, 0, ez], [cw + t, h, minZ - t]),
    box('daily:corridor:end', [-cw - t, 0, ez - t], [cw + t, h, ez]),
  ]
  if (doorOpen) {
    // The open leaf stands along the corridor's west side, clear of the walking line at x = 0.
    out.push(box('daily:door', [-half - 0.08, 0, DOOR_HINGE[2] - doorW - 0.05], [-half + DOOR_LEAF_T + 0.04, DR.doorH, DOOR_HINGE[2] + 0.05]))
  } else {
    out.push(boxFromCenter('daily:door', [0, DR.doorH / 2, minZ - t / 2], [doorW + 0.1, DR.doorH, t]))
  }
  return out
}

/** True once the player has walked out through the open door. */
export function isThroughExit(pos: Vec3 | readonly number[], doorOpen: boolean): boolean {
  return doorOpen && pos[2] < EXIT_Z && Math.abs(pos[0]) < DR.corridorHalfW + 0.1
}

/** Wall slots for clue posters on the west wall (centre of each poster, world space). */
export function clueSlots(n: number): Vec3[] {
  const span = Math.min(6.4, 1.55 * n)
  const z0 = (DR.minZ + DR.maxZ) / 2 - span / 2 + span / (2 * n)
  return Array.from({ length: n }, (_, i) => [DR.minX + 0.03, 1.65, z0 + (i * span) / n] as Vec3)
}

/** The guess board (chalkboard) on the east wall. */
export const BOARD_POS: Vec3 = [DR.maxX - 0.03, 1.75, 0.6]
export const BOARD_SIZE: [number, number] = [2.6, 1.7]

/** The hint bell on its little table (floor point), east side near the entrance. */
export const BELL_POS: Vec3 = [2.55, 0, 3.0]

/** Brass plaque with today's number and theme, on the wall left of the door (centre, wall surface). */
export const PLAQUE_POS: Vec3 = [-1.3, 1.55, DR.minZ + 0.01]

/** The banner above the door (cipher word, or the room's name). */
export const BANNER_POS: Vec3 = [0, 2.72, DR.minZ + 0.03]
