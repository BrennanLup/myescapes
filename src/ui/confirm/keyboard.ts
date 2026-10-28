/**
 * Phone keyboard helpers for the review forms (Phase 3, workstream A). Pure DOM, no three.js, so
 * the phone log flow imports this file directly.
 *
 * - `useKeyboardOpen()`: true while an on-screen keyboard covers part of the page, read from
 *   `window.visualViewport`. The forms hide their sticky Save bar then, so the keyboard and the bar
 *   don't stack up over the field being typed in; every other question stays in the normal flow.
 * - `useRevealFocusedField(ref)`: when a field inside `ref` gets focus, and again when the keyboard
 *   finishes opening, scroll it to the middle of what is still visible.
 */
import { useEffect, useState, type RefObject } from 'react'

/** Less than this is browser chrome (URL bar) moving, not a keyboard. */
const KEYBOARD_MIN_PX = 120

/** Height of the layout viewport the keyboard covers (0 when none). */
export function keyboardInset(win: Pick<Window, 'innerHeight' | 'visualViewport'> = window): number {
  const vv = win.visualViewport
  if (!vv) return 0
  const covered = win.innerHeight - (vv.height + vv.offsetTop)
  return covered > KEYBOARD_MIN_PX ? Math.round(covered) : 0
}

const TEXTY = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', 'time', 'datetime-local', 'month', 'week', ''])

/** Fields that bring up an on-screen keyboard (or a picker that takes the bottom of the screen). */
export function isTypingField(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && TEXTY.has((el as HTMLInputElement).type)
}

/**
 * Whether a field at `rect` sits outside the visible band: under the keyboard (or a bar of
 * `bottomReserve` px above it), or above the top (behind a header of `topReserve` px).
 */
export function needsReveal(rect: { top: number; bottom: number }, visibleHeight: number, topReserve = 0, bottomReserve = 0, margin = 12): boolean {
  return rect.bottom > visibleHeight - bottomReserve - margin || rect.top < topReserve + margin
}

export function useKeyboardOpen(): boolean {
  return useKeyboardInset() > 0
}

/** Pixels of the page the on-screen keyboard covers right now (0 when closed). */
export function useKeyboardInset(): number {
  const [open, setOpen] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => setOpen(keyboardInset())
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return open
}

export function useRevealFocusedField(root: RefObject<HTMLElement | null>, opts: { topReserve?: number } = {}): void {
  const topReserve = opts.topReserve ?? 0
  useEffect(() => {
    const el = root.current
    if (!el || typeof window === 'undefined') return
    const vv = window.visualViewport
    let timer: ReturnType<typeof setTimeout> | undefined
    const reveal = () => {
      const f = document.activeElement
      if (!isTypingField(f) || !el.contains(f)) return
      const visible = vv ? vv.height : window.innerHeight
      const r = f.getBoundingClientRect()
      // A visual viewport scrolled by the browser shifts what "top" means.
      const off = vv ? vv.offsetTop : 0
      if (needsReveal({ top: r.top - off, bottom: r.bottom - off }, visible, topReserve)) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        f.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      }
    }
    const later = () => {
      clearTimeout(timer)
      // Wait for the keyboard animation (~250 ms on iOS and Android).
      timer = setTimeout(reveal, 320)
    }
    const onFocus = (e: FocusEvent) => {
      if (isTypingField(e.target as Element)) later()
    }
    el.addEventListener('focusin', onFocus)
    vv?.addEventListener('resize', later)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('focusin', onFocus)
      vv?.removeEventListener('resize', later)
    }
  }, [root, topReserve])
}
