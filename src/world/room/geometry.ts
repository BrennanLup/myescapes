/**
 * Builds the room's static geometry, merged into one BufferGeometry per
 * material bucket so the whole shell costs roughly a dozen draw calls.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ANCHORS, HALF_D, HALF_W, LED_STRIPS, ROOM, type Vec3, type WallId } from '@/contracts/scene'
import {
  WAINSCOT_HEIGHT,
  WALL_IDS,
  splitAtHeight,
  wallBoxToWorld,
  wallHalfLength,
  wallOpenings,
  wallSegments,
  type Rect,
} from './layout'

export type Bucket =
  | 'plaster'
  | 'plasterAccent'
  | 'baseboard'
  | 'trim'
  | 'beams'
  | 'floor'
  | 'ceiling'
  | 'glass'
  | 'housing'

/** UV units per metre for the room shell's world-planar UVs (1 UV unit = 2 m). */
export const UV_PER_METRE = 0.5

/** World-planar UVs in metres * scale, picked per vertex by the dominant normal axis. */
function planarUV(g: THREE.BufferGeometry, scale = UV_PER_METRE) {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    if (ny >= nx && ny >= nz) uv.setXY(i, x * scale, z * scale)
    else if (nx >= nz) uv.setXY(i, z * scale, y * scale)
    else uv.setXY(i, x * scale, y * scale)
  }
  uv.needsUpdate = true
}

class Builder {
  parts = new Map<Bucket, THREE.BufferGeometry[]>()
  box(bucket: Bucket, center: Vec3, size: Vec3) {
    if (size.some((s) => s <= 1e-6)) return
    const g = new THREE.BoxGeometry(size[0], size[1], size[2])
    g.translate(center[0], center[1], center[2])
    this.push(bucket, g)
  }
  /** Box on a wall: u/v rect, depth d0..d1 from the interior face (negative = into the room). */
  wallBox(bucket: Bucket, wall: WallId, r: Rect, d0: number, d1: number) {
    const { center, size } = wallBoxToWorld(wall, r, d0, d1)
    this.box(bucket, center, size)
  }
  /** Horizontal quad on a floor/ceiling plane. */
  hquad(bucket: Bucket, x0: number, x1: number, z0: number, z1: number, y: number, facingUp: boolean) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
    g.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2)
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
    this.push(bucket, g)
  }
  push(bucket: Bucket, g: THREE.BufferGeometry) {
    planarUV(g)
    const list = this.parts.get(bucket) ?? []
    list.push(g)
    this.parts.set(bucket, list)
  }
  build(): Map<Bucket, THREE.BufferGeometry> {
    const out = new Map<Bucket, THREE.BufferGeometry>()
    for (const [k, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      list.forEach((g) => g.dispose())
      if (merged) {
        merged.computeBoundingSphere()
        out.set(k, merged)
      }
    }
    return out
  }
}

/** Visible wall thickness (matches the contract); the window reveals show this depth. */
const T = ROOM.wallThickness
const GLASS_D = 0.17

/** u-range on the south wall kept free for the gate door (no baseboard / chair rail across it). */
function doorGap(): [number, number] {
  const half = ANCHORS.gateDoor.size[0] / 2 + 0.05
  return [ANCHORS.gateDoor.position[0] - half, ANCHORS.gateDoor.position[0] + half]
}

/** Horizontal strip along a whole wall, optionally skipping the door gap on the south wall. */
function strip(b: Builder, bucket: Bucket, wall: WallId, v0: number, v1: number, d0: number, d1: number, skipDoor = false) {
  const L = wallHalfLength(wall)
  const ranges: Array<[number, number]> = []
  if (wall === 'south' && skipDoor) {
    const [g0, g1] = doorGap()
    ranges.push([-L, g0], [g1, L])
  } else ranges.push([-L, L])
  for (const [u0, u1] of ranges) b.wallBox(bucket, wall, { u0, u1, v0, v1 }, d0, d1)
}

