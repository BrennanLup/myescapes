import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { useStore } from './store'
import { ARRIVAL_DELAY_MS, ARRIVAL_GAP_MS, installRoomSync, REFRESH_MIN_MS } from './sync'

const initial = useStore.getState()

describe('installRoomSync', () => {
  let uninstall: (() => void) | null = null
  let clock = 0
  const refresh = vi.fn(async () => {})
  const load = vi.fn(async () => {})

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1_000_000
    useStore.setState(initial, true)
    useStore.setState({ refreshData: refresh, loadData: load })
    refresh.mockClear()
    load.mockClear()
  })
  afterEach(() => {
    uninstall?.()
    uninstall = null
    vi.useRealTimers()
  })

  const install = (opts: Parameters<typeof installRoomSync>[0] = {}) => (uninstall = installRoomSync({ now: () => clock, ...opts }))

  it('loads the room once', () => {
    install()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('signed in: refreshes when the tab comes back, at most every REFRESH_MIN_MS', () => {
    install({ load: false })
    useStore.setState({ ...FIXTURE_DATASET, dataSource: 'postgres', dataStatus: 'ready' })
    window.dispatchEvent(new Event('focus'))
    expect(refresh).not.toHaveBeenCalled() // just loaded
    clock += REFRESH_MIN_MS + 1
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
    clock += REFRESH_MIN_MS + 1
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('signed out (seed demo) or still loading: never refreshes', () => {
    install({ load: false })
    useStore.setState({ dataSource: 'seed', dataStatus: 'ready' })
    clock += REFRESH_MIN_MS + 1
    window.dispatchEvent(new Event('focus'))
    useStore.setState({ dataSource: 'postgres', dataStatus: 'loading' })
    window.dispatchEvent(new Event('focus'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('plays arrivals one by one once the player is in and no overlay is open', () => {
    install({ load: false })
    useStore.setState({ pendingArrivals: ['g1', 'g2'] })
    vi.advanceTimersByTime(ARRIVAL_DELAY_MS * 3)
    expect(useStore.getState().lastAddedRoomId).toBeNull() // world not entered yet

    useStore.setState({ worldReady: true, overlay: { kind: 'gate' } })
    vi.advanceTimersByTime(ARRIVAL_DELAY_MS * 3)
    expect(useStore.getState().lastAddedRoomId).toBeNull() // covered by an overlay

    useStore.setState({ overlay: null })
    vi.advanceTimersByTime(ARRIVAL_DELAY_MS + 1)
    expect(useStore.getState()).toMatchObject({ lastAddedRoomId: 'g1', pendingArrivals: ['g2'] })
    vi.advanceTimersByTime(ARRIVAL_GAP_MS + 1)
    expect(useStore.getState()).toMatchObject({ lastAddedRoomId: 'g2', pendingArrivals: [] })
  })

  it('an overlay opening between arrivals pauses them', () => {
    install({ load: false })
    useStore.setState({ worldReady: true, pendingArrivals: ['g1', 'g2'] })
    vi.advanceTimersByTime(ARRIVAL_DELAY_MS + 1)
    expect(useStore.getState().lastAddedRoomId).toBe('g1')
    useStore.setState({ overlay: { kind: 'wishlist' } })
    vi.advanceTimersByTime(ARRIVAL_GAP_MS * 3)
    expect(useStore.getState().lastAddedRoomId).toBe('g1')
    useStore.setState({ overlay: null })
    vi.advanceTimersByTime(ARRIVAL_GAP_MS + ARRIVAL_DELAY_MS)
    expect(useStore.getState().lastAddedRoomId).toBe('g2')
  })

  it('uninstall stops listening', () => {
    install({ load: false })
    uninstall!()
    uninstall = null
    useStore.setState({ dataSource: 'postgres', dataStatus: 'ready', worldReady: true, pendingArrivals: ['g1'] })
    clock += REFRESH_MIN_MS + 1
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(10_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(useStore.getState().lastAddedRoomId).toBeNull()
  })
})
