import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AvatarState } from '@/contracts/avatar'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { useCameraMode } from '@/player/view'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { DEFAULT_OUTFIT, KEY_REWARDS, type Outfit } from '@/world/avatars/catalog'
import { CharacterHud } from './CharacterHud'
import { WardrobeOverlay } from './WardrobeOverlay'
import { LOCAL_OUTFIT_KEY, resetWardrobeForTests, useWardrobe } from './store'

const keys = (over: Partial<NonNullable<AvatarState['keys']>> = {}) => ({ balance: 20, earned: 20, spent: 0, rooms: 0, dailies: 0, ...over })

let server: { state: AvatarState; calls: { method: string; url: string; body: unknown }[]; fail?: { status: number; error: string } }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  resetWardrobeForTests()
  resetShellForTests()
  localStorage.clear()
  useCameraMode.setState({ mode: 'first' })
  useStore.setState({ overlay: { kind: 'wardrobe' }, worldReady: true, isTouch: false })
  server = { state: { signedIn: true, outfit: DEFAULT_OUTFIT, saved: true, owned: [], keys: keys() }, calls: [] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    server.calls.push({ method, url, body })
    if (server.fail && method !== 'GET') return json(server.fail.status, { error: server.fail.error, code: 'forbidden' })
    if (url === '/api/me/avatar' && method === 'PUT') server.state = { ...server.state, outfit: (body as { outfit: Outfit }).outfit, saved: true }
    if (url === '/api/me/avatar/purchases') {
      const b = body as { itemId: AvatarState['owned'][number]; wear?: Outfit }
      server.state = { ...server.state, owned: [...server.state.owned, b.itemId], keys: keys({ balance: 10, spent: 10 }), ...(b.wear ? { outfit: b.wear } : {}) }
    }
    return json(200, server.state)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openLoaded() {
  render(<WardrobeOverlay />)
  await waitFor(() => expect(useWardrobe.getState().status).toBe('ready'))
}

describe('WardrobeOverlay', () => {
  it('shows keys, tabs, and saves a new free look', async () => {
    await openLoaded()
    expect(screen.getByTestId('key-balance').textContent).toContain('20')
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    // No WebGL in tests: the preview falls back to a description.
    expect(screen.getByTestId('wardrobe-preview').getAttribute('aria-label')).toContain('Your character')
    const save = screen.getByTestId('wardrobe-primary') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByTestId('wardrobe-tab-hair'))
    fireEvent.click(screen.getByTestId('item-hair-bob'))
    expect(screen.getByTestId('item-hair-bob').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('swatch-teal'))
    expect(save.disabled).toBe(false)

    const closed = vi.fn()
    const off = bus.on('overlay:close', closed)
    await act(async () => fireEvent.click(save))
    off()
    const put = server.calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({ outfit: { ...DEFAULT_OUTFIT, hair: 'hair-bob', hairColor: 'teal' } })
    expect(useWardrobe.getState().outfit.hair).toBe('hair-bob')
    expect(closed).toHaveBeenCalled()
    expect(useShell.getState().toast?.text).toMatch(/saved/i)
  })

  it('locked items: try on, then unlock with keys and wear in one step', async () => {
    await openLoaded()
    fireEvent.click(screen.getByTestId('wardrobe-tab-extras'))
    const tile = screen.getByTestId('item-acc-headphones')
    expect(tile.getAttribute('data-locked')).toBe('true')
    fireEvent.click(tile)
    const primary = screen.getByTestId('wardrobe-primary')
    expect(primary.textContent).toContain('Unlock Headphones')
    await act(async () => fireEvent.click(primary))
    const post = server.calls.find((c) => c.url === '/api/me/avatar/purchases')!
    expect(post.body).toEqual({ itemId: 'acc-headphones', wear: { ...DEFAULT_OUTFIT, accessory: 'acc-headphones' } })
    expect(useWardrobe.getState().owned).toContain('acc-headphones')
    expect(useWardrobe.getState().keys?.balance).toBe(10)
  })

  it('too few keys: the unlock button is disabled and explains how to earn more', async () => {
    await openLoaded()
    fireEvent.click(screen.getByTestId('wardrobe-tab-hat'))
    fireEvent.click(screen.getByTestId('item-hat-crown'))
    expect((screen.getByTestId('wardrobe-primary') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('wardrobe-message').textContent).toContain('100 more keys')
    expect(screen.getByTestId('earn-info').textContent).toContain(`${KEY_REWARDS.roomLogged} keys for every room`)
  })

  it('shows the server refusal', async () => {
    await openLoaded()
    server.fail = { status: 403, error: 'Unlock Headphones with keys before wearing it.' }
    fireEvent.click(screen.getByTestId('wardrobe-tab-body'))
    fireEvent.click(screen.getByTestId('swatch-ebony'))
    await act(async () => fireEvent.click(screen.getByTestId('wardrobe-primary')))
    expect(screen.getByTestId('wardrobe-message').textContent).toContain('Unlock Headphones')
  })

  it('signed out: free looks save on this device; locked ones ask you to sign in', async () => {
    server.state = { signedIn: false, outfit: DEFAULT_OUTFIT, saved: false, owned: [], keys: null }
    await openLoaded()
    expect(screen.queryByTestId('key-balance')).toBeNull()
    fireEvent.click(screen.getByTestId('wardrobe-tab-hat'))
    fireEvent.click(screen.getByTestId('item-hat-crown'))
    expect(screen.getByTestId('wardrobe-primary').getAttribute('href')).toBe('/welcome')
    fireEvent.click(screen.getByTestId('item-hat-beanie'))
    await act(async () => fireEvent.click(screen.getByTestId('wardrobe-primary')))
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(JSON.parse(localStorage.getItem(LOCAL_OUTFIT_KEY)!).hat).toBe('hat-beanie')
  })

  it('arrow keys move between tabs; Escape closes', async () => {
    await openLoaded()
    const first = screen.getByTestId('wardrobe-tab-body')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByTestId('wardrobe-tab-hair').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByTestId('wardrobe-tab-hair'), { key: 'End' })
    expect(screen.getByTestId('wardrobe-tab-extras').getAttribute('aria-selected')).toBe('true')
    const closed = vi.fn()
    const off = bus.on('overlay:close', closed)
    fireEvent.keyDown(window, { key: 'Escape' })
    off()
    expect(closed).toHaveBeenCalled()
  })

  it('undo puts the saved look back', async () => {
    await openLoaded()
    fireEvent.click(screen.getByTestId('wardrobe-random'))
    fireEvent.click(screen.getByTestId('wardrobe-tab-body'))
    fireEvent.click(screen.getByTestId('swatch-porcelain'))
    expect((screen.getByTestId('wardrobe-reset') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('wardrobe-reset'))
    expect((screen.getByTestId('wardrobe-reset') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CharacterHud', () => {
  beforeEach(() => useStore.setState({ overlay: null }))

  it('toggles the camera mode and remembers it; opens the wardrobe', async () => {
    render(<CharacterHud />)
    await waitFor(() => expect(useWardrobe.getState().status).toBe('ready'))
    const toggle = screen.getByTestId('camera-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(useCameraMode.getState().mode).toBe('third')
    expect(localStorage.getItem('myescapes.camera.v1')).toBe('third')
    expect(screen.getByTestId('camera-toggle').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('wardrobe-button').getAttribute('aria-label')).toContain('20 keys')
    fireEvent.click(screen.getByTestId('wardrobe-button'))
    expect(useStore.getState().overlay).toEqual({ kind: 'wardrobe' })
  })

  it('touch: big round buttons', async () => {
    useStore.setState({ isTouch: true })
    render(<CharacterHud />)
    expect(screen.getByTestId('camera-toggle').className).toContain('h-14')
  })

  it('hidden while an overlay is open or the world is loading', () => {
    useStore.setState({ worldReady: false })
    const { rerender } = render(<CharacterHud />)
    expect(screen.queryByTestId('character-hud')).toBeNull()
    act(() => useStore.setState({ worldReady: true, overlay: { kind: 'settings' } }))
    rerender(<CharacterHud />)
    expect(screen.queryByTestId('character-hud')).toBeNull()
  })

  it('tells you when you earned keys after logging a room', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<CharacterHud />)
      await waitFor(() => expect(useWardrobe.getState().keys?.earned).toBe(20))
      server.state = { ...server.state, keys: keys({ earned: 30, balance: 30, rooms: 1 }) }
      bus.emit('entry:saved', { entry: {} as never })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      await waitFor(() => expect(useShell.getState().toast?.text).toBe('+10 keys for the wardrobe'))
    } finally {
      vi.useRealTimers()
    }
  })
})
