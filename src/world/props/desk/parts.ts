/**
 * Static desk geometry as a list of primitive parts, merged into one geometry
 * per material so the whole set costs a handful of draw calls.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Vec3 } from '@/contracts/scene'
import { D, LAMP_BULB_LOCAL } from './layout'

export type PartMat =
  | 'woodLight'
  | 'woodDark'
  | 'fabricTeal'
  | 'fabricOrange'
  | 'metalDark'
  | 'metal'
  | 'brass'
  | 'ceramic'
  | 'pot'
  | 'leaf'
  | 'stickyYellow'
  | 'stickyPink'
  | 'plastic'
  | 'led'
  | 'shade'

type Shape =
  | { g: 'box'; a: [number, number, number] }
  | { g: 'cyl'; a: [number, number, number, number?, boolean?] }
  | { g: 'sphere'; a: [number, number?, number?] }
  | { g: 'torus'; a: [number, number, number?, number?] }

export type Part = Shape & { m: PartMat; p: Vec3; r?: Vec3; s?: Vec3 }

function geometryFor(part: Part): THREE.BufferGeometry {
  switch (part.g) {
    case 'box':
      return new THREE.BoxGeometry(...part.a)
    case 'cyl':
      return new THREE.CylinderGeometry(part.a[0], part.a[1], part.a[2], part.a[3] ?? 10, 1, part.a[4] ?? false)
    case 'sphere':
      return new THREE.SphereGeometry(part.a[0], part.a[1] ?? 10, part.a[2] ?? 8)
    case 'torus':
      return new THREE.TorusGeometry(part.a[0], part.a[1], part.a[2] ?? 6, part.a[3] ?? 16)
  }
}

/** Applies a parent transform (position + Y rotation) to a list of parts. Rotations use 'YXZ' order so yaws add. */
function place(parts: Part[], pos: Vec3, rotY: number): Part[] {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  return parts.map((pt) => ({
    ...pt,
    p: [pos[0] + pt.p[0] * c + pt.p[2] * s, pos[1] + pt.p[1], pos[2] - pt.p[0] * s + pt.p[2] * c] as Vec3,
    r: [pt.r?.[0] ?? 0, (pt.r?.[1] ?? 0) + rotY, pt.r?.[2] ?? 0] as Vec3,
  }))
}

const box = (m: PartMat, a: [number, number, number], p: Vec3, r?: Vec3): Part => ({ g: 'box', m, a, p, r })
const cyl = (m: PartMat, a: [number, number, number, number?, boolean?], p: Vec3, r?: Vec3): Part => ({ g: 'cyl', m, a, p, r })

function deskParts(): Part[] {
  const { topY, topT, width, backZ, frontZ } = D
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2
  const legH = topY - topT
  const parts: Part[] = [
    // Chunky top with a darker lip.
    box('woodLight', [width, topT, depth], [0, topY - topT / 2, cz]),
    box('woodDark', [width + 0.02, 0.025, 0.03], [0, topY - topT - 0.005, frontZ - 0.005]),
    // Slab legs and modesty panel.
    box('woodLight', [0.09, legH, depth - 0.04], [-width / 2 + 0.07, legH / 2, cz]),
    box('woodLight', [0.09, legH, depth - 0.04], [width / 2 - 0.07, legH / 2, cz]),
    box('woodDark', [width - 0.2, 0.42, 0.04], [0, legH - 0.24, backZ + 0.06]),
    // Drawer cabinet on the right.
    box('woodLight', [0.48, legH - 0.04, depth - 0.1], [0.74, (legH - 0.04) / 2 + 0.02, cz - 0.02]),
  ]
  for (let i = 0; i < 3; i++) {
    const y = 0.16 + i * 0.22
    parts.push(box('woodDark', [0.42, 0.18, 0.02], [0.74, y, frontZ - 0.06]))
    parts.push(cyl('brass', [0.018, 0.018, 0.03, 8], [0.74, y, frontZ - 0.035], [Math.PI / 2, 0, 0]))
  }
  return parts
}

function monitorParts(pos: Vec3, w: number, h: number, rotY: number): Part[] {
  const standH = pos[1] - D.topY
  return place(
    [
      // Bezel (screen face is a separate mesh in front of it).
      box('plastic', [w + 0.04, h + 0.04, 0.035], [0, 0, 0]),
      box('plastic', [w * 0.6, h * 0.6, 0.06], [0, 0, -0.04]),
      // Stand.
      box('metalDark', [0.05, standH, 0.04], [0, -standH / 2, -0.07]),
      box('metalDark', [0.26, 0.015, 0.18], [0, -standH + 0.008, -0.03]),
    ],
    pos,
    rotY,
  )
}

const TOWER_POS: Vec3 = [-0.97, D.topY, -0.18]

