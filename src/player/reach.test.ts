// Cross-cutting walkability check: registers the REAL colliders from every workstream (room walls,
// living set, desk, gate door, cork board, chalkboard, wrap shelf) and walks from the exact room centre.
import { describe, expect, it } from 'vitest'
import type { AABB } from '@/contracts/colliders'
import { PLAYER } from '@/contracts/scene'
import { wallColliders } from '@/world/room/layout'
import { LIVING_COLLIDERS } from '@/world/props/living/layout'
import { deskColliders } from '@/world/props/desk/layout'
import { gateColliders } from '@/gate/colliders'
import { boardColliders } from '@/world/board/colliders'
import { wishlistColliders } from '@/world/wishlist/colliders'
import { wrapColliders } from '@/ui/wrap/colliders'
import { stepMovement, type MoveInput, type MoveState } from './movement'

function allColliders(gateOpen: boolean): AABB[] {
  return [
    ...wallColliders(),
    ...LIVING_COLLIDERS,
    ...deskColliders(),
    ...gateColliders(gateOpen),
    ...boardColliders(),
    ...wishlistColliders(),
    ...wrapColliders(),
  ]
}

const fwd: MoveInput = { forward: 1, strafe: 0, run: false }

/** Walks forward from (0, 0) at `yaw` for `seconds` and returns the straight-line distance covered. */
function reach(yaw: number, boxes: AABB[], seconds = 5): number {
  let s: MoveState = { pos: [0, 0], vel: [0, 0], yaw, pitch: 0, bobPhase: 0 }
  const dt = 1 / 60
  for (let i = 0; i < seconds / dt; i++) s = stepMovement(s, fwd, dt, { boxes })
  return Math.hypot(s.pos[0], s.pos[1])
}

const CARDINALS = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 }
const DIAGONALS = { northwest: Math.PI / 4, southwest: (3 * Math.PI) / 4, southeast: (-3 * Math.PI) / 4, northeast: -Math.PI / 4 }
const NEED = 10 * PLAYER.stepLength

describe('reach from the exact room centre with every real collider', () => {
  it('collider ids are unique across workstreams', () => {
    for (const open of [false, true]) {
      const ids = allColliders(open).map((b) => b.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  for (const open of [false, true]) {
    const boxes = allColliders(open)
    const gate = open ? 'gate open' : 'gate closed'

    it(`walks at least 10 steps (7.5 m) north, south, east and west (${gate})`, () => {
      for (const [dir, yaw] of Object.entries(CARDINALS)) expect(reach(yaw, boxes), `${dir} (${gate})`).toBeGreaterThanOrEqual(NEED)
    })

    it(`walks a good way along the diagonals too (${gate})`, () => {
      // The room is 20 x 16 m, so a diagonal ends in a corner; furniture there may stop it a little earlier.
      for (const [dir, yaw] of Object.entries(DIAGONALS)) expect(reach(yaw, boxes), `${dir} (${gate})`).toBeGreaterThanOrEqual(NEED)
    })
  }
})
