/**
 * "Friends online" on the phone home (/m) (Phase 3, workstream C): who is around right now, with a
 * Visit button into their room. Light, like presence.tsx (no three.js, no socket, no room store):
 * the phone bundle must stay free of them (src/mobile/shell/bundle.test.ts).
 *
 * Shows nothing until someone is online, so a quiet evening costs no space on the home screen.
 */
import type { FriendPresence } from '@/contracts/realtime'
import { Avatar } from '../ui'
import { presenceText, useFriendPresence } from './presence'
import { visitUrl } from './urls'

/** How many rows before "and N more". */
export const FRIENDS_ONLINE_MAX = 4

const RANK: Record<FriendPresence['where'], number> = { own_home: 0, your_home: 1, elsewhere: 2, lobby: 3, offline: 4 }

/** Online friends, the ones at home (worth visiting) first, then by name. */
export function onlineFriends(map: Record<string, FriendPresence>): FriendPresence[] {
  return Object.values(map)
    .filter((f) => f.online)
    .sort((a, b) => RANK[a.where] - RANK[b.where] || a.user.displayName.localeCompare(b.user.displayName))
}

export function FriendsOnline({
  onJoinMine,
  presence,
  max = FRIENDS_ONLINE_MAX,
}: {
  /** A friend is in your room: open your own 3D room (the phone shell passes "View on desktop"). */
  onJoinMine?(): void
  /** Tests: presence by user id instead of polling the server. */
  presence?: Record<string, FriendPresence>
  max?: number
}) {
  const polled = useFriendPresence()
  const online = onlineFriends(presence ?? polled)
  if (!online.length) return null
  const shown = online.slice(0, max)
  const more = online.length - shown.length
  return (
    <section data-testid="friends-online" aria-labelledby="friends-online-title" className="space-y-2">
      <h2 id="friends-online-title" className="flex items-center gap-2 font-display text-xl">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-good" />
        Friends online
        <span className="font-sans text-sm font-semibold text-ink-soft">{online.length}</span>
      </h2>
      <ul className="divide-y divide-panel-edge/60 rounded-2xl bg-white/60 px-3 ring-1 ring-panel-edge">
        {shown.map((f) => (
          <FriendOnlineRow key={f.user.id} friend={f} onJoinMine={onJoinMine} />
        ))}
      </ul>
      {more > 0 ? (
        <a href="/settings#friends" data-testid="friends-online-more" className="inline-block text-sm font-semibold text-teal underline">
          and {more} more online
        </a>
      ) : null}
    </section>
  )
}

function FriendOnlineRow({ friend, onJoinMine }: { friend: FriendPresence; onJoinMine?(): void }) {
  const name = friend.user.displayName
  const handle = friend.user.handle
  const button = 'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold shadow-sm active:brightness-95'
  return (
    <li data-testid="friend-online" data-user-id={friend.user.id} className="flex items-center gap-3 py-2.5">
      <span className="relative inline-flex shrink-0">
        <Avatar name={name} image={friend.user.image} />
        <span aria-hidden className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full bg-good ring-2 ring-[var(--color-paper)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{name}</span>
        <span className="block truncate text-xs text-ink-soft">{presenceText(friend)}</span>
      </span>
      {friend.where === 'your_home' ? (
        onJoinMine ? (
          <button type="button" data-testid="friend-online-join" onClick={onJoinMine} aria-label={`Join ${name} in your room`} className={`${button} bg-white/80 text-ink ring-1 ring-panel-edge`}>
            Join
          </button>
        ) : null
      ) : handle ? (
        <a href={visitUrl(handle)} data-testid="friend-online-visit" aria-label={`Visit ${name}'s room`} className={`${button} bg-teal text-white`}>
          Visit
        </a>
      ) : null}
    </li>
  )
}
