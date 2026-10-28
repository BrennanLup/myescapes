import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendPresence } from '../../contracts/realtime'
import { FriendsOnline, onlineFriends } from './friends'

const user = (id: string, name: string, handle: string | null = id) => ({ id: `usr_${id}`, handle, displayName: name, image: null })
const p = (u: ReturnType<typeof user>, online: boolean, where: FriendPresence['where'] = online ? 'elsewhere' : 'offline', homeCount = 0): FriendPresence => ({ user: u, online, where, homeCount })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubPresence(friends: FriendPresence[]) {
  const fetchMock = vi.fn(async (url: string) => (url === '/api/presence' ? json({ friends, here: [], realtime: true }) : json({}, 404)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('onlineFriends', () => {
  it('keeps online friends with a handle, people in their own room first, then by name', () => {
    const list = [p(user('zed', 'Zed'), true, 'elsewhere'), p(user('amy', 'Amy'), true, 'lobby'), p(user('mia', 'Mia'), true, 'own_home', 2), p(user('off', 'Off'), false), p(user('nohandle', 'No handle', null), true)]
    const map = Object.fromEntries(list.map((f) => [f.user.id, f]))
    expect(onlineFriends(map).map((f) => f.user.displayName)).toEqual(['Mia', 'Amy', 'Zed'])
  })
})

describe('FriendsOnline (phone home)', () => {
  it('lists online friends with "Visit in 3D" links into their rooms', async () => {
    const fetchMock = stubPresence([p(user('mia', 'Mia'), true, 'own_home', 2), p(user('bob', 'Bob'), false)])
    render(<FriendsOnline />)
    const box = await screen.findByTestId('friends-online')
    expect(fetchMock).toHaveBeenCalledWith('/api/presence', expect.anything())
    const rows = within(box).getAllByTestId('friend-online')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Mia')
    expect(rows[0].textContent).toContain('In their room with 1 friend')
    const link = within(rows[0]).getByRole('link', { name: "Visit Mia's room in 3D" })
    expect(link.getAttribute('href')).toBe('/home/mia')
    expect(within(box).getByRole('heading', { name: /friends online/i })).toBeTruthy()
  })

  it('shows at most three, with a link to all friends', async () => {
    stubPresence(['a', 'b', 'c', 'd'].map((id) => p(user(id, id.toUpperCase()), true)))
    render(<FriendsOnline />)
    const box = await screen.findByTestId('friends-online')
    expect(within(box).getAllByTestId('friend-online')).toHaveLength(3)
    expect(within(box).getByRole('link', { name: 'See all (4)' }).getAttribute('href')).toBe('/settings#friends')
  })

  it('shows nothing when nobody is online or presence fails', async () => {
    const fetchMock = stubPresence([p(user('bob', 'Bob'), false)])
    const first = render(<FriendsOnline />)
    await settle()
    expect(fetchMock).toHaveBeenCalled()
    expect(first.container.innerHTML).toBe('')
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'nope', code: 'unauthorized' }, 401)))
    const again = render(<FriendsOnline />)
    await settle()
    expect(again.container.innerHTML).toBe('')
  })
})
