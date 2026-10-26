/**
 * Friends UI (workstream 35): invite link + QR code, search by @handle or exact email, friend
 * requests, per-friend auto-accept, the inbox (pending tags, guest-name claims, notifications)
 * and the notifications badge. Also the `/invite/:code` landing page.
 *
 * Exports used elsewhere: `InvitePage` (router), `FriendsPanel` and `Inbox` (settings, mobile
 * shell), `NotificationsBadge` (headers). Light: no three.js.
 */
import { useEffect, useState } from 'react'
import { signInWithGoogle, useSession } from '../auth'
import type { Friend, FriendRequest, GuestClaim, Invite, Notification, PendingTag, PublicUser, Relation } from '../contracts/models'
import { callApi, ROUTES } from '../contracts/routes'
import { Link } from '../router'
import { errorText, inviteMessage, isUnauthorized, loadBadge, loadFriends, loadInbox, normaliseSearch, smsHref, type Section } from './client'
import { QrCode } from './qr'
import { Avatar, Button, Card, ErrorLine, Loading, formatDate, useAction, useLoad, userLabel } from './ui'

export { badgeCount, visitsToConfirm } from './client'

// ---------------------------------------------------------------------------
// Friends panel
// ---------------------------------------------------------------------------

export function FriendsPanel({ inviterName = null }: { inviterName?: string | null }) {
  const load = useLoad((signal) => loadFriends({ signal }), [])
  if (load.status === 'loading') return <div data-testid="friends-panel"><Loading /></div>
  if (load.status === 'error') return <div data-testid="friends-panel"><ErrorLine error={load.error} /></div>
  const { friends, requests, invites } = load.data
  return (
    <div data-testid="friends-panel" className="space-y-4">
      <InviteCard invites={invites} inviterName={inviterName} onChanged={load.reload} />
      <SearchCard onChanged={load.reload} />
      <RequestsCard requests={requests} onChanged={load.reload} />
      <FriendsList friends={friends} onChanged={load.reload} />
    </div>
  )
}

function SectionError<T>({ s }: { s: Section<T> }) {
  return s.ok ? null : <ErrorLine error={s.error} />
}

