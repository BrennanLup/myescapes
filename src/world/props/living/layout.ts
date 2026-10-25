/**
 * World-space layout of the living set (pure data, no React/three).
 * Everything else in this folder reads positions from here, and the collider
 * list is derived from the same numbers so the unit test checks what we render.
 */
import { boxFromCenter, type AABB } from '@/contracts/colliders'
import { ANCHORS, LAMPS, type Vec3 } from '@/contracts/scene'

const [LX, , LZ] = ANCHORS.livingArea.position

export const RUG = { center: [LX + 0.5, 0, LZ] as Vec3, size: [4.2, 3.0] as [number, number] }

/** Couch faces -X (towards the room centre), back to the shelves corridor. */
export const COUCH = { center: [6.0, 0, LZ] as Vec3, rotY: -Math.PI / 2, length: 2.2, depth: 0.9, height: 0.95 }

export const COFFEE_TABLE = { center: [LX + 0.75, 0, LZ] as Vec3, size: [0.8, 0.45, 1.3] as Vec3 }

/** Bean bags face +X (towards the table and couch). */
export const BEAN_BAGS = [
  { id: 'beanbag-orange', mat: 'fabricOrange', center: [2.5, 0, 0.75] as Vec3, rotY: Math.PI / 2 + 0.35, r: 0.5 },
  { id: 'beanbag-teal', mat: 'fabricTeal', center: [2.4, 0, 2.3] as Vec3, rotY: Math.PI / 2 - 0.3, r: 0.5 },
] as const

export const POUF = { center: [3.45, 0, 3.25] as Vec3, r: 0.28, h: 0.24 }

export const SIDE_TABLE = { center: [6.0, 0, 3.05] as Vec3, r: 0.26, h: 0.54 }

/**
 * Floor lamp base, just behind the couch's north arm (a reading light). The shade centre is exactly
 * LAMPS.floorLamp. It stays off the z = 0 centre line so a walk east from the room centre is not blocked.
 */
export const FLOOR_LAMP = { base: [LAMPS.floorLamp[0], 0, LAMPS.floorLamp[2]] as Vec3, shade: LAMPS.floorLamp }

export const SHELF = {
  anchor: ANCHORS.shelves.position as Vec3,
  rotY: ANCHORS.shelves.rotationY,
  width: 3,
  height: 2.4,
  /** Local z range (back..front); the back sits almost against the east wall. */
  zBack: -0.22,
  zFront: 0.21,
}

export type PlantKind = 'monstera' | 'snake' | 'bush'

export interface PlantSpec {
  id: string
  kind: PlantKind
  pos: Vec3
  scale: number
  /** Collider half-size (x/z) around the pot. */
  half: number
  height: number
}

export const FLOOR_PLANTS: PlantSpec[] = [
  { id: 'plant-monstera-north', kind: 'monstera', pos: [7.6, 0, -7.3], scale: 1.15, half: 0.3, height: 1.5 },
  { id: 'plant-snake-north', kind: 'snake', pos: [-5.6, 0, -7.4], scale: 1.1, half: 0.22, height: 1.2 },
  { id: 'plant-monstera-se', kind: 'monstera', pos: [8.9, 0, 7.2], scale: 1, half: 0.28, height: 1.3 },
  { id: 'plant-snake-couch', kind: 'snake', pos: [6.95, 0, 3.05], scale: 0.9, half: 0.2, height: 1.0 },
  { id: 'plant-bush-sw', kind: 'bush', pos: [-9.3, 0, 7.3], scale: 1, half: 0.26, height: 0.75 },
  { id: 'plant-bush-south', kind: 'bush', pos: [-7.7, 0, 7.4], scale: 0.85, half: 0.24, height: 0.65 },
  { id: 'plant-snake-shelf', kind: 'snake', pos: [9.35, 0, 6.15], scale: 1.0, half: 0.2, height: 1.1 },
]

/** Hanging plants (above head height, so no colliders). Position = pot centre. */
export const HANGING_PLANTS: Vec3[] = [
  [-9.25, 2.65, 5.2],
  [7.7, 2.7, 7.35],
  [7.3, 2.75, -1.6],
]

function shelfBox(): AABB {
  // Shelf local x -> world +z, local z -> world -x (rotY = -PI/2).
  const [ax, , az] = SHELF.anchor
  const half = SHELF.width / 2
  return {
    id: 'living:bookshelf',
    min: [ax - SHELF.zFront, 0, az - half],
    max: [ax - SHELF.zBack, SHELF.height, az + half],
  }
}

/** Every solid piece in the living set (stable module constant). */
export const LIVING_COLLIDERS: AABB[] = [
  boxFromCenter('living:couch', [COUCH.center[0], COUCH.height / 2, COUCH.center[2]], [COUCH.depth, COUCH.height, COUCH.length]),
  ...BEAN_BAGS.map((b) => boxFromCenter(`living:${b.id}`, [b.center[0], 0.42, b.center[2]], [b.r * 2, 0.84, b.r * 2])),
  boxFromCenter('living:pouf', [POUF.center[0], POUF.h / 2, POUF.center[2]], [POUF.r * 2, POUF.h, POUF.r * 2]),
  boxFromCenter(
    'living:coffee-table',
    [COFFEE_TABLE.center[0], COFFEE_TABLE.size[1] / 2, COFFEE_TABLE.center[2]],
    COFFEE_TABLE.size,
  ),
  boxFromCenter('living:side-table', [SIDE_TABLE.center[0], SIDE_TABLE.h / 2, SIDE_TABLE.center[2]], [SIDE_TABLE.r * 2, SIDE_TABLE.h, SIDE_TABLE.r * 2]),
  boxFromCenter('living:floor-lamp', [FLOOR_LAMP.base[0], 1, FLOOR_LAMP.base[2]], [0.4, 2, 0.4]),
  shelfBox(),
  ...FLOOR_PLANTS.map((p) => boxFromCenter(`living:${p.id}`, [p.pos[0], p.height / 2, p.pos[2]], [p.half * 2, p.height, p.half * 2])),
]
