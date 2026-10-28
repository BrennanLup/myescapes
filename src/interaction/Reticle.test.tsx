import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useStore } from '@/state/store'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { useCameraMode } from '@/player/view'
import { useInteraction } from './controller'
import { cornerBottom, Reticle } from './Reticle'

afterEach(() => {
  cleanup()
  resetShellForTests()
  useShell.setState({ hudPanelOpen: false })
  useStore.setState({ pointerLocked: false, worldReady: false, isTouch: false })
  useInteraction.setState({ hovered: null })
  useCameraMode.setState({ mode: 'first' })
})

describe('Reticle look hint', () => {
  it('hides while a HUD panel is open, and for good once you have clicked into the room', () => {
    useStore.setState({ worldReady: true, overlay: null, isTouch: false, pointerLocked: false })
    render(<Reticle />)
    expect(screen.getByTestId('look-hint')).toBeTruthy()
    act(() => useShell.setState({ hudPanelOpen: true }))
    expect(screen.queryByTestId('look-hint')).toBeNull()
    act(() => useShell.setState({ hudPanelOpen: false }))
    expect(screen.getByTestId('look-hint')).toBeTruthy()
    act(() => useStore.setState({ pointerLocked: true }))
    act(() => useStore.setState({ pointerLocked: false }))
    expect(screen.queryByTestId('look-hint')).toBeNull()
  })
})

describe('Reticle Tap button on touch screens', () => {
  const hover = () => useInteraction.setState({ hovered: { id: 'door', kind: 'door', label: "Today's lock" } as never })

  it('sits under the reticle in first person', () => {
    useStore.setState({ worldReady: true, overlay: null, isTouch: true })
    hover()
    render(<Reticle />)
    expect(screen.getByTestId('interact-tap')).toBeTruthy()
    expect(screen.queryByTestId('interact-tap-corner')).toBeNull()
  })

  it('moves to the bottom-right corner in third person, off your character', () => {
    useStore.setState({ worldReady: true, overlay: null, isTouch: true })
    useCameraMode.setState({ mode: 'third' })
    hover()
    render(<Reticle />)
    const corner = screen.getByTestId('interact-tap-corner')
    expect(corner.textContent).toContain("Today's lock")
    expect(corner.querySelector('[data-testid="interact-tap"]')).toBeTruthy()
  })

  it('goes 12 px above the highest round button on the right, ignoring the left side', () => {
    const rect = (top: number, right: number, height = 60) => ({ top, right, width: 56, height })
    expect(cornerBottom([rect(700, 380), rect(500, 380)], 390, 844)).toBe(844 - 500 + 12)
    expect(cornerBottom([rect(300, 120)], 390, 844)).toBeNull()
    expect(cornerBottom([{ top: 0, right: 0, width: 0, height: 0 }], 390, 844)).toBeNull()
    expect(cornerBottom([], 390, 844)).toBeNull()
  })
})