/** Invites I can still share: unused and not expired, newest first. */
export function activeInvites(invites: readonly Invite[], now = Date.now()): Invite[] {
  return invites.filter((i) => !i.usedBy && Date.parse(i.expiresAt) > now).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function InviteCard({ invites, inviterName, onChanged }: { invites: Section<Invite[]>; inviterName: string | null; onChanged(): void }) {
  const act = useAction()
  const [guestName, setGuestName] = useState('')
  const [created, setCreated] = useState<Invite | null>(null)
  const active = invites.ok ? activeInvites(invites.data) : []
  const current = created ?? active[0] ?? null

  const make = () =>
    act.run(async () => {
      const inv = await callApi(ROUTES.createInvite, { body: guestName.trim() ? { guestName: guestName.trim() } : {} })
      setCreated(inv)
      setGuestName('')
      onChanged()
    })

  return (
    <Card title="Invite a friend" testId="invite-card">
      <p className="mb-3 text-sm text-ink-soft">Text a link to the person you play with. When they sign in, you become friends, and they can claim visits you logged with their name.</p>
      {current && <InviteLink invite={current} inviterName={inviterName} onRevoked={() => { setCreated(null); onChanged() }} />}
      <div className="mt-3 space-y-2">
        <label className="block text-sm">
          <span className="font-bold">Their name in your logs (optional)</span>
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            maxLength={60}
            placeholder="e.g. the name you typed as crew"
            data-testid="invite-guest-name"
            className="mt-1 block min-h-11 w-full rounded-full bg-white px-4 text-base ring-1 ring-panel-edge"
          />
        </label>
        <Button tone={current ? 'quiet' : 'primary'} disabled={act.busy} onClick={() => void make()} data-testid="invite-create">
          {current ? 'Make a new link' : 'Make an invite link'}
        </Button>
        <ErrorLine error={act.error} />
        <SectionError s={invites} />
      </div>
    </Card>
  )
}

function InviteLink({ invite, inviterName, onRevoked }: { invite: Invite; inviterName: string | null; onRevoked(): void }) {
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const act = useAction()
  const text = inviteMessage(invite.url, inviterName)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      act.setError('Copy failed. Press and hold the link to copy it.')
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'My Escapes invite', text, url: invite.url })
    } catch {
      /* cancelled */
    }
  }
  const revoke = () =>
    act.run(async () => {
      await callApi(ROUTES.revokeInvite, { params: { code: invite.code } })
      onRevoked()
    })

  return (
    <div className="space-y-2 rounded-xl bg-paper p-3 ring-1 ring-panel-edge" data-testid="invite-link">
      <p className="break-all font-mono text-xs select-all" data-testid="invite-url">
        {invite.url}
      </p>
      <p className="text-xs text-ink-soft">
        {invite.guestName ? `For "${invite.guestName}" · ` : ''}Expires {formatDate(invite.expiresAt)}
      </p>
      <div className="flex flex-wrap gap-2">
        {canShare && (
          <Button tone="primary" onClick={() => void share()} data-testid="invite-share">
            Share
          </Button>
        )}
        <a href={smsHref(text)} data-testid="invite-sms" className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-4 text-sm font-bold ring-1 ring-panel-edge">
          Text it
        </a>
        <Button onClick={() => void copy()} data-testid="invite-copy">
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        <Button onClick={() => setShowQr((s) => !s)} data-testid="invite-qr-toggle" aria-expanded={showQr}>
          {showQr ? 'Hide QR code' : 'QR code'}
        </Button>
        <Button onClick={() => void revoke()} disabled={act.busy} data-testid="invite-revoke">
          Revoke
        </Button>
      </div>
      {showQr && (
        <div className="pt-2 text-center">
          <QrCode text={invite.url} />
          <p className="mt-1 text-xs text-ink-soft">Let them scan this after a game.</p>
        </div>
      )}
      <ErrorLine error={act.error} />
    </div>
  )
}

const RELATION_TEXT: Record<Relation, string> = {
  none: '',
  friends: 'Already friends',
  request_sent: 'Request sent',
  request_received: 'Wants to be your friend',
  blocked: 'Blocked',
}

