/**
 * Touch controls (DOM overlay): a virtual joystick bottom-left and a
 * full-screen drag-look surface. Writes runtime.joystick and runtime.lookDelta;
 * the PlayerController consumes them each frame.
 *
 * The look surface never stops propagation or prevents default on taps, so the
 * interaction system's window-level tap listener still sees them. Joystick
 * events do stop propagation (a thumb on the stick is never a world tap).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { runtime } from '@/contracts/runtime'
import { selectControlsEnabled, useStore } from '@/state/store'
import { joystickVector } from './joystick'

/** Joystick base diameter and knob travel, px. */
const BASE = 150
const KNOB = 66
const TRAVEL = (BASE - KNOB) / 2 + 8

function resetJoystick() {
  runtime.joystick.x = 0
  runtime.joystick.y = 0
}

/** Switch to touch mode on the first real touch anywhere. */
function useTouchDetection() {
  const isTouch = useStore((s) => s.isTouch)
  useEffect(() => {
    if (isTouch) return
    const on = (e: Event) => {
      if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'touch') return
      useStore.getState().setTouch(true)
    }
    window.addEventListener('touchstart', on, { passive: true, capture: true })
    window.addEventListener('pointerdown', on, { capture: true })
    return () => {
      window.removeEventListener('touchstart', on, { capture: true })
      window.removeEventListener('pointerdown', on, { capture: true })
    }
  }, [isTouch])
}

function LookSurface() {
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  useEffect(() => {
    const map = pointers.current
    return () => {
      map.clear()
      runtime.lookDelta.x = runtime.lookDelta.y = 0
    }
  }, [])
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    runtime.lookDelta.x += e.clientX - p.x
    runtime.lookDelta.y += e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
  }
  return (
    <div
      data-look-surface=""
      aria-hidden="true"
      className="absolute inset-0"
      style={{ touchAction: 'none' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  )
}

function Joystick() {
  const active = useRef<{ id: number; cx: number; cy: number } | null>(null)
  const [knob, setKnob] = useState<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false })

  useEffect(() => resetJoystick, [])

  const update = (clientX: number, clientY: number) => {
    const a = active.current
    if (!a) return
    const v = joystickVector(clientX - a.cx, clientY - a.cy, TRAVEL)
    runtime.joystick.x = v.x
    runtime.joystick.y = v.y
    setKnob({ x: v.knobX, y: v.knobY, on: true })
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (active.current) return
    const r = e.currentTarget.getBoundingClientRect()
    active.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointers */
    }
    update(e.clientX, e.clientY)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (active.current?.id !== e.pointerId) return
    e.stopPropagation()
    update(e.clientX, e.clientY)
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (active.current?.id !== e.pointerId) return
    e.stopPropagation()
    active.current = null
    resetJoystick()
    setKnob({ x: 0, y: 0, on: false })
  }

  return (
    <div
      role="presentation"
      data-joystick=""
      className="absolute rounded-full"
      style={{
        left: 'max(22px, env(safe-area-inset-left))',
        bottom: 'max(30px, calc(env(safe-area-inset-bottom) + 18px))',
        width: BASE,
        height: BASE,
        touchAction: 'none',
        background: 'radial-gradient(circle at 50% 45%, rgba(255,247,236,0.42), rgba(255,247,236,0.18) 70%)',
        border: '3px solid rgba(232,201,164,0.75)',
        boxShadow: '0 10px 30px rgba(60,30,20,0.28), inset 0 0 18px rgba(255,255,255,0.25)',
        backdropFilter: 'blur(3px)',
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {/* direction ticks */}
      {[0, 90, 180, 270].map((deg) => (
        <span
          key={deg}
          className="absolute left-1/2 top-1/2 block"
          style={{
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom: '9px solid rgba(255,247,236,0.75)',
            transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-${BASE / 2 - 14}px)`,
          }}
        />
      ))}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          transition: knob.on ? 'none' : 'transform 160ms ease-out',
          background: 'radial-gradient(circle at 38% 32%, #fff7ec, #f3c79a 60%, #e07b39)',
          border: '3px solid rgba(255,247,236,0.95)',
          boxShadow: knob.on ? '0 6px 18px rgba(224,123,57,0.55)' : '0 6px 16px rgba(60,30,20,0.35)',
          opacity: knob.on ? 0.95 : 0.85,
        }}
      />
    </div>
  )
}

export function MobileControls() {
  useTouchDetection()
  const isTouch = useStore((s) => s.isTouch)
  const enabled = useStore(selectControlsEnabled)
  const visible = isTouch && enabled
  useEffect(() => {
    if (!visible) resetJoystick()
  }, [visible])
  if (!visible) return null
  return (
    <div className="fixed inset-0" style={{ zIndex: 5 }} data-mobile-controls="">
      <LookSurface />
      <Joystick />
    </div>
  )
}
