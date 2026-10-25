/**
 * World layout contract.
 *
 * Coordinate system: right-handed, Y up, 1 unit = 1 metre. Origin is the centre
 * of the floor. The room spans x in [-HALF_W, HALF_W], z in [-HALF_D, HALF_D],
 * y in [0, HEIGHT]. "North" is -Z (the wall you face at spawn).
 *
 * Every anchor gives a position and a Y rotation. A rotationY of 0 means the
 * object's local +Z faces into the room from the north wall (i.e. it faces the
 * player at spawn). Mount content inside `<Anchor name="...">` and build it in
 * local space: local +Z = out of the wall / towards the room, local +Y = up.
 *
 * Owned by the orchestrator.
 */

export type Vec3 = [number, number, number]

export const ROOM = {
  /** Interior width along X (metres). */
  width: 20,
  /** Interior depth along Z (metres). */
  depth: 16,
  /** Floor to ceiling. */
  height: 4,
  /** Wall thickness (walls are built outside the interior bounds). */
  wallThickness: 0.3,
} as const

export const HALF_W = ROOM.width / 2
export const HALF_D = ROOM.depth / 2

/** Player eye height and collision radius. */
export const PLAYER = {
  eyeHeight: 1.6,
  radius: 0.35,
  walkSpeed: 3.2,
  runSpeed: 5.5,
  /** One "step" for the 10-20 steps requirement. */
  stepLength: 0.75,
} as const

export type WallId = 'north' | 'south' | 'east' | 'west'

/** Inward-facing Y rotation for an object hung on each wall. */
export const WALL_ROTATION: Record<WallId, number> = {
  north: 0,
  south: Math.PI,
  east: -Math.PI / 2,
  west: Math.PI / 2,
}

export interface AnchorSpec {
  position: Vec3
  rotationY: number
  wall?: WallId
  /** Footprint (width along local X, height along local Y, depth along local Z) reserved for the owner. */
  size: Vec3
  owner: string
}

const WALL_INSET = 0.02

export const ANCHORS = {
  /** Player start. rotationY is the camera yaw (0 = looking towards -Z / north wall). */
  spawn: { position: [0, PLAYER.eyeHeight, 3.5], rotationY: 0, size: [0, 0, 0], owner: 'src/player' },
  /** Big cork board centred on the north wall. Position = centre of the board face. */
  bulletinBoard: {
    position: [0, 2.05, -HALF_D + WALL_INSET],
    rotationY: WALL_ROTATION.north,
    wall: 'north',
    size: [9, 3, 0.12],
    owner: 'src/world/board',
  },
  /** Chalkboard wish list on the east wall. Position = centre of the board face. */
  wishlistBoard: {
    position: [HALF_W - WALL_INSET, 1.9, -3],
    rotationY: WALL_ROTATION.east,
    wall: 'east',
    size: [3.2, 2, 0.1],
    owner: 'src/world/wishlist',
  },
  /** "Add new entry" desk against the west wall. Position = floor point under the desk centre. */
  desk: {
    position: [-HALF_W + 0.55, 0, -3],
    rotationY: WALL_ROTATION.west,
    wall: 'west',
    size: [2.4, 1.6, 1.0],
    owner: 'src/world/props/desk',
  },
  /** Daily memory-puzzle gate: a door/safe on the south wall. Position = floor point at the door centre. */
  gateDoor: {
    position: [0, 0, HALF_D - WALL_INSET],
    rotationY: WALL_ROTATION.south,
    wall: 'south',
    size: [1.4, 2.5, 0.6],
    owner: 'src/gate',
  },
  /** Living area centre (rug, coffee table, bean bags). Floor point. */
  livingArea: {
    position: [3.5, 0, 1.5],
    rotationY: 0,
    size: [5, 1.2, 4],
    owner: 'src/world/props/living',
  },
  /** Bookshelves against the east wall. Floor point. */
  shelves: {
    position: [HALF_W - 0.25, 0, 4],
    rotationY: WALL_ROTATION.east,
    wall: 'east',
    size: [3, 2.4, 0.45],
    owner: 'src/world/props/living',
  },
  /** Year-in-escape-rooms trophy shelf + calendar on the west wall. Floor point. */
  wrapTrophy: {
    position: [-HALF_W + 0.25, 0, 3.5],
    rotationY: WALL_ROTATION.west,
    wall: 'west',
    size: [1.6, 2.0, 0.4],
    owner: 'src/ui/wrap',
  },
} as const satisfies Record<string, AnchorSpec>

export type AnchorName = keyof typeof ANCHORS

/**
 * Light fixture positions (world space). Prop owners put lamp MESHES here,
 * the lighting workstream puts LIGHTS here, so they line up.
 */
export const LAMPS = {
  /** Floor lamp in the living area: bulb position. */
  floorLamp: [6.75, 1.75, 0.7] as Vec3,
  /** Desk lamp bulb (desk anchor at x=-9.45, z=-3). */
  deskLamp: [-9.35, 1.25, -3.85] as Vec3,
  /** Two warm ceiling pendants. */
  pendantA: [-4, 3.3, 0] as Vec3,
  pendantB: [4, 3.3, 3] as Vec3,
  /** Board spotlight targets the board centre from the ceiling. */
  boardSpot: [0, 3.8, -5.5] as Vec3,
} as const

/** Teal LED strips (world-space line segments). Lighting owns the glow; room shell may add a thin housing. */
export const LED_STRIPS: Array<{ from: Vec3; to: Vec3 }> = [
  // Along the ceiling edge of the north wall above the board.
  { from: [-HALF_W + 0.1, ROOM.height - 0.08, -HALF_D + 0.1], to: [HALF_W - 0.1, ROOM.height - 0.08, -HALF_D + 0.1] },
  // Behind the desk monitors.
  { from: [-HALF_W + 0.08, 1.2, -4.2], to: [-HALF_W + 0.08, 1.2, -1.8] },
  // Under the shelves.
  { from: [HALF_W - 0.08, 0.1, 2.5], to: [HALF_W - 0.08, 0.1, 5.5] },
]

/** Windows: wall + horizontal centre along the wall (world X for north/south, world Z for east/west) + size. Room shell cuts them; lighting may add a cool fill. */
export const WINDOWS: Array<{ wall: WallId; center: number; bottom: number; width: number; height: number }> = [
  { wall: 'west', center: 4.5 + 2.2, bottom: 1.0, width: 1.6, height: 1.8 },
  { wall: 'east', center: -7, bottom: 1.0, width: 1.6, height: 1.8 },
  { wall: 'south', center: -6, bottom: 1.0, width: 2.2, height: 1.8 },
  { wall: 'south', center: 6, bottom: 1.0, width: 2.2, height: 1.8 },
]

/** Converts an anchor's local-space point into world space. */
export function anchorToWorld(name: AnchorName, local: Vec3): Vec3 {
  const a = ANCHORS[name]
  const c = Math.cos(a.rotationY)
  const s = Math.sin(a.rotationY)
  const [x, y, z] = local
  return [a.position[0] + x * c + z * s, a.position[1] + y, a.position[2] - x * s + z * c]
}
