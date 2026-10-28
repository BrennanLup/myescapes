/**
 * "Friends online" on the phone's home screen (Phase 3 QA): who of your friends is around right
 * now, with a link into their 3D room. Uses the light presence poll (`useFriendPresence`, no
 * three.js, no socket) that the settings friends list uses. Shows nothing when nobody is online
 * or the server has no realtime, so the home screen stays calm.
 */
import type { FriendPresence } from '../../contracts/realtime'
import { Avatar } from '../../social/ui'
import { PresenceDot, presenceText, useFriendPresence } from '../../social/visit/presence'
import { visitUrl } from '../../social/visit/urls'

/** How many friends the row lists before "See all friends". */
export const FRIENDS_ONLINE_MAX = 3

/** Online friends with a room to visit (a handle), the ones already in a room first, then by name. */
export function onlineFriends(map: Record<string, FriendPresence>): FriendPresence[] {
  const rank = (p: FriendPresence) => (p.where === 'own_home' ? 0 : p.where === 'your_home' ? 1 : 2)
  return Object.values(map)
    .filter((p) => p.online && !!p.user.handle)
    .sort((a, b) => rank(a) - rank(b) || a.user.displayName.localeCompare(b.user.displayName))
}

export function FriendsOnline({ pollMs }: { pollMs?: number }) {
  const friends = onlineFriends(useFriendPresence(pollMs))
  if (!friends.length) return null
  const shown = friends.slice(0, FRIENDS_ONLINE_MAX)
  const more = friends.length - shown.length
  return (
    <section data-testid="friends-online" aria-labelledby="friends-online-title" className="rounded-cozy bg-white p-3 shadow-sm ring-1 ring-panel-edge/60">
      <div className="mb-1 flex items-center justify-between gap-3 px-1">
        <h2 id="friends-online-title" className="flex items-center gap-2 font-display text-lg">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-good" />
          Friends online
          <span className="sr-only">: {friends.length}</span>
        </h2>
        <a href="/settings#friends" className="text-sm font-semibold text-teal underline">
          {more > 0 ? `See all (${friends.length})` : 'All friends'}
        </a>
      </div>
      <ul className="divide-y divide-panel-edge/60">
        {shown.map((p) => (
          <FriendOnlineRow key={p.user.id} presence={p} />
        ))}
      </ul>
      <p className="px-1 pt-1 text-xs text-ink-soft">Visiting opens their 3D room.</p>
    </section>
  )
}

function FriendOnlineRow({ presence }: { presence: FriendPresence }) {
  const { user } = presence
  const name = user.displayName
  return (
    <li data-testid="friend-online" data-user-id={user.id} className="flex items-center gap-3 px-1 py-2">
      <span className="relative inline-flex shrink-0">
        <Avatar name={name} image={user.image} size={36} />
        <PresenceDot presence={presence} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{name}</span>
        <span className="block truncate text-xs text-ink-soft">{presenceText(presence)}</span>
      </span>
      <a
        href={visitUrl(user.handle ?? '')}
        data-testid="friend-online-visit"
        aria-label={`Visit ${name}'s room in 3D`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-teal px-4 text-sm font-bold text-white shadow-sm active:brightness-95"
      >
        Visit in 3D
      </a>
    </li>
  )
}
