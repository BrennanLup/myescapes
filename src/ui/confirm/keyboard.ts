/**
 * Phone keyboard helpers for the review forms (Phase 3, workstream A). Pure DOM, no three.js, so
 * the phone log flow imports this file directly.
 *
 * - `useKeyboardOpen()`: true while an on-screen keyboard is up. The forms hide their sticky Save
 *   bar then, so the keyboard and the bar don't stack up over the field being typed in; every other
 *   question stays in the normal flow. Two kinds of browser:
 *   - the keyboard covers the page and only the *visual* viewport shrinks (Chrome and Safari on
 *     phones): `keyboardInset()` measures it from `window.visualViewport`;
 *   - the keyboard shrinks the *layout* viewport, so `innerHeight` itself drops (Firefox for
 *     Android, or `interactive-widget=resizes-content`): the inset reads 0 there, so
 *     `layoutShrunk()` also counts "a text field has focus and the page is much shorter than it
 *     was at this width" as keyboard-open (touch screens only).
 * - `useRevealFocusedField(ref)`: when a field inside `ref` gets focus, and again when the keyboard
 *   finishes opening, scroll it to the middle of what is still visible, and above a bar still
 *   floating at the bottom (an element marked `data-reveal-avoid` with `position: fixed`).
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

/** Tallest layout viewport seen at the current width: the page with no keyboard up. */
let tallest = { width: 0, height: 0 }

/** Remember the page height at this width (a new width, i.e. a rotation, starts over). */
export function noteViewport(win: Pick<Window, 'innerWidth' | 'innerHeight'> = window): void {
  if (win.innerWidth !== tallest.width) tallest = { width: win.innerWidth, height: win.innerHeight }
  else if (win.innerHeight > tallest.height) tallest = { ...tallest, height: win.innerHeight }
}

/** Tests: forget the remembered page height. */
export function resetViewportMemory(): void {
  tallest = { width: 0, height: 0 }
}

/**
 * A keyboard that resized the page itself: a typing field has focus and the layout viewport is
 * more than KEYBOARD_MIN_PX shorter than the tallest seen at this width.
 */
export function layoutShrunk(win: Pick<Window, 'innerWidth' | 'innerHeight'> = window, focused: Element | null = document.activeElement): boolean {
  if (!isTypingField(focused) || win.innerWidth !== tallest.width) return false
  return tallest.height - win.innerHeight > KEYBOARD_MIN_PX
}

const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

export interface KeyboardState {
  /** Pixels of the page the keyboard covers (0 when closed, or when the page was resized instead). */
  inset: number
  open: boolean
}

/** Whether an on-screen keyboard is up, and how much of the page it covers. */
export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ inset: 0, open: false })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    // A desktop window made shorter while typing is not a keyboard.
    const touch = coarsePointer()
    const update = () => {
      noteViewport()
      const inset = keyboardInset()
      const open = inset > 0 || (touch && layoutShrunk())
      setState((s) => (s.inset === inset && s.open === open ? s : { inset, open }))
    }
    // Focus moves before or after the resize, depending on the browser: check again shortly after.
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      update()
      clearTimeout(timer)
      timer = setTimeout(update, 350)
    }
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', soon)
    document.addEventListener('focusout', soon)
    return () => {
      clearTimeout(timer)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', soon)
      document.removeEventListener('focusout', soon)
    }
  }, [])
  return state
}

export function useKeyboardOpen(): boolean {
  return useKeyboardState().open
}

/** Pixels of the page the on-screen keyboard covers right now (0 when closed). */
export function useKeyboardInset(): number {
  return useKeyboardState().inset
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
      // A bar still floating over the bottom (marked data-reveal-avoid) must not cover the field either.
      const bar = el.querySelector<HTMLElement>('[data-reveal-avoid]')
      const barTop = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top - off : null
      const bottomReserve = barTop !== null && barTop > 0 && barTop < visible ? visible - barTop : 0
      if (needsReveal({ top: r.top - off, bottom: r.bottom - off }, visible, topReserve, bottomReserve)) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        f.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
        // Centred can still be under a tall floating bar on a short screen: nudge the page up.
        if (bottomReserve) {
          const nudge = () => {
            const over = f.getBoundingClientRect().bottom - off - (visible - bottomReserve - 12)
            if (over > 0) window.scrollBy?.({ top: over, behavior: 'auto' })
          }
          if (reduce) nudge()
          else setTimeout(nudge, 400)
        }
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
    // A keyboard that resizes the page itself fires a window resize (and maybe no viewport one).
    window.addEventListener('resize', later)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('focusin', onFocus)
      vv?.removeEventListener('resize', later)
      window.removeEventListener('resize', later)
    }
  }, [root, topReserve])
}
