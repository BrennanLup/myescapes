/** Pure joystick maths: screen offset (px) -> movement vector. */

/** Fraction of travel ignored around the centre. */
export const JOYSTICK_DEADZONE = 0.12

/**
 * dx/dy are the finger offset from the joystick centre in screen pixels
 * (y grows downward). Returns x = strafe right, y = forward, both in [-1, 1],
 * plus the knob offset clamped to the travel radius.
 */
export function joystickVector(dx: number, dy: number, travel: number): { x: number; y: number; knobX: number; knobY: number } {
  const d = Math.hypot(dx, dy)
  if (d < 1e-9 || travel <= 0) return { x: 0, y: 0, knobX: 0, knobY: 0 }
  const clamped = Math.min(d, travel)
  const knobX = (dx / d) * clamped
  const knobY = (dy / d) * clamped
  const m = clamped / travel
  if (m < JOYSTICK_DEADZONE) return { x: 0, y: 0, knobX, knobY }
  const scaled = (m - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE)
  return { x: (dx / d) * scaled, y: (-dy / d) * scaled, knobX, knobY }
}
