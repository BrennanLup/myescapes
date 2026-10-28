import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FriendPresence } from '@/contracts/realtime'
import { FriendsOnline, onlineFriends } from './FriendsOnline'

const person = (id: string, name: string, handle: string | null = id) => ({ id, handle, displayName: name, image: null })
const f = (id: string, name: string, where: FriendPresence['where'], online = true, homeCount = 0, handle: string | null = id): FriendPresence => ({
  user: person(id, name, handle),
  online,
  where,
  homeCount,
})
const byId = (...list: FriendPresence[]) => Object.fromEntries(list.map((x) => [x.user.id, x]))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FriendsOnline', () => {
  it('lists online friends only, the ones at home first', () => {
    const list = onlineFriends(byId(f('zed', 'Zed', 'lobby'), f('mia', 'Mia', 'own_home', true, 2), f('off', 'Off', 'offline', false), f('ann', 'Ann', 'your_home'), f('bo', 'Bo', 'own_home')))
    expect(list.map((x) => x.user.id)).toEqual(['bo', 'mia', 'ann', 'zed'])
  })

  it('shows nothing while nobody is online', () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    render(<FriendsOnline presence={byId(f('off', 'Off', 'offline', false))} />)
    expect(screen.queryByTestId('friends-online')).toBeNull()
  })

  it('offers a Visit button into each online friend’s room, and Join for one in yours', () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    const join = vi.fn()
    render(<FriendsOnline onJoinMine={join} presence={byId(f('mia', 'Mia Park', 'own_home', true, 2), f('ann', 'Ann', 'your_home'), f('nohandle', 'Nameless', 'lobby', true, 0, null))} />)
    const section = screen.getByRole('region', { name: /Friends online/ })
    const rows = within(section).getAllByTestId('friend-online')
    expect(rows.map((r) => r.dataset.userId)).toEqual(['mia', 'ann', 'nohandle'])
    const visit = within(rows[0]).getByRole('link', { name: "Visit Mia Park's room" })
    expect(visit.getAttribute('href')).toBe('/home/mia')
    expect(rows[0].textContent).toContain('In their room with 1 friend')
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Join Ann in your room' }))
    expect(join).toHaveBeenCalledTimes(1)
    // No @handle yet: no way in, but still listed as online.
    expect(within(rows[2]).queryByRole('link')).toBeNull()
  })

  it('keeps the list short and links to the rest', () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    render(<FriendsOnline max={2} presence={byId(f('a', 'A', 'own_home'), f('b', 'B', 'own_home'), f('c', 'C', 'lobby'))} />)
    expect(screen.getAllByTestId('friend-online')).toHaveLength(2)
    expect(screen.getByTestId('friends-online-more').textContent).toBe('and 1 more online')
    expect(screen.getByTestId('friends-online-more').getAttribute('href')).toBe('/settings#friends')
  })

  it('polls the server for presence', async () => {
    const body = { friends: [f('mia', 'Mia', 'own_home')], here: [], realtime: true }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<FriendsOnline />)
    expect((await screen.findByRole('link', { name: "Visit Mia's room" })).getAttribute('href')).toBe('/home/mia')
  })
})
