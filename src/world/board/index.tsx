/**
 * Workstream 6: the bulletin board. A cork board on the north wall with one
 * pinned polaroid per room, grouped by the active sort, plus in-world sort tabs.
 * Layout is a pure function (`layout.ts`); animation runs in one useFrame loop
 * that mutates Object3Ds directly (no React render per frame).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Anchor } from '@/world/Anchor'
import { getMaterial } from '@/world/materials'
import { bus } from '@/contracts/events'
import { interactable } from '@/contracts/interaction'
import { runtime } from '@/contracts/runtime'
import { ANCHORS, type Vec3 } from '@/contracts/scene'
import { useColliders } from '@/contracts/colliders'
import { GENRE_COLORS, PALETTE, UI } from '@/contracts/style'
import { SORT_KEYS, type Review, type Room } from '@/contracts/types'
import { BOARD_SORT_KEYS, BOARD_SORT_LABELS, useStore, type BoardPin, type BoardSortKey } from '@/state/store'
import type { CrewSticker } from '@/state/crew'
import { loadAvatars } from './avatars'
import { boardColliders } from './colliders'
import { layoutBoard, PHOTO_ASPECT, PIN_LOCAL_Y, PIN_LOCAL_Z, slotPinLocal, type BoardLayout, type LayoutGroup } from './layout'
import {
  drawLabelCard,
  drawNote,
  drawPolaroid,
  drawSoftShadow,
  drawTab,
  makeCanvasTexture,
  POLAROID_H,
  POLAROID_W,
  whenFontsReady,
} from './textures'

export { layoutBoard } from './layout'

// ---------------------------------------------------------------------------
// Board dimensions (anchor-local; z = 0 is the wall side, +Z into the room)
// ---------------------------------------------------------------------------

const BOARD_W = ANCHORS.bulletinBoard.size[0]
const BOARD_H = ANCHORS.bulletinBoard.size[1]
const BOARD_D = ANCHORS.bulletinBoard.size[2]
const FRAME = 0.14
const CORK_D = 0.05
const CORK_FACE_Z = 0.015 + CORK_D
const PHOTO_Z = CORK_FACE_Z + 0.007
const INNER_W = BOARD_W - FRAME * 2
const INNER_H = BOARD_H - FRAME * 2
const TAB_STRIP = 0.27
const TAB_Y = INNER_H / 2 - 0.035 - 0.095
const AREA_TOP = INNER_H / 2 - TAB_STRIP
const AREA_BOTTOM = -INNER_H / 2 + 0.05
export const AREA_W = INNER_W - 0.2
export const AREA_H = AREA_TOP - AREA_BOTTOM
const AREA_CY = (AREA_TOP + AREA_BOTTOM) / 2

/** Where new entries fly in from: the desk on the west wall, in board-local space. */
const DESK_FROM: Vec3 = (() => {
  const a = ANCHORS.bulletinBoard.position
  const d = ANCHORS.desk.position
  return [d[0] + 0.9 - a[0], 1.0 - a[1], d[2] - a[2]]
})()

// ---------------------------------------------------------------------------
// Shared geometry / materials (created once)
// ---------------------------------------------------------------------------

const PHOTO_H_UNIT = 1 / PHOTO_ASPECT
const PHOTO_GEO = new THREE.PlaneGeometry(1, PHOTO_H_UNIT)
const SHADOW_GEO = new THREE.PlaneGeometry(1.22, PHOTO_H_UNIT * 1.16)
const PIN_GEO = new THREE.SphereGeometry(0.045, 12, 8)
const PIN_STEM_GEO = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6)
const TAPE_GEO = new THREE.PlaneGeometry(0.36, 0.1)
const PLANE_GEO = new THREE.PlaneGeometry(1, 1)

let shadowMat: THREE.MeshBasicMaterial | null = null
function getShadowMaterial() {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: typeof document !== 'undefined' ? makeCanvasTexture(drawSoftShadow()) : null,
      color: '#000000',
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    })
  }
  return shadowMat
}

