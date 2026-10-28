/**
 * What the room knows about other people right now (Phase 3, workstream C), as a small Zustand
 * store fed by the socket (session.ts). Reactive UI reads it; poses are not here (they change 10
 * times a second): they live in `poses`, a plain map of `PoseBuffer`s read every frame.
 */
import { create } from 'zustand'
import type { PublicUser } from '@/contracts/models'
import type { Emote, FriendPresence, PresenceWhere, RealtimeErrorCode } from '@/contracts/realtime'
import { normalizeOutfit, starterOutfit, type Outfit } from '@/world/avatars/catalog'
import type { ConnectionStatus } from './client'
import { PoseBuffer } from './interpolation'

/** How long a chat bubble stays above someone's head. */
export const BUBBLE_MS = 6500
/** How long an emote plays. */
export const EMOTE_MS = 3000
/** Chat lines kept for the chat log. */
export const CHAT_LOG_MAX = 40

export interface Player {
  sid: string
  user: PublicUser
  isOwner: boolean
  outfit: Outfit
  joinedAt: number
}

export interface ChatLine {
  id: string
  sid: string
  user: PublicUser
  text: string
  /** Local time it arrived (ms). */
  at: number
  mine: boolean
}

export interface HomeInfo {
  handle: string
  owner: PublicUser
  isOwner: boolean
}

export interface RealtimeState {
  status: ConnectionStatus | 'off'
  /** Me, from the server's hello. */
  me: PublicUser | null
  sid: string | null
  home: HomeInfo | null
  /** The last refused join (not friends, full ...), cleared by the next successful one. */
  joinError: { code: RealtimeErrorCode; message: string } | null
  /** Everyone else in this home, by connection id. */
  players: Record<string, Player>
  /** Latest chat line per connection (mine included), for the bubbles. */
  bubbles: Record<string, ChatLine>
  /** Emote playing per connection (mine included), with its local start time. */
  emotes: Record<string, { emote: Emote; at: number }>
  chat: ChatLine[]
  /** Unread chat lines (while the chat log is closed). */
  unread: number
  /** My friends and where they are, by user id. */
  friends: Record<string, FriendPresence>
  friendsLoaded: boolean
  /** Chat the server turned down (too fast), for the chat box to offer again. `n` changes each time. */
  chatReturned: { text: string; message: string; n: number } | null
}

export const initialRealtimeState: RealtimeState = {
  status: 'off',
  me: null,
  sid: null,
  home: null,
  joinError: null,
  players: {},
  bubbles: {},
  emotes: {},
  chat: [],
  unread: 0,
  friends: {},
  friendsLoaded: false,
  chatReturned: null,
}

export const useRealtime = create<RealtimeState>()(() => ({ ...initialRealtimeState }))

/** Interpolation buffers for remote players, by connection id (not reactive). */
export const poses = new Map<string, PoseBuffer>()

export function poseBuffer(sid: string): PoseBuffer {
  let b = poses.get(sid)
  if (!b) {
    b = new PoseBuffer()
    poses.set(sid, b)
  }
  return b
}

/** A look received over the network, repaired; nothing usable falls back to the person's starter look. */
export function outfitFor(raw: unknown, userId: string): Outfit {
  const fallback = starterOutfit(userId)
  if (!raw || typeof raw !== 'object') return fallback
  return normalizeOutfit(raw, fallback)
}

/** People in this home, owner first, then by arrival. */
export function playersInOrder(players: Record<string, Player>): Player[] {
  return Object.values(players).sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.joinedAt - b.joinedAt)
}

/** Friends to offer in "Visit a friend": online first, then by name. */
export function friendsInOrder(friends: Record<string, FriendPresence>): FriendPresence[] {
  return Object.values(friends).sort((a, b) => Number(b.online) - Number(a.online) || a.user.displayName.localeCompare(b.user.displayName))
}

/** A short line about where a friend is. */
export function whereLabel(where: PresenceWhere, name: string): string {
  switch (where) {
    case 'own_home':
      return 'In their room'
    case 'your_home':
      return 'In your room'
    case 'elsewhere':
      return "Visiting a friend's room"
    case 'lobby':
      return 'Online'
    case 'offline':
      return `${name} is offline`
  }
}

/** First name for toasts ("Mia Chen" -> "Mia"). */
export function firstName(u: Pick<PublicUser, 'displayName' | 'handle'>): string {
  const first = u.displayName.trim().split(/\s+/)[0]
  return first || (u.handle ? `@${u.handle}` : 'Someone')
}

/** Tests and sign-out. */
export function resetRealtime(): void {
  poses.clear()
  useRealtime.setState({ ...initialRealtimeState })
}