function buildWindow(b: Builder, wall: WallId, o: Rect) {
  const w = o.u1 - o.u0
  const h = o.v1 - o.v0
  const lt = 0.045 // reveal liner thickness
  // Wooden liner around the reveal (full wall depth).
  b.wallBox('trim', wall, { u0: o.u0, u1: o.u0 + lt, v0: o.v0, v1: o.v1 }, 0, T)
  b.wallBox('trim', wall, { u0: o.u1 - lt, u1: o.u1, v0: o.v0, v1: o.v1 }, 0, T)
  b.wallBox('trim', wall, { u0: o.u0, u1: o.u1, v0: o.v1 - lt, v1: o.v1 }, 0, T)
  b.wallBox('trim', wall, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v0 + lt }, GLASS_D - 0.02, T)
  // Casing on the interior face.
  const cw = 0.09
  b.wallBox('trim', wall, { u0: o.u0 - cw, u1: o.u0, v0: o.v0 - 0.05, v1: o.v1 + cw }, -0.03, 0)
  b.wallBox('trim', wall, { u0: o.u1, u1: o.u1 + cw, v0: o.v0 - 0.05, v1: o.v1 + cw }, -0.03, 0)
  b.wallBox('trim', wall, { u0: o.u0 - cw, u1: o.u1 + cw, v0: o.v1, v1: o.v1 + cw }, -0.035, 0)
  // Deep sill: protrudes into the room and runs back to the glass.
  b.wallBox('trim', wall, { u0: o.u0 - 0.14, u1: o.u1 + 0.14, v0: o.v0 - 0.05, v1: o.v0 + 0.01 }, -0.12, GLASS_D)
  // Mullions crossing the glass.
  const mt = 0.05
  const verticals = w > 2 ? 2 : 1
  for (let i = 1; i <= verticals; i++) {
    const u = o.u0 + (w * i) / (verticals + 1)
    b.wallBox('trim', wall, { u0: u - mt / 2, u1: u + mt / 2, v0: o.v0, v1: o.v1 }, GLASS_D - 0.04, GLASS_D + 0.03)
  }
  const vb = o.v0 + h * 0.64
  b.wallBox('trim', wall, { u0: o.u0, u1: o.u1, v0: vb - mt / 2, v1: vb + mt / 2 }, GLASS_D - 0.04, GLASS_D + 0.03)
  // Glass pane.
  b.wallBox('glass', wall, o, GLASS_D, GLASS_D + 0.01)
}

function buildFloor(b: Builder) {
  // One quad; the plank texture (tiled per metre in index.tsx) draws the seams and joints.
  b.hquad('floor', -HALF_W, HALF_W, -HALF_D, HALF_D, 0, true)
}

function buildCeiling(b: Builder) {
  const H = ROOM.height
  b.hquad('ceiling', -HALF_W, HALF_W, -HALF_D, HALF_D, H, false)
  // Cozy wooden beams running east-west. z=0 sits right above pendant A.
  for (const z of [-4, 0, 4]) b.box('beams', [0, H - 0.08, z], [ROOM.width, 0.16, 0.22])
}

function buildLedHousings(b: Builder) {
  for (const s of LED_STRIPS) {
    const [x0, y0, z0] = s.from
    const [x1, y1, z1] = s.to
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const cz = (z0 + z1) / 2
    if (cy > ROOM.height - 0.5) {
      // Ceiling strip: channel just above the LED line.
      b.box('housing', [cx, cy + 0.035, cz], alongX ? [len, 0.025, 0.06] : [0.06, 0.025, len])
    } else if (alongX) {
      // Strip along a north/south wall: back plate between the LED and the wall.
      const wallZ = cz < 0 ? -HALF_D : HALF_D
      const d = Math.abs(wallZ - cz)
      b.box('housing', [cx, cy, wallZ - Math.sign(wallZ) * (d - 0.015) / 2], [len, 0.05, Math.max(d - 0.015, 0.01)])
    } else {
      const wallX = cx < 0 ? -HALF_W : HALF_W
      const d = Math.abs(wallX - cx)
      b.box('housing', [wallX - Math.sign(wallX) * (d - 0.015) / 2, cy, cz], [Math.max(d - 0.015, 0.01), 0.05, len])
    }
  }
}

export function buildRoomGeometry(): Map<Bucket, THREE.BufferGeometry> {
  const b = new Builder()
  for (const wall of WALL_IDS) {
    const { below, above } = splitAtHeight(wallSegments(wall), WAINSCOT_HEIGHT)
    for (const r of below) b.wallBox('plasterAccent', wall, r, 0, T)
    for (const r of above) b.wallBox('plaster', wall, r, 0, T)
    // Baseboard, chair rail (top of the wainscot) and two-step crown moulding.
    strip(b, 'baseboard', wall, 0, 0.13, -0.022, 0, true)
    strip(b, 'baseboard', wall, WAINSCOT_HEIGHT - 0.035, WAINSCOT_HEIGHT + 0.03, -0.028, 0, true)
    strip(b, 'baseboard', wall, ROOM.height - 0.07, ROOM.height, -0.06, 0)
    strip(b, 'baseboard', wall, ROOM.height - 0.13, ROOM.height - 0.07, -0.03, 0)
    for (const o of wallOpenings(wall)) buildWindow(b, wall, o)
  }
  // Corner posts so the wall boxes meet outside the corners.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box('plaster', [sx * (HALF_W + T / 2), ROOM.height / 2, sz * (HALF_D + T / 2)], [T, ROOM.height, T])
  buildFloor(b)
  buildCeiling(b)
  buildLedHousings(b)
  return b.build()
}
