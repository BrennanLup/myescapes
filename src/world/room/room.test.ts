import { describe, expect, it } from 'vitest'
import { HALF_D, HALF_W, PLAYER, ROOM, WINDOWS } from '@/contracts/scene'
import { ANCHORS } from '@/contracts/scene'
import {
  WALL_IDS,
  segmentWall,
  splitAtHeight,
  wallBoxToWorld,
  wallColliders,
  wallHalfLength,
  wallOpenings,
  wallSegments,
  type Rect,
} from './layout'
import { buildRoomGeometry } from './geometry'

const area = (r: Rect) => (r.u1 - r.u0) * (r.v1 - r.v0)
const inside = (r: Rect, u: number, v: number) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1

describe('wall segmentation', () => {
  for (const wall of WALL_IDS) {
    it(`${wall}: covers the full wall minus openings exactly once`, () => {
      const L = wallHalfLength(wall)
      const segs = wallSegments(wall)
      const holes = wallOpenings(wall)
      const total = segs.reduce((a, r) => a + area(r), 0)
      const holeArea = holes.reduce((a, r) => a + area(r), 0)
      expect(total).toBeCloseTo(2 * L * ROOM.height - holeArea, 6)
      // Sample a grid: every point is either in exactly one segment or in exactly one opening.
      for (let u = -L + 0.013; u < L; u += 0.097) {
        for (let v = 0.011; v < ROOM.height; v += 0.053) {
          const inSeg = segs.filter((r) => inside(r, u, v)).length
          const inHole = holes.filter((r) => inside(r, u, v)).length
          expect(inSeg + inHole).toBe(1)
        }
      }
    })
  }

  it('cuts every window in WINDOWS', () => {
    const count = WALL_IDS.reduce((a, w) => a + wallOpenings(w).length, 0)
    expect(count).toBe(WINDOWS.length)
  })

  it('handles overlapping, edge-touching and clipped openings', () => {
    const bounds = { u0: 0, u1: 10, v0: 0, v1: 4 }
    const holes = [
      { u0: -1, u1: 1, v0: 1, v1: 2 },
      { u0: 3, u1: 5, v0: 1, v1: 3 },
      { u0: 4, u1: 6, v0: 2, v1: 4.5 },
    ]
    const segs = segmentWall(bounds, holes)
    for (let u = 0.05; u < 10; u += 0.1)
      for (let v = 0.05; v < 4; v += 0.1) {
        const inSeg = segs.filter((r) => inside(r, u, v)).length
        const inHole = holes.some((r) => inside(r, u, v))
        expect(inSeg).toBe(inHole ? 0 : 1)
      }
  })

  it('a wall without openings is one segment', () => {
    expect(segmentWall({ u0: -1, u1: 1, v0: 0, v1: 4 }, [])).toEqual([{ u0: -1, u1: 1, v0: 0, v1: 4 }])
  })

  it('splitAtHeight preserves area', () => {
    const segs = wallSegments('south')
    const { below, above } = splitAtHeight(segs, 0.9)
    const sum = (rs: Rect[]) => rs.reduce((a, r) => a + area(r), 0)
    expect(sum(below) + sum(above)).toBeCloseTo(sum(segs), 6)
    expect(below.every((r) => r.v1 <= 0.9)).toBe(true)
    expect(above.every((r) => r.v0 >= 0.9)).toBe(true)
  })

  it('wall boxes sit outside the interior', () => {
    for (const wall of WALL_IDS) {
      for (const r of wallSegments(wall)) {
        const { center, size } = wallBoxToWorld(wall, r, 0, ROOM.wallThickness)
        const minX = center[0] - size[0] / 2
        const maxX = center[0] + size[0] / 2
        const minZ = center[2] - size[2] / 2
        const maxZ = center[2] + size[2] / 2
        const outside = maxX <= -HALF_W + 1e-9 || minX >= HALF_W - 1e-9 || maxZ <= -HALF_D + 1e-9 || minZ >= HALF_D - 1e-9
        expect(outside).toBe(true)
      }
    }
  })

  it('windows keep clear of the wall anchors', () => {
    const spans: Record<string, Array<[number, number]>> = { north: [], south: [], east: [], west: [] }
    const g = ANCHORS.gateDoor
    spans.south.push([g.position[0] - g.size[0] / 2, g.position[0] + g.size[0] / 2])
    spans.east.push([ANCHORS.wishlistBoard.position[2] - 1.6, ANCHORS.wishlistBoard.position[2] + 1.6])
    spans.east.push([ANCHORS.shelves.position[2] - 1.5, ANCHORS.shelves.position[2] + 1.5])
    spans.west.push([ANCHORS.desk.position[2] - 1.2, ANCHORS.desk.position[2] + 1.2])
    spans.west.push([ANCHORS.wrapTrophy.position[2] - 0.8, ANCHORS.wrapTrophy.position[2] + 0.8])
    for (const wall of WALL_IDS)
      for (const o of wallOpenings(wall))
        for (const [a, b] of spans[wall]) expect(o.u1 <= a || o.u0 >= b).toBe(true)
  })
})

describe('wall colliders', () => {
  const boxes = wallColliders()
  const hit = (x: number, y: number, z: number) =>
    boxes.some((b) => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2])

  it('has the four ids', () => {
    expect(boxes.map((b) => b.id).sort()).toEqual(['room:wall:east', 'room:wall:north', 'room:wall:south', 'room:wall:west'])
  })

  it('never intrudes into the interior', () => {
    for (const b of boxes) {
      const overlapX = b.min[0] < HALF_W && b.max[0] > -HALF_W
      const overlapZ = b.min[2] < HALF_D && b.max[2] > -HALF_D
      expect(overlapX && overlapZ).toBe(false)
    }
  })

  it('cover the full player body height', () => {
    for (const b of boxes) {
      expect(b.min[1]).toBeLessThanOrEqual(0.1)
      expect(b.max[1]).toBeGreaterThanOrEqual(1.8)
    }
  })

  it('enclose the interior with no gaps (ring just outside the walls, corners included)', () => {
    const eps = 0.01
    const ring = PLAYER.radius
    for (const y of [0.1, 1, 1.8]) {
      for (let x = -HALF_W - ring; x <= HALF_W + ring; x += 0.05) {
        expect(hit(x, y, -HALF_D - eps)).toBe(true)
        expect(hit(x, y, HALF_D + eps)).toBe(true)
        expect(hit(x, y, -HALF_D - ring)).toBe(true)
        expect(hit(x, y, HALF_D + ring)).toBe(true)
      }
      for (let z = -HALF_D - ring; z <= HALF_D + ring; z += 0.05) {
        expect(hit(-HALF_W - eps, y, z)).toBe(true)
        expect(hit(HALF_W + eps, y, z)).toBe(true)
        expect(hit(-HALF_W - ring, y, z)).toBe(true)
        expect(hit(HALF_W + ring, y, z)).toBe(true)
      }
    }
  })
})

describe('room geometry', () => {
  it('builds a small number of merged buckets', () => {
    const geoms = buildRoomGeometry()
    expect(geoms.size).toBeLessThanOrEqual(12)
    for (const k of ['plaster', 'plasterAccent', 'floor', 'ceiling', 'glass', 'trim', 'baseboard'] as const) {
      expect(geoms.get(k)?.getAttribute('position').count).toBeGreaterThan(0)
    }
    geoms.forEach((g) => g.dispose())
  })
})