function towerParts(): Part[] {
  const pos: Vec3 = TOWER_POS
  return place(
    [
      box('metalDark', [0.22, 0.46, 0.42], [0, 0.23, 0]),
      box('plastic', [0.2, 0.06, 0.4], [0, 0.03, 0]),
      // Front fan grille (LED ring is separate).
      cyl('metal', [0.06, 0.06, 0.012, 14], [0, 0.3, 0.212], [Math.PI / 2, 0, 0]),
      cyl('metal', [0.06, 0.06, 0.012, 14], [0, 0.15, 0.212], [Math.PI / 2, 0, 0]),
    ],
    pos,
    0,
  )
}

/** LED parts on the PC tower + a thin strip along the desk underside front. */
export function ledParts(): Part[] {
  const pos: Vec3 = TOWER_POS
  return [
    ...place(
      [
        { g: 'torus', m: 'led', a: [0.062, 0.008, 6, 20], p: [0, 0.3, 0.22] },
        { g: 'torus', m: 'led', a: [0.062, 0.008, 6, 20], p: [0, 0.15, 0.22] },
        box('led', [0.012, 0.4, 0.012], [-0.1, 0.24, 0.215]),
        box('led', [0.14, 0.01, 0.01], [0, 0.43, 0.215]),
      ],
      pos,
      0,
    ),
    box('led', [D.width - 0.3, 0.012, 0.012], [0, D.topY - D.topT - 0.03, D.frontZ - 0.05]),
  ]
}

function peripheralsParts(): Part[] {
  const y = D.topY
  const parts: Part[] = [
    // Keyboard with key rows.
    box('plastic', [0.5, 0.025, 0.17], [0.15, y + 0.0125, 0.16], [0, 0.03, 0]),
    ...[0, 1, 2, 3].map((i) => box('metal', [0.44, 0.012, 0.025], [0.15, y + 0.03, 0.1 + i * 0.038], [0, 0.03, 0])),
    // Desk mat.
    box('fabricTeal', [0.95, 0.006, 0.36], [0.25, y + 0.003, 0.18]),
    // Mouse.
    { g: 'sphere', m: 'plastic', a: [0.035, 10, 6], p: [0.55, y + 0.012, 0.2], s: [0.85, 0.45, 1.3] },
    // Mug with handle.
    cyl('ceramic', [0.045, 0.04, 0.1, 12], [-0.3, y + 0.05, 0.22]),
    { g: 'torus', m: 'ceramic', a: [0.028, 0.009, 5, 10], p: [-0.25, y + 0.055, 0.22], r: [0, 0, 0] },
    cyl('woodDark', [0.04, 0.04, 0.005, 12], [-0.3, y + 0.095, 0.22]),
    // Tiny cactus in a pot.
    cyl('pot', [0.045, 0.035, 0.07, 10], [-0.68, y + 0.035, 0.23]),
    cyl('leaf', [0.026, 0.03, 0.1, 8], [-0.68, y + 0.12, 0.23]),
    { g: 'sphere', m: 'leaf', a: [0.026, 8, 6], p: [-0.68, y + 0.17, 0.23] },
    cyl('leaf', [0.014, 0.016, 0.05, 6], [-0.65, y + 0.13, 0.23], [0, 0, -0.9]),
    { g: 'sphere', m: 'stickyPink', a: [0.012, 6, 4], p: [-0.68, y + 0.198, 0.23] },
    // Sticky notes: on the main monitor bezel and on the desk.
    box('stickyYellow', [0.07, 0.07, 0.003], [D.mainMonitor.pos[0] + D.mainMonitor.w / 2 - 0.01, D.mainMonitor.pos[1] + 0.2, D.mainMonitor.pos[2] + 0.02], [0, 0, 0.12]),
    box('stickyPink', [0.07, 0.07, 0.003], [D.mainMonitor.pos[0] - D.mainMonitor.w / 2 + 0.02, D.mainMonitor.pos[1] - 0.21, D.mainMonitor.pos[2] + 0.02], [0, 0, -0.1]),
    box('stickyYellow', [0.08, 0.004, 0.08], [-0.15, y + 0.002, 0.3], [0, 0.3, 0]),
    box('stickyYellow', [0.08, 0.004, 0.08], [-0.12, y + 0.006, 0.31], [0, -0.15, 0]),
  ]
  return parts
}

/** Podcast mic on a boom arm clamped to the back edge. */
function micParts(): Part[] {
  const base: Vec3 = [0.64, D.topY, -0.4]
  const elbow: Vec3 = [0.64, D.topY + 0.5, -0.3]
  const mic: Vec3 = [0.66, D.topY + 0.3, 0.12]
  return [
    box('metalDark', [0.06, 0.05, 0.08], [base[0], base[1] + 0.025, base[2]]),
    ...segment('metalDark', [base[0], base[1] + 0.04, base[2]], elbow, 0.012),
    ...segment('metalDark', elbow, [mic[0], mic[1] + 0.07, mic[2] - 0.02], 0.012),
    { g: 'torus', m: 'metal', a: [0.05, 0.007, 5, 14], p: [mic[0], mic[1] + 0.01, mic[2]], r: [0, Math.PI / 2, 0] },
    cyl('metalDark', [0.032, 0.032, 0.13, 12], mic, [0.25, 0, 0]),
    { g: 'sphere', m: 'metal', a: [0.034, 10, 8], p: [mic[0], mic[1] + 0.065, mic[2] + 0.015] },
  ]
}

