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
import { installVisitNotices, visitorPromptLabel } from './notices'
import { PeopleHud } from './PeopleHud'
import { endVisit, followVisitHandle, installVisit, pageNav, resetVisitForTests, useVisitEnded, visitHandleFromPath, visitProblem, visitUrl, VISITOR_SPAWN } from './state'

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

  it("keeps the owner's Wrapped closed and says why", () => {
    const offBridge = installBridge()
    const off = installVisitNotices()
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    bus.emit('wrap:open')
    expect(useStore.getState().overlay).toBeNull()
    expect(useShell.getState().toast?.text).toBe("Robin's Wrapped is theirs to open. Yours is on the shelf in your own room.")
    off()
    offBridge()
  })

  it('labels the desk, wish list and trophy as look-only while visiting', () => {
    const desk = { id: 'desk', kind: 'desk' as const, label: 'Log a new escape room', event: { type: 'record:open' as const, payload: {} } }
    const wish = { id: 'wl', kind: 'wishlist' as const, label: 'Open the wish list', event: { type: 'wishlist:open' as const, payload: {} } }
    const trophy = { id: 'tr', kind: 'wrap' as const, label: 'Your year in escape rooms', event: { type: 'wrap:open' as const, payload: {} } }
    const photo = { id: 'p', kind: 'photo' as const, label: 'Read review' }
    const v = { handle: 'robin', owner: host }
    expect(visitorPromptLabel(desk, v)).toBe("Robin's desk (look only)")
    expect(visitorPromptLabel(wish, v)).toBe("Robin's wish list (look only)")
    expect(visitorPromptLabel(trophy, v)).toBe("Robin's trophy shelf (look only)")
    expect(visitorPromptLabel(photo, v)).toBe('Read review')
    expect(visitorPromptLabel(desk, null)).toBe('Log a new escape room')
  })

  it('follows the owner to a new @handle (reloads and the address bar use it)', () => {
    window.history.replaceState(null, '', '/home/robin?autostart=1')
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    followVisitHandle(host.id, 'robbie')
    expect(useStore.getState().visiting?.handle).toBe('robbie')
    expect(window.location.pathname + window.location.search).toBe('/home/robbie?autostart=1')
    // Someone else's room never renames this one.
    followVisitHandle('u-other', 'mallory')
    expect(useStore.getState().visiting?.handle).toBe('robbie')
    window.history.replaceState(null, '', '/')
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

  it('closes the room when you are removed while inside, and forgets its data', async () => {
    setSessionUser(me)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, view()))
    installVisit('robin')
    useStore.setState({ visiting: { handle: 'robin', owner: host }, reviews: [{ id: 'r1' }] as never, rooms: [{ id: 'room1' }] as never, dataStatus: 'ready', overlay: { kind: 'review', reviewId: 'r1' } as never })
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
    act(() => endVisit({ problem: 'removed', ownerName: 'Robin', retryAfterMs: null }))
    const err = await screen.findByTestId('visit-error')
    expect(err.dataset.problem).toBe('removed')
    expect(screen.queryByTestId('desktop-room')).toBeNull()
    const heading = screen.getByRole('heading', { name: "You can no longer visit Robin's room" })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByTestId('visit-back').getAttribute('href')).toBe('/?autostart=1')
    const st = useStore.getState()
    expect(st.reviews).toEqual([])
    expect(st.rooms).toEqual([])
    expect(st.overlay).toBeNull()
    expect(st.dataStatus).toBe('idle')
    // Still read-only, and the friend's data is not fetched again.
    expect(st.visiting?.handle).toBe('robin')
    await useStore.getState().loadData()
    expect(useStore.getState().dataStatus).toBe('error')
  })

  it('says when the owner asked you to leave, and when you can come back', async () => {
    setSessionUser(me)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, view()))
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    render(<HomeVisitPage params={{ handle: 'robin' }} rest="/" />)
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
    act(() => endVisit({ problem: 'kicked', ownerName: null, retryAfterMs: 61_000 }))
    expect((await screen.findByTestId('visit-error')).dataset.problem).toBe('kicked')
    // No name given: the room's owner from the page's own load.
    expect(screen.getByRole('heading', { name: 'Robin asked you to leave' })).toBeTruthy()
    expect(screen.getByText(/visit again in 2 minutes/)).toBeTruthy()
  })

  it('never ends anything outside a friend\'s room', () => {
    endVisit({ problem: 'removed', ownerName: 'Robin', retryAfterMs: null })
    expect(useVisitEnded.getState().ended).toBeNull()
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
    // Robin is listed under "Here now" already, so not again under "Visit a friend".
    const friends = screen.getAllByTestId('visit-friend')
    expect(friends.map((f) => [f.dataset.handle, f.dataset.online])).toEqual([['kim', 'false']])
    fireEvent.click(screen.getByLabelText("Visit Kim's room"))
    expect(go).toHaveBeenCalledWith('/home/kim?autostart=1')
  })

  it('does not list a guest who is here again under "Visit a friend"', () => {
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
    expect(screen.getAllByTestId('person-row').map((r) => r.dataset.handle)).toEqual(['robin', 'sam'])
    expect(screen.queryAllByTestId('visit-friend')).toEqual([])
    expect(screen.getByText('All your friends are here with you.')).toBeTruthy()
    expect(screen.queryByLabelText("Visit Sam Guest's room")).toBeNull()
  })

  it('asks the host to confirm "Ask to leave" before the guest is sent away', async () => {
    const session = await import('@/net/session')
    const kick = vi.spyOn(session, 'kickPlayer').mockImplementation(() => {})
    useRealtime.setState({
      status: 'open',
      me: host,
      sid: 's-host',
      home: { handle: 'robin', owner: host, isOwner: true },
      players: { 's-guest': { sid: 's-guest', user: guest, isOwner: false, outfit: {} as never, joinedAt: 1 } },
      friends: {},
      friendsLoaded: true,
    })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('people-button'))
    const ask = screen.getByTestId('kick-player')
    fireEvent.click(ask)
    expect(kick).not.toHaveBeenCalled()
    expect(ask.getAttribute('aria-expanded')).toBe('true')
    const box = screen.getByTestId('kick-confirm')
    expect(box.textContent).toContain("Ask Sam to leave? They can't come back for 10 minutes.")
    // Focus lands on the safe choice.
    expect(document.activeElement).toBe(screen.getByTestId('kick-confirm-cancel'))

    // Esc cancels the question only; the panel stays open and focus goes back.
    fireEvent.keyDown(screen.getByTestId('kick-confirm-cancel'), { key: 'Escape' })
    expect(screen.queryByTestId('kick-confirm')).toBeNull()
    expect(screen.getByTestId('people-panel')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('kick-player'))

    fireEvent.click(screen.getByTestId('kick-player'))
    fireEvent.click(screen.getByTestId('kick-confirm-cancel'))
    expect(kick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('kick-player'))
    fireEvent.click(screen.getByTestId('kick-confirm-yes'))
    expect(kick).toHaveBeenCalledWith('s-guest')
    expect(screen.queryByTestId('kick-confirm')).toBeNull()
  })

  it('says "Here with you" for a friend on their way into your room (not listed yet)', () => {
    useRealtime.setState({
      status: 'open',
      me: host,
      sid: 's-host',
      home: { handle: 'robin', owner: host, isOwner: true },
      players: {},
      friends: { [guest.id]: { user: guest, online: true, where: 'your_home', homeCount: 0 } },
      friendsLoaded: true,
    })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('people-button'))
    expect(screen.getAllByTestId('visit-friend')[0].textContent).toContain('Here with you')
  })

  it("counts the people in a friend's room only when someone is with them", () => {
    const kim = { id: 'u-3', handle: 'kim', displayName: 'Kim Lee', image: null }
    const ana = { id: 'u-4', handle: 'ana', displayName: 'Ana', image: null }
    useRealtime.setState({
      status: 'open',
      me: guest,
      sid: 's-guest',
      home: { handle: 'sam', owner: guest, isOwner: true },
      players: {},
      friends: {
        [kim.id]: { user: kim, online: true, where: 'own_home', homeCount: 1 },
        [ana.id]: { user: ana, online: true, where: 'own_home', homeCount: 3 },
      },
      friendsLoaded: true,
    })
    render(<PeopleHud />)
    fireEvent.click(screen.getByTestId('people-button'))
    const rows = Object.fromEntries(screen.getAllByTestId('visit-friend').map((r) => [r.dataset.handle, r.textContent ?? '']))
    expect(rows.kim).toContain('In their room')
    expect(rows.kim).not.toMatch(/1 in their room|·/)
    expect(rows.ana).toContain('In their room with 2 friends')
  })

  it('shows what your emote did, even in first person where your character is hidden', () => {
    online()
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    render(<PeopleHud />)
    expect(screen.queryByTestId('emote-echo')).toBeNull()
    act(() => useRealtime.setState({ emotes: { 's-guest': { emote: 'wave', at: Date.now() } } }))
    expect(screen.getByTestId('emote-echo').textContent).toBe('You waved · Robin sees it')
  })

  it('says nobody saw an emote when you are alone', () => {
    useRealtime.setState({ status: 'open', me: guest, sid: 's-guest', friendsLoaded: true, emotes: { 's-guest': { emote: 'cheer', at: Date.now() } } })
    render(<PeopleHud />)
    expect(screen.getByTestId('emote-echo').textContent).toBe('You cheered · nobody else is here to see it')
  })

  it('labels the spoiler toggle on phones and calls the room look-only', () => {
    useStore.setState({ visiting: { handle: 'robin', owner: host } })
    render(<PeopleHud />)
    expect(screen.getByTestId('visit-spoilers').textContent).toContain('Spoilers')
    expect(screen.getByTestId('visit-banner').textContent).toContain('look-only')
    expect(screen.getByTestId('visit-banner').textContent).not.toContain('nothing here changes')
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
