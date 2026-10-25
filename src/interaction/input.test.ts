import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '@/contracts/events'
import { interactable } from '@/contracts/interaction'
import { useStore } from '@/state/store'
import { setHoveredSpec } from './controller'
import { attachInteractionInput } from './input'

const spec = interactable({ id: 'desk', kind: 'desk', label: 'Record a room', event: { type: 'record:open', payload: {} } })
  .userData.interactable

function pointer(type: string, target: EventTarget, init: { id?: number; kind?: string; x?: number; y?: number; button?: number } = {}) {
  const e = new PointerEvent(type, {
    pointerId: init.id ?? 3,
    pointerType: init.kind ?? 'touch',
    isPrimary: true,
    button: init.button ?? 0,
    clientX: init.x ?? 100,
    clientY: init.y ?? 200,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(e)
  return e
}

function touchEnd(target: EventTarget) {
  const e = new Event('touchend', { bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

function click(target: EventTarget, x = 100, y = 200) {
  const e = new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

describe('attachInteractionInput', () => {
  let canvas: HTMLCanvasElement
  let button: HTMLButtonElement
  let detach: () => void
  let opened: number
  let clicked: number
  let off: () => void

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] })
    useStore.setState({ worldReady: true, overlay: null })
    canvas = document.createElement('canvas')
    button = document.createElement('button')
    button.addEventListener('click', () => clicked++)
    document.body.append(canvas, button)
    opened = 0
    clicked = 0
    off = bus.on('record:open', () => opened++)
    detach = attachInteractionInput(canvas, () => spec)
  })

  afterEach(() => {
    detach()
    off()
    canvas.remove()
    button.remove()
    setHoveredSpec(null)
    useStore.setState({ worldReady: false, overlay: null })
    vi.useRealTimers()
  })

  it('a tap on the canvas interacts and is consumed (no ghost click on the opened overlay)', () => {
    pointer('pointerdown', canvas)
    const up = pointer('pointerup', canvas)
    expect(opened).toBe(1)
    expect(up.defaultPrevented).toBe(true)
    // Touch sequence: touchend is cancelled so the browser never synthesizes the click.
    expect(touchEnd(canvas).defaultPrevented).toBe(true)
    // Pointer-only sequence: a click still arrives on the overlay button under the finger.
    const ghost = click(button)
    expect(ghost.defaultPrevented).toBe(true)
    expect(clicked).toBe(0)
    // Only one click is eaten: the next real tap on the button works.
    click(button)
    expect(clicked).toBe(1)
  })

  it('a later or far-away click is not swallowed', () => {
    pointer('pointerdown', canvas)
    pointer('pointerup', canvas)
    expect(opened).toBe(1)
    click(button, 300, 600)
    expect(clicked).toBe(1)
    vi.advanceTimersByTime(1000)
    click(button)
    expect(clicked).toBe(2)
  })

  it('a tap that hits nothing is not consumed', () => {
    detach()
    detach = attachInteractionInput(canvas, () => null)
    pointer('pointerdown', canvas)
    const up = pointer('pointerup', canvas)
    expect(opened).toBe(0)
    expect(up.defaultPrevented).toBe(false)
    expect(touchEnd(canvas).defaultPrevented).toBe(false)
    click(button)
    expect(clicked).toBe(1)
  })

  it('a tap on a HUD button does not interact (only canvas / look surfaces do)', () => {
    pointer('pointerdown', button)
    pointer('pointerup', button)
    click(button)
    expect(opened).toBe(0)
    expect(clicked).toBe(1)
  })

  it('a locked mouse click interacts and its own click is swallowed', () => {
    setHoveredSpec(spec)
    let locked: Element | null = canvas
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked })
    pointer('pointerdown', canvas, { kind: 'mouse', id: 1 })
    expect(opened).toBe(1)
    locked = null
    pointer('pointerup', button, { kind: 'mouse', id: 1, x: 720, y: 450 })
    click(button, 720, 450)
    expect(clicked).toBe(0)
    click(button, 720, 450)
    expect(clicked).toBe(1)
    delete (document as { pointerLockElement?: unknown }).pointerLockElement
  })

  it('an unlocked mouse click does not interact or swallow', () => {
    setHoveredSpec(spec)
    pointer('pointerdown', canvas, { kind: 'mouse', id: 1 })
    pointer('pointerup', canvas, { kind: 'mouse', id: 1 })
    click(button)
    expect(opened).toBe(0)
    expect(clicked).toBe(1)
  })
})
