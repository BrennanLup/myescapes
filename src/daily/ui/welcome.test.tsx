import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../../state/store'
import { PlayIn3D } from './Play3D'
import { resetShellForTests, useShell } from '../../ui/shell/shellStore'
import { clearWelcomeNote, DailyWelcome, leaveWelcomeNote } from './welcome'
import { markArrivingFromDaily, takeArrivingFromDaily } from './welcomeNote'

afterEach(() => {
  cleanup()
  clearWelcomeNote()
  useStore.getState().setWorldReady(false)
  takeArrivingFromDaily()
  resetShellForTests()
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

describe('arriving from the puzzle room skips the first "How to play" card', () => {
  it('closes the automatic card once, and the help button still opens it', () => {
    markArrivingFromDaily()
    render(<DailyWelcome />)
    // The HUD opens the card once the world is ready.
    act(() => useShell.getState().openHint())
    expect(useShell.getState().hintOpen).toBe(false)
    act(() => useShell.getState().openHint())
    expect(useShell.getState().hintOpen).toBe(true)
  })

  it('still shows it when the room was opened any other way', () => {
    render(<DailyWelcome />)
    act(() => useShell.getState().openHint())
    expect(useShell.getState().hintOpen).toBe(true)
  })

  it('handles a card that opened before the welcome mounted its effect', () => {
    markArrivingFromDaily()
    // Like the HUD mounted before it: its effect opens the card first.
    function OpensFirst() {
      useEffect(() => useShell.getState().openHint(), [])
      return null
    }
    render(
      <>
        <OpensFirst />
        <DailyWelcome />
      </>,
    )
    expect(useShell.getState().hintOpen).toBe(false)
  })
})
