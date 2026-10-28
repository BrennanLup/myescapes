import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../../state/store'
import { PlayIn3D } from './Play3D'
import { clearWelcomeNote, DailyWelcome, leaveWelcomeNote } from './welcome'

afterEach(() => {
  cleanup()
  clearWelcomeNote()
  useStore.getState().setWorldReady(false)
})

const note = { number: 7, solved: true, guesses: 2, maxGuesses: 6, timeMs: 83_000, at: Date.now() }

describe('DailyWelcome (main room, after walking out of the puzzle room)', () => {
  it('waits for the room to be entered, then celebrates once', () => {
    leaveWelcomeNote({ ...note, signedIn: true })
    render(<DailyWelcome />)
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
    act(() => useStore.getState().setWorldReady(true))
    expect(screen.getByTestId('daily-welcome-line').textContent).toBe('You escaped #7 in 2/6 · 1:23')
    expect(screen.queryByTestId('daily-welcome-signin')).toBeNull()
    cleanup()
    render(<DailyWelcome />)
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
  })

  it('asks signed-out players to sign in', () => {
    leaveWelcomeNote({ ...note, solved: false, signedIn: false })
    useStore.getState().setWorldReady(true)
    render(<DailyWelcome />)
    expect(screen.getByTestId('daily-welcome-signin').textContent).toMatch(/Continue with Google/)
  })

  it('renders nothing without a note', () => {
    useStore.getState().setWorldReady(true)
    render(<DailyWelcome />)
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
  })
})

describe('PlayIn3D', () => {
  it('links to the puzzle room', () => {
    render(<PlayIn3D />)
    expect(screen.getByTestId('daily-play-3d').getAttribute('href')).toBe('/daily/room')
  })
})
