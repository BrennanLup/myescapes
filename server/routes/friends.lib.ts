/**
 * Friendship and notification helpers shared by the social routes (workstreams 31-34).
 * Owned by workstream 31. No route registration here: see friends.ts.
 *
 * `friendships` stores one row per pair with `userA < userB`; these helpers hide that ordering
 * behind "me" / "them" views.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { NotificationType, PublicUser } from '../../src/contracts/models'
import type { Db } from '../db/client'
import { friendships, notifications, users, visitParticipants } from '../db/schema'
import { toPublicUser } from '../db/util'

export type FriendshipRow = typeof friendships.$inferSelect

/** Order a pair the way `friendships` stores it. */
export function orderPair(x: string, y: string): { userA: string; userB: string; xIsA: boolean } {
  return x < y ? { userA: x, userB: y, xIsA: true } : { userA: y, userB: x, xIsA: false }
}

/** The friendship row between two users, seen from `me`. */
export interface FriendshipView {
  row: FriendshipRow
  other: string
  /** I auto-accept their tags. */
  myAutoAccept: boolean
  /** They auto-accept my tags. */
  theirAutoAccept: boolean
}

export function viewFrom(row: FriendshipRow, me: string): FriendshipView {
  const meIsA = row.userA === me
  return {
    row,
    other: meIsA ? row.userB : row.userA,
    myAutoAccept: meIsA ? row.aAutoAccepts : row.bAutoAccepts,
    theirAutoAccept: meIsA ? row.bAutoAccepts : row.aAutoAccepts,
  }
}

export async function friendshipBetween(db: Db, me: string, other: string): Promise<FriendshipView | null> {
  if (me === other) return null
  const p = orderPair(me, other)
  const row = (await db.select().from(friendships).where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB))).limit(1))[0]
  return row ? viewFrom(row, me) : null
}

/** Every accepted friendship of `me`. */
export async function acceptedFriendships(db: Db, me: string): Promise<FriendshipView[]> {
  const rows = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userA, me), eq(friendships.userB, me))))
  return rows.map((r) => viewFrom(r, me))
}

/** Ids of my accepted friends. */
export async function friendIds(db: Db, me: string | null): Promise<Set<string>> {
  if (!me) return new Set()
  return new Set((await acceptedFriendships(db, me)).map((f) => f.other))
}

/** True when either side blocked the other. */
export function isBlocked(f: FriendshipView | null): boolean {
  return f?.row.status === 'blocked'
}

/** Public faces of users by id. Missing ids are left out. */
export async function publicUsers(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, PublicUser>> {
  const list = [...new Set([...ids].filter((x): x is string => Boolean(x)))]
  if (!list.length) return new Map()
  const rows = await db
    .select({ id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image })
    .from(users)
    .where(inArray(users.id, list))
  return new Map(rows.map((u) => [u.id, toPublicUser(u)]))
}

export async function publicUser(db: Db, id: string): Promise<PublicUser | null> {
  return (await publicUsers(db, [id])).get(id) ?? null
}

/** How many visits two users are both on (owner or accepted). */
export async function visitsTogetherCounts(db: Db, me: string, others: string[]): Promise<Map<string, number>> {
  if (!others.length) return new Map()
  const mine = db
    .select({ visitId: visitParticipants.visitId })
    .from(visitParticipants)
    .where(and(eq(visitParticipants.userId, me), inArray(visitParticipants.status, ['owner', 'accepted'])))
  const rows = await db
    .select({ userId: visitParticipants.userId, n: sql<number>`count(*)::int` })
    .from(visitParticipants)
    .where(
      and(
        inArray(visitParticipants.userId, others),
        inArray(visitParticipants.status, ['owner', 'accepted']),
        inArray(visitParticipants.visitId, mine),
      ),
    )
    .groupBy(visitParticipants.userId)
  return new Map(rows.map((r) => [r.userId as string, Number(r.n)]))
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotifyInput {
  userId: string
  type: NotificationType
  actorId?: string | null
  visitId?: string | null
  payload?: Record<string, unknown>
}

/** Insert notifications (never to the actor themselves). */
export async function notify(db: Db, items: NotifyInput[]): Promise<void> {
  const rows = items
    .filter((n) => n.userId && n.userId !== n.actorId)
    .map((n) => ({ userId: n.userId, type: n.type, actorId: n.actorId ?? null, visitId: n.visitId ?? null, payload: n.payload ?? {} }))
  if (rows.length) await db.insert(notifications).values(rows)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-12" -> "Oct 12" (plus the year when it isn't `thisYear`). */
export function shortDate(iso: unknown, thisYear?: number): string {
  if (typeof iso !== 'string') return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const base = `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`
  return thisYear !== undefined && Number(m[1]) !== thisYear ? `${base}, ${m[1]}` : base
}

/** The line shown in the inbox. Payloads may carry their own `text` (e.g. from moderation). */
export function notificationText(type: string, actorName: string | null, payload: Record<string, unknown>, thisYear?: number): string {
  if (typeof payload.text === 'string' && payload.text) return payload.text
  const who = actorName ?? 'Someone'
  const game = typeof payload.gameName === 'string' && payload.gameName ? payload.gameName : 'a room'
  const date = shortDate(payload.date, thisYear)
  const on = date ? ` on ${date}` : ''
  switch (type) {
    case 'friend_request':
      return `${who} sent you a friend request`
    case 'friend_accepted':
      return `${who} accepted your friend request`
    case 'tagged':
      return `${who} says you played ${game} together${on}`
    case 'tag_auto_added':
      return `${who} logged ${game} with you`
    case 'tag_accepted': {
      if (typeof payload.claimed === 'number') {
        const n = payload.claimed
        const as = typeof payload.guestName === 'string' ? ` as "${payload.guestName}"` : ''
        return `${who} claimed ${n} visit${n === 1 ? '' : 's'}${as}`
      }
      if (payload.joined) return `${who} joined your visit to ${game}${on}`
      return `${who} added ${game} to their room`
    }
    case 'visit_edited':
      return `${who} edited your visit to ${game}`
    case 'invite_accepted':
      return `${who} accepted your invite`
    case 'review_hidden':
      return `A moderator hid your review of ${game}`
    default:
      return `${who} sent you an update`
  }
}
