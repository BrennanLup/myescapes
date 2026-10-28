import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useStore } from '@/state/store'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { Reticle } from './Reticle'

afterEach(() => {
  cleanup()
  resetShellForTests()
  useShell.setState({ hudPanelOpen: false })
  useStore.setState({ pointerLocked: false, worldReady: false })
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
