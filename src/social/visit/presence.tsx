/**
 * Friends' online status outside the 3D room (Phase 3, workstream C): the settings friends list
 * shows a dot and "Visit room". Light (no three.js, no socket): polls `GET /api/presence` while the
 * page is visible.
 */
import { useEffect, useState } from 'react'
import type { FriendPresence } from '@/contracts/realtime'
import { callApi, ROUTES } from '@/contracts/routes'
import { visitUrl } from './urls'

export const PRESENCE_POLL_MS = 30_000

/** Presence by user id; empty until loaded (or when the server has no realtime). */
export function useFriendPresence(pollMs = PRESENCE_POLL_MS): Record<string, FriendPresence> {
  const [map, setMap] = useState<Record<string, FriendPresence>>({})
  useEffect(() => {
    let live = true
    const ctl = new AbortController()
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const list = await callApi(ROUTES.presence, {}, { signal: ctl.signal })
        if (live) setMap(Object.fromEntries(list.friends.map((f) => [f.user.id, f])))
      } catch {
        /* signed out or offline: no dots */
      }
    }
    void load()
    const t = setInterval(load, pollMs)
    const onShow = () => void load()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      live = false
      ctl.abort()
      clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [pollMs])
  return map
}

/** "Online", "In their room" ..., for a friend's row. */
export function presenceText(p: FriendPresence | undefined): string | null {
  if (!p) return null
  if (!p.online) return 'Offline'
  switch (p.where) {
    case 'own_home':
      return p.homeCount > 1 ? `In their room with ${p.homeCount - 1} ${p.homeCount === 2 ? 'friend' : 'friends'}` : 'In their room'
    case 'your_home':
      return 'In your room'
    case 'elsewhere':
      return "Visiting a friend's room"
    default:
      return 'Online'
  }
}

export function PresenceDot({ presence }: { presence: FriendPresence | undefined }) {
  if (!presence) return null
  return (
    <span
      data-testid="presence-dot"
      data-online={presence.online ? 'true' : 'false'}
      aria-hidden
      className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--color-paper)] ${presence.online ? 'bg-good' : 'bg-[#bfae9f]'}`}
    />
  )
}

/** A link into a friend's 3D room (a full page load: the room boots for them). */
export function VisitRoomLink({ handle, name }: { handle: string; name: string }) {
  return (
    <a
      href={visitUrl(handle)}
      data-testid="friend-visit"
      aria-label={`Visit ${name}'s room`}
      className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-teal px-3.5 text-xs font-bold text-white shadow-sm active:brightness-95"
    >
      Visit room
    </a>
  )
}
