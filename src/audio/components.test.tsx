import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bus } from '@/contracts/events'
import { runtime } from '@/contracts/runtime'
import { DEFAULT_SETTINGS, useStore } from '@/state/store'
import { AudioSystem, VolumeToggle } from './index'

beforeEach(() => {
  useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(cleanup)

describe('VolumeToggle', () => {
  it('toggles mute and unmutes to a sane volume', () => {
    render(<VolumeToggle />)
    const btn = screen.getByTestId('volume-toggle')
    fireEvent.click(btn)
    expect(useStore.getState().settings.muted).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(useStore.getState().settings.muted).toBe(false)

    act(() => useStore.getState().updateSettings({ volume: 0 }))
    fireEvent.click(btn)
    expect(useStore.getState().settings.volume).toBe(0.5)
    expect(useStore.getState().settings.muted).toBe(false)
  })

  it('shows a slider on mouse hover that sets volume', () => {
    render(<VolumeToggle />)
    const wrap = screen.getByTestId('volume-toggle').parentElement!
    fireEvent.pointerEnter(wrap, { pointerType: 'mouse' })
    const slider = screen.getByTestId('volume-slider')
    fireEvent.change(slider, { target: { value: '0.3' } })
    expect(useStore.getState().settings.volume).toBeCloseTo(0.3)
    fireEvent.change(slider, { target: { value: '0' } })
    expect(useStore.getState().settings.muted).toBe(true)
  })
})

describe('AudioSystem', () => {
  it('mounts without AudioContext and survives gestures, events and walking', () => {
    const { container } = render(<AudioSystem />)
    expect(container.innerHTML).toBe('')
    bus.emit('user:gesture')
    bus.emit('sfx', { name: 'pin' })
    bus.emit('gate:solved', { skipped: false })
    runtime.player.moving = true
    runtime.player.speed = 2
    runtime.player.moving = false
    runtime.player.speed = 0
  })
})
