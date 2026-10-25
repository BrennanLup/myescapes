import { describe, expect, it } from 'vitest'
import { eventCode, inputFromKeys, isTypingTarget } from './keyboard'
import { joystickVector } from './joystick'

describe('keyboard', () => {
  it('maps WASD and arrows', () => {
    expect(inputFromKeys(new Set(['KeyW']))).toEqual({ forward: 1, strafe: 0, run: false })
    expect(inputFromKeys(new Set(['ArrowDown', 'ArrowLeft', 'ShiftLeft']))).toEqual({ forward: -1, strafe: -1, run: true })
    expect(inputFromKeys(new Set(['KeyW', 'KeyS', 'KeyD']))).toEqual({ forward: 0, strafe: 1, run: false })
  })
  it('falls back to key when code is empty', () => {
    expect(eventCode({ code: '', key: 'w' })).toBe('KeyW')
    expect(eventCode({ code: 'KeyA', key: 'q' })).toBe('KeyA')
  })
  it('detects typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(window)).toBe(false)
  })
})

describe('joystick', () => {
  it('up is forward, right is strafe right, clamped to 1', () => {
    const up = joystickVector(0, -500, 50)
    expect(up.y).toBeCloseTo(1)
    expect(up.x).toBeCloseTo(0)
    expect(up.knobY).toBeCloseTo(-50)
    const right = joystickVector(50, 0, 50)
    expect(right.x).toBeCloseTo(1)
  })
  it('has a dead zone', () => {
    expect(joystickVector(2, 2, 50)).toMatchObject({ x: 0, y: 0 })
  })
})
