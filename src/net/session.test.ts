import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerState, ServerMessage } from '@/contracts/realtime'
import { useCameraMode, playerView } from '@/player/view'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { starterOutfit, DEFAULT_OUTFIT } from '@/world/avatars/catalog'
import { ServerClock } from './clock'
import { bus, type AppEvent } from '@/contracts/events'
import { RealtimeClient, type SocketLike } from './client'
import { activeLocalEmote, applyMessage, chatSlowDown, clearRoom, holdRoom, installRealtime, localState, poseChanged, roomOnScreen, sendChat } from './session'
import { useStore } from '@/state/store'
import { resetVisitForTests, useVisitEnded } from '@/social/visit/state'
import { BUBBLE_MS, firstName, friendsInOrder, outfitFor, playersInOrder, poses, resetRealtime, useRealtime } from './store'

const host = { id: 'u-host', handle: 'robin', displayName: 'Robin Host', image: null }
const guest = { id: 'u-guest', handle: 'sam', displayName: 'Sam Guest', image: null }
const other = { id: 'u-3', handle: 'kim', displayName: 'Kim', image: null }
const pose = (x: number): PlayerState => ({ p: [x, 0, 1], yaw: 0, pitch: 0, cam: 'third', anim: 'walk', v: 1.2 })
const c = { clock: new ServerClock(), sid: 's-host' }
const apply = (m: ServerMessage, now = 1000) => applyMessage(m, c, now)
const toast = () => useShell.getState().toast?.text ?? null

beforeEach(() => {
  resetRealtime()
  resetShellForTests()
})
afterEach(() => vi.restoreAllMocks())