/** A cylinder from a to b. */
function segment(m: PartMat, a: Vec3, b: Vec3, radius: number): Part[] {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const len = va.distanceTo(vb)
  const mid = va.clone().add(vb).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
  return [cyl(m, [radius, radius, len, 6], [mid.x, mid.y, mid.z], [e.x, e.y, e.z])]
}

/** Desk lamp: base on the desk, arm up and over, shade around the contract bulb position. */
function lampParts(): Part[] {
  const [bx, by, bz] = LAMP_BULB_LOCAL
  const base: Vec3 = [bx + 0.12, D.topY, bz - 0.32]
  const elbow: Vec3 = [bx + 0.12, by + 0.2, bz - 0.36]
  const head: Vec3 = [bx, by + 0.09, bz]
  return [
    cyl('fabricOrange', [0.08, 0.09, 0.03, 14], [base[0], base[1] + 0.015, base[2]]),
    ...segment('brass', [base[0], base[1] + 0.03, base[2]], elbow, 0.012),
    ...segment('brass', elbow, head, 0.012),
    { g: 'sphere', m: 'brass', a: [0.02, 8, 6], p: elbow },
    // Shade: open cone around the bulb (bulb mesh is separate).
    { g: 'cyl', m: 'shade', a: [0.04, 0.11, 0.13, 14, true], p: [bx, by + 0.04, bz] },
  ]
}

function chairParts(): Part[] {
  const local: Part[] = [
    // Five-star base + caster balls.
    ...[0, 1, 2, 3, 4].flatMap((i): Part[] => {
      const a = (i / 5) * Math.PI * 2
      return [
        box('metalDark', [0.05, 0.04, 0.3], [Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14], [0, a, 0]),
        { g: 'sphere', m: 'metalDark', a: [0.03, 6, 4], p: [Math.sin(a) * 0.28, 0.03, Math.cos(a) * 0.28] },
      ]
    }),
    cyl('metal', [0.03, 0.03, 0.34, 8], [0, 0.26, 0]),
    // Seat.
    box('metalDark', [0.44, 0.05, 0.44], [0, 0.44, 0]),
    box('fabricTeal', [0.5, 0.09, 0.5], [0, 0.5, 0]),
    box('fabricOrange', [0.52, 0.03, 0.06], [0, 0.53, -0.23]),
    // Backrest (chair faces local -Z, toward the desk), side bolsters, headrest pillow.
    box('fabricTeal', [0.46, 0.66, 0.09], [0, 0.92, 0.24], [-0.12, 0, 0]),
    box('fabricOrange', [0.07, 0.62, 0.11], [-0.24, 0.9, 0.245], [-0.12, 0, 0]),
    box('fabricOrange', [0.07, 0.62, 0.11], [0.24, 0.9, 0.245], [-0.12, 0, 0]),
    box('fabricOrange', [0.26, 0.11, 0.08], [0, 1.15, 0.24], [-0.12, 0, 0]),
    box('metalDark', [0.06, 0.18, 0.06], [0, 0.6, 0.24]),
    // Armrests.
    box('metalDark', [0.04, 0.2, 0.04], [-0.27, 0.6, 0.02]),
    box('metalDark', [0.04, 0.2, 0.04], [0.27, 0.6, 0.02]),
    box('fabricTeal', [0.07, 0.04, 0.26], [-0.27, 0.71, 0]),
    box('fabricTeal', [0.07, 0.04, 0.26], [0.27, 0.71, 0]),
  ]
  return place(local, D.chair.pos, D.chair.rotY)
}

export function staticParts(): Part[] {
  return [
    ...deskParts(),
    ...monitorParts(D.mainMonitor.pos, D.mainMonitor.w, D.mainMonitor.h, D.mainMonitor.rotY),
    ...monitorParts(D.sideMonitor.pos, D.sideMonitor.w, D.sideMonitor.h, D.sideMonitor.rotY),
    ...towerParts(),
    ...peripheralsParts(),
    ...micParts(),
    ...lampParts(),
    ...chairParts(),
  ]
}

/** Merge parts into one geometry per material. */
export function mergeByMaterial(parts: Part[]): Map<PartMat, THREE.BufferGeometry> {
  const groups = new Map<PartMat, THREE.BufferGeometry[]>()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  for (const part of parts) {
    const g = geometryFor(part)
    const [rx, ry, rz] = part.r ?? [0, 0, 0]
    q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
    m.compose(new THREE.Vector3(...part.p), q, new THREE.Vector3(...(part.s ?? [1, 1, 1])))
    g.applyMatrix4(m)
    const list = groups.get(part.m) ?? []
    list.push(g)
    groups.set(part.m, list)
  }
  const out = new Map<PartMat, THREE.BufferGeometry>()
  for (const [k, list] of groups) {
    const merged = mergeGeometries(list, false)
    list.forEach((g) => g.dispose())
    if (merged) {
      merged.computeBoundingSphere()
      out.set(k, merged)
    }
  }
  return out
}
