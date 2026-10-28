/**
 * Pure geometry for the room's "air": the moonlight shaft volumes through the windows and the
 * boxes the dust motes float in. No React; `Atmosphere.tsx` turns these into meshes.
 */
import { HALF_D, HALF_W, WINDOWS, type Vec3 } from '@/contracts/scene'
import { moonDirection } from './rig'

export interface Shaft {
  id: string
  /** The window opening's four corners on the interior wall face (bottom-left, bottom-right, top-right, top-left). */
  window: [Vec3, Vec3, Vec3, Vec3]
  /** The same corners pushed along the moonlight until they reach the floor. */
  floor: [Vec3, Vec3, Vec3, Vec3]
}

/** Interior-face corners of a window, in a consistent winding. */
export function windowCorners(w: (typeof WINDOWS)[number]): [Vec3, Vec3, Vec3, Vec3] {
  const u0 = w.center - w.width / 2
  const u1 = w.center + w.width / 2
  const v0 = w.bottom
  const v1 = w.bottom + w.height
  const at = (u: number, v: number): Vec3 => {
    switch (w.wall) {
      case 'north':
        return [u, v, -HALF_D]
      case 'south':
        return [u, v, HALF_D]
      case 'east':
        return [HALF_W, v, u]
      case 'west':
        return [-HALF_W, v, u]
    }
  }
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
}

const INWARD: Record<string, Vec3> = { north: [0, 0, 1], south: [0, 0, -1], east: [-1, 0, 0], west: [1, 0, 0] }

/** Moonlight shafts for every window the moon shines into whose beam lands on this room's floor. */
export function moonShafts(dir: Vec3 = moonDirection()): Shaft[] {
  const out: Shaft[] = []
  WINDOWS.forEach((w, i) => {
    const n = INWARD[w.wall]
    // Light must travel into the room through this wall.
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] <= 0.05) return
    const win = windowCorners(w)
    const floor = win.map((p) => {
      const t = p[1] / -dir[1]
      return [p[0] + dir[0] * t, 0, p[2] + dir[2] * t] as Vec3
    }) as Shaft['floor']
    // A grazing beam that would end beyond another wall is mostly blocked: skip it.
    if (floor.some((p) => Math.abs(p[0]) > HALF_W || Math.abs(p[2]) > HALF_D)) return
    out.push({ id: `${w.wall}-${i}`, window: win, floor })
  })
  return out
}

/** Axis-aligned box around a shaft, shrunk to the room interior: where its dust floats. */
export function shaftBounds(s: Shaft): { center: Vec3; size: Vec3 } {
  const pts = [...s.window, ...s.floor]
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])))
  const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])))
  const lim = [HALF_W - 0.2, 4, HALF_D - 0.2]
  for (const k of [0, 2]) {
    min[k] = Math.max(min[k], -lim[k])
    max[k] = Math.min(max[k], lim[k])
  }
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  }
}
