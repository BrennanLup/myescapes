import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '@/contracts/events'
import type { DailyToday } from '@/contracts/models'
import { runtime } from '@/contracts/runtime'
import { useCameraMode } from '@/player/view'
import { useStore } from '@/state/store'
import { useShell } from '@/ui/shell/shellStore'
import { generateDaily, type DailyChallenge } from '../engine'
import { readWelcomeNote, clearWelcomeNote } from '../ui/welcome'
import { SPAWN } from './layout'
import { useRoomPlay } from './playStore'
import { useRoomUi } from './uiStore'

// No WebGL in jsdom: the Canvas and the in-Canvas systems are stubbed; the DOM layer is real.
vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" />, useFrame: () => undefined, useThree: () => undefined }))
vi.mock('@/audio', () => ({ AudioSystem: () => null }))
vi.mock('@/interaction', () => ({ InteractionSystem: () => null, Reticle: () => null }))
vi.mock('@/player', () => ({ PlayerController: () => null, MobileControls: () => null }))
vi.mock('@/world/avatars/LocalAvatar', () => ({ LocalAvatar: () => null }))
vi.mock('@/ui/shell/PerfMonitor', () => ({ PerfMonitor: () => null }))

const { DailyRoomPage } = await import('./index')

function today(kind: DailyChallenge['kind'], over: Partial<DailyToday> = {}): DailyToday {
  return {
    serverDay: '2026-10-28',
    timeZone: 'UTC',
    puzzle: { day: '2026-10-28', number: 3, kind, seed: `room-test-${kind}`, maxGuesses: 6, theme: null },
    result: null,
    streak: null,
    nextAt: '2026-10-29T00:00:00.000Z',
    ...over,
  }
}

let body: DailyToday
let posts: string[]
beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/daily/room')
  posts = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).split('?')[0]
    if ((init.method ?? 'GET') !== 'GET') posts.push(path)
    if (path === '/api/daily/today') return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'nope' }), { status: 404, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  clearWelcomeNote()
})

async function enter() {
  render(<DailyRoomPage />)
  fireEvent.click(await screen.findByTestId('daily-room-enter'))
  expect(useStore.getState().worldReady).toBe(true)
}

const interact = (id: string) => act(() => bus.emit('interact', { id, kind: 'prop' }))