function SearchCard({ onChanged }: { onChanged(): void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<(PublicUser & { relation: Relation })[] | null>(null)
  const act = useAction()
  const search = () => {
    const query = normaliseSearch(q)
    if (!query) return
    void act.run(async () => {
      const r = await callApi(ROUTES.userSearch, { query: { q: query } })
      setResults(r.users)
    })
  }
  const setRelation = (id: string, relation: Relation) => setResults((rs) => rs?.map((u) => (u.id === id ? { ...u, relation } : u)) ?? null)
  const add = (u: PublicUser) =>
    act.run(async () => {
      const r = await callApi(ROUTES.sendFriendRequest, { body: { userId: u.id } })
      setRelation(u.id, r.relation)
      onChanged()
    })
  const accept = (u: PublicUser) =>
    act.run(async () => {
      await callApi(ROUTES.acceptFriend, { params: { userId: u.id } })
      setRelation(u.id, 'friends')
      onChanged()
    })
  return (
    <Card title="Find a friend" testId="friend-search">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="@handle or exact email"
          aria-label="Search by @handle or email"
          autoCapitalize="none"
          autoCorrect="off"
          data-testid="friend-search-input"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base ring-1 ring-panel-edge"
        />
        <Button type="submit" tone="primary" disabled={act.busy || !q.trim()} data-testid="friend-search-submit">
          Search
        </Button>
      </form>
      <p className="mt-2 text-xs text-ink-soft">There's no public list of people. Search needs their exact @handle or email.</p>
      <ErrorLine error={act.error} />
      {results && (
        <ul className="mt-3 space-y-2" data-testid="friend-search-results">
          {results.length === 0 && <li className="text-sm text-ink-soft" data-testid="friend-search-none">Nobody found with that handle or email.</li>}
          {results.map((u) => (
            <li key={u.id} className="flex items-center gap-3" data-testid="friend-search-result">
              <Avatar name={u.displayName} image={u.image} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{userLabel(u)}</span>
              {u.relation === 'none' && (
                <Button tone="primary" disabled={act.busy} onClick={() => void add(u)} data-testid="friend-add">
                  Add friend
                </Button>
              )}
              {u.relation === 'request_received' && (
                <Button tone="primary" disabled={act.busy} onClick={() => void accept(u)} data-testid="friend-accept">
                  Accept
                </Button>
              )}
              {u.relation !== 'none' && u.relation !== 'request_received' && <span className="text-xs text-ink-soft" data-testid="friend-relation">{RELATION_TEXT[u.relation]}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RequestsCard({ requests, onChanged }: { requests: Section<FriendRequest[]>; onChanged(): void }) {
  const act = useAction()
  if (requests.ok && requests.data.length === 0) return null
  const answer = (u: PublicUser, accept: boolean) =>
    act.run(async () => {
      if (accept) await callApi(ROUTES.acceptFriend, { params: { userId: u.id } })
      else await callApi(ROUTES.declineFriend, { params: { userId: u.id } })
      onChanged()
    })
  return (
    <Card title="Friend requests" testId="friend-requests">
      <SectionError s={requests} />
      {requests.ok && (
        <ul className="space-y-2">
          {requests.data.map((r) => (
            <li key={r.user.id + r.direction} className="flex flex-wrap items-center gap-2" data-testid={`friend-request-${r.direction}`}>
              <Avatar name={r.user.displayName} image={r.user.image} />
              <span className="min-w-0 flex-1 truncate text-sm">
                <b>{userLabel(r.user)}</b>
                <span className="block text-xs text-ink-soft">{r.direction === 'incoming' ? 'wants to be friends' : 'request sent'}</span>
              </span>
              {r.direction === 'incoming' ? (
                <>
                  <Button tone="primary" disabled={act.busy} onClick={() => void answer(r.user, true)} data-testid="request-accept">
                    Accept
                  </Button>
                  <Button disabled={act.busy} onClick={() => void answer(r.user, false)} data-testid="request-decline">
                    Decline
                  </Button>
                </>
              ) : (
                <Button disabled={act.busy} onClick={() => void answer(r.user, false)} data-testid="request-cancel">
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={act.error} />
    </Card>
  )
}

function FriendsList({ friends, onChanged }: { friends: Section<Friend[]>; onChanged(): void }) {
  return (
    <Card title="Friends" testId="friends-list">
      <SectionError s={friends} />
      {friends.ok && friends.data.length === 0 && <p className="text-sm text-ink-soft" data-testid="friends-empty">No friends yet. Send an invite link to get started.</p>}
      {friends.ok && (
        <ul className="divide-y divide-panel-edge/60">
          {friends.data.map((f) => (
            <FriendRow key={f.user.id} friend={f} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function FriendRow({ friend, onChanged }: { friend: Friend; onChanged(): void }) {
  const act = useAction()
  const [auto, setAuto] = useState(friend.autoAccept)
  const [confirm, setConfirm] = useState<null | 'unfriend' | 'block'>(null)
  useEffect(() => setAuto(friend.autoAccept), [friend.autoAccept])
  const toggle = (next: boolean) => {
    setAuto(next)
    void act.run(async () => {
      try {
        const f = await callApi(ROUTES.setAutoAccept, { params: { userId: friend.user.id }, body: { autoAccept: next } })
        setAuto(f.autoAccept)
      } catch (e) {
        setAuto(!next)
        throw e
      }
    })
  }
  const remove = (kind: 'unfriend' | 'block') =>
    act.run(async () => {
      if (kind === 'unfriend') await callApi(ROUTES.unfriend, { params: { userId: friend.user.id } })
      else await callApi(ROUTES.blockUser, { params: { userId: friend.user.id } })
      setConfirm(null)
      onChanged()
    })
  const name = friend.user.displayName
  return (
    <li className="space-y-2 py-3" data-testid="friend-row" data-user-id={friend.user.id}>
      <div className="flex items-center gap-3">
        <Avatar name={name} image={friend.user.image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{userLabel(friend.user)}</span>
          <span className="block text-xs text-ink-soft">
            {friend.visitsTogether} {friend.visitsTogether === 1 ? 'room' : 'rooms'} together
          </span>
        </span>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Always add {name}'s visits to my room</span>
        <input type="checkbox" checked={auto} disabled={act.busy} onChange={(e) => toggle(e.target.checked)} data-testid="friend-auto-accept" className="h-5 w-5 shrink-0 accent-[var(--color-accent)]" />
      </label>
      {!confirm ? (
        <div className="flex gap-3 text-xs">
          <button type="button" className="min-h-8 text-ink-soft underline" onClick={() => setConfirm('unfriend')} data-testid="friend-unfriend">
            Unfriend
          </button>
          <button type="button" className="min-h-8 text-ink-soft underline" onClick={() => setConfirm('block')} data-testid="friend-block">
            Block
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg bg-bad/10 p-2 text-sm">
          <p>{confirm === 'unfriend' ? `Unfriend ${name}? Past shared visits stay, but they can't tag you any more.` : `Block ${name}? They can't find you, tag you or send requests.`}</p>
          <div className="flex gap-2">
            <Button tone="danger" disabled={act.busy} onClick={() => void remove(confirm)} data-testid="friend-remove-confirm">
              {confirm === 'unfriend' ? 'Unfriend' : 'Block'}
            </Button>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <ErrorLine error={act.error} />
    </li>
  )
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * The current items plus the ones answered in this view, so an answered tag or claim keeps showing
 * its "Added to your room" / "Claimed" line after the reload drops it from the pending list.
 */
export function withAnswered<T>(current: readonly T[], answered: readonly T[], key: (t: T) => string): T[] {
  const have = new Set(current.map(key))
  return [...answered.filter((t) => !have.has(key(t))), ...current]
}

const tagKey = (t: PendingTag) => t.participantId
const claimKey = (c: GuestClaim) => `${c.inviter.id}:${c.guestName}`

export function Inbox({ onOpenVisit, onChanged }: { onOpenVisit?(visitId: string): void; onChanged?(): void }) {
  const load = useLoad((signal) => loadInbox({ signal }), [])
  const [answeredTags, setAnsweredTags] = useState<PendingTag[]>([])
  const [answeredClaims, setAnsweredClaims] = useState<GuestClaim[]>([])
  const changed = () => {
    load.reload()
    onChanged?.()
  }
  if (load.status === 'loading') return <div data-testid="inbox"><Loading /></div>
  if (load.status === 'error') return <div data-testid="inbox"><ErrorLine error={load.error} /></div>
  const { tags, claims, notifications } = load.data
  const tagItems = tags.ok ? withAnswered(tags.data, answeredTags, tagKey) : []
  const claimItems = claims.ok ? withAnswered(claims.data, answeredClaims, claimKey) : []
  const nothing = tags.ok && !tagItems.length && claims.ok && !claimItems.length && notifications.ok && !notifications.data.items.length
  const allSignedOut = !tags.ok && isUnauthorized(tags.error) && !notifications.ok && isUnauthorized(notifications.error)
  return (
    <div data-testid="inbox" className="space-y-3">
      {allSignedOut ? (
        <ErrorLine error={tags.ok ? null : tags.error} />
      ) : (
        <>
          {nothing && <p className="text-sm text-ink-soft" data-testid="inbox-empty">Nothing new. Visits friends tag you on show up here.</p>}
          <SectionError s={tags} />
          {tagItems.map((t) => (
            <PendingTagItem
              key={tagKey(t)}
              tag={t}
              onChanged={() => {
                setAnsweredTags((a) => (a.some((x) => tagKey(x) === tagKey(t)) ? a : [...a, t]))
                changed()
              }}
              onOpenVisit={onOpenVisit}
            />
          ))}
          <SectionError s={claims} />
          {claimItems.map((c) => (
            <ClaimItem
              key={claimKey(c)}
              claim={c}
              onChanged={() => {
                setAnsweredClaims((a) => (a.some((x) => claimKey(x) === claimKey(c)) ? a : [...a, c]))
                changed()
              }}
            />
          ))}
          <SectionError s={notifications} />
          {notifications.ok && notifications.data.items.length > 0 && <NotificationList items={notifications.data.items} unread={notifications.data.unread} onChanged={changed} onOpenVisit={onOpenVisit} />}
        </>
      )}
    </div>
  )
}

function PendingTagItem({ tag, onChanged, onOpenVisit }: { tag: PendingTag; onChanged(): void; onOpenVisit?(id: string): void }) {
  const act = useAction()
  const [done, setDone] = useState<null | 'accepted' | 'declined'>(null)
  const answer = (accept: boolean) =>
    act.run(async () => {
      const r = await callApi(ROUTES.respondToTag, { params: { id: tag.visitId }, body: { accept } })
      setDone(r.status)
      onChanged()
    })
  return (
    <div className="rounded-[var(--radius-cozy)] bg-white/70 p-3 ring-1 ring-warn" data-testid="inbox-tag" data-visit-id={tag.visitId}>
      <p className="text-sm">
        <b>{tag.taggedBy.displayName}</b> says you played <b>{tag.game.name}</b> together on {formatDate(tag.date)}.
      </p>
      {done ? (
        <p className="mt-2 text-sm text-ink-soft" data-testid="inbox-tag-done">
          {done === 'accepted' ? 'Added to your room.' : 'Removed.'}
          {done === 'accepted' && onOpenVisit && (
            <button type="button" className="ml-2 font-bold text-teal" onClick={() => onOpenVisit(tag.visitId)}>
              Open
            </button>
          )}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button tone="primary" disabled={act.busy} onClick={() => void answer(true)} data-testid="inbox-tag-accept">
            Add to my room
          </Button>
          <Button disabled={act.busy} onClick={() => void answer(false)} data-testid="inbox-tag-decline">
            That wasn't me
          </Button>
        </div>
      )}
      <ErrorLine error={act.error} />
    </div>
  )
}

export function ClaimItem({ claim, onChanged }: { claim: GuestClaim; onChanged(): void }) {
  const act = useAction()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(claim.visits.map((v) => v.participantId)))
  const [claimed, setClaimed] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const n = claim.visits.length
  const submit = (ids?: string[]) =>
    act.run(async () => {
      const r = await callApi(ROUTES.claim, { body: { inviterId: claim.inviter.id, guestName: claim.guestName, ...(ids ? { participantIds: ids } : {}) } })
      setClaimed(r.claimed)
      onChanged()
    })
  if (dismissed) return null
  return (
    <div className="rounded-[var(--radius-cozy)] bg-white/70 p-3 ring-1 ring-teal/50" data-testid="inbox-claim">
      <p className="text-sm">
        <b>{claim.inviter.displayName}</b> has {n} {n === 1 ? 'visit' : 'visits'} with a guest named <b>"{claim.guestName}"</b>. Is that you?
      </p>
      {claimed !== null ? (
        <p className="mt-2 text-sm text-ink-soft" data-testid="inbox-claim-done">
          Claimed {claimed} {claimed === 1 ? 'visit' : 'visits'}. They're in your room now.
        </p>
      ) : (
        <>
          {picking && (
            <ul className="mt-2 space-y-1" data-testid="inbox-claim-list">
              {claim.visits.map((v) => (
                <li key={v.participantId}>
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.has(v.participantId)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const next = new Set(s)
                          if (e.target.checked) next.add(v.participantId)
                          else next.delete(v.participantId)
                          return next
                        })
                      }
                      className="h-5 w-5 accent-[var(--color-accent)]"
                    />
                    {v.game.name} · {formatDate(v.date)}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {picking ? (
              <Button tone="primary" disabled={act.busy || picked.size === 0} onClick={() => void submit([...picked])} data-testid="inbox-claim-picked">
                Claim {picked.size}
              </Button>
            ) : (
              <Button tone="primary" disabled={act.busy} onClick={() => void submit()} data-testid="inbox-claim-all">
                {n === 1 ? "Yes, that's me" : `Claim all ${n}`}
              </Button>
            )}
            {n > 1 && (
              <Button onClick={() => setPicking((p) => !p)} data-testid="inbox-claim-pick">
                {picking ? 'Claim all instead' : 'Pick some'}
              </Button>
            )}
            <Button onClick={() => setDismissed(true)} data-testid="inbox-claim-dismiss">
              Not me
            </Button>
          </div>
        </>
      )}
      <ErrorLine error={act.error} />
    </div>
  )
}

function NotificationList({ items, unread, onChanged, onOpenVisit }: { items: Notification[]; unread: number; onChanged(): void; onOpenVisit?(id: string): void }) {
  const act = useAction()
  const markAll = () =>
    act.run(async () => {
      await callApi(ROUTES.readNotifications, { body: { all: true } })
      onChanged()
    })
  return (
    <div className="space-y-2" data-testid="notifications">
      <div className="flex items-center justify-between">
        <h3 className="font-display">Notifications</h3>
        {unread > 0 && (
          <button type="button" className="min-h-9 text-sm font-bold text-teal" disabled={act.busy} onClick={() => void markAll()} data-testid="notifications-read-all">
            Mark all read
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {items.map((n) => (
          <li key={n.id} data-testid="notification" data-unread={n.readAt ? undefined : 'true'} className={`flex items-start gap-2 rounded-lg px-2 py-2 text-sm ${n.readAt ? 'text-ink-soft' : 'bg-white/70 font-bold'}`}>
            {n.actor && <Avatar name={n.actor.displayName} image={n.actor.image} size={24} />}
            <span className="min-w-0 flex-1">
              {n.visitId && onOpenVisit ? (
                <button type="button" className="text-left" onClick={() => onOpenVisit(n.visitId as string)}>
                  {n.text}
                </button>
              ) : (
                n.text
              )}
              <span className="block text-xs font-normal text-ink-soft">{formatDate(n.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
      <ErrorLine error={act.error} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notifications badge
// ---------------------------------------------------------------------------

const BADGE_POLL_MS = 60_000

/**
 * A bell with the unread count (notifications plus pending tags). Renders nothing when signed out.
 * Polls once a minute while the tab is visible.
 */
export function NotificationsBadge({ href = '/settings#inbox', onOpen, refreshKey = 0 }: { href?: string; onOpen?(): void; refreshKey?: number }) {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    const ac = new AbortController()
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      loadBadge({ signal: ac.signal })
        .then((n) => live && setCount(n))
        .catch(() => undefined)
    }
    refresh()
    const id = setInterval(refresh, BADGE_POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      live = false
      ac.abort()
      clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshKey])
  if (count === null) return null
  const label = count ? `${count} new` : 'No new notifications'
  const inner = (
    <>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span data-testid="notifications-count" className="absolute -top-1 -right-1 min-w-5 rounded-full bg-bad px-1 text-center text-[11px] leading-5 font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </>
  )
  const cls = 'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-white/60'
  return onOpen ? (
    <button type="button" aria-label={label} data-testid="notifications-badge" onClick={onOpen} className={cls}>
      {inner}
    </button>
  ) : (
    <Link to={href} aria-label={label} data-testid="notifications-badge" className={cls}>
      {inner}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// /invite/:code
// ---------------------------------------------------------------------------

const REASON_TEXT = { expired: 'This invite link has expired.', used: 'This invite link was already used.', revoked: 'This invite link was cancelled.' } as const

export function InvitePage({ params }: { params: Record<string, string>; rest?: string }) {
  const code = params.code ?? ''
  const session = useSession()
  const preview = useLoad((signal) => callApi(ROUTES.invitePreview, { params: { code } }, { signal }), [code])
  const act = useAction()
  const [accepted, setAccepted] = useState<{ friend: Friend; claimableVisits: number } | null>(null)

  const accept = () =>
    act.run(async () => {
      const r = await callApi(ROUTES.acceptInvite, { params: { code } })
      setAccepted(r)
    })

  const signIn = () =>
    act.run(async () => {
      await signInWithGoogle(`/invite/${encodeURIComponent(code)}`)
    })

  let body
  if (preview.status === 'loading') body = <Loading />
  else if (preview.status === 'error') body = <ErrorLine error={preview.error} testId="invite-error" />
  else {
    const p = preview.data
    const inviter = p.inviter.displayName
    if (accepted) {
      body = <InviteAccepted inviter={accepted.friend.user} claimable={accepted.claimableVisits} />
    } else if (!p.valid) {
      body = (
        <div className="space-y-3" data-testid="invite-invalid">
          <p>{p.reason ? REASON_TEXT[p.reason] : 'This invite link no longer works.'}</p>
          <p className="text-sm text-ink-soft">Ask {inviter} to send a new one.</p>
        </div>
      )
    } else {
      body = (
        <div className="space-y-4" data-testid="invite-valid">
          <div className="flex items-center gap-3">
            <Avatar name={inviter} image={p.inviter.image} size={48} />
            <p className="text-lg">
              <b>{userLabel(p.inviter)}</b> invited you to be friends on My Escapes.
            </p>
          </div>
          <p className="text-sm text-ink-soft">Log the escape rooms you play together once, and each keep your own review.{p.guestName ? ` They've already logged some visits with "${p.guestName}"; you can claim them after joining.` : ''}</p>
          {session.status === 'signed-in' ? (
            <Button tone="primary" disabled={act.busy} onClick={() => void accept()} data-testid="invite-accept" className="w-full">
              Accept invite
            </Button>
          ) : session.status === 'loading' ? (
            <Loading />
          ) : (
            <Button tone="primary" disabled={act.busy} onClick={() => void signIn()} data-testid="invite-sign-in" className="w-full">
              Continue with Google
            </Button>
          )}
          <ErrorLine error={act.error} />
        </div>
      )
    }
  }

  return (
    <main data-testid="invite-page" className="min-h-screen bg-panel px-4 py-10 text-ink">
      <div className="mx-auto max-w-md space-y-6">
        <h1 className="font-display text-3xl">You're invited</h1>
        {body}
        <LegalLinks />
      </div>
    </main>
  )
}

function InviteAccepted({ inviter, claimable }: { inviter: PublicUser; claimable: number }) {
  const claims = useLoad((signal) => callApi(ROUTES.claims, {}, { signal }).then((r) => r.claims.filter((c) => c.inviter.id === inviter.id)), [inviter.id, claimable])
  return (
    <div className="space-y-4" data-testid="invite-accepted">
      <p className="text-lg">
        You and <b>{inviter.displayName}</b> are friends now.
      </p>
      {claimable > 0 && claims.status === 'loading' && <Loading />}
      {claims.status === 'error' && claimable > 0 && <p className="text-sm text-bad">{errorText(claims.error)}</p>}
      {claims.status === 'ready' && claims.data.map((c) => <ClaimItem key={c.guestName} claim={c} onChanged={() => undefined} />)}
      <div className="flex flex-wrap gap-2">
        <a href="/" className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 font-bold text-accent-ink" data-testid="invite-go-home">
          Go to my room
        </a>
        <Link to="/settings" className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-5 font-bold ring-1 ring-panel-edge">
          Friends and settings
        </Link>
      </div>
    </div>
  )
}

/** Links to the static pages. Plain anchors: they are served by the server, not the client router. */
export function LegalLinks() {
  return (
    <nav className="flex flex-wrap gap-4 pt-4 text-sm text-ink-soft underline" data-testid="legal-links">
      <a href="/about">About</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  )
}
