import { describe, expect, it } from 'vitest'
import type { AABB } from '@/contracts/colliders'
import { ANCHORS, HALF_D, HALF_W, LAMPS, PLAYER, ROOM } from '@/contracts/scene'
import { LIVING_COLLIDERS } from './layout'
import { buildLivingSet } from './set'
import { bookCoverGeometry, bookPagesGeometry } from './shelf'

type P = [number, number]

/** Clear walking paths (x, z polylines) with a 1.5 m wide corridor (0.75 m half-width). */
const SPAWN: P = [ANCHORS.spawn.position[0], ANCHORS.spawn.position[2]]
const PATHS: Record<string, P[]> = {
  board: [SPAWN, [0, -7.0]],
  door: [SPAWN, [0, 7.6]],
  desk: [SPAWN, [-8.2, -3]],
  wishlist: [SPAWN, [0, -2.6], [8.8, -3]],
}
const HALF_PATH = 0.75

/** Other workstreams' footprints (x/z rectangles incl. a standing zone in front). */
const FOOTPRINTS: Record<string, { min: P; max: P }> = {
  board: { min: [-4.6, -HALF_D], max: [4.6, -7.0] },
  desk: { min: [-HALF_W, -4.5], max: [-7.6, -1.5] },
  wishlist: { min: [8.6, -4.6], max: [HALF_W, -1.4] },
  gate: { min: [-0.7, 6.6], max: [0.7, HALF_D] },
  trophy: { min: [-HALF_W, 2.7], max: [-9.0, 4.3] },
}

function rectSegDistance(b: AABB, a: P, c: P): number {
  // Sample the segment densely; boxes are small so 5 cm steps are plenty.
  const len = Math.hypot(c[0] - a[0], c[1] - a[1])
  const n = Math.max(2, Math.ceil(len / 0.05))
  let best = Infinity
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a[0] + (c[0] - a[0]) * t
    const z = a[1] + (c[1] - a[1]) * t
    const dx = Math.max(b.min[0] - x, 0, x - b.max[0])
    const dz = Math.max(b.min[2] - z, 0, z - b.max[2])
    best = Math.min(best, Math.hypot(dx, dz))
  }
  return best
}

describe('living colliders', () => {
  it('ids are unique and namespaced', () => {
    const ids = LIVING_COLLIDERS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('living:')).toBe(true)
    for (const name of ['couch', 'coffee-table', 'side-table', 'floor-lamp', 'bookshelf']) expect(ids).toContain(`living:${name}`)
    expect(ids.filter((i) => i.includes('plant')).length).toBeGreaterThanOrEqual(5)
    expect(ids.filter((i) => i.includes('beanbag')).length).toBeGreaterThanOrEqual(2)
  })

  it('every box is inside the room and well-formed', () => {
    for (const c of LIVING_COLLIDERS) {
      expect(c.min[0], c.id).toBeGreaterThanOrEqual(-HALF_W)
      expect(c.max[0], c.id).toBeLessThanOrEqual(HALF_W)
      expect(c.min[2], c.id).toBeGreaterThanOrEqual(-HALF_D)
      expect(c.max[2], c.id).toBeLessThanOrEqual(HALF_D)
      expect(c.min[1], c.id).toBeGreaterThanOrEqual(0)
      expect(c.max[1], c.id).toBeLessThanOrEqual(ROOM.height)
      for (let k = 0; k < 3; k++) expect(c.max[k], c.id).toBeGreaterThan(c.min[k])
    }
  })

  it('keeps a 1.5 m path clear from spawn to the board, desk, wishlist and door', () => {
    for (const [name, pts] of Object.entries(PATHS)) {
      for (let i = 0; i < pts.length - 1; i++) {
        for (const c of LIVING_COLLIDERS) {
          expect(rectSegDistance(c, pts[i], pts[i + 1]), `${c.id} blocks path to ${name}`).toBeGreaterThan(HALF_PATH)
        }
      }
    }
  })

  it("stays out of other anchors' footprints", () => {
    for (const [name, f] of Object.entries(FOOTPRINTS)) {
      for (const c of LIVING_COLLIDERS) {
        const overlap = c.min[0] < f.max[0] && c.max[0] > f.min[0] && c.min[2] < f.max[1] && c.max[2] > f.min[1]
        expect(overlap, `${c.id} overlaps ${name}`).toBe(false)
      }
    }
  })

  it('nothing stands squarely on the room centre lines (x = 0, z = 0)', () => {
    // A box that only grazes a line (like the orange bean bag) just nudges the player aside, but one
    // that covers the line itself stops a straight walk from the centre dead (the old floor lamp did).
    const band = 0.15
    for (const c of LIVING_COLLIDERS) {
      expect(c.min[2] < band && c.max[2] > -band, `${c.id} sits on the z = 0 line`).toBe(false)
      expect(c.min[0] < band && c.max[0] > -band, `${c.id} sits on the x = 0 line`).toBe(false)
    }
    // The floor lamp keeps a full player radius off the line, so the walk east is not even nudged.
    const lamp = LIVING_COLLIDERS.find((c) => c.id === 'living:floor-lamp')!
    expect(lamp.min[2]).toBeGreaterThan(PLAYER.radius)
  })

  it('stands the floor lamp just behind the north end of the couch', () => {
    const lamp = LIVING_COLLIDERS.find((c) => c.id === 'living:floor-lamp')!
    const couch = LIVING_COLLIDERS.find((c) => c.id === 'living:couch')!
    // Behind the couch back (the couch faces -X, towards the room).
    expect(lamp.min[0]).toBeGreaterThanOrEqual(couch.max[0])
    expect(lamp.min[0] - couch.max[0]).toBeLessThan(0.3)
    // Level with the couch's north end, so the shade hangs over the arm as a reading light.
    expect(LAMPS.floorLamp[2]).toBeGreaterThan(couch.min[2])
    expect(LAMPS.floorLamp[2]).toBeLessThan(couch.min[2] + 0.6)
  })

  it('colliders do not overlap each other', () => {
    const cs = LIVING_COLLIDERS
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i]
        const b = cs[j]
        const o = a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2]
        expect(o, `${a.id} vs ${b.id}`).toBe(false)
      }
  })
})