const TAPE_COLORS = ['#7fd1c7', '#f4a261', '#f2a7c3', '#f6d57a', '#a9c7f0']
const tapeMats: THREE.MeshStandardMaterial[] = []
function getTapeMaterial(seed: number) {
  if (!tapeMats.length)
    for (const c of TAPE_COLORS) tapeMats.push(new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.82, roughness: 0.7, depthWrite: false }))
  return tapeMats[Math.floor(seed * TAPE_COLORS.length) % TAPE_COLORS.length]
}

const pinMetal = new THREE.MeshStandardMaterial({ color: '#c9cdd0', metalness: 0.6, roughness: 0.35 })
const noRaycast = () => null

function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void whenFontsReady().then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])
  return ready
}

// ---------------------------------------------------------------------------
// Animation state (plain objects, mutated per frame)
// ---------------------------------------------------------------------------

interface Anim {
  id: string
  hoverId: string
  // current base transform (without hover)
  x: number
  y: number
  z: number
  rot: number
  scale: number
  // flight
  fx: number
  fy: number
  fz: number
  frot: number
  fscale: number
  tx: number
  ty: number
  tz: number
  trot: number
  tscale: number
  t0: number
  dur: number
  arc: number
  spin: number
  sway: number
  flying: boolean
  emitPin: boolean
  wobbleT0: number
  wobbleAmp: number
  hover: number
  dirty: boolean
  pin: Vec3
}

function newAnim(id: string): Anim {
  return {
    id,
    hoverId: 'photo:' + id,
    x: 0, y: 0, z: PHOTO_Z, rot: 0, scale: 0.0001,
    fx: 0, fy: 0, fz: 0, frot: 0, fscale: 0,
    tx: 0, ty: 0, tz: PHOTO_Z, trot: 0, tscale: 1,
    t0: 0, dur: 1, arc: 0, spin: 0, sway: 0,
    flying: false, emitPin: false,
    wobbleT0: -1, wobbleAmp: 0,
    hover: 0, dirty: true,
    pin: [0, 0, 0],
  }
}

