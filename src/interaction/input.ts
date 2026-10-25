/**
 * DOM input for the interaction system: a mouse click while pointer-locked, the
 * E key, and a touch tap on the canvas / `[data-look-surface]` (raycast at the
 * tap point).
 *
 * Ghost-click guard: the press that triggers an interaction usually opens an
 * overlay, and the browser then delivers that press's trailing click (on touch, a
 * synthesized compatibility click) to whatever overlay control is now under the
 * finger or cursor. An interacting tap is consumed: its pointerup and touchend are
 * cancelled (no compatibility mouse events / click), and any click that still
 * arrives within `CLICK_SWALLOW_MS` near the same spot is eaten in the capture
 * phase before React sees it. The locked-mouse path swallows its click the same way.
 */
import type { InteractableSpec } from '@/contracts/interaction'
import { selectControlsEnabled, useStore } from '@/state/store'
import { interactHovered, interactWith, useInteraction } from './controller'
import { armClickSwallow, isTap, isTapSurface, moveTap, shouldSwallowClick, startTap, type ClickSwallow, type TapStart } from './logic'

/** Resolves the interactable under normalized device coordinates (x, y in [-1, 1], y up). */
export type CastAt = (x: number, y: number) => InteractableSpec | null

export function attachInteractionInput(canvas: HTMLElement, castAt: CastAt): () => void {
  const enabled = () => selectControlsEnabled(useStore.getState())
  const lockedNow = () => !!document.pointerLockElement
  let tap: (TapStart & { id: number; ok: boolean }) | null = null
  /** A locked-mouse press that interacted and is still down. */
  let pressId: number | null = null
  /** Window in which the trailing click of an interacting press is eaten. */
  let swallow: ClickSwallow | null = null

  const onLockChange = () => useInteraction.setState({ locked: lockedNow() })
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      // Only a click that happens while already locked interacts (the locking click doesn't).
      if (e.button === 0 && lockedNow() && enabled() && interactHovered()) pressId = e.pointerId
      return
    }
    if (!e.isPrimary) return
    tap = { ...startTap(e.clientX, e.clientY, e.timeStamp), id: e.pointerId, ok: isTapSurface(e.target, canvas) }
  }
  const onPointerMove = (e: PointerEvent) => {
    if (tap && e.pointerId === tap.id) tap = { ...tap, ...moveTap(tap, e.clientX, e.clientY) }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (pressId !== null && e.pointerId === pressId) {
      pressId = null
      // Pointer lock is gone once the overlay opens, so the cursor position says nothing.
      swallow = armClickSwallow(performance.now(), null)
    }
    if (!tap || e.pointerId !== tap.id) return
    const t = tap
    tap = null
    if (!t.ok || !enabled() || !isTap(t, e.clientX, e.clientY, e.timeStamp)) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    if (!interactWith(castAt(x, y))) return
    if (e.cancelable) e.preventDefault()
    swallow = armClickSwallow(performance.now(), [e.clientX, e.clientY])
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (tap && e.pointerId === tap.id) tap = null
  }
  const onTouchEnd = (e: TouchEvent) => {
    // Cancelling touchend is what stops the browser from synthesizing the click.
    if (swallow && performance.now() <= swallow.until && e.cancelable) e.preventDefault()
  }
  const onClickCapture = (e: MouseEvent) => {
    if (!shouldSwallowClick(swallow, performance.now(), e.clientX, e.clientY)) return
    swallow = null
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    const el = e.target as HTMLElement | null
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
    if (enabled()) interactHovered()
  }

  onLockChange()
  document.addEventListener('pointerlockchange', onLockChange)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('touchend', onTouchEnd, { passive: false, capture: true })
  window.addEventListener('click', onClickCapture, true)
  window.addEventListener('keydown', onKey)
  return () => {
    document.removeEventListener('pointerlockchange', onLockChange)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('touchend', onTouchEnd, { capture: true })
    window.removeEventListener('click', onClickCapture, true)
    window.removeEventListener('keydown', onKey)
  }
}
