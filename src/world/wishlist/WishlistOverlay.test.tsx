import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WishlistItem } from '@/contracts/types'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { WishlistOverlay } from './WishlistOverlay'

vi.mock('@/ui/roompicker/search', () => ({
  searchDirectory: vi.fn(async () => ({
    games: [{ id: 'g1', slug: 'the-vault-toronto', name: 'The Vault', genre: null, status: 'active', venueId: 'v1', venueName: 'Lockbox', venueSlug: 'lockbox', city: 'Toronto', country: 'CA', reviewCount: 0, avgOverall: null }],
    venues: [],
  })),
}))

const items: WishlistItem[] = [
  { id: 'w2', name: 'Sky Pirates', city: 'San Francisco', link: '', addedBy: 'Jules', priority: 2, done: false },
  { id: 'w1', name: 'The Vault', city: 'Toronto', link: 'vault.example.com', addedBy: 'Maya', priority: 1, done: false },
  { id: 'w3', name: 'Lost Temple', city: '', link: '', addedBy: '', priority: 3, done: false },
]

let setWishlist: ReturnType<typeof vi.fn<(next: WishlistItem[]) => Promise<void>>>
const original = useStore.getState().setWishlist

beforeEach(() => {
  setWishlist = vi.fn((next: WishlistItem[]) => {
    useStore.setState({ wishlist: next })
    return Promise.resolve()
  })
  useStore.setState({ wishlist: items, crew: [{ id: 'c1', name: 'Maya' }], isTouch: false, setWishlist })
})

afterEach(() => {
  cleanup()
  useStore.setState({ wishlist: [], crew: [], setWishlist: original })
})

const last = () => setWishlist.mock.calls.at(-1)![0]
const summary = (list: WishlistItem[]) => list.map((x) => `${x.priority}:${x.id}${x.done ? ':done' : ''}`)

describe('WishlistOverlay', () => {
  it('renders items in priority order with a safe link', () => {
    render(<WishlistOverlay />)
    const rows = screen.getAllByTestId(/^wishlist-item-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['wishlist-item-w1', 'wishlist-item-w2', 'wishlist-item-w3'])
    const link = screen.getByText('Visit site ↗') as HTMLAnchorElement
    expect(link.href).toBe('https://vault.example.com/')
    expect(link.target).toBe('_blank')
  })

  it('adds an item at the bottom and plays chalk', () => {
    const sfx = vi.fn()
    const off = bus.on('sfx', sfx)
    render(<WishlistOverlay />)
    fireEvent.change(screen.getByTestId('wishlist-add-name'), { target: { value: '  Clockwork Lab ' } })
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Austin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Maya' }))
    fireEvent.click(screen.getByTestId('wishlist-add-submit'))
    expect(setWishlist).toHaveBeenCalledTimes(1)
    const next = last()
    expect(summary(next).slice(0, 3)).toEqual(['1:w1', '2:w2', '3:w3'])
    expect(next[3]).toMatchObject({ name: 'Clockwork Lab', city: 'Austin', addedBy: 'Maya', priority: 4, done: false })
    expect(sfx).toHaveBeenCalledWith({ name: 'chalk' })
    expect((screen.getByTestId('wishlist-add-name') as HTMLInputElement).value).toBe('')
    off()
  })

  it('links a room picked from the directory', async () => {
    vi.useFakeTimers()
    try {
      render(<WishlistOverlay />)
      fireEvent.change(screen.getByTestId('wishlist-add-name'), { target: { value: 'vau' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      fireEvent.click(screen.getByTestId('roompicker-option-game'))
      expect(screen.getByTestId('wishlist-linked').textContent).toContain('Lockbox, Toronto')
      fireEvent.click(screen.getByTestId('wishlist-add-submit'))
      expect(last()[3]).toMatchObject({ name: 'The Vault', city: 'Toronto', link: '/games/the-vault-toronto', gameId: 'g1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not add without a name', () => {
    render(<WishlistOverlay />)
    fireEvent.click(screen.getByTestId('wishlist-add-submit'))
    expect(setWishlist).not.toHaveBeenCalled()
    expect(screen.getByText('Give the room a name first.')).toBeTruthy()
  })

  it('reorders with up/down and renumbers', () => {
    render(<WishlistOverlay />)
    fireEvent.click(screen.getByTestId('wishlist-up-w3'))
    expect(summary(last())).toEqual(['1:w1', '2:w3', '3:w2'])
    fireEvent.click(screen.getByTestId('wishlist-down-w1'))
    expect(summary(last())).toEqual(['1:w3', '2:w1', '3:w2'])
    expect((screen.getByTestId('wishlist-up-w3') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reorders with drag and drop', () => {
    render(<WishlistOverlay />)
    const data = new Map<string, string>()
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByTestId('wishlist-item-w3'), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId('wishlist-item-w1'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('wishlist-item-w1'), { dataTransfer })
    expect(summary(last())).toEqual(['1:w3', '2:w1', '3:w2'])
  })

  it('marks done and back', () => {
    render(<WishlistOverlay />)
    fireEvent.click(screen.getByTestId('wishlist-done-w2'))
    expect(summary(last())).toEqual(['1:w1', '2:w2:done', '3:w3'])
    fireEvent.click(screen.getByTestId('wishlist-done-w2'))
    expect(summary(last())).toEqual(['1:w1', '2:w2', '3:w3'])
  })

  it('removes with undo', () => {
    render(<WishlistOverlay />)
    fireEvent.click(screen.getByTestId('wishlist-remove-w2'))
    expect(summary(last())).toEqual(['1:w1', '2:w3'])
    fireEvent.click(screen.getByTestId('wishlist-undo'))
    expect(summary(last())).toEqual(['1:w1', '2:w2', '3:w3'])
  })

  it('shows an error toast when saving fails', async () => {
    setWishlist.mockImplementationOnce(() => Promise.reject(new Error('nope')))
    render(<WishlistOverlay />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('wishlist-done-w1'))
    })
    expect(screen.getByRole('status').textContent).toContain("Couldn't save")
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    const off = bus.on('overlay:close', onClose)
    render(<WishlistOverlay />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    off()
  })
})