function startFlight(a: Anim, now: number, delay: number, dur: number, arc: number) {
  a.fx = a.x
  a.fy = a.y
  a.fz = a.z
  a.frot = a.rot
  a.fscale = a.scale
  a.t0 = now + delay
  a.dur = dur
  a.arc = arc
  a.spin = 0
  a.sway = 0
  a.flying = true
  a.dirty = true
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Objs {
  group: THREE.Object3D
  shadow: THREE.Object3D | null
}

const AX = ANCHORS.bulletinBoard.position[0]
const AY = ANCHORS.bulletinBoard.position[1]
const AZ = ANCHORS.bulletinBoard.position[2]
const AC = Math.cos(ANCHORS.bulletinBoard.rotationY)
const AS = Math.sin(ANCHORS.bulletinBoard.rotationY)

function toWorld(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = AX + x * AC + z * AS
  out[1] = AY + y
  out[2] = AZ - x * AS + z * AC
  return out
}

// ---------------------------------------------------------------------------
// Polaroid
// ---------------------------------------------------------------------------

interface PolaroidProps {
  room: Room
  review: Review | undefined
  crew: readonly CrewSticker[]
  res: number
  tape: 'left' | 'right' | null
  tapeSeed: number
  fontsReady: boolean
  register: (id: string, obj: THREE.Object3D | null) => void
}

const NO_AVATARS: ReadonlyMap<string, HTMLImageElement> = new Map()

const Polaroid = memo(function Polaroid({ room, review, crew, res, tape, tapeSeed, fontsReady, register }: PolaroidProps) {
  const { canvas, texture, material } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = Math.round(POLAROID_W * res)
    c.height = Math.round(POLAROID_H * res)
    const t = makeCanvasTexture(c)
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, metalness: 0 })
    return { canvas: c, texture: t, material: m }
  }, [res])
  useEffect(
    () => () => {
      texture.dispose()
      material.dispose()
    },
    [texture, material],
  )

  const url = room.photos[0]?.url ?? review?.photos[0]?.url ?? null
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImg(null)
      return
    }
    let alive = true
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.decoding = 'async'
    im.onload = () => alive && setImg(im)
    im.onerror = () => alive && setImg(null)
    im.src = url
    return () => {
      alive = false
      im.onload = null
      im.onerror = null
    }
  }, [url])

  // Crew profile pictures for the stickers (initials until they load, or if they can't).
  const avatarKey = crew.flatMap((c) => (c.image ? [c.image] : [])).join('\n')
  const [avatars, setAvatars] = useState<ReadonlyMap<string, HTMLImageElement>>(NO_AVATARS)
  useEffect(() => {
    if (!avatarKey) {
      setAvatars(NO_AVATARS)
      return
    }
    let alive = true
    void loadAvatars(avatarKey.split('\n')).then((m) => alive && m.size > 0 && setAvatars(m))
    return () => {
      alive = false
    }
  }, [avatarKey])

  useEffect(() => {
    try {
      drawPolaroid(canvas, { room, review, crew }, img, avatars)
    } catch {
      drawPolaroid(canvas, { room, review, crew }, null)
    }
    texture.needsUpdate = true
  }, [canvas, texture, room, review, crew, img, avatars, fontsReady])

  const ref = useCallback((g: THREE.Object3D | null) => register(room.id, g), [register, room.id])
  const spec = useMemo(
    () =>
      interactable({
        id: 'photo:' + room.id,
        kind: 'photo',
        label: 'Read review: ' + room.name,
        event: { type: 'review:open', payload: { roomId: room.id } },
      }),
    [room.id, room.name],
  )

  return (
    <group ref={ref} {...spec}>
      <mesh name="shadow" geometry={SHADOW_GEO} material={getShadowMaterial()} position={[0.03, -0.04, -0.004]} raycast={noRaycast} />
      <mesh geometry={PHOTO_GEO} material={material} />
      <mesh geometry={PIN_STEM_GEO} material={pinMetal} position={[0, PIN_LOCAL_Y, PIN_LOCAL_Z * 0.4]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast} />
      <mesh geometry={PIN_GEO} material={getMaterial('pinRed')} position={[0, PIN_LOCAL_Y, PIN_LOCAL_Z]} scale={[1, 1, 0.8]} />
      {tape && (
        <mesh
          geometry={TAPE_GEO}
          material={getTapeMaterial(tapeSeed)}
          position={[tape === 'left' ? -0.42 : 0.42, PHOTO_H_UNIT / 2 - 0.03, 0.003]}
          rotation={[0, 0, tape === 'left' ? 0.75 : -0.75]}
          raycast={noRaycast}
        />
      )}
    </group>
  )
})

// ---------------------------------------------------------------------------
// Group label cards
// ---------------------------------------------------------------------------

const LABEL_ACCENTS = [UI.accent, UI.teal, PALETTE.fabricPlum, PALETTE.brass, PALETTE.rug, PALETTE.leaf]
const RATING_ACCENTS: Record<string, string> = { '90+': UI.good, '80-89': UI.teal, '70-79': UI.warn, '<70': UI.bad, Unrated: '#9a8a80' }
const TIME_ACCENTS: Record<string, string> = {
  'Under 45 min': UI.good,
  '45-54 min': UI.teal,
  '55+ min': UI.warn,
  "Didn't escape": UI.bad,
  Unknown: '#9a8a80',
}

function accentFor(sort: BoardSortKey, g: LayoutGroup): string {
  if (sort === 'genre') return GENRE_COLORS[g.key] ?? GENRE_COLORS.other
  if (sort === 'rating') return RATING_ACCENTS[g.key] ?? UI.accent
  if (sort === 'escapeTime') return TIME_ACCENTS[g.key] ?? UI.accent
  return LABEL_ACCENTS[g.index % LABEL_ACCENTS.length]
}

