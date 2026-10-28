import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setSessionUser } from '@/auth'
import { bus } from '@/contracts/events'
import { ApiCallError } from '@/contracts/errors'
import type { HomeView } from '@/contracts/realtime'
import type { Dataset } from '@/contracts/types'
import { resetRealtime, useRealtime } from '@/net/store'
import { runtime } from '@/contracts/runtime'
import { useStore } from '@/state/store'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { installBridge } from '@/state/bridge'
import { HomeVisitPage } from './HomeVisitPage'
import { installVisitNotices } from './notices'
import { PeopleHud } from './PeopleHud'
import { installVisit, pageNav, resetVisitForTests, visitHandleFromPath, visitProblem, visitUrl, VISITOR_SPAWN } from './state'

vi.mock('../../desktop', () => ({ DesktopApp: () => <div data-testid="desktop-room" /> }))

const host = { id: 'u-host', handle: 'robin', displayName: 'Robin Host', image: null }
const guest = { id: 'u-guest', handle: 'sam', displayName: 'Sam Guest', image: null }
const me = { ...guest, email: 'sam@example.com', onboarded: true, isAdmin: false, createdAt: '2026-01-01T00:00:00.000Z' }
const dataset: Dataset = { rooms: [], reviews: [], wishlist: [], crew: [], source: 'postgres' } as unknown as Dataset
const view = (over: Partial<HomeView> = {}): HomeView => ({ owner: host, isOwner: false, readOnly: true, dataset, spoilersHidden: true, presence: { ownerOnline: true, visitors: [] }, ...over })

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let go: ReturnType<typeof vi.fn<(url: string) => void>>
beforeEach(() => {
  resetVisitForTests()
  resetRealtime()
  resetShellForTests()
  useStore.setState({ visiting: null, overlay: null, worldReady: true, isTouch: false })
  go = vi.fn<(url: string) => void>()
  vi.spyOn(pageNav, 'go').mockImplementation(go)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ visiting: null })
})

describe('addresses', () => {
  it('reads the handle from /home/:handle', () => {
    expect(visitHandleFromPath('/home/robin')).toBe('robin')
    expect(visitHandleFromPath('/home/%40Robin/')).toBe('robin')
    expect(visitHandleFromPath('/home/')).toBeNull()
    expect(visitHandleFromPath('/home/a/b')).toBeNull()
    expect(visitHandleFromPath('/homes/robin')).toBeNull()
    expect(visitHandleFromPath('/home/%E0%A4%A')).toBeNull()
    expect(visitUrl('robin', { autostart: true })).toBe('/home/robin?autostart=1')
  })

  it('names what went wrong', () => {
    expect(visitProblem(new ApiCallError(404, undefined, 'x'))).toBe('not_found')
    expect(visitProblem(new ApiCallError(403, undefined, 'x'))).toBe('forbidden')
    expect(visitProblem(new ApiCallError(401, undefined, 'x'))).toBe('signed_out')
    expect(visitProblem(new Error('offline'))).toBe('unavailable')
  })
})

describe("a friend's room is read-only", () => {
  it('loads their home instead of yours and refuses edits', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      expect(String(input)).toBe('/api/homes/robin')
      return json(200, view())
    })
    installVisit('robin')
    await useStore.getState().loadData()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useStore.getState().visiting).toEqual({ handle: 'robin', owner: host })
    await expect(useStore.getState().setWishlist([])).rejects.toThrow("friend's room")
    await expect(useStore.getState().addEntry({} as never)).rejects.toThrow("friend's room")
    useStore.getState().openOverlay({ kind: 'record' })
    useStore.getState().openOverlay({ kind: 'wishlist' })
    expect(useStore.getState().overlay).toBeNull()
    useStore.getState().openOverlay({ kind: 'review', roomId: 'r1' })
    expect(useStore.getState().overlay).toEqual({ kind: 'review', roomId: 'r1' })
  })

  it('starts visitors a step away from the owner\'s usual spot', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, view()))
    installVisit('robin')
    expect(runtime.player.position).toEqual(VISITOR_SPAWN)
  })

  it('explains why logging is closed', () => {
    const offBridge = installBridge()
    const off = installVisitNotices()
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    bus.emit('record:open')
    expect(useStore.getState().overlay).toBeNull()
    expect(useShell.getState().toast?.text).toBe("This is Robin's room, so it's look-only. Log rooms and wishes in your own.")
    off()
    offBridge()
  })
})

