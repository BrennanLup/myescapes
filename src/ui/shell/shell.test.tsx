import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore, DEFAULT_SETTINGS } from '@/state/store'
import { bus } from '@/contracts/events'
import { apiClient } from '@/contracts/api'
import { SettingsOverlay } from './SettingsOverlay'
import { Hud } from './Hud'
import { LoadingScreen } from './LoadingScreen'
import { resetShellForTests } from './shellStore'
import { useRealtime } from '@/net/store'
import { resetSessionForTests, setSessionUser } from '@/auth/session'

beforeEach(() => {
  resetShellForTests()
  resetSessionForTests()
  setSessionUser(null)
  vi.spyOn(apiClient, 'getStatus').mockResolvedValue({ extraction: 'mock', transcription: 'mock', storage: 'none', database: 'none', auth: 'disabled', version: '0.1.0' })
  useStore.setState({ settings: { ...DEFAULT_SETTINGS }, sort: 'city', overlay: null, worldReady: false, dataStatus: 'idle', isTouch: false })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SettingsOverlay', () => {
  it('updates the store', async () => {
    render(<SettingsOverlay />)
    fireEvent.click(screen.getByTestId('quality-high'))
    expect(useStore.getState().settings.quality).toBe('high')
    fireEvent.click(screen.getByTestId('invert-y-toggle'))
    expect(useStore.getState().settings.invertY).toBe(true)
    fireEvent.click(screen.getByTestId('head-bob-toggle'))
    expect(useStore.getState().settings.headBob).toBe(true)
    fireEvent.change(screen.getByTestId('sensitivity-slider'), { target: { value: '2.4' } })
    expect(useStore.getState().settings.sensitivity).toBe(2.4)
    fireEvent.change(screen.getByTestId('volume-slider'), { target: { value: '0.25' } })
    expect(useStore.getState().settings.volume).toBe(0.25)
    // server status section
    expect(await screen.findByText('Mock extractor')).toBeTruthy()
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeTruthy()
    expect(screen.getByText('DATABASE_URL')).toBeTruthy()
  })

  it('signed in, links to the account page (friends, invites, sign out, delete)', () => {
    setSessionUser({ id: 'usr_a', handle: 'brennan', displayName: 'Brennan', image: null, email: 'b@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' })
    render(<SettingsOverlay />)
    const link = screen.getByTestId('settings-account-link')
    expect(link.getAttribute('href')).toBe('/settings')
    expect(screen.getByText('Brennan')).toBeTruthy()
    // Never the email.
    expect(screen.queryByText(/b@example\.com/)).toBeNull()
  })

  it('signed out, shows no account link', () => {
    setSessionUser(null)
    render(<SettingsOverlay />)
    expect(screen.queryByTestId('settings-account-link')).toBeNull()
  })

  it('emits overlay:close on Escape and on close', () => {
    const spy = vi.fn()
    const off = bus.on('overlay:close', spy)
    render(<SettingsOverlay />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(spy).toHaveBeenCalledTimes(2)
    off()
  })
})

describe('Hud', () => {
  it('is hidden before the world is ready and while an overlay is open', () => {
    const { rerender } = render(<Hud />)
    expect(screen.queryByTestId('hud')).toBeNull()
    act(() => useStore.setState({ worldReady: true, overlay: { kind: 'settings' } }))
    rerender(<Hud />)
    expect(screen.queryByTestId('hud')).toBeNull()
  })

  it('sort hotkeys and chips change the sort; buttons emit events', async () => {
    useStore.setState({ worldReady: true })
    render(<Hud />)
    fireEvent.keyDown(window, { key: '3', code: 'Digit3' })
    expect(useStore.getState().sort).toBe('genre')
    fireEvent.click(screen.getByTestId('sort-rating'))
    expect(useStore.getState().sort).toBe('rating')
    const spy = vi.fn()
    const off = bus.on('settings:open', spy)
    fireEvent.click(screen.getByTestId('settings-button'))
    expect(spy).toHaveBeenCalled()
    off()
    expect(screen.getByTestId('controls-hint')).toBeTruthy()
    expect(await screen.findByTestId('mode-badge')).toBeTruthy()
  })
})

describe('How to play card (Phase 3 controls)', () => {
  afterEach(() => useRealtime.setState({ status: 'off' }))

  it('desktop: people and chat keys when the room is live, and the wardrobe', () => {
    useRealtime.setState({ status: 'open' })
    useStore.setState({ worldReady: true })
    render(<Hud />)
    const card = screen.getByTestId('controls-hint').textContent ?? ''
    expect(card).toContain('F · T')
    expect(card).toContain('chat')
    expect(card).toContain('Wardrobe')
    expect(card).toContain('V')
  })

  it('desktop, offline: no people or chat line', () => {
    useStore.setState({ worldReady: true })
    render(<Hud />)
    expect(screen.getByTestId('controls-hint').textContent).not.toContain('F · T')
  })

  it('touch: a legend for the round buttons on the right', () => {
    useRealtime.setState({ status: 'open' })
    useStore.setState({ worldReady: true, isTouch: true })
    render(<Hud />)
    for (const id of ['people', 'chat', 'emotes', 'camera', 'wardrobe']) expect(screen.getByTestId(`hint-legend-${id}`)).toBeTruthy()
    expect(screen.getByTestId('hint-legend').textContent).toContain('Wardrobe')
  })

  it('touch, offline: only the camera and wardrobe buttons', () => {
    useStore.setState({ worldReady: true, isTouch: true })
    render(<Hud />)
    expect(screen.queryByTestId('hint-legend-people')).toBeNull()
    expect(screen.getByTestId('hint-legend-camera')).toBeTruthy()
  })
})

describe("Hud in a friend's room", () => {
  afterEach(() => useStore.setState({ visiting: null }))

  it("names whose escapes these are instead of 'My Escapes'", () => {
    useStore.setState({ worldReady: true, visiting: { handle: 'robin', owner: { id: 'u-r', handle: 'robin', displayName: 'Robin Host', image: null } } })
    render(<Hud />)
    expect(screen.getByTestId('hud-title').textContent).toContain("Robin's escapes")
    expect(screen.getByTestId('hud-title').textContent).not.toContain('My Escapes')
  })
})

describe('LoadingScreen', () => {
  it('shows the enter button when ready and sets worldReady after the fade', async () => {
    vi.useFakeTimers()
    useStore.setState({ dataStatus: 'ready' })
    render(<LoadingScreen />)
    expect(screen.getByTestId('loading-screen')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    fireEvent.click(screen.getByTestId('enter-button'))
    await act(async () => {
      vi.advanceTimersByTime(700)
    })
    expect(useStore.getState().worldReady).toBe(true)
    expect(screen.queryByTestId('loading-screen')).toBeNull()
  })

  it("says whose room is loading in a friend's room", () => {
    useStore.setState({ dataStatus: 'loading', visiting: { handle: 'vera', owner: { id: 'u-v', handle: 'vera', displayName: 'Vera Lynn', image: null } } })
    render(<LoadingScreen />)
    expect(screen.getByTestId('loading-tagline').textContent).toBe("Heading to Vera's room…")
    expect(screen.getByTestId('loading-screen').getAttribute('aria-label')).toBe("Heading to Vera's room…")
    useStore.setState({ visiting: null })
  })

  it("uses the @handle until the friend's name has loaded, and the usual tagline at home", () => {
    useStore.setState({ dataStatus: 'loading', visiting: { handle: 'vera', owner: null } })
    const { unmount } = render(<LoadingScreen />)
    expect(screen.getByTestId('loading-tagline').textContent).toBe("Heading to @vera's room…")
    unmount()
    useStore.setState({ visiting: null })
    render(<LoadingScreen />)
    expect(screen.getByTestId('loading-tagline').textContent).toBe('every room we ever broke out of')
  })

  it('shows retry on data error', () => {
    const load = vi.fn(async () => {})
    useStore.setState({ dataStatus: 'error', dataError: 'boom', loadData: load })
    render(<LoadingScreen />)
    fireEvent.click(screen.getByTestId('retry-button'))
    expect(load).toHaveBeenCalled()
  })
})
