import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { bus, type AppEvent } from '@/contracts/events'
import { useStore } from '@/state/store'
import { GateOverlay } from './GateOverlay'
import { STORAGE_KEY, todayKey } from './daily'
import { getDailyGate, resetGateSession, useGateSession } from './session'

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

describe('GateOverlay', () => {
  let events: AppEvent[]
  let off: () => void
  beforeEach(() => {
    localStorage.clear()
    useStore.getState().setDataset(FIXTURE_DATASET)
    events = []
    off = bus.onAny((e) => events.push(e))
  })
  afterEach(() => {
    off()
    cleanup()
    setUrl('')
  })

  function open(kind: string) {
    setUrl(`?gate=force&gateType=${kind}`)
    resetGateSession()
    useGateSession.getState().requestPlay()
    render(<GateOverlay />)
  }

  it('wrong answers shake, emit gate:miss + error sfx, reveal hints, then allow skip', () => {
    open('cipher')
    expect(screen.getByTestId('gate-overlay').dataset.gateKind).toBe('cipher')
    expect(screen.queryByTestId('gate-skip')).toBeNull()
    for (let i = 0; i < 3; i++) {
      fireEvent.change(screen.getByTestId('gate-answer'), { target: { value: 'nope' } })
      fireEvent.click(screen.getByTestId('gate-submit'))
    }
    const misses = events.filter((e) => e.type === 'gate:miss')
    expect(misses.map((e) => (e.payload as { misses: number }).misses)).toEqual([1, 2, 3])
    expect(events.some((e) => e.type === 'sfx' && e.payload.name === 'error')).toBe(true)
    expect(screen.getByTestId('gate-hints').children).toHaveLength(2)
    fireEvent.click(screen.getByTestId('gate-skip'))
    const solved = events.find((e) => e.type === 'gate:solved')
    expect(solved?.payload).toMatchObject({ skipped: true })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(todayKey())
  })

  it('Esc does not close before solve', () => {
    open('lock')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(events.some((e) => e.type === 'overlay:close')).toBe(false)
    expect(useGateSession.getState().locked).toBe(true)
  })

  it('hint button exhausts hints and then offers skip', () => {
    open('sequence')
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('gate-hint'))
    expect(screen.queryByTestId('gate-hint')).toBeNull()
    expect(screen.getByTestId('gate-skip')).toBeTruthy()
  })

  it('solving reveals the room and Step inside emits gate:solved', () => {
    open('lock')
    const answer = getDailyGate().challenge.answer as string
    expect(window.__ESCAPE_GATE__ === undefined || typeof window.__ESCAPE_GATE__.answer === 'function').toBe(true)
    fireEvent.change(screen.getByTestId('gate-answer'), { target: { value: answer } })
    fireEvent.click(screen.getByTestId('gate-submit'))
    expect(events.some((e) => e.type === 'sfx' && e.payload.name === 'unlock')).toBe(true)
    const room = getDailyGate().source.room!
    expect(screen.getByTestId('gate-reveal').textContent).toContain(room.name)
    fireEvent.click(screen.getByTestId('gate-continue'))
    const solved = events.find((e) => e.type === 'gate:solved')
    expect(solved?.payload).toEqual({ skipped: false, puzzleId: getDailyGate().source.puzzle.id })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(todayKey())
  })

  it('search targets: find them all to solve', () => {
    open('search')
    const ids = getDailyGate().challenge.answer as string[]
    ids.forEach((_, i) => fireEvent.click(screen.getByTestId(`gate-target-${i}`)))
    expect(screen.getByTestId('gate-reveal')).toBeTruthy()
  })

  it('choice puzzles (recall)', () => {
    open('recall')
    const answer = getDailyGate().challenge.answer as string
    const btn = document.querySelector(`[data-choice-id="${answer}"]`) as HTMLElement
    fireEvent.click(btn)
    expect(screen.getByTestId('gate-reveal')).toBeTruthy()
  })
})
