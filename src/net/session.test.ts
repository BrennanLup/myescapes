import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerState, ServerMessage } from '@/contracts/realtime'
import { useCameraMode, playerView } from '@/player/view'
import { resetShellForTests, useShell } from '@/ui/shell/shellStore'
import { starterOutfit, DEFAULT_OUTFIT } from '@/world/avatars/catalog'
import { ServerClock } from './clock'
import { activeLocalEmote, applyMessage, localState, poseChanged } from './session'
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
