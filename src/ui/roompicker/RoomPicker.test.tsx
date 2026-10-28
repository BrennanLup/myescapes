import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameSummary, VenueSummary } from '@/contracts/models'
import { RoomPicker } from './RoomPicker'

const game: GameSummary = { id: 'g1', slug: 'the-vault', name: 'The Vault', genre: null, status: 'active', venueId: 'v1', venueName: 'Lockbox', venueSlug: 'lockbox', city: 'Toronto', country: 'CA', reviewCount: 2, avgOverall: 4.5 }
const venue = { id: 'v2', slug: 'vault-games', name: 'Vault Games', brand: null, address: '', city: 'Austin', citySlug: 'austin-tx-us', region: 'TX', country: 'US', lat: null, lng: null, status: 'active', gameCount: 3 } as VenueSummary

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function typeAndWait(text: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

describe('RoomPicker', () => {
  it('searches after a pause and lists rooms then venues', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async (_q: { q: string }) => ({ games: [game], venues: [venue] }))
    render(<RoomPicker onPick={() => {}} search={search} />)
    await typeAndWait('v')
    expect(search).not.toHaveBeenCalled()
    await typeAndWait('vau')
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0][0]).toMatchObject({ q: 'vau' })
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.dataset.testid)).toEqual(['roompicker-option-game', 'roompicker-option-venue'])
    expect(options[0].textContent).toContain('Lockbox · Toronto, CA')
    expect(options[1].textContent).toContain('3 rooms')
  })

  it('picks with the keyboard and offers to add free text', async () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const onCreate = vi.fn()
    render(<RoomPicker onPick={onPick} allowCreate onCreate={onCreate} search={async () => ({ games: [game], venues: [venue] })} />)
    await typeAndWait('vault')
    const input = screen.getByRole('combobox')
    // Nothing is highlighted until an arrow key: the first ↓ lands on the first result.
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith({ kind: 'game', game })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'venue', venue })
    fireEvent.focus(input)
    fireEvent.click(screen.getByTestId('roompicker-option-create'))
    expect(onCreate).toHaveBeenCalledWith('vault')
  })

  it('Enter on the "Add" row adds, like a click; with no row highlighted Enter is left to the form', async () => {
    vi.useFakeTimers()
    const onCreate = vi.fn()
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <RoomPicker onPick={() => {}} allowCreate onCreate={onCreate} search={async () => ({ games: [game], venues: [] })} />
      </form>,
    )
    await typeAndWait('lighth')
    const input = screen.getByRole('combobox')
    const enter = () => fireEvent.keyDown(input, { key: 'Enter' })
    expect(enter()).toBe(true) // not prevented: the form may submit
    fireEvent.keyDown(input, { key: 'ArrowUp' }) // from none, ↑ goes to the last row ("Add")
    expect(screen.getByTestId('roompicker-option-create').getAttribute('aria-selected')).toBe('true')
    expect(enter()).toBe(false)
    expect(onCreate).toHaveBeenCalledWith('lighth')
  })

  it('says so when nothing matches or the search fails', async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockResolvedValueOnce({ games: [], venues: [] }).mockRejectedValueOnce(new Error('down'))
    render(<RoomPicker onPick={() => {}} search={search} />)
    await typeAndWait('zzz')
    expect(screen.getByText('No rooms found.')).toBeTruthy()
    await typeAndWait('zzzz')
    expect(screen.getByText("Couldn't search the room directory.")).toBeTruthy()
  })
})