describe('living set geometry', () => {
  const set = buildLivingSet()

  it('lamp shades sit exactly at the LAMPS positions', () => {
    const check = (mark: string, p: readonly number[]) => {
      const m = set.marks.get(mark)
      expect(m, mark).toBeDefined()
      for (let k = 0; k < 3; k++) expect(m![k]).toBeCloseTo(p[k], 5)
    }
    check('floorLampShade', LAMPS.floorLamp)
    check('pendantA', LAMPS.pendantA)
    check('pendantB', LAMPS.pendantB)
  })

  it('stays under the draw-call budget', () => {
    // One mesh per merged (material, shadow) bucket + three instanced meshes (book covers, page blocks, records).
    expect(set.parts.length + 3).toBeLessThan(60)
    expect(set.books.length).toBeGreaterThan(60)
    expect(set.books.filter((b) => b.kind === 'record').length).toBeGreaterThan(0)
  })

  it('stays within the triangle budget for phones', () => {
    const merged = set.parts.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0)
    const cover = bookCoverGeometry()
    const pages = bookPagesGeometry()
    const books = set.books.filter((b) => b.kind !== 'record').length
    const bookTris = books * (cover.attributes.position.count / 3 + (pages.index?.count ?? 0) / 3)
    expect(merged + bookTris).toBeLessThan(200_000)
  })

  it('geometry is finite with unit normals and UVs (merge-safe)', () => {
    for (const p of set.parts) {
      expect(p.geometry.attributes.uv, p.key).toBeDefined()
      const pos = p.geometry.attributes.position.array
      const nrm = p.geometry.attributes.normal.array
      let bad = 0
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++
      for (let i = 0; i < nrm.length; i += 3) if (!(Math.abs(Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) - 1) < 0.02)) bad++
      expect(bad, p.key).toBe(0)
    }
  })

  it('main furniture casts shadows', () => {
    for (const m of ['fabricPlum', 'woodLight', 'woodDark', 'fabricOrange', 'fabricTeal'] as const)
      expect(set.parts.some((p) => p.mat === m && p.castShadow), m).toBe(true)
  })

  it('emissive lamp parts never cast shadows', () => {
    for (const p of set.parts) if (p.mat === 'emissiveWarm') expect(p.castShadow).toBe(false)
  })
})