describe('applyMessage', () => {
  it('fills the room from joined, repairing looks and buffering poses', () => {
    apply({ type: 'hello', sid: 's-host', you: host, serverTime: 1, limits: {} })
    apply({
      type: 'joined',
      home: { handle: 'robin', owner: host },
      sid: 's-host',
      isOwner: true,
      serverTime: 5000,
      players: [
        { sid: 's-guest', user: guest, isOwner: false, state: pose(1), outfit: { ...DEFAULT_OUTFIT, hat: 'not-a-hat' }, joinedAt: 10 },
        { sid: 's-3', user: other, isOwner: false, state: null, outfit: null, joinedAt: 5 },
      ],
    })
    const st = useRealtime.getState()
    expect(st.home).toEqual({ handle: 'robin', owner: host, isOwner: true })
    expect(Object.keys(st.players)).toEqual(['s-guest', 's-3'])
    expect(st.players['s-guest'].outfit.hat).toBe(starterOutfit(guest.id).hat)
    expect(st.players['s-guest'].outfit.top).toBe(DEFAULT_OUTFIT.top)
    expect(st.players['s-3'].outfit).toEqual(starterOutfit(other.id))
    expect(poses.get('s-guest')!.sample(5000)!.p[0]).toBe(1)
    expect(poses.has('s-3')).toBe(false)
    expect(playersInOrder(st.players).map((p) => p.sid)).toEqual(['s-3', 's-guest'])
  })

  it('says who came in and left, once per person', () => {
    apply({ type: 'hello', sid: 's-host', you: host, serverTime: 1, limits: {} })
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: 5000, players: [] })
    apply({ type: 'player_joined', player: { sid: 's-guest', user: guest, isOwner: false, state: pose(2), outfit: null, joinedAt: 1 } })
    expect(toast()).toBe('Sam is in your room')
    useShell.setState({ toast: null })
    // The same person from a second tab: no second toast.
    apply({ type: 'player_joined', player: { sid: 's-guest2', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 2 } })
    expect(toast()).toBeNull()
    apply({ type: 'player_left', sid: 's-guest', userId: guest.id, reason: 'replaced' })
    expect(toast()).toBeNull()
    expect(poses.has('s-guest')).toBe(false)
    apply({ type: 'player_left', sid: 's-guest2', userId: guest.id, reason: 'disconnected' })
    expect(toast()).toBe('Sam left')
    expect(useRealtime.getState().players).toEqual({})
    // A replace in the hub's real order (left first, then joined): still no "came in" toast.
    apply({ type: 'player_joined', player: { sid: 's-guest3', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 3 } })
    useShell.setState({ toast: null })
    apply({ type: 'player_left', sid: 's-guest3', userId: guest.id, reason: 'replaced' })
    apply({ type: 'player_joined', player: { sid: 's-guest4', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 4 } })
    expect(toast()).toBeNull()
    // A replace with no join after it (oldest tab closed over the cap) doesn't hide a later visit.
    apply({ type: 'player_left', sid: 's-guest4', userId: guest.id, reason: 'replaced' }, 10_000)
    apply({ type: 'player_joined', player: { sid: 's-guest5', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 5 } }, 60_000)
    expect(toast()).toBe('Sam is in your room')
  })

  it('a visitor hears the host is home', () => {
    apply({ type: 'hello', sid: 's-guest', you: guest, serverTime: 1, limits: {} })
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-guest', isOwner: false, serverTime: 5000, players: [] })
    apply({ type: 'player_joined', player: { sid: 's-host', user: host, isOwner: true, state: null, outfit: null, joinedAt: 1 } })
    expect(toast()).toBe('Robin is home')
  })

  it('buffers poses only for people in the room', () => {
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: 5000, players: [{ sid: 's-guest', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 1 }] })
    apply({ type: 'states', at: 6000, players: [{ sid: 's-guest', s: pose(3) }, { sid: 'ghost', s: pose(4) }] })
    expect(poses.get('s-guest')!.latest()!.s.p[0]).toBe(3)
    expect(poses.has('ghost')).toBe(false)
  })

  it('keeps chat, bubbles, emotes and unread counts', () => {
    apply({ type: 'hello', sid: 's-host', you: host, serverTime: 1, limits: {} })
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: 5000, players: [{ sid: 's-guest', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 1 }] })
    apply({ type: 'chat', id: 'c1', sid: 's-guest', user: guest, text: 'Love the board!', at: 1 }, 2000)
    apply({ type: 'chat', id: 'c2', sid: 's-host', user: host, text: 'Thanks!', at: 2 }, 2100)
    const st = useRealtime.getState()
    expect(st.chat.map((l) => [l.text, l.mine])).toEqual([
      ['Love the board!', false],
      ['Thanks!', true],
    ])
    expect(st.unread).toBe(1)
    expect(st.bubbles['s-guest'].text).toBe('Love the board!')
    expect(BUBBLE_MS).toBeGreaterThan(3000)
    apply({ type: 'emote', sid: 's-guest', emote: 'dance', at: 1 }, 2200)
    expect(useRealtime.getState().emotes['s-guest']).toEqual({ emote: 'dance', at: 2200 })
    apply({ type: 'outfit', sid: 's-guest', outfit: { ...DEFAULT_OUTFIT, topColor: 'teal' } })
    expect(useRealtime.getState().players['s-guest'].outfit.topColor).toBe('teal')
  })

  it('tracks friends presence and reports refused joins', () => {
    apply({ type: 'presence', user: guest, online: true, where: 'own_home' })
    apply({ type: 'presence', user: other, online: false, where: 'offline' })
    expect(friendsInOrder(useRealtime.getState().friends).map((f) => f.user.handle)).toEqual(['sam', 'kim'])
    apply({ type: 'visitor', user: guest, joined: true })
    expect(toast()).toBe('Sam is in your room')
    apply({ type: 'error', code: 'not_friends', message: "Only @robin's friends can visit their room.", about: 'join' })
    expect(useRealtime.getState().joinError?.code).toBe('not_friends')
    expect(toast()).toContain('friends')
  })

  it('tells you when you were asked to leave', () => {
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-guest', isOwner: false, serverTime: 5000, players: [] })
    apply({ type: 'left', home: 'robin', reason: 'kicked' })
    expect(useRealtime.getState().home).toBeNull()
    expect(toast()).toBe('Robin asked you to leave their room.')
    expect(useRealtime.getState().joinError?.message).toBe('Robin asked you to leave their room.')
  })

  describe("in a friend's room", () => {
    beforeEach(() => {
      resetVisitForTests()
      useStore.setState({ visiting: { handle: 'robin', owner: host }, reviews: [{ id: 'r1' }] as never })
      apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-guest', isOwner: false, serverTime: 5000, players: [] })
    })
    afterEach(() => {
      resetVisitForTests()
      useStore.setState({ visiting: null, reviews: [] })
    })

    it('closes the room when you are removed (unfriended or blocked), without saying you left', () => {
      apply({ type: 'left', home: 'robin', reason: 'removed' })
      expect(useVisitEnded.getState().ended).toEqual({ problem: 'removed', ownerName: 'Robin', retryAfterMs: null })
      expect(useRealtime.getState().joinError?.message).toBe("You can no longer visit Robin's room.")
      expect(toast()).toBeNull()
      expect(useStore.getState().reviews).toEqual([])
    })

    it('closes the room when the owner asks you to leave', () => {
      apply({ type: 'left', home: 'robin', reason: 'kicked' })
      expect(useVisitEnded.getState().ended?.problem).toBe('kicked')
    })

    it('closes the room when a rejoin is refused, but not when it is only full', () => {
      apply({ type: 'error', code: 'home_full', message: 'Full', about: 'join' })
      expect(useVisitEnded.getState().ended).toBeNull()
      apply({ type: 'error', code: 'forbidden', message: 'Robin Host asked you to leave. You can come back in 4 min.', about: 'join', retryAfterMs: 200_000 })
      expect(useVisitEnded.getState().ended).toEqual({ problem: 'kicked', ownerName: 'Robin', retryAfterMs: 200_000 })
    })

    it('treats a not_found rejoin (a block) like being removed', () => {
      apply({ type: 'error', code: 'not_found', message: 'There is no room with that @handle.', about: 'join' })
      expect(useVisitEnded.getState().ended?.problem).toBe('removed')
    })
  })
})

