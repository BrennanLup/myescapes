/**
 * Local (interaction-only) reactive state + the interact action, shared between
 * the in-Canvas `InteractionSystem` and the DOM `Reticle`.
 */
import { create } from 'zustand'
import { bus } from '@/contracts/events'
import type { InteractableSpec } from '@/contracts/interaction'
import { selectControlsEnabled, useStore } from '@/state/store'

interface InteractionState {
  /** Full spec of the hovered target (the app store only holds its id). */
  hovered: InteractableSpec | null
  /** Live pointer-lock state (also mirrors the app store's flag). */
  locked: boolean
}

export const useInteraction = create<InteractionState>()(() => ({ hovered: null, locked: false }))

/** Sets the hovered spec, writes the store and emits `hover:changed` when the target changes. */
export function setHoveredSpec(spec: InteractableSpec | null) {
  const prev = useInteraction.getState().hovered
  if (prev?.id === spec?.id && prev?.label === spec?.label) return
  useInteraction.setState({ hovered: spec })
  if (prev?.id === spec?.id) return
  useStore.getState().setHovered(spec?.id ?? null)
  bus.emit('hover:changed', { id: spec?.id ?? null, kind: spec?.kind ?? null })
}

/** Fires an interaction for `spec`: its own event, the generic `interact` event and a click sfx. */
export function interactWith(spec: InteractableSpec | null): boolean {
  if (!spec) return false
  if (!selectControlsEnabled(useStore.getState())) return false
  if (spec.event) {
    const { type, payload } = spec.event
    ;(bus.emit as (t: string, p: unknown) => void)(type, payload)
  }
  bus.emit('interact', { id: spec.id, kind: spec.kind })
  bus.emit('sfx', { name: 'click' })
  return true
}

/** Interacts with whatever is hovered right now (used by the E key and the touch Tap button). */
export function interactHovered(): boolean {
  return interactWith(useInteraction.getState().hovered)
}

/** True while the object with this interactable id is hovered. */
export function useIsHovered(id: string): boolean {
  return useStore((s) => s.hoveredId === id)
}
