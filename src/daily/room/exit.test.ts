import { afterEach, describe, expect, it } from 'vitest'
import { runtime } from '@/contracts/runtime'
import { ANCHORS } from '@/contracts/scene'
import { useStore } from '@/state/store'
import { newProgress, type Progress } from '../ui/state'
import { clearWelcomeNote, readWelcomeNote, takeWelcomeNote, welcomeLine } from '../ui/welcome'
import { exitTarget, homeArrivalPose, walkHome } from './exit'

const solved: Progress = { ...newProgress('2026-10-28', 3), status: 'solved', startedAt: 1000, finishedAt: 61_000, guesses: [['1', '2', '3']], grid: [['hit', 'hit', 'hit']] }

afterEach(() => {
  clearWelcomeNote()
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
    expect(p.position[2]).toBeGreaterThan(ANCHORS.gateDoor.position[2] - 3)
    expect(p.yaw).toBe(0)
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
