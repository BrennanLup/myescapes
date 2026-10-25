/**
 * First-person controller (inside the Canvas). No visible avatar.
 * Keyboard movement, pointer-lock mouse look with click-and-drag fallback,
 * touch joystick/look via runtime, collisions against the collider registry.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { colliders } from '@/contracts/colliders'
import { runtime } from '@/contracts/runtime'
import { PLAYER, type Vec3 } from '@/contracts/scene'
import { selectControlsEnabled, useStore } from '@/state/store'
import { eventCode, inputFromKeys, isMoveKey, isTypingTarget } from './keyboard'
import {
  applyLook,
  headBobOffset,
  MOUSE_LOOK_RAD_PER_PX,
  NO_INPUT,
  speedOf,
  stepMovement,
  TOUCH_LOOK_RAD_PER_PX,
  type MoveInput,
  type MoveState,
} from './movement'

/** Ignore single locked-mouse events larger than this (px); real flicks are spread over many events. */
const MAX_LOCKED_DELTA = 250

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

function controlsEnabled() {
  return selectControlsEnabled(useStore.getState())
}

export function PlayerController() {
  const gl = useThree((s) => s.gl)
  const held = useRef(new Set<string>())
  const look = useRef({ x: 0, y: 0 })
  const state = useRef<MoveState>({
    pos: [runtime.player.position[0], runtime.player.position[2]],
    vel: [0, 0],
    yaw: runtime.player.yaw,
    pitch: runtime.player.pitch,
    bobPhase: 0,
  })
  const baseY = useRef<number>(runtime.player.position[1] || PLAYER.eyeHeight)
  /** What we last wrote to runtime.player, to detect outside edits (tests/screenshots). */
  const written = useRef<{ position: Vec3; yaw: number; pitch: number } | null>(null)
  const boxes = useRef(colliders.all())

  // Collider cache (refresh on registry change).
  useEffect(() => {
    boxes.current = colliders.all()
    return colliders.subscribe(() => {
      boxes.current = colliders.all()
    })
  }, [])

  // Keyboard.
  useEffect(() => {
    const keys = held.current
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const code = eventCode(e)
      if (!isMoveKey(code) || !controlsEnabled()) return
      keys.add(code)
      if (code.startsWith('Arrow')) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      keys.delete(eventCode(e))
      // Shift released alongside a letter can leave stale codes; fine, keyup clears each.
    }
    const releaseAll = () => keys.clear()
    const onVisibility = () => document.hidden && releaseAll()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibility)
    const unsub = useStore.subscribe((s, prev) => {
      if (selectControlsEnabled(prev) && !selectControlsEnabled(s)) {
        releaseAll()
        look.current.x = look.current.y = 0
      }
    })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
      unsub()
    }
  }, [])

  // Mouse: pointer lock with click-and-drag fallback.
  useEffect(() => {
    const canvas = gl.domElement
    let lockFailed = false
    let drag: { id: number; x: number; y: number } | null = null
    let skipMoves = 0
    const locked = () => document.pointerLockElement === canvas

    const requestLock = () => {
      if (lockFailed || locked() || !canvas.requestPointerLock) return
      try {
        const r = canvas.requestPointerLock() as unknown
        if (r && typeof (r as Promise<void>).catch === 'function') {
          ;(r as Promise<void>).catch(() => {
            lockFailed = true
          })
        }
      } catch {
        lockFailed = true
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (!useStore.getState().isTouch) useStore.getState().setTouch(true)
        return
      }
      if (e.button !== 0 || !controlsEnabled()) return
      if (!useStore.getState().isTouch) requestLock()
      if (!locked()) drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (locked()) {
        // Browsers can report a bogus jump on the first event(s) after locking.
        if (skipMoves > 0) {
          skipMoves--
          return
        }
        if (Math.abs(e.movementX) > MAX_LOCKED_DELTA || Math.abs(e.movementY) > MAX_LOCKED_DELTA) return
        if (controlsEnabled()) {
          look.current.x += e.movementX
          look.current.y += e.movementY
        }
        return
      }
      if (drag && e.pointerId === drag.id) {
        if (controlsEnabled()) {
          look.current.x += e.clientX - drag.x
          look.current.y += e.clientY - drag.y
        }
        drag.x = e.clientX
        drag.y = e.clientY
      }
    }
    const endDrag = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null
    }
    const onLockChange = () => {
      const l = locked()
      if (l) {
        drag = null
        skipMoves = 2
      }
      if (useStore.getState().pointerLocked !== l) useStore.getState().setPointerLocked(l)
    }
    const onLockError = () => {
      lockFailed = true
      onLockChange()
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    const onBlur = () => {
      drag = null
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      if (locked()) document.exitPointerLock?.()
    }
  }, [gl])

  useFrame(({ camera }, delta) => {
    const st = useStore.getState()
    const enabled = selectControlsEnabled(st)
    const p = runtime.player
    let s = state.current

    // Outside edits to runtime.player (legacy screenshot scripts) win.
    const w = written.current
    if (w && (p.position[0] !== w.position[0] || p.position[1] !== w.position[1] || p.position[2] !== w.position[2] || p.yaw !== w.yaw || p.pitch !== w.pitch)) {
      if (p.position[1] !== w.position[1]) baseY.current = p.position[1]
      s = { ...s, pos: [p.position[0], p.position[2]], vel: [0, 0], yaw: p.yaw, pitch: p.pitch }
    }

    const tp = runtime.pendingTeleport
    if (tp) {
      runtime.pendingTeleport = null
      baseY.current = Number.isFinite(tp.position[1]) ? tp.position[1] : PLAYER.eyeHeight
      s = {
        ...s,
        pos: [tp.position[0], tp.position[2]],
        vel: [0, 0],
        yaw: tp.yaw ?? s.yaw,
        pitch: tp.pitch ?? s.pitch,
      }
    }

    // Look.
    const { sensitivity, invertY, headBob } = st.settings
    const ld = runtime.lookDelta
    if (enabled && (look.current.x || look.current.y || ld.x || ld.y)) {
      let r = applyLook(s.yaw, s.pitch, look.current.x, look.current.y, MOUSE_LOOK_RAD_PER_PX, sensitivity, invertY)
      r = applyLook(r.yaw, r.pitch, ld.x, ld.y, TOUCH_LOOK_RAD_PER_PX, sensitivity, invertY)
      s = { ...s, yaw: r.yaw, pitch: r.pitch }
    }
    look.current.x = look.current.y = 0
    ld.x = ld.y = 0

    // Move.
    let input: MoveInput = NO_INPUT
    if (enabled) {
      const k = inputFromKeys(held.current)
      const j = runtime.joystick
      input = { forward: clamp1(k.forward + j.y), strafe: clamp1(k.strafe + j.x), run: k.run }
    }
    s = stepMovement(s, input, delta, { boxes: boxes.current })
    state.current = s

    const speed = speedOf(s)
    const bob = headBob ? headBobOffset(s.bobPhase, speed) : 0
    const pos: Vec3 = [s.pos[0], baseY.current + bob, s.pos[1]]
    p.position = pos
    p.yaw = s.yaw
    p.pitch = s.pitch
    p.speed = speed
    p.moving = speed > 0.3
    written.current = { position: [pos[0], pos[1], pos[2]], yaw: s.yaw, pitch: s.pitch }

    camera.position.set(pos[0], pos[1], pos[2])
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
  })

  return null
}
