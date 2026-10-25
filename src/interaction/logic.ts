/**
 * Pure interaction logic (no React, no WebGL): spec resolution, hit filtering,
 * tap detection and prompt text. Unit-tested in logic.test.ts.
 */
import { DEFAULT_INTERACT_DISTANCE, type InteractableSpec } from '@/contracts/interaction'

/** Minimal shape of an Object3D we need (keeps the logic testable without three). */
export interface ParentChainNode {
  parent: ParentChainNode | null
  userData: Record<string, unknown>
}

/** Walks up from `obj` to the first ancestor (or itself) carrying `userData.interactable`. */
export function findInteractable<T extends ParentChainNode>(obj: T | null): { spec: InteractableSpec; root: T } | null {
  let cur: ParentChainNode | null = obj
  while (cur) {
    const spec = cur.userData?.interactable as InteractableSpec | undefined
    if (spec && typeof spec === 'object' && typeof spec.id === 'string') return { spec, root: cur as T }
    cur = cur.parent
  }
  return null
}

export function maxDistanceOf(spec: InteractableSpec): number {
  return spec.maxDistance ?? DEFAULT_INTERACT_DISTANCE
}

export interface RayHit<T extends ParentChainNode = ParentChainNode> {
  object: T
  distance: number
}

export interface ResolvedTarget<T extends ParentChainNode = ParentChainNode> {
  spec: InteractableSpec
  root: T
  distance: number
}

/**
 * Thin occluders (red string, glass, labels) sitting just in front of an
 * interactable shouldn't block it. A non-interactable first hit only blocks if
 * no interactable hit lies within this many metres behind it.
 */
export const OCCLUDER_TOLERANCE = 0.12

/**
 * Picks the interact target from distance-sorted ray hits.
 * - The nearest hit decides; a non-interactable mesh in front blocks (with a small tolerance).
 * - The target must be within its spec's maxDistance.
 */
export function resolveTarget<T extends ParentChainNode>(
  hits: readonly RayHit<T>[],
  tolerance = OCCLUDER_TOLERANCE,
): ResolvedTarget<T> | null {
  if (hits.length === 0) return null
  const first = hits[0]
  for (const hit of hits) {
    if (hit.distance - first.distance > tolerance) break
    const found = findInteractable(hit.object)
    if (found) {
      if (hit.distance > maxDistanceOf(found.spec)) return null
      return { spec: found.spec, root: found.root, distance: hit.distance }
    }
  }
  return null
}

// ---------------------------------------------------------------- tap detection

export const TAP_MAX_MS = 300
export const TAP_MAX_MOVE_PX = 12

export interface TapStart {
  x: number
  y: number
  t: number
  /** Largest distance from the start point seen so far. */
  maxMove: number
}

export function startTap(x: number, y: number, t: number): TapStart {
  return { x, y, t, maxMove: 0 }
}

export function moveTap(tap: TapStart, x: number, y: number): TapStart {
  const d = Math.hypot(x - tap.x, y - tap.y)
  return d > tap.maxMove ? { ...tap, maxMove: d } : tap
}

/** True when a touch that started at `tap` and ended at (x, y, t) is a short, still tap. */
export function isTap(tap: TapStart, x: number, y: number, t: number): boolean {
  const moved = Math.max(tap.maxMove, Math.hypot(x - tap.x, y - tap.y))
  return t - tap.t < TAP_MAX_MS && moved < TAP_MAX_MOVE_PX
}

/** Is this DOM element a surface where a tap may interact (the canvas, or a look surface)? */
export function isTapSurface(target: EventTarget | null, canvas: Element | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const el = target as Element
  if (canvas && (el === canvas || canvas.contains(el))) return true
  return el.closest('[data-look-surface]') !== null
}

// ---------------------------------------------------------------- prompt text

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s
}

/** "[E] Read review" */
export function desktopPrompt(label: string): string {
  return `[E] ${label.trim()}`
}

/** "Tap to read review" */
export function touchPrompt(label: string): string {
  const l = label.trim()
  return l ? `Tap to ${lowerFirst(l)}` : 'Tap'
}

// ---------------------------------------------------------------- outline sizing

/**
 * Per-axis scale (about the bounding-box centre) that grows a mesh by `thickness`
 * world metres on every side. `halfExtent` is the local half-size, `worldScale`
 * the world scale per local axis. Axes thinner than `flatEpsilon` (world) keep
 * scale 1 and mark the mesh as flat (planes are outlined with a coplanar hull).
 */
export function hullScale(
  halfExtent: readonly [number, number, number],
  worldScale: readonly [number, number, number],
  thickness: number,
  flatEpsilon = 0.004,
): { scale: [number, number, number]; flat: boolean } {
  let flat = false
  const scale = [0, 1, 2].map((i) => {
    const worldHalf = halfExtent[i] * Math.abs(worldScale[i])
    if (worldHalf < flatEpsilon) {
      flat = true
      return 1
    }
    return 1 + thickness / worldHalf
  }) as [number, number, number]
  return { scale, flat }
}

/** Outline thickness in metres for a target at `distance` (roughly constant on screen). */
export function outlineThickness(distance: number): number {
  return Math.min(0.03, Math.max(0.006, distance * 0.0055))
}
