import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_REWARDS } from '../../world/avatars/catalog'
import { KeysEarned, ROOM_KEYS } from './keys'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('KeysEarned (the "Saved!" screen)', () => {
  it('matches the keys the server gives for a room', () => {
    expect(ROOM_KEYS).toBe(KEY_REWARDS.roomLogged)
  })

  it('shows the keys just earned and the balance from the wardrobe API', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/me/avatar' ? json({ signedIn: true, saved: false, owned: [], outfit: {}, keys: { balance: 40, earned: 40, spent: 0, rooms: 2, dailies: 0 } }) : json({}, 404),
    )
    render(<KeysEarned fetch={fetchMock as unknown as typeof fetch} />)
    expect(screen.getByTestId('log-done-keys').textContent).toContain('+10 keys')
    expect((await screen.findByTestId('log-done-key-balance')).textContent).toContain('you have 40')
    expect(fetchMock).toHaveBeenCalledWith('/api/me/avatar', expect.objectContaining({ method: 'GET' }))
  })

  it('without a balance (offline or an error) still shows the reward, without a number', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'down', code: 'internal' }, 500))
    render(<KeysEarned fetch={fetchMock as unknown as typeof fetch} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('log-done-keys').textContent).toContain('+10 keys')
    expect(screen.queryByTestId('log-done-key-balance')).toBeNull()
  })

  it('"Open the wardrobe" opens the 3D room and remembers it, like "View on desktop"', async () => {
    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, assign } })
    try {
      render(<KeysEarned fetch={(async () => json({ keys: null })) as unknown as typeof fetch} />)
      await userEvent.click(screen.getByRole('button', { name: /open the wardrobe in my 3d room/i }))
      expect(assign).toHaveBeenCalledWith('/?desktop=1')
      expect(localStorage.getItem('myescapes:view')).toBe('desktop')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: orig })
    }
  })
})