function GroupLabel({ group, sort, fontsReady, delay }: { group: LayoutGroup; sort: BoardSortKey; fontsReady: boolean; delay: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const accent = accentFor(sort, group)
  const aspect = group.labelW / group.labelH
  const material = useMemo(() => {
    // fontsReady is a dependency so the card redraws once the web fonts land.
    void fontsReady
    const t = makeCanvasTexture(drawLabelCard(group.label, group.count, accent, aspect))
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })
  }, [group.label, group.count, accent, aspect, fontsReady])
  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
    },
    [material],
  )
  const start = useRef(performance.now() / 1000 + delay)
  const done = useRef(false)
  useFrame(() => {
    const m = ref.current
    if (!m || done.current) return
    const p = Math.min(1, Math.max(0, (performance.now() / 1000 - start.current) / 0.35))
    const s = p <= 0 ? 0.0001 : 1 + Math.sin(p * Math.PI) * 0.12
    m.scale.set(group.labelW * s, group.labelH * s, 1)
    if (p >= 1) {
      m.scale.set(group.labelW, group.labelH, 1)
      done.current = true
    }
  })
  const tilt = ((group.index * 37) % 7) * 0.004 - 0.012
  return (
    <mesh
      ref={ref}
      geometry={PLANE_GEO}
      material={material}
      position={[group.labelX, group.labelY + AREA_CY, PHOTO_Z - 0.002]}
      rotation={[0, 0, tilt]}
      scale={[0.0001, 0.0001, 1]}
    />
  )
}

// ---------------------------------------------------------------------------
// Sort tabs and notes
// ---------------------------------------------------------------------------

const TAB_W = 0.62
const TAB_H = TAB_W / (256 / 80)
const TAB_GAP = 0.07

function SortTab({ sortKey, active, x, fontsReady }: { sortKey: BoardSortKey; active: boolean; x: number; fontsReady: boolean }) {
  const label = BOARD_SORT_LABELS[sortKey]
  const material = useMemo(() => {
    void fontsReady
    const t = makeCanvasTexture(drawTab(label, active))
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, transparent: true, alphaTest: 0.5 })
  }, [label, active, fontsReady])
  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
    },
    [material],
  )
  const spec = useMemo(() => interactable({ id: 'sort:' + sortKey, kind: 'sort', label: 'Sort by ' + label, maxDistance: 7 }), [sortKey, label])
  const s = active ? 1.08 : 1
  return (
    <mesh
      {...spec}
      geometry={PLANE_GEO}
      material={material}
      position={[x, TAB_Y - (active ? 0.012 : 0), PHOTO_Z + (active ? 0.006 : 0)]}
      scale={[TAB_W * s, TAB_H * s, 1]}
    />
  )
}

