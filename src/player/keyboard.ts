/**
 * Keyboard state for movement. Tracks held movement keys by `KeyboardEvent.code`
 * and turns them into a MoveInput. Pure apart from the DOM helper `isTypingTarget`.
 */
import type { MoveInput } from './movement'

export const FORWARD_KEYS = ['KeyW', 'ArrowUp'] as const
export const BACK_KEYS = ['KeyS', 'ArrowDown'] as const
export const LEFT_KEYS = ['KeyA', 'ArrowLeft'] as const
export const RIGHT_KEYS = ['KeyD', 'ArrowRight'] as const
export const RUN_KEYS = ['ShiftLeft', 'ShiftRight'] as const

const MOVE_KEYS = new Set<string>([...FORWARD_KEYS, ...BACK_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, ...RUN_KEYS])

/** Fallback for synthetic events that only set `key`. */
const KEY_TO_CODE: Record<string, string> = {
  w: 'KeyW', W: 'KeyW', s: 'KeyS', S: 'KeyS', a: 'KeyA', A: 'KeyA', d: 'KeyD', D: 'KeyD',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Shift: 'ShiftLeft',
}

export function eventCode(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  return e.code || KEY_TO_CODE[e.key] || ''
}

export function isMoveKey(code: string): boolean {
  return MOVE_KEYS.has(code)
}

export function inputFromKeys(held: ReadonlySet<string>): MoveInput {
  const any = (keys: readonly string[]) => keys.some((k) => held.has(k))
  return {
    forward: (any(FORWARD_KEYS) ? 1 : 0) - (any(BACK_KEYS) ? 1 : 0),
    strafe: (any(RIGHT_KEYS) ? 1 : 0) - (any(LEFT_KEYS) ? 1 : 0),
    run: any(RUN_KEYS),
  }
}

/** True when keys should go to a form field instead of the player. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).tagName !== 'string') return false
  const el = t as HTMLElement
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}
