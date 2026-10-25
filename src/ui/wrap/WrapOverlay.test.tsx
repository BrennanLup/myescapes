import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { WrapOverlay } from './WrapOverlay'
import { circledDays } from './calendarTexture'

const stage = () => screen.getByTestId('wrap-stage')
const cardKey = () => stage().getAttribute('data-card')

describe('WrapOverlay', () => {
  beforeEach(() => {
    useStore.getState().setDataset(FIXTURE_DATASET)
  })
  afterEach(() => {
    cleanup()
    useStore.setState({ rooms: [], reviews: [] })
  })

  it('renders the intro for the most recent year', () => {
    render(<WrapOverlay />)
    expect(screen.getByTestId('wrap-overlay')).toBeTruthy()
    expect((screen.getByTestId('wrap-year') as HTMLSelectElement).value).toBe('2025')
    expect(cardKey()).toBe('intro')
    expect(screen.getByText(/year in escape rooms/i)).toBeTruthy()
    const options = [...(screen.getByTestId('wrap-year') as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toEqual(['2025', '2024', 'all'])
  })

  it('navigates with buttons, arrow keys and taps', () => {
    render(<WrapOverlay />)
    fireEvent.click(screen.getByTestId('wrap-next'))
    expect(cardKey()).toBe('rooms')
    expect(screen.getByText('escape rooms')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(cardKey()).toBe('best')
    expect(screen.getAllByText('Mars Base Omega').length).toBeGreaterThan(0)
    expect(screen.getByTestId('wrap-photo-placeholder')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(cardKey()).toBe('rooms')
    fireEvent.click(screen.getByTestId('wrap-prev'))
    expect(cardKey()).toBe('intro')
    // prev at the start is a no-op
    fireEvent.click(screen.getByTestId('wrap-prev'))
    expect(cardKey()).toBe('intro')
    // tap right half advances (jsdom rect width is 0, so x=10 counts as right)
    fireEvent.click(stage(), { clientX: 10 })
    expect(cardKey()).toBe('rooms')
  })

  it('swipes on touch', () => {
    render(<WrapOverlay />)
    fireEvent.touchStart(stage(), { touches: [{ clientX: 300, clientY: 400 }] })
    fireEvent.touchEnd(stage(), { changedTouches: [{ clientX: 100, clientY: 410 }] })
    expect(cardKey()).toBe('rooms')
    fireEvent.touchStart(stage(), { touches: [{ clientX: 100, clientY: 400 }] })
    fireEvent.touchEnd(stage(), { changedTouches: [{ clientX: 300, clientY: 400 }] })
    expect(cardKey()).toBe('intro')
  })

  it('walks every card to the summary and replays', () => {
    render(<WrapOverlay />)
    const seen: string[] = []
    for (let i = 0; i < 10; i++) {
      seen.push(cardKey()!)
      if (cardKey() === 'summary') break
      fireEvent.click(screen.getByTestId('wrap-next'))
    }
    expect(seen).toEqual(['intro', 'rooms', 'best', 'fastest', 'puzzle', 'cities', 'crew', 'summary'])
    expect(screen.getByTestId('wrap-summary')).toBeTruthy()
    fireEvent.click(screen.getByTestId('wrap-next'))
    expect(cardKey()).toBe('intro')
  })

  it('switches year and shows the no-escape fallback', () => {
    render(<WrapOverlay />)
    fireEvent.change(screen.getByTestId('wrap-year'), { target: { value: '2024' } })
    expect(cardKey()).toBe('intro')
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('wrap-next'))
    expect(cardKey()).toBe('fastest')
    expect(screen.getByText(/escapes this time/)).toBeTruthy()
  })

  it('handles no data', () => {
    act(() => useStore.setState({ rooms: [], reviews: [] }))
    render(<WrapOverlay />)
    expect((screen.getByTestId('wrap-year') as HTMLSelectElement).value).toBe('all')
    fireEvent.click(screen.getByTestId('wrap-next'))
    expect(cardKey()).toBe('empty')
  })

  it('Esc and close emit overlay:close', () => {
    const fn = vi.fn()
    const off = bus.on('overlay:close', fn)
    render(<WrapOverlay />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('wrap-close'))
    off()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('calendar circled days', () => {
  it('uses play dates in the month, topped up with Saturdays', () => {
    // October 2026: Saturdays are 3, 10, 17, 24, 31.
    expect(circledDays(2026, 9, ['2026-10-21', '2025-10-05'])).toEqual([3, 10, 21])
    expect(circledDays(2026, 9, [])).toEqual([3, 10, 17])
  })
})