function Note({ lines, x, y, w, h, rot = 0, bg, fontsReady }: { lines: string[]; x: number; y: number; w: number; h: number; rot?: number; bg?: string; fontsReady: boolean }) {
  const key = lines.join('\n')
  const material = useMemo(() => {
    void fontsReady
    const px = 300
    const t = makeCanvasTexture(drawNote(key.split('\n'), px, Math.round((px * h) / w), bg))
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })
  }, [key, w, h, bg, fontsReady])
  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
    },
    [material],
  )
  return (
    <group position={[x, y, PHOTO_Z]} rotation={[0, 0, rot]}>
      <mesh geometry={PLANE_GEO} material={material} scale={[w, h, 1]} />
      <mesh geometry={PIN_GEO} material={getMaterial('pinRed')} position={[0, h / 2 - 0.035, 0.02]} scale={[0.6, 0.6, 0.5]} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Board frame
// ---------------------------------------------------------------------------

function Frame() {
  const wood = getMaterial('woodLight')
  const cork = getMaterial('cork')
  const fz = BOARD_D / 2
  return (
    <group>
      <mesh material={cork} position={[0, 0, 0.015 + CORK_D / 2]} receiveShadow>
        <boxGeometry args={[INNER_W, INNER_H, CORK_D]} />
      </mesh>
      <mesh material={wood} position={[0, BOARD_H / 2 - FRAME / 2, fz]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_W, FRAME, BOARD_D]} />
      </mesh>
      <mesh material={wood} position={[0, -BOARD_H / 2 + FRAME / 2, fz]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_W, FRAME, BOARD_D]} />
      </mesh>
      <mesh material={wood} position={[-BOARD_W / 2 + FRAME / 2, 0, fz]} castShadow receiveShadow>
        <boxGeometry args={[FRAME, INNER_H, BOARD_D]} />
      </mesh>
      <mesh material={wood} position={[BOARD_W / 2 - FRAME / 2, 0, fz]} castShadow receiveShadow>
        <boxGeometry args={[FRAME, INNER_H, BOARD_D]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const NO_CREW = {}
const NO_STICKERS: readonly CrewSticker[] = []

function crewFor(index: Record<string, readonly CrewSticker[]>, review: Review | undefined): readonly CrewSticker[] {
  return (review && index[review.id]) || NO_STICKERS
}

/** The empty-board note: a signed-in user's own (new) room, or the demo with nothing in it. */
export function emptyBoardLines(signedIn: boolean): string[] {
  return signedIn
    ? ['Your board is empty!', 'Log your first escape at the desk', 'or from your phone.']
    : ['No escapes pinned yet!', 'Log one at the desk.']
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true
}

export function BulletinBoard() {
  const rooms = useStore((s) => s.rooms)
  const reviews = useStore((s) => s.reviews)
  const sort = useStore((s) => s.boardSort)
  const crewIndex = useStore((s) => s.crewIndex)
  const signedIn = useStore((s) => s.dataSource === 'postgres')
  const lastAddedRoomId = useStore((s) => s.lastAddedRoomId)
  const fontsReady = useFontsReady()

  // Only the crew sort depends on the crew, so other sorts don't re-layout when avatars arrive.
  const layoutCrew = sort === 'crew' ? crewIndex : NO_CREW
  const layout: BoardLayout = useMemo(() => layoutBoard(rooms, reviews, sort, AREA_W, AREA_H, layoutCrew), [rooms, reviews, sort, layoutCrew])
  const latest = useMemo(() => {
    const m = new Map<string, Review>()
    for (const r of reviews) {
      const cur = m.get(r.roomId)
      if (!cur || r.date > cur.date) m.set(r.roomId, r)
    }
    return m
  }, [reviews])
  const slotById = useMemo(() => new Map(layout.slots.map((s) => [s.roomId, s])), [layout])
  const res = rooms.length > 80 ? 0.625 : 1

  const anims = useRef(new Map<string, Anim>())
  const objs = useRef(new Map<string, Objs>())
  const hovered = useRef<string | null>(useStore.getState().hoveredId)
  const initialized = useRef(false)
  const prevLastAdded = useRef<string | null>(lastAddedRoomId)

  const colliderBoxes = useMemo(() => boardColliders(), [])
  useColliders(colliderBoxes)

  // Hover id without re-rendering.
  useEffect(() => useStore.subscribe((s) => (hovered.current = s.hoveredId)), [])

  // In-world sort tabs.
  useEffect(
    () =>
      bus.on('interact', ({ id }) => {
        if (!id.startsWith('sort:')) return
        const key = id.slice(5) as BoardSortKey
        if (BOARD_SORT_KEYS.includes(key)) useStore.getState().setBoardSort(key)
      }),
    [],
  )

  // Key 7 groups by crew (the HUD handles 1-6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return
      if (e.key !== '7' && e.code !== 'Digit7' && e.code !== 'Numpad7') return
      const st = useStore.getState()
      if (!st.worldReady || st.overlay) return
      st.setBoardSort('crew')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const register = useCallback((id: string, obj: THREE.Object3D | null) => {
    if (!obj) {
      objs.current.delete(id)
      return
    }
    objs.current.set(id, { group: obj, shadow: obj.getObjectByName('shadow') ?? null })
    const a = anims.current.get(id)
    if (a) a.dirty = true
  }, [])

  // Re-target animations whenever the layout changes; publish pin targets.
  useLayoutEffect(() => {
    const now = performance.now() / 1000
    const n = layout.slots.length
    const stagger = n > 1 ? Math.min(0.05, 1.2 / n) : 0
    const first = !initialized.current
    const newId = lastAddedRoomId !== prevLastAdded.current ? lastAddedRoomId : null
    prevLastAdded.current = lastAddedRoomId
    const seen = new Set<string>()
    const pins: BoardPin[] = []
    const tmp: Vec3 = [0, 0, 0]

    for (const slot of layout.slots) {
      seen.add(slot.roomId)
      const tx = slot.x
      const ty = slot.y + AREA_CY
      let a = anims.current.get(slot.roomId)
      const created = !a
      if (!a) {
        a = newAnim(slot.roomId)
        anims.current.set(slot.roomId, a)
        a.x = tx
        a.y = ty
        a.z = PHOTO_Z
        a.rot = slot.tilt
        a.scale = slot.w
      }
      const moved =
        Math.abs(a.tx - tx) > 1e-4 || Math.abs(a.ty - ty) > 1e-4 || Math.abs(a.tscale - slot.w) > 1e-5 || Math.abs(a.trot - slot.tilt) > 1e-5
      a.tx = tx
      a.ty = ty
      a.tz = PHOTO_Z
      a.trot = slot.tilt
      a.tscale = slot.w

      if (slot.roomId === newId) {
        // Fly in from the desk, spin a little, pin itself.
        a.x = DESK_FROM[0]
        a.y = DESK_FROM[1]
        a.z = DESK_FROM[2]
        a.rot = slot.tilt + 1.4
        a.scale = slot.w * 0.7
        startFlight(a, now, 0.25, 1.7, 0.6)
        a.spin = 1.4
        a.emitPin = true
      } else if (created) {
        if (first) {
          // Initial cascade: drop gently onto the board.
          a.z = PHOTO_Z + 0.45
          a.y = ty + 0.12
          a.scale = slot.w * 1.1
          a.rot = slot.tilt * -1.5
          startFlight(a, now, 0.1 + slot.order * stagger * 0.6, 0.7, 0.05)
        } else {
          a.scale = slot.w * 0.01
          startFlight(a, now, 0.3 + slot.order * stagger, 0.5, 0.1)
        }
      } else if (moved) {
        const dist = Math.hypot(a.x - tx, a.y - ty)
        startFlight(a, now, slot.order * stagger, 0.85 + Math.min(0.5, dist * 0.08), 0.22 + Math.min(0.35, dist * 0.06))
        a.sway = (slot.seed - 0.5) * 0.5
      }
      a.dirty = true

      const [px, py, pz] = slotPinLocal(tx, ty, slot.w, slot.tilt)
      toWorld(tmp, px, py, PHOTO_Z + pz)
      pins.push({ roomId: slot.roomId, group: slot.group, order: slot.order, target: [tmp[0], tmp[1], tmp[2]] })
    }
    for (const id of [...anims.current.keys()]) {
      if (!seen.has(id)) {
        anims.current.delete(id)
        runtime.pinPositions.delete(id)
      }
    }
    if (n > 0) initialized.current = true
    useStore.getState().setBoardPins(pins)
  }, [layout, lastAddedRoomId])

  useEffect(
    () => () => {
      for (const id of anims.current.keys()) runtime.pinPositions.delete(id)
    },
    [],
  )

  useFrame((_, delta) => {
    const now = performance.now() / 1000
    const dt = Math.min(delta, 0.05)
    const hov = hovered.current
    for (const a of anims.current.values()) {
      let active = a.dirty
      if (a.flying) {
        active = true
        const p = (now - a.t0) / a.dur
        if (p <= 0) {
          a.x = a.fx
          a.y = a.fy
          a.z = a.fz
          a.rot = a.frot
          a.scale = a.fscale
        } else if (p < 1) {
          const e = easeInOut(p)
          const bump = Math.sin(Math.PI * p)
          a.x = a.fx + (a.tx - a.fx) * e
          a.y = a.fy + (a.ty - a.fy) * e + bump * a.arc * 0.35
          a.z = a.fz + (a.tz - a.fz) * e + bump * a.arc
          a.rot = a.frot + (a.trot - a.frot) * e + a.spin * Math.sin(Math.PI * 2 * e) * (1 - e) + a.sway * bump
          a.scale = (a.fscale + (a.tscale - a.fscale) * e) * (1 + 0.06 * bump)
        } else {
          a.x = a.tx
          a.y = a.ty
          a.z = a.tz
          a.rot = a.trot
          a.scale = a.tscale
          a.flying = false
          a.wobbleT0 = now
          a.wobbleAmp = a.emitPin ? 0.16 : 0.07
          if (a.emitPin) {
            a.emitPin = false
            bus.emit('sfx', { name: 'pin' })
          }
        }
      }
      const ht = hov === a.hoverId ? 1 : 0
      if (Math.abs(a.hover - ht) > 0.002) {
        a.hover += (ht - a.hover) * Math.min(1, dt * 12)
        active = true
      } else if (a.hover !== ht) {
        a.hover = ht
        active = true
      }
      let wob = 0
      if (a.wobbleT0 >= 0) {
        const t = now - a.wobbleT0
        if (t > 0.9) {
          a.wobbleT0 = -1
        } else {
          wob = a.wobbleAmp * Math.exp(-5 * t) * Math.sin(t * 24)
        }
        active = true
      }
      if (!active) continue
      a.dirty = false

      const h = a.hover
      const rz = a.z + h * 0.09 * (a.tscale / 0.5 + 0.4)
      const rs = a.scale * (1 + 0.14 * h) * (1 - Math.abs(wob) * 0.25)
      const rr = a.rot * (1 - 0.6 * h) + wob
      const o = objs.current.get(a.id)
      if (o) {
        o.group.position.set(a.x, a.y, rz)
        o.group.rotation.set(0, 0, rr)
        o.group.scale.setScalar(Math.max(rs, 1e-4))
        if (o.shadow) {
          const lift = Math.max(0, rz - PHOTO_Z)
          const inv = 1 / Math.max(rs, 1e-4)
          o.shadow.position.set((0.012 + lift * 0.3) * inv, (-0.018 - lift * 0.35) * inv, (-lift - 0.0035) * inv)
          o.shadow.scale.setScalar(1 + lift * 0.6)
        }
      }
      const py = PIN_LOCAL_Y * rs
      toWorld(a.pin, a.x - Math.sin(rr) * py, a.y + Math.cos(rr) * py, rz + PIN_LOCAL_Z * rs)
      runtime.pinPositions.set(a.id, a.pin)
    }
  })

  // The six Phase 1 tabs stay centred where they always were; Crew is a seventh tab to their right.
  const tabsW = SORT_KEYS.length * TAB_W + (SORT_KEYS.length - 1) * TAB_GAP
  const n = rooms.length

  return (
    <Anchor name="bulletinBoard">
      <Frame />
      {BOARD_SORT_KEYS.map((k, i) => (
        <SortTab key={k} sortKey={k} active={k === sort} x={-tabsW / 2 + TAB_W / 2 + i * (TAB_W + TAB_GAP)} fontsReady={fontsReady} />
      ))}
      <Note lines={['Sort by:']} x={-tabsW / 2 - 0.5} y={TAB_Y + 0.005} w={0.66} h={0.19} rot={0.03} fontsReady={fontsReady} />
      <Note
        lines={[n === 1 ? '1 room escaped!' : `${n} rooms escaped!`]}
        x={tabsW / 2 + TAB_GAP + TAB_W + 0.54}
        y={TAB_Y + 0.005}
        w={0.92}
        h={0.19}
        rot={-0.025}
        bg="#cfeee9"
        fontsReady={fontsReady}
      />
      {layout.groups.map((g) => (
        <GroupLabel key={sort + ':' + g.key + ':' + g.labelW.toFixed(3)} group={g} sort={sort} fontsReady={fontsReady} delay={0.15 + g.index * 0.05} />
      ))}
      {rooms.map((room) => {
        const slot = slotById.get(room.id)
        if (!slot) return null
        return (
          <Polaroid
            key={room.id}
            room={room}
            review={latest.get(room.id)}
            crew={crewFor(crewIndex, latest.get(room.id))}
            res={res}
            tape={slot.tape}
            tapeSeed={slot.seed}
            fontsReady={fontsReady}
            register={register}
          />
        )
      })}
      {n === 0 && <Note lines={emptyBoardLines(signedIn)} x={0} y={AREA_CY} w={1.9} h={0.9} rot={-0.03} fontsReady={fontsReady} />}
    </Anchor>
  )
}