describe('connection loss, refusals and sounds', () => {
  const fill = () => {
    apply({ type: 'hello', sid: 's-host', you: host, serverTime: 1, limits: {} })
    apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: 5000, players: [{ sid: 's-guest', user: guest, isOwner: false, state: pose(1), outfit: null, joinedAt: 1 }] })
    apply({ type: 'emote', sid: 's-guest', emote: 'wave', at: 1 })
  }

  it('clearRoom forgets everyone (no statues while reconnecting)', () => {
    fill()
    expect(poses.size).toBe(1)
    clearRoom()
    const st = useRealtime.getState()
    expect(st.home).toBeNull()
    expect(st.players).toEqual({})
    expect(st.emotes).toEqual({})
    expect(poses.size).toBe(0)
  })

  it('stays quiet about joins the client is retrying', () => {
    apply({ type: 'error', code: 'unavailable', message: 'Something went wrong on our side.', about: 'join' })
    expect(useRealtime.getState().joinError).toBeNull()
    expect(toast()).toBeNull()
  })

  it('plays soft sounds for arrivals, chat from others and visitors, not for my own chat', () => {
    const events: AppEvent[] = []
    const off = bus.onAny((e) => events.push(e))
    try {
      apply({ type: 'hello', sid: 's-host', you: host, serverTime: 1, limits: {} })
      apply({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: 5000, players: [] })
      apply({ type: 'player_joined', player: { sid: 's-guest', user: guest, isOwner: false, state: null, outfit: null, joinedAt: 2 } })
      apply({ type: 'chat', id: 'c1', sid: 's-guest', user: guest, text: 'hi', at: 3 })
      apply({ type: 'chat', id: 'c2', sid: 's-host', user: host, text: 'hey', at: 4 })
      const names = events.filter((e) => e.type === 'sfx').map((e) => (e.payload as { name: string }).name)
      expect(names).toEqual(['string', 'click'])
    } finally {
      off()
    }
  })

  it('words the chat limit for chat', () => {
    expect(chatSlowDown(10_400)).toBe("You're sending messages quickly. Wait 11 s, then send it again.")
  })
})

