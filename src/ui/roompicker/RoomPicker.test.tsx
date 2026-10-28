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
    const search = vi.fn(async () => ({ games: [game], venues: [venue] }))
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
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith({ kind: 'venue', venue })
    fireEvent.focus(input)
    fireEvent.click(screen.getByTestId('roompicker-option-create'))
    expect(onCreate).toHaveBeenCalledWith('vault')
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