describe('HomeVisitPage', () => {
  it('asks signed-out visitors to sign in', async () => {
    setSessionUser(null)
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    expect(await screen.findByTestId('sign-in-screen')).toBeTruthy()
    expect(screen.getByText("Visit @robin's room")).toBeTruthy()
  })

  it('explains when you are not friends', async () => {
    setSessionUser(me)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(403, { error: 'Only friends', code: 'forbidden' }))
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    const err = await screen.findByTestId('visit-error')
    expect(err.dataset.problem).toBe('forbidden')
    expect(screen.getByText("Only @robin's friends can come in")).toBeTruthy()
    expect(screen.getByTestId('visit-back').getAttribute('href')).toBe('/?autostart=1')
  })

  it('Try again asks the server again after a failed load', async () => {
    setSessionUser(me)
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(json(200, view()))
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    expect((await screen.findByTestId('visit-error')).dataset.problem).toBe('unavailable')
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('opens the room for a friend, and sends you home for your own handle', async () => {
    setSessionUser(me)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, view()))
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
    cleanup()
    resetVisitForTests()
    vi.spyOn(pageNav, 'go').mockImplementation(go)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, view({ owner: guest, isOwner: true, readOnly: false })))
    render(<HomeVisitPage params={{ handle: 'sam' }} rest="/" />)
    await waitFor(() => expect(go).toHaveBeenCalledWith('/?autostart=1'))
  })
})

