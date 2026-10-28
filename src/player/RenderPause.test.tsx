import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useStore } from '@/state/store'

/** A stand-in for the react-three-fiber root state: just what RenderPause touches. */
const canvas = document.createElement('canvas')
const root = {
  frameloop: 'always' as 'always' | 'demand' | 'never',
  clock: { elapsedTime: 0 },
  gl: { domElement: canvas },
  setFrameloop: vi.fn((f: 'always' | 'demand' | 'never') => {
    root.frameloop = f
    // Like react-three-fiber: switching restarts the clock from zero.
    root.clock.elapsedTime = 0
  }),
}
vi.mock('@react-three/fiber', () => ({
  useThree: (select: (s: { get: () => typeof root }) => unknown) => select({ get: () => root }),
}))

const { RenderPause, shouldPauseRender, PAUSING_OVERLAYS } = await import('./RenderPause')

describe('shouldPauseRender', () => {
  it('pauses behind the covering overlays once the world is up, not behind Settings', () => {
    for (const kind of ['review', 'record', 'gate', 'wardrobe', 'wishlist', 'wrap'] as const) {
      expect(shouldPauseRender({ worldReady: true, overlay: kind === 'review' ? { kind, roomId: 'r' } : { kind } })).toBe(true)
    }
    expect(PAUSING_OVERLAYS.has('confirm')).toBe(true)
    expect(shouldPauseRender({ worldReady: true, overlay: { kind: 'settings' } })).toBe(false)
    expect(shouldPauseRender({ worldReady: true, overlay: null })).toBe(false)
    // Behind the loading screen the room keeps drawing (shaders warm up).
    expect(shouldPauseRender({ worldReady: false, overlay: { kind: 'wardrobe' } })).toBe(false)
  })
})

describe('RenderPause', () => {
  beforeEach(() => {
    root.frameloop = 'always'
    root.clock.elapsedTime = 0
    root.setFrameloop.mockClear()
    useStore.setState({ overlay: null, worldReady: true })
  })
  afterEach(cleanup)

  it('switches the room to on-demand frames while the wardrobe is open and back when it closes', () => {
    render(<RenderPause />)
    expect(canvas.dataset.render).toBe('live')
    expect(root.setFrameloop).not.toHaveBeenCalled()

    root.clock.elapsedTime = 42
    act(() => useStore.getState().openOverlay({ kind: 'wardrobe' }))
    expect(root.frameloop).toBe('demand')
    expect(canvas.dataset.render).toBe('paused')
    // The animation clock carries on from where it was.
    expect(root.clock.elapsedTime).toBe(42)

    act(() => useStore.getState().closeOverlay())
    expect(root.frameloop).toBe('always')
    expect(canvas.dataset.render).toBe('live')
    expect(root.clock.elapsedTime).toBe(42)
  })

  it('keeps drawing behind Settings, and resumes on unmount', () => {
    const { unmount } = render(<RenderPause />)
    act(() => useStore.getState().openOverlay({ kind: 'settings' }))
    expect(root.frameloop).toBe('always')
    act(() => useStore.getState().closeOverlay())
    act(() => useStore.getState().openOverlay({ kind: 'record' }))
    expect(root.frameloop).toBe('demand')
    unmount()
    expect(root.frameloop).toBe('always')
  })
})
