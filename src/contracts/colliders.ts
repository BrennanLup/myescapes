/**
 * Collision contract: simple axis-aligned boxes in world space.
 * Anything solid (walls, furniture) registers a box; the player controller
 * (`src/player`) resolves a circle of radius PLAYER.radius against all boxes
 * whose Y range overlaps the player's body (y in [0.1, 1.8]).
 *
 * Register from a component with `useCollider(box)` (auto-unregisters on unmount)
 * or imperatively with `colliders.add(box)`.
 *
 * Owned by the orchestrator.
 */
import { useEffect } from 'react'
import type { Vec3 } from './scene'

export interface AABB {
  /** Unique id, e.g. "room:wall:north" or "living:couch". */
  id: string
  min: Vec3
  max: Vec3
}

type Listener = () => void

class ColliderRegistry {
  private boxes = new Map<string, AABB>()
  private listeners = new Set<Listener>()
  add(box: AABB): () => void {
    this.boxes.set(box.id, box)
    this.listeners.forEach((l) => l())
    return () => this.remove(box.id)
  }
  remove(id: string) {
    if (this.boxes.delete(id)) this.listeners.forEach((l) => l())
  }
  all(): AABB[] {
    return [...this.boxes.values()]
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  clear() {
    this.boxes.clear()
  }
}

export const colliders = new ColliderRegistry()

/** Build an AABB from a centre and full size. */
export function boxFromCenter(id: string, center: Vec3, size: Vec3): AABB {
  return {
    id,
    min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
  }
}

/** Register colliders for the lifetime of a component. Pass a stable array (useMemo). */
export function useColliders(boxes: AABB[]) {
  useEffect(() => {
    const offs = boxes.map((b) => colliders.add(b))
    return () => offs.forEach((off) => off())
  }, [boxes])
}
