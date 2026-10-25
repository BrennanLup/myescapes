import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore, DEFAULT_SETTINGS } from '@/state/store'
import { bus } from '@/contracts/events'
import { apiClient } from '@/contracts/api'
import { SettingsOverlay } from './SettingsOverlay'
import { Hud } from './Hud'
import { LoadingScreen } from './LoadingScreen'
import { resetShellForTests } from './shellStore'

beforeEach(() => {
  resetShellForTests()
  vi.spyOn(apiClient, 'getStatus').mockResolvedValue({ extraction: 'mock', storage: 'seed', version: '0.1.0' })
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
    expect(screen.getByText('GOOGLE_SERVICE_ACCOUNT_JSON')).toBeTruthy()
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

  it('shows retry on data error', () => {
    const load = vi.fn(async () => {})
    useStore.setState({ dataStatus: 'error', dataError: 'boom', loadData: load })
    render(<LoadingScreen />)
    fireEvent.click(screen.getByTestId('retry-button'))
    expect(load).toHaveBeenCalled()
  })
})
