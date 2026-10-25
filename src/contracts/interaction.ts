/**
 * Interaction contract. Any Object3D becomes interactable by carrying
 * `userData.interactable` (use the `interactable()` helper as a spread prop):
 *
 *   <mesh {...interactable({ id: 'photo:room_1', kind: 'photo', label: 'Read review',
 *            event: { type: 'review:open', payload: { roomId: 'room_1' } } })} />
 *
 * The interaction system (`src/interaction`) raycasts from the screen centre
 * (or the tap point on touch), walks up the parent chain to the first object
 * with `userData.interactable`, highlights it, shows the prompt, and on
 * click / tap / E emits `spec.event` on the bus (plus a generic `interact` event).
 * It also writes the hovered id into the store (`hoveredId`) so objects can glow.
 *
 * Owned by the orchestrator.
 */
import type { AppEvent } from './events'

export type InteractKind = 'photo' | 'desk' | 'wishlist' | 'gate' | 'wrap' | 'sort' | 'prop' | 'settings'

export interface InteractableSpec {
  id: string
  kind: InteractKind
  /** Prompt text, e.g. "Read review". Shown as "[E] Read review" / "Tap to read review". */
  label: string
  /** Event emitted on interact. Optional for objects that only listen to `interact`. */
  event?: AppEvent
  /** Max interaction distance in metres (default 4.5). */
  maxDistance?: number
}

export function interactable(spec: InteractableSpec): { userData: { interactable: InteractableSpec } } {
  return { userData: { interactable: spec } }
}

export const DEFAULT_INTERACT_DISTANCE = 4.5
