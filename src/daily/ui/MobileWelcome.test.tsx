import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MobileDailyWelcome } from './MobileWelcome'
import { clearWelcomeNote, isFromDaily, leaveWelcomeNote, readWelcomeNote } from './welcomeNote'

const note = { number: 3, solved: true, guesses: 1, maxGuesses: 6, timeMs: 60_000, at: Date.now() }

afterEach(() => {
  cleanup()
  clearWelcomeNote()
  window.history.replaceState(null, '', '/')
})

describe('MobileDailyWelcome (/m after the puzzle room exit)', () => {
  it('celebrates a solve for a signed-out phone and nudges sign-in, once', () => {
    leaveWelcomeNote({ ...note, signedIn: false })
    window.history.replaceState(null, '', '/m?from=daily')
    render(<MobileDailyWelcome signedIn={false} />)
    expect(screen.getByTestId('daily-welcome-line').textContent).toBe('You escaped #3 in 1/6 · 1:00')
    expect(screen.getByTestId('daily-welcome-signin').textContent).toMatch(/sign in to keep your streak/i)
    expect(screen.getByTestId('daily-welcome-confetti')).toBeTruthy()
    // Flag dropped and note cleared: a reload doesn't celebrate again.
    expect(window.location.search).toBe('')
    expect(readWelcomeNote()).toBeNull()
    cleanup()
    render(<MobileDailyWelcome signedIn={false} />)
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
  })

  it('has no sign-in nudge when signed in, and can be dismissed', () => {
    leaveWelcomeNote({ ...note, solved: false, signedIn: true })
    window.history.replaceState(null, '', '/m?from=daily')
    render(<MobileDailyWelcome signedIn />)
    expect(screen.getByTestId('daily-welcome-line').textContent).toMatch(/stayed locked/)
    expect(screen.queryByTestId('daily-welcome-signin')).toBeNull()
    expect(screen.queryByTestId('daily-welcome-confetti')).toBeNull()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })))
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
  })

  it('ignores a note without the from=daily flag', () => {
    leaveWelcomeNote({ ...note, signedIn: true })
    window.history.replaceState(null, '', '/m')
    render(<MobileDailyWelcome signedIn />)
    expect(screen.queryByTestId('daily-welcome')).toBeNull()
    expect(readWelcomeNote()).not.toBeNull()
  })

  it('reads the flag', () => {
    expect(isFromDaily('?from=daily')).toBe(true)
    expect(isFromDaily('?from=other')).toBe(false)
    expect(isFromDaily('')).toBe(false)
  })
})