describe('the 3D Escape of the Day room (DOM layer)', () => {
  it('enters at the spawn, starts the clock, and opens the lock from the prop', async () => {
    body = today('combination')
    runtime.player.position = [9, 9, 9]
    await enter()
    expect(runtime.player.position).toEqual(SPAWN.position)
    expect(screen.getByTestId('daily-room').getAttribute('data-status')).toBe('playing')
    expect((screen.getByTestId('daily-left')).textContent).toContain('6 left')

    interact('daily:lock')
    expect(screen.getByTestId('daily-room-lock')).toBeTruthy()
    expect(useStore.getState().overlay?.kind).toBe('gate')
    const c = generateDaily(body.puzzle) as Extract<DailyChallenge, { kind: 'combination' }>
    const wrong = c.answer.map((d) => String((Number(d) + 1) % 10)).join('')
    fireEvent.change(screen.getByTestId('daily-input'), { target: { value: wrong } })
    fireEvent.click(screen.getByTestId('daily-submit'))
    expect(screen.getByTestId('daily-row-0')).toBeTruthy()
    expect(useRoomPlay.getState().progress?.guesses).toHaveLength(1)
    expect(useRoomPlay.getState().doorOpen).toBe(false)

    // Esc closes the panel and gives the controls back.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('daily-room-lock')).toBeNull()
    expect(useStore.getState().overlay).toBeNull()
  })

  it('rings the bell for a hint, reads clues from posters, and solving opens the door with a result', async () => {
    body = today('cipher')
    await enter()
    interact('daily:clue:0')
    expect(screen.getByTestId('daily-room-clues')).toBeTruthy()
    fireEvent.click(screen.getByTestId('daily-room-close'))
    interact('daily:hint')
    fireEvent.click(screen.getByTestId('daily-hint'))
    expect(screen.getByTestId('daily-hints').children).toHaveLength(1)
    fireEvent.click(screen.getByTestId('daily-room-close'))

    vi.useFakeTimers({ shouldAdvanceTime: true })
    interact('daily:lock')
    const c = generateDaily(body.puzzle)
    fireEvent.change(screen.getByTestId('daily-input'), { target: { value: c.answer.join('') } })
    fireEvent.click(screen.getByTestId('daily-submit'))
    expect(useRoomPlay.getState().doorOpen).toBe(true)
    expect(useRoomPlay.getState().celebrate).toBe(1)
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTestId('daily-room-result-panel')).toBeTruthy()
    expect(screen.getByTestId('daily-share-text').textContent).toMatch(/Escape #3 🔓 1\/6/)
    // Signed out: nothing is posted, and the way home is the demo room.
    expect(posts).toEqual([])
    expect((screen.getByTestId('daily-room-home')).textContent).toContain('demo room')
    fireEvent.click(screen.getByTestId('daily-room-home'))
    expect(screen.getByTestId('daily-room-leaving')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.location.search).toBe('?demo=1&autostart=1')
    expect(readWelcomeNote()).toMatchObject({ number: 3, solved: true, signedIn: false })
  })

  it('search day: looking under things fills a round and the found ones stay found', async () => {
    body = today('search')
    await enter()
    const spots = window.__ESCAPE_DAILY_ROOM__!.spots()
    const [first] = Object.keys(spots)
    interact(`daily:spot:${first}`)
    expect(useRoomUi.getState().toast?.text).toMatch(/found a brass/)
    expect((screen.getByTestId('daily-room-looks')).textContent).toContain('Found 1/')
    // Looking at the same spot again does nothing.
    interact(`daily:spot:${first}`)
    expect(window.__ESCAPE_DAILY_ROOM__!.round().looked).toEqual([first])
    for (const id of Object.keys(spots).slice(1)) interact(`daily:spot:${id}`)
    expect(useRoomPlay.getState().progress?.status).toBe('solved')
    expect(useRoomPlay.getState().doorOpen).toBe(true)
  })

  it('a day already finished opens with the door open and a "Look around" entry', async () => {
    body = today('sequence')
    const c = generateDaily(body.puzzle)
    window.localStorage.setItem(
      'myescapes.daily.v1.2026-10-28',
      JSON.stringify({ day: '2026-10-28', number: 3, status: 'failed', startedAt: 1, finishedAt: 2, guesses: [], grid: [], hintsUsed: 0, submitted: false }),
    )
    render(<DailyRoomPage />)
    expect((await screen.findByTestId('daily-room-enter')).textContent).toContain('Look around')
    await waitFor(() => expect(useRoomPlay.getState().doorOpen).toBe(true))
    fireEvent.click(screen.getByTestId('daily-room-enter'))
    interact('daily:lock')
    expect(screen.getByTestId('daily-room-result-panel')).toBeTruthy()
    expect(c.kind).toBe('sequence')
  })

  it('has the first / third person toggle (hidden behind panels) and says quality step-downs', async () => {
    body = today('combination')
    useCameraMode.getState().setMode('first')
    await enter()
    const toggle = screen.getByTestId('camera-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Switch to third person (V)')
    fireEvent.click(toggle)
    expect(useCameraMode.getState().mode).toBe('third')
    expect(screen.getByTestId('camera-toggle').getAttribute('aria-pressed')).toBe('true')
    interact('daily:lock')
    expect(screen.queryByTestId('camera-toggle')).toBeNull()
    act(() => useRoomUi.getState().close())
    act(() => useShell.getState().showToast('Switched to Low quality for smoother play'))
    expect(screen.getByTestId('daily-room-toast').textContent).toMatch(/Low quality/)
    useCameraMode.getState().setMode('first')
  })

  it('offers the 2D game when today cannot load', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    render(<DailyRoomPage />)
    expect((await screen.findByTestId('daily-room-error')).textContent).toMatch(/2D version/)
  })
})
