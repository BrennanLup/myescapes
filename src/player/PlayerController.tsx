/**
 * Player controller (inside the Canvas): first person, or third person behind your character.
 * Keyboard movement, pointer-lock mouse look with click-and-drag fallback,
 * touch joystick/look via runtime, collisions against the collider registry.
 * `V` toggles the camera mode (see view.ts); the camera maths live in camera.ts.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { colliders } from '@/contracts/colliders'
import { runtime } from '@/contracts/runtime'
import { PLAYER, type Vec3 } from '@/contracts/scene'
import { selectControlsEnabled, useStore } from '@/state/store'
import { clearDistance, damp, easeBlend, followDistance, lookVector, rayStartDistance, stepBodyYaw, THIRD_PERSON, thirdPersonOffset } from './camera'
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
import { playerView, useCameraMode } from './view'

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
  /** Third-person camera state: smoothed head pivot and the current (wall-limited) distance. */
  const cam = useRef({ pivot: [0, 0, 0] as Vec3, distance: 0, clear: 1, init: false })

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
      if (code === 'KeyV') {
        if (!e.repeat && controlsEnabled()) useCameraMode.getState().toggle()
        return
      }
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
    const view = playerView
    const mode = useCameraMode.getState().mode
    view.mode = mode
    const dt = Math.min(Math.max(delta, 0), 0.25)
    const blendStep = dt / THIRD_PERSON.blendSeconds
    view.blend = mode === 'third' ? Math.min(1, view.blend + blendStep) : Math.max(0, view.blend - blendStep)
    const third = easeBlend(view.blend)

    // Head bob only makes sense through the character's own eyes.
    const bob = headBob ? headBobOffset(s.bobPhase, speed) * (1 - third) : 0
    const pos: Vec3 = [s.pos[0], baseY.current + bob, s.pos[1]]
    p.position = pos
    p.yaw = s.yaw
    p.pitch = s.pitch
    p.speed = speed
    p.moving = speed > 0.3
    written.current = { position: [pos[0], pos[1], pos[2]], yaw: s.yaw, pitch: s.pitch }

    view.feet = [s.pos[0], baseY.current - PLAYER.eyeHeight, s.pos[1]]
    view.bodyYaw = stepBodyYaw(view.bodyYaw, s.vel, s.yaw, third > 0 ? 'third' : 'first', dt)
    view.lookPitch = s.pitch
    view.speed = speed

    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    const c = cam.current
    const head: Vec3 = [pos[0], baseY.current - THIRD_PERSON.pivotDrop, pos[2]]
    if (third <= 0) {
      c.init = false
      c.distance = 0
      c.clear = 1
      view.cameraDistance = 0
      view.rayStart = 0
      camera.position.set(pos[0], pos[1], pos[2])
      return
    }
    // Smooth follow of the head; snap after teleports and on the first third-person frame.
    const jump = Math.hypot(head[0] - c.pivot[0], head[1] - c.pivot[1], head[2] - c.pivot[2])
    if (!c.init || jump > 2) {
      c.pivot = [...head]
      c.init = true
    } else {
      c.pivot = [0, 1, 2].map((i) => damp(c.pivot[i], head[i], THIRD_PERSON.followRate, dt)) as Vec3
    }
    const want = thirdPersonOffset(s.yaw, s.pitch, THIRD_PERSON.distance * third, THIRD_PERSON.side * third, THIRD_PERSON.up * third)
    const wantLen = Math.hypot(want[0], want[1], want[2])
    // Work in fractions of the wanted offset, so the mode blend and the wall pull-in compose.
    const allowed = wantLen > 1e-6 ? Math.min(1, clearDistance(c.pivot, want, boxes.current) / wantLen) : 0
    c.clear = followDistance(c.clear, allowed, dt)
    const k = c.clear
    c.distance = wantLen * k
    const camPos: Vec3 = [c.pivot[0] + want[0] * k, c.pivot[1] + want[1] * k, c.pivot[2] + want[2] * k]
    camera.position.set(camPos[0], camPos[1], camPos[2])
    view.cameraDistance = c.distance
    view.rayStart = rayStartDistance(camPos, lookVector(s.yaw, s.pitch), pos)
  })

  return null
}