describe('PeopleHud', () => {
  const online = () =>
    useRealtime.setState({
      status: 'open',
      me: guest,
      sid: 's-guest',
      home: { handle: 'robin', owner: host, isOwner: false },
      players: { 's-host': { sid: 's-host', user: host, isOwner: true, outfit: {} as never, joinedAt: 1 } },
      friends: {
        [host.id]: { user: host, online: true, where: 'own_home', homeCount: 2 },
        'u-3': { user: { id: 'u-3', handle: 'kim', displayName: 'Kim', image: null }, online: false, where: 'offline', homeCount: 0 },
      },
      friendsLoaded: true,
    })

  it('shows nothing for signed-out visitors', () => {
    const { container } = render(<PeopleHud />)
    expect(container.innerHTML).toBe('')
  })

  it("shows the visiting banner with Back to my room in a friend's room", () => {
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    render(<PeopleHud />)
    expect(screen.getByTestId('visit-banner').textContent).toContain("Robin Host's room")
    fireEvent.click(screen.getByTestId('visit-back-home'))
    expect(go).toHaveBeenCalledWith('/?autostart=1')
  })

  it('fits the banner on a phone: first name and "My room"', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: !q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }))
    try {
      useStore.setState({ visiting: { handle: 'robin', owner: host } })
      render(<PeopleHud />)
      expect(screen.getByTestId('visit-banner-title').textContent).toBe("Robin's room")
      expect(screen.getByTestId('visit-back-home').textContent).toBe('My room')
      expect(screen.getByLabelText('Back to my room')).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lists who is here and friends to visit, online first', () => {
    online()
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    render(<PeopleHud />)
    expect(screen.getByTestId('people-button').textContent).toContain('2 here')
    fireEvent.click(screen.getByTestId('people-button'))
    const here = screen.getAllByTestId('person-row').map((r) => r.dataset.handle)
    expect(here).toEqual(['sam', 'robin'])
    const friends = screen.getAllByTestId('visit-friend')
    expect(friends.map((f) => [f.dataset.handle, f.dataset.online])).toEqual([
      ['robin', 'true'],
      ['kim', 'false'],
    ])
    // Already in Robin's room: no Visit button for Robin; Kim's opens her room.
    expect(friends[0].textContent).toContain("You're here")
    fireEvent.click(screen.getByLabelText("Visit Kim's room"))
    expect(go).toHaveBeenCalledWith('/home/kim?autostart=1')
  })

  it('offers "Here with you" instead of Visit for a friend in your room', () => {
    useRealtime.setState({
      status: 'open',
      me: host,
      sid: 's-host',
      home: { handle: 'robin', owner: host, isOwner: true },
      players: { 's-guest': { sid: 's-guest', user: guest, isOwner: false, outfit: {} as never, joinedAt: 1 } },
      friends: { [guest.id]: { user: guest, online: true, where: 'your_home', homeCount: 0 } },
      friendsLoaded: true,
    })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('people-button'))
    expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy()
    const row = screen.getAllByTestId('visit-friend')[0]
    expect(row.textContent).toContain('Here with you')
    expect(screen.queryByLabelText("Visit Sam Guest's room")).toBeNull()
  })

  it('calls the dock button People, like the panel', () => {
    useRealtime.setState({ status: 'open', me: guest, friendsLoaded: true })
    render(<PeopleHud />)
    expect(screen.getByTestId('people-button').textContent).toContain('People')
  })

  it('puts a chat line the server turned down back in the box', async () => {
    online()
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('chat-button'))
    const input = (await screen.findByTestId('chat-input')) as HTMLInputElement
    act(() => {
      useRealtime.setState({ chatReturned: { text: 'look!', message: "You're sending messages quickly. Wait 3 s, then send it again.", n: 1 } })
    })
    expect(input.value).toBe('look!')
    expect(screen.getByText("You're sending messages quickly. Wait 3 s, then send it again.")).toBeTruthy()
    expect(useRealtime.getState().chatReturned).toBeNull()
  })

  it('shows a reconnecting chip while the connection is down', () => {
    online()
    useRealtime.setState({ status: 'reconnecting' })
    render(<PeopleHud />)
    expect(screen.getByTestId('connection-chip').textContent).toContain('Reconnecting')
  })

  it('keeps the touch chat hint short', () => {
    online()
    useStore.setState({ isTouch: true })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('chat-button'))
    expect(screen.getByText('Never saved')).toBeTruthy()
    expect(screen.queryByText(/Enter sends/)).toBeNull()
  })

  it('tells the room hints when a panel is open', () => {
    online()
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('people-button'))
    expect(useShell.getState().hudPanelOpen).toBe(true)
  })

  it('opens the chat with T and sends a line', async () => {
    online()
    render(<PeopleHud />)
    act(() => {
      fireEvent.keyDown(window, { key: 't', code: 'KeyT' })
    })
    const input = await screen.findByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Hello!' } })
    fireEvent.submit(input.closest('form')!)
    // Not connected in this test: the line is kept and the reason shown.
    expect((input as HTMLInputElement).value).toBe('Hello!')
    expect(screen.getByText('Not connected right now. Your message was not sent.')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('chat-input')).toBeNull()
  })

  it('hides while an overlay is open', () => {
    online()
    useStore.setState({ overlay: { kind: 'settings' } })
    const { container } = render(<PeopleHud />)
    expect(container.innerHTML).toBe('')
  })

  it('uses round buttons and sheets on touch screens', () => {
    online()
    useStore.setState({ isTouch: true })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('emote-button'))
    expect(screen.getByTestId('emote-wave')).toBeTruthy()
    fireEvent.click(screen.getByTestId('people-button'))
    expect(screen.getByTestId('people-panel')).toBeTruthy()
  })
})