describe('installRealtime', () => {
  class Sock implements SocketLike {
    static last: Sock
    readyState = 0
    sent: Record<string, unknown>[] = []
    onopen: ((ev: unknown) => void) | null = null
    onclose: ((ev: { code: number }) => void) | null = null
    onmessage: ((ev: { data: unknown }) => void) | null = null
    onerror: ((ev: unknown) => void) | null = null
    constructor() {
      Sock.last = this
    }
    send(d: string) {
      this.sent.push(JSON.parse(d))
    }
    close() {
      this.readyState = 3
    }
    say(m: ServerMessage) {
      this.onmessage?.({ data: JSON.stringify(m) })
    }
  }

  it('clears the room when the socket drops, and gives refused chat back to the chat box', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ friends: [], here: [], realtime: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new RealtimeClient({ url: 'ws://t', createSocket: () => new Sock(), random: () => 0.5 })
    const release = holdRoom()
    const off = await installRealtime({ client, handle: 'robin' })
    try {
      const s = Sock.last
      s.readyState = 1
      s.onopen?.({})
      s.say({ type: 'hello', sid: 's-host', you: host, serverTime: Date.now(), limits: {} })
      s.say({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: Date.now(), players: [{ sid: 's-guest', user: guest, isOwner: false, state: pose(1), outfit: null, joinedAt: 1 }] })
      expect(Object.keys(useRealtime.getState().players)).toEqual(['s-guest'])

      expect(sendChat('one').ok).toBe(true)
      expect(sendChat('two').ok).toBe(true)
      s.say({ type: 'chat', id: 'c1', sid: 's-host', user: host, text: 'one', at: 1 })
      s.say({ type: 'error', code: 'rate_limited', message: 'slow', about: 'chat', retryAfterMs: 3000 })
      expect(useRealtime.getState().chatReturned).toMatchObject({ text: 'two', message: chatSlowDown(3000) })

      s.readyState = 3
      s.onclose?.({ code: 1006 })
      const st = useRealtime.getState()
      expect(st.status).toBe('reconnecting')
      expect(st.players).toEqual({})
      expect(st.home).toBeNull()
      expect(poses.size).toBe(0)
    } finally {
      off()
      release()
    }
  })

  it('is in the home only while the main room is on screen (an in-app move to the puzzle room leaves it)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ friends: [], here: [], realtime: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new RealtimeClient({ url: 'ws://t', createSocket: () => new Sock(), random: () => 0.5 })
    // The module loads before App mounts: no join until the room is on screen.
    const off = await installRealtime({ client, handle: 'robin' })
    let release: () => void = () => {}
    try {
      const s = Sock.last
      s.readyState = 1
      s.onopen?.({})
      s.say({ type: 'hello', sid: 's-host', you: host, serverTime: Date.now(), limits: {} })
      expect(s.sent.filter((m) => m.type === 'join')).toEqual([])

      release = holdRoom()
      expect(roomOnScreen()).toBe(true)
      expect(s.sent.filter((m) => m.type === 'join')).toEqual([{ type: 'join', home: 'robin' }])
      s.say({ type: 'joined', home: { handle: 'robin', owner: host }, sid: 's-host', isOwner: true, serverTime: Date.now(), players: [{ sid: 's-guest', user: guest, isOwner: false, state: pose(1), outfit: null, joinedAt: 1 }] })

      // A quick unmount and remount (development double effects) stays in.
      release()
      release = holdRoom()
      await new Promise((r) => setTimeout(r, 300))
      expect(s.sent.filter((m) => m.type === 'leave')).toEqual([])
      expect(s.sent.filter((m) => m.type === 'join')).toHaveLength(1)

      // Off to /daily/room: the puzzle room sets worldReady and moves the shared player view.
      release()
      useStore.setState({ worldReady: true })
      await new Promise((r) => setTimeout(r, 300))
      expect(s.sent.filter((m) => m.type === 'leave')).toEqual([{ type: 'leave' }])
      expect(useRealtime.getState().players).toEqual({})
      playerView.feet = [4, 0, -3]
      playerView.speed = 2
      await new Promise((r) => setTimeout(r, 250))
      expect(s.sent.filter((m) => m.type === 'state')).toEqual([])

      // Back in the room: join again.
      release = holdRoom()
      expect(s.sent.filter((m) => m.type === 'join')).toHaveLength(2)
    } finally {
      off()
      release()
      useStore.setState({ worldReady: false })
      playerView.speed = 0
    }
  })
})

describe('local pose', () => {
  it('reads the player controller and rounds it', () => {
    useCameraMode.setState({ mode: 'third' })
    playerView.feet = [1.23456, 0, -2.5]
    playerView.bodyYaw = 7
    playerView.speed = 1.4
    const s = localState(0)
    expect(s.p[0]).toBeCloseTo(1.235, 3)
    expect(s.yaw).toBeCloseTo(7 - 2 * Math.PI, 2)
    expect(s.cam).toBe('third')
    expect(s.anim).toBe('walk')
    playerView.speed = 0
    expect(localState(0).anim).toBe('idle')
  })

  it('sends only real changes', () => {
    const a = pose(1)
    expect(poseChanged(null, a)).toBe(true)
    expect(poseChanged(a, { ...a, p: [1.004, 0, 1] })).toBe(false)
    expect(poseChanged(a, { ...a, p: [1.05, 0, 1] })).toBe(true)
    expect(poseChanged(a, { ...a, anim: 'idle' })).toBe(true)
    expect(poseChanged(a, { ...a, yaw: 2 * Math.PI })).toBe(false)
  })

  it('no emote plays until one is sent', () => {
    expect(activeLocalEmote()).toBeNull()
  })
})

describe('helpers', () => {
  it('first names and outfits', () => {
    expect(firstName({ displayName: 'Mia Chen', handle: 'mia' })).toBe('Mia')
    expect(firstName({ displayName: '  ', handle: 'mia' })).toBe('@mia')
    expect(outfitFor('nope', 'u1')).toEqual(starterOutfit('u1'))
  })
})
