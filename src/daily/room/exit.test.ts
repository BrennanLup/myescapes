import { afterEach, describe, expect, it } from 'vitest'
import { runtime } from '@/contracts/runtime'
import { ANCHORS } from '@/contracts/scene'
import { useStore } from '@/state/store'
import { newProgress, type Progress } from '../ui/state'
import { clearWelcomeNote, readWelcomeNote, takeWelcomeNote, welcomeLine } from '../ui/welcome'
import { takeArrivingFromDaily } from '../ui/welcomeNote'
import { clearDistance, DESKTOP_RIG, orbitPitch, THIRD_PERSON, thirdPersonOffset, TOUCH_RIG, type CameraRig } from '@/player/camera'
import { gateColliders } from '@/gate/colliders'
import { wallColliders } from '@/world/room/layout'
import { boardColliders } from '@/world/board/colliders'
import { wishlistColliders } from '@/world/wishlist/colliders'
import { LIVING_COLLIDERS } from '@/world/props/living/layout'
import { deskColliders } from '@/world/props/desk/layout'
import { wrapColliders } from '@/ui/wrap/colliders'
import { exitTarget, homeArrivalPose, walkHome } from './exit'

const solved: Progress = { ...newProgress('2026-10-28', 3), status: 'solved', startedAt: 1000, finishedAt: 61_000, guesses: [['1', '2', '3']], grid: [['hit', 'hit', 'hit']] }

afterEach(() => {
  clearWelcomeNote()
  takeArrivingFromDaily()
  window.history.replaceState(null, '', '/')
})

describe('leaving the puzzle room', () => {
  it('leads signed-in players home and signed-out players to the demo room', () => {
    expect(exitTarget(true)).toBe('/?autostart=1')
    expect(exitTarget(false)).toBe('/?demo=1&autostart=1')
  })

  it('arrives just inside the room door, facing the board', () => {
    const p = homeArrivalPose()
    expect(p.position[2]).toBeLessThan(ANCHORS.gateDoor.position[2])
    expect(p.position[2]).toBeGreaterThan(ANCHORS.gateDoor.position[2] - 4)
    // Far enough in that the third-person camera behind you clears the south wall.
    expect(ANCHORS.gateDoor.position[2] - p.position[2]).toBeGreaterThanOrEqual(THIRD_PERSON.distance)
    expect(p.yaw).toBe(0)
  })

  /** How much of a rig's distance the third-person camera keeps at the arrival pose, with every static collider of the main room. */
  function keptAtArrival(rig: CameraRig, doorOpen: boolean): number {
    const p = homeArrivalPose()
    const pivot: [number, number, number] = [p.position[0], p.position[1] - THIRD_PERSON.pivotDrop, p.position[2]]
    const want = thirdPersonOffset(p.yaw, orbitPitch(p.pitch, pivot[1], rig), rig.distance, rig.side, rig.up)
    const boxes = [...wallColliders(), ...gateColliders(doorOpen), ...boardColliders(), ...wishlistColliders(), ...LIVING_COLLIDERS, ...deskColliders(), ...wrapColliders()]
    return Math.min(1, clearDistance(pivot, want, boxes) / Math.hypot(...want))
  }

  it('arrives where the third-person camera keeps its full distance, door open or closed', () => {
    // After a solved day the door leaf stands open into the room: it used to pull the camera to about 2 m.
    for (const open of [false, true]) {
      expect(keptAtArrival(DESKTOP_RIG, open)).toBeGreaterThan(0.99)
      // Touch-screen laptops and tablets that get the 3D room: higher and further back, nearly all of it.
      expect(keptAtArrival(TOUCH_RIG, open)).toBeGreaterThan(0.9)
    }
  })

  it('the open door leaf stays out of a wide (21:9) third-person view at the arrival', () => {
    const p = homeArrivalPose()
    const want = thirdPersonOffset(p.yaw, 0, DESKTOP_RIG.distance, DESKTOP_RIG.side, DESKTOP_RIG.up)
    const cam = [p.position[0] + want[0], p.position[2] + want[2]]
    const leaf = gateColliders(true).find((b) => b.id === 'gate:door-leaf')!
    // Horizontal half field of view of a 21:9 screen at the room's 70 degree vertical one: about 59 degrees.
    const half = Math.atan(Math.tan((35 * Math.PI) / 180) * (21 / 9))
    for (const x of [leaf.min[0], leaf.max[0]]) {
      for (const z of [leaf.min[2], leaf.max[2]]) {
        const ahead = cam[1] - z
        if (ahead <= 0) continue
        expect(Math.atan2(Math.abs(x - cam[0]), ahead)).toBeGreaterThan(half)
      }
    }
  })

  it('walks home: pose, a clean shell, a welcome note and the navigation', () => {
    useStore.getState().openOverlay({ kind: 'gate' })
    useStore.getState().setWorldReady(true)
    const to = walkHome({ progress: solved, maxGuesses: 6, signedIn: true })
    expect(to).toBe('/?autostart=1')
    expect(window.location.pathname + window.location.search).toBe('/?autostart=1')
    expect(runtime.player.position).toEqual(homeArrivalPose().position)
    expect(useStore.getState().overlay).toBeNull()
    expect(useStore.getState().worldReady).toBe(false)
    const note = readWelcomeNote()
    expect(note).toMatchObject({ number: 3, solved: true, guesses: 1, maxGuesses: 6, timeMs: 60_000, signedIn: true })
    expect(welcomeLine(note!)).toBe('You escaped #3 in 1/6 · 1:00')
    // The main room skips its first "How to play" card.
    expect(takeArrivingFromDaily()).toBe(true)
    expect(takeArrivingFromDaily()).toBe(false)
  })

  it('leaving before finishing leaves no celebration', () => {
    walkHome({ progress: { ...newProgress('2026-10-28', 3), status: 'playing', startedAt: 1 }, maxGuesses: 6, signedIn: false })
    expect(window.location.search).toBe('?demo=1&autostart=1')
    expect(readWelcomeNote()).toBeNull()
  })

  it('sends phones straight to /m with the from=daily flag after a finished day', () => {
    expect(exitTarget(false, true)).toBe('/m?from=daily')
    const to = walkHome({ progress: solved, maxGuesses: 6, signedIn: false, phone: true })
    expect(to).toBe('/m?from=daily')
    expect(window.location.pathname + window.location.search).toBe('/m?from=daily')
    expect(readWelcomeNote()).toMatchObject({ number: 3, solved: true, signedIn: false })
  })

  it('a phone leaving before finishing just goes to /m', () => {
    const to = walkHome({ progress: { ...newProgress('2026-10-28', 3), status: 'playing', startedAt: 1 }, maxGuesses: 6, signedIn: true, phone: true })
    expect(to).toBe('/m')
    expect(readWelcomeNote()).toBeNull()
  })

  it('the note is read once and goes stale', () => {
    walkHome({ progress: { ...solved, status: 'failed' }, maxGuesses: 6, signedIn: false })
    const n = takeWelcomeNote()
    expect(n?.solved).toBe(false)
    expect(welcomeLine(n!)).toMatch(/stayed locked/)
    expect(takeWelcomeNote()).toBeNull()
    walkHome({ progress: solved, maxGuesses: 6, signedIn: true })
    expect(readWelcomeNote(Date.now() + 10 * 60_000)).toBeNull()
  })
})
