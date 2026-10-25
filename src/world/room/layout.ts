/**
 * Pure layout maths for the room shell (no three.js), so it can be unit tested.
 *
 * Wall-local coordinates: `u` runs along the wall in the world axis that the
 * wall spans (world X for north/south, world Z for east/west), `v` is height
 * above the floor. Openings (windows) are rectangles in (u, v).
 */
import { HALF_D, HALF_W, ROOM, WINDOWS, type Vec3, type WallId } from '@/contracts/scene'
import type { AABB } from '@/contracts/colliders'

export interface Rect {
  u0: number
  u1: number
  v0: number
  v1: number
}

export const WALL_IDS: WallId[] = ['north', 'south', 'east', 'west']

/** Height of the two-tone wainscot (lower accent band) and its chair rail. */
export const WAINSCOT_HEIGHT = 0.9
/** Collider thickness. Thick so a fast player can never tunnel through. */
export const COLLIDER_THICKNESS = 1

/** Half the wall's length along u (interior extent). */
export function wallHalfLength(wall: WallId): number {
  return wall === 'north' || wall === 'south' ? HALF_W : HALF_D
}

/** Window openings for one wall as (u, v) rectangles. */
export function wallOpenings(wall: WallId, windows = WINDOWS): Rect[] {
  return windows
    .filter((w) => w.wall === wall)
    .map((w) => ({ u0: w.center - w.width / 2, u1: w.center + w.width / 2, v0: w.bottom, v1: w.bottom + w.height }))
}

/**
 * Splits the rectangle [u0,u1] x [v0,v1] into non-overlapping rectangles that
 * cover it minus the openings. Works by slicing the wall into vertical columns
 * at every opening edge, then emitting the solid v-intervals of each column.
 * Adjacent columns with identical v-intervals are merged to keep the count low.
 */
export function segmentWall(bounds: Rect, openings: Rect[]): Rect[] {
  const clipped = openings
    .map((o) => ({
      u0: Math.max(o.u0, bounds.u0),
      u1: Math.min(o.u1, bounds.u1),
      v0: Math.max(o.v0, bounds.v0),
      v1: Math.min(o.v1, bounds.v1),
    }))
    .filter((o) => o.u1 > o.u0 && o.v1 > o.v0)
  const us = [...new Set([bounds.u0, bounds.u1, ...clipped.flatMap((o) => [o.u0, o.u1])])].sort((a, b) => a - b)

  const out: Rect[] = []
  // Open rectangles from the previous column, keyed by "v0:v1", for merging.
  let prev = new Map<string, Rect>()
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i]
    const b = us[i + 1]
    if (b - a < 1e-9) continue
    const mid = (a + b) / 2
    const holes = clipped
      .filter((o) => o.u0 <= mid && o.u1 >= mid)
      .map((o) => [o.v0, o.v1] as const)
      .sort((x, y) => x[0] - y[0])
    // Solid intervals = [v0,v1] minus the union of holes.
    const solids: Array<[number, number]> = []
    let cursor = bounds.v0
    for (const [h0, h1] of holes) {
      if (h0 > cursor) solids.push([cursor, h0])
      cursor = Math.max(cursor, h1)
    }
    if (cursor < bounds.v1) solids.push([cursor, bounds.v1])

    const next = new Map<string, Rect>()
    for (const [v0, v1] of solids) {
      const key = `${v0}:${v1}`
      const open = prev.get(key)
      if (open && Math.abs(open.u1 - a) < 1e-9) {
        open.u1 = b
        next.set(key, open)
      } else {
        const r = { u0: a, u1: b, v0, v1 }
        out.push(r)
        next.set(key, r)
      }
    }
    prev = next
  }
  return out
}

/** Splits rectangles horizontally at height `v` (used for the two-tone wainscot). */
export function splitAtHeight(rects: Rect[], v: number): { below: Rect[]; above: Rect[] } {
  const below: Rect[] = []
  const above: Rect[] = []
  for (const r of rects) {
    if (r.v1 <= v) below.push(r)
    else if (r.v0 >= v) above.push(r)
    else {
      below.push({ ...r, v1: v })
      above.push({ ...r, v0: v })
    }
  }
  return { below, above }
}

/** Solid wall pieces for one wall (full interior length, floor to ceiling, minus windows). */
export function wallSegments(wall: WallId): Rect[] {
  const L = wallHalfLength(wall)
  return segmentWall({ u0: -L, u1: L, v0: 0, v1: ROOM.height }, wallOpenings(wall))
}

/**
 * Converts a wall-local box (u range, v range, depth range `d` measured from
 * the interior face: d=0 on the face, positive = outwards into the wall)
 * to a world-space centre and size.
 */
export function wallBoxToWorld(wall: WallId, r: Rect, d0: number, d1: number): { center: Vec3; size: Vec3 } {
  const uc = (r.u0 + r.u1) / 2
  const vc = (r.v0 + r.v1) / 2
  const du = r.u1 - r.u0
  const dv = r.v1 - r.v0
  const dd = Math.abs(d1 - d0)
  const dc = (d0 + d1) / 2
  switch (wall) {
    case 'north':
      return { center: [uc, vc, -HALF_D - dc], size: [du, dv, dd] }
    case 'south':
      return { center: [uc, vc, HALF_D + dc], size: [du, dv, dd] }
    case 'east':
      return { center: [HALF_W + dc, vc, uc], size: [dd, dv, du] }
    case 'west':
      return { center: [-HALF_W - dc, vc, uc], size: [dd, dv, du] }
  }
}

/** Thick, full-height colliders outside the interior bounds. They overlap at the corners. */
export function wallColliders(thickness = COLLIDER_THICKNESS): AABB[] {
  const H = ROOM.height
  const t = thickness
  return [
    { id: 'room:wall:north', min: [-HALF_W - t, 0, -HALF_D - t], max: [HALF_W + t, H, -HALF_D] },
    { id: 'room:wall:south', min: [-HALF_W - t, 0, HALF_D], max: [HALF_W + t, H, HALF_D + t] },
    { id: 'room:wall:east', min: [HALF_W, 0, -HALF_D - t], max: [HALF_W + t, H, HALF_D + t] },
    { id: 'room:wall:west', min: [-HALF_W - t, 0, -HALF_D - t], max: [-HALF_W, H, HALF_D + t] },
  ]
}

/** Small deterministic PRNG (mulberry32) for plank joints and skyline. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
