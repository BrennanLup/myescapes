/**
 * Friends, user search, invite links and notifications.
 * Owned by workstream 31 (server/routes/friends* (also owns notifications)). Helpers: friends.lib.ts.
 *
 * - Mutual friendships: request, accept (or a request back), decline/cancel, unfriend, block.
 * - Blocking hides you both ways: requests, search and invites from a blocked pair answer a generic
 *   404, never "blocked".
 * - Auto-accept is per friend and per direction, off by default.
 * - Search finds one user by exact @handle or exact email. There is no browsable directory and
 *   emails are never echoed.
 * - Invite links make the inviter and the person who opens them friends; a guest name on the
 *   invite tells the new friend which visits to claim (claims.ts).
 */
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { NOTIFICATION_TYPES, type Friend, type FriendRequest, type Invite, type NotificationType, type Relation } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext, SessionUser } from '../context'
import type { Db } from '../db/client'
import { friendships, invites, notifications, users, visitParticipants } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import {
  acceptedFriendships,
  friendshipBetween,
  notificationText,
  notify,
  orderPair,
  publicUser,
  publicUsers,
  visitsTogetherCounts,
  type FriendshipView,
} from './friends.lib'
import { decodeCursor, encodeCursor } from './reviews.lib'
import { inTx } from './visits.lib'

const INVITE_DAYS = 30
/** Lookups by handle/email/invite code are rate-limited per client, against enumeration. */
const LOOKUP_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
const DAY_MS = 24 * 3600 * 1000
/** Unambiguous uppercase letters and digits (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newInviteCode(length = 10): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

/** My relation to another user. */
export function relationOf(f: FriendshipView | null, me: string): Relation {
  if (!f) return 'none'
  if (f.row.status === 'accepted') return 'friends'
  if (f.row.status === 'blocked') return 'blocked'
  return f.row.requestedBy === me ? 'request_sent' : 'request_received'
}

const notFoundUser = () => new HttpError('not_found', 'No one found with that name.')

async function friendOut(db: Db, me: string, f: FriendshipView): Promise<Friend> {
  const [u, n] = await Promise.all([publicUser(db, f.other), visitsTogetherCounts(db, me, [f.other])])
  if (!u) throw new HttpError('not_found', 'User not found.')
  return {
    user: u,
    since: (f.row.acceptedAt ?? f.row.createdAt).toISOString(),
    autoAccept: f.myAutoAccept,
    theyAutoAccept: f.theirAutoAccept,
    visitsTogether: n.get(f.other) ?? 0,
  }
}

/** Make two users friends (accepting any pending request either way). Fails on a block. */
async function befriend(db: Db, me: string, other: string): Promise<FriendshipView> {
  const p = orderPair(me, other)
  const existing = await friendshipBetween(db, me, other)
  if (existing?.row.status === 'blocked') throw notFoundUser()
  if (existing?.row.status === 'accepted') return existing
  if (existing) {
    const row = (await db.update(friendships).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(friendships.id, existing.row.id)).returning())[0]
    return { ...existing, row }
  }
  await db.insert(friendships).values({ userA: p.userA, userB: p.userB, status: 'accepted', requestedBy: other, acceptedAt: new Date() }).onConflictDoNothing()
  const after = await friendshipBetween(db, me, other)
  if (!after || after.row.status !== 'accepted') throw new HttpError('conflict', 'Could not add this friend. Try again.')
  return after
}

function inviteOut(origin: string, row: typeof invites.$inferSelect, usedBy: Invite['usedBy']): Invite {
  return {
    code: row.code,
    url: `${origin}/invite/${row.code}`,
    guestName: row.guestName,
    expiresAt: row.expiresAt.toISOString(),
    usedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Visits where `inviterId` tagged a guest called `guestName` that `me` could claim. */
async function claimableCount(db: Db, inviterId: string, guestName: string | null, me: string): Promise<number> {
  if (!guestName) return 0
  const mine = db.select({ id: visitParticipants.visitId }).from(visitParticipants).where(eq(visitParticipants.userId, me))
  const r = await db
    .select({ n: sql<number>`count(distinct ${visitParticipants.visitId})::int` })
    .from(visitParticipants)
    .where(
      and(
        isNull(visitParticipants.userId),
        eq(visitParticipants.addedBy, inviterId),
        sql`lower(${visitParticipants.guestName}) = lower(${guestName.trim()})`,
        sql`${visitParticipants.status} <> 'declined'`,
        notInArray(visitParticipants.visitId, mine),
      ),
    )
  return Number(r[0]?.n ?? 0)
}

export async function friendsRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.friends, async ({ user }) => {
    const db = ctx.db()
    const list = await acceptedFriendships(db, user.id)
    const ids = list.map((f) => f.other)
    const [people, counts] = await Promise.all([publicUsers(db, ids), visitsTogetherCounts(db, user.id, ids)])
    const friends: Friend[] = list.flatMap((f) => {
      const u = people.get(f.other)
      return u
        ? [{ user: u, since: (f.row.acceptedAt ?? f.row.createdAt).toISOString(), autoAccept: f.myAutoAccept, theyAutoAccept: f.theirAutoAccept, visitsTogether: counts.get(f.other) ?? 0 }]
        : []
    })
    friends.sort((a, b) => b.visitsTogether - a.visitsTogether || a.user.displayName.localeCompare(b.user.displayName))
    return { friends }
  })

  defineRoute(app, ctx, ROUTES.friendRequests, async ({ user }) => {
    const db = ctx.db()
    const rows = await db
      .select()
      .from(friendships)
      .where(and(eq(friendships.status, 'pending'), or(eq(friendships.userA, user.id), eq(friendships.userB, user.id))))
      .orderBy(desc(friendships.createdAt))
    const people = await publicUsers(db, rows.map((r) => (r.userA === user.id ? r.userB : r.userA)))
    const requests: FriendRequest[] = rows.flatMap((r) => {
      const other = people.get(r.userA === user.id ? r.userB : r.userA)
      return other ? [{ user: other, direction: r.requestedBy === user.id ? ('outgoing' as const) : ('incoming' as const), createdAt: r.createdAt.toISOString() }] : []
    })
    return { requests }
  })

  defineRoute(app, ctx, ROUTES.sendFriendRequest, async ({ body, user }) => {
    const db = ctx.db()
    const given = [body.handle, body.email, body.userId].filter((x) => x !== undefined && x !== '')
    if (given.length !== 1) throw new HttpError('invalid', 'Give exactly one of handle, email or userId.')
    const target = await findUser(db, body)
    if (!target || target.id === user.id) {
      if (target?.id === user.id) throw new HttpError('invalid', 'That\'s you.')
      throw notFoundUser()
    }
    const result = await inTx(db, async (tx) => {
      const f = await friendshipBetween(tx, user.id, target.id)
      if (f?.row.status === 'blocked') throw notFoundUser()
      if (f?.row.status === 'accepted') return { relation: 'friends' as const, notice: null }
      if (f?.row.status === 'pending') {
        if (f.row.requestedBy === user.id) return { relation: 'request_sent' as const, notice: null }
        // They already asked me: asking back accepts.
        await tx.update(friendships).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(friendships.id, f.row.id))
        return { relation: 'friends' as const, notice: { userId: target.id, type: 'friend_accepted' as const, actorId: user.id } }
      }
      const p = orderPair(user.id, target.id)
      await tx.insert(friendships).values({ userA: p.userA, userB: p.userB, status: 'pending', requestedBy: user.id })
      return { relation: 'request_sent' as const, notice: { userId: target.id, type: 'friend_request' as const, actorId: user.id } }
    })
    if (result.notice) await notify(db, [result.notice])
    return { relation: result.relation, user: (await publicUser(db, target.id))! }
  }, LOOKUP_LIMIT)

  defineRoute(app, ctx, ROUTES.acceptFriend, async ({ params, user }) => {
    const db = ctx.db()
    const f = await friendshipBetween(db, user.id, params.userId)
    if (!f || f.row.status !== 'pending' || f.row.requestedBy === user.id) throw new HttpError('not_found', 'No friend request from this person.')
    const row = (await db.update(friendships).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(friendships.id, f.row.id)).returning())[0]
    await notify(db, [{ userId: params.userId, type: 'friend_accepted', actorId: user.id }])
    return friendOut(db, user.id, { ...f, row })
  })

  defineRoute(app, ctx, ROUTES.declineFriend, async ({ params, user }) => {
    const db = ctx.db()
    const f = await friendshipBetween(db, user.id, params.userId)
    if (!f || f.row.status !== 'pending') throw new HttpError('not_found', 'No friend request with this person.')
    await db.delete(friendships).where(eq(friendships.id, f.row.id))
    // Drop the request notice it created.
    await db
      .delete(notifications)
      .where(and(eq(notifications.type, 'friend_request'), isNull(notifications.readAt), or(and(eq(notifications.userId, user.id), eq(notifications.actorId, params.userId)), and(eq(notifications.userId, params.userId), eq(notifications.actorId, user.id)))))
    return { ok: true as const }
  })

  defineRoute(app, ctx, ROUTES.unfriend, async ({ params, user }) => {
    const db = ctx.db()
    const f = await friendshipBetween(db, user.id, params.userId)
    if (!f || f.row.status === 'blocked') throw new HttpError('not_found', 'You are not friends with this person.')
    // Past shared visits stay; without the friendship, new tags stop.
    await db.delete(friendships).where(eq(friendships.id, f.row.id))
    return { ok: true as const }
  })

  defineRoute(app, ctx, ROUTES.blockUser, async ({ params, user }) => {
    const db = ctx.db()
    if (params.userId === user.id) throw new HttpError('invalid', 'You can\'t block yourself.')
    const exists = (await db.select({ id: users.id }).from(users).where(eq(users.id, params.userId)).limit(1))[0]
    if (!exists) throw notFoundUser()
    await inTx(db, async (tx) => {
      const f = await friendshipBetween(tx, user.id, params.userId)
      if (f?.row.status === 'blocked') return // already blocked (by either side)
      const p = orderPair(user.id, params.userId)
      const set = { status: 'blocked' as const, blockedBy: user.id, requestedBy: user.id, aAutoAccepts: false, bAutoAccepts: false, acceptedAt: null }
      if (f) await tx.update(friendships).set(set).where(eq(friendships.id, f.row.id))
      else await tx.insert(friendships).values({ userA: p.userA, userB: p.userB, ...set })
      // Pending tags between the two are withdrawn.
      await tx
        .update(visitParticipants)
        .set({ status: 'declined', respondedAt: new Date() })
        .where(
          and(
            eq(visitParticipants.status, 'pending'),
            or(and(eq(visitParticipants.userId, user.id), eq(visitParticipants.addedBy, params.userId)), and(eq(visitParticipants.userId, params.userId), eq(visitParticipants.addedBy, user.id))),
          ),
        )
    })
    return { ok: true as const }
  })

  defineRoute(app, ctx, ROUTES.unblockUser, async ({ params, user }) => {
    const db = ctx.db()
    const f = await friendshipBetween(db, user.id, params.userId)
    if (!f || f.row.status !== 'blocked' || f.row.blockedBy !== user.id) throw new HttpError('not_found', 'You have not blocked this person.')
    await db.delete(friendships).where(eq(friendships.id, f.row.id))
    return { ok: true as const }
  })

  defineRoute(app, ctx, ROUTES.setAutoAccept, async ({ params, body, user }) => {
    const db = ctx.db()
    const f = await friendshipBetween(db, user.id, params.userId)
    if (!f || f.row.status !== 'accepted') throw new HttpError('not_found', 'You are not friends with this person.')
    const meIsA = f.row.userA === user.id
    const row = (await db.update(friendships).set(meIsA ? { aAutoAccepts: body.autoAccept } : { bAutoAccepts: body.autoAccept }).where(eq(friendships.id, f.row.id)).returning())[0]
    return friendOut(db, user.id, { ...f, row, myAutoAccept: body.autoAccept })
  })

  defineRoute(app, ctx, ROUTES.userSearch, async ({ query, user }) => {
    const db = ctx.db()
    const q = query.q.trim()
    const target = await findUser(db, q.includes('@') && !q.startsWith('@') ? { email: q } : { handle: q })
    if (!target || target.id === user.id) return { users: [] }
    const f = await friendshipBetween(db, user.id, target.id)
    // Someone who blocked me can't be found; someone I blocked shows as blocked (so I can unblock).
    if (f?.row.status === 'blocked' && f.row.blockedBy !== user.id) return { users: [] }
    const u = (await publicUser(db, target.id))!
    return { users: [{ ...u, relation: relationOf(f, user.id) }] }
  }, LOOKUP_LIMIT)

  defineRoute(app, ctx, ROUTES.createInvite, async ({ body, user, req }) => {
    const db = ctx.db()
    const now = ctx.now()
    let row: typeof invites.$inferSelect | undefined
    for (let i = 0; i < 5 && !row; i++) {
      row = (
        await db
          .insert(invites)
          .values({ code: newInviteCode(), inviterId: user.id, guestName: body.guestName?.trim() || null, expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS), createdAt: now })
          .onConflictDoNothing()
          .returning()
      )[0]
    }
    if (!row) throw new HttpError('internal', 'Could not make an invite. Try again.')
    return inviteOut(ctx.origin(req), row, null)
  }, LOOKUP_LIMIT)

  defineRoute(app, ctx, ROUTES.myInvites, async ({ user, req }) => {
    const db = ctx.db()
    const rows = await db.select().from(invites).where(and(eq(invites.inviterId, user.id), isNull(invites.revokedAt))).orderBy(desc(invites.createdAt))
    const people = await publicUsers(db, rows.map((r) => r.usedBy))
    const origin = ctx.origin(req)
    return { invites: rows.map((r) => inviteOut(origin, r, r.usedBy ? people.get(r.usedBy) ?? null : null)) }
  })

  defineRoute(app, ctx, ROUTES.invitePreview, async ({ params }) => {
    const db = ctx.db()
    const row = await inviteByCode(db, params.code)
    const inviter = row ? await publicUser(db, row.inviterId) : null
    if (!row || !inviter) throw new HttpError('not_found', 'This invite link doesn\'t exist.')
    const reason = inviteProblem(row, ctx.now())
    return { code: row.code, inviter, guestName: row.guestName, valid: reason === null, reason }
  }, LOOKUP_LIMIT)

  defineRoute(app, ctx, ROUTES.acceptInvite, async ({ params, user }) => {
    const db = ctx.db()
    const row = await inviteByCode(db, params.code)
    if (!row) throw new HttpError('not_found', 'This invite link doesn\'t exist.')
    if (row.inviterId === user.id) throw new HttpError('invalid', 'This is your own invite. Send it to a friend.')
    const usedByMe = row.usedBy === user.id
    const problem = inviteProblem(row, ctx.now())
    if (problem && !usedByMe) {
      throw new HttpError('gone', problem === 'expired' ? 'This invite has expired. Ask for a new link.' : problem === 'used' ? 'This invite was already used.' : 'This invite was cancelled.')
    }
    const { view, fresh } = await inTx(db, async (tx) => {
      if (!usedByMe) {
        // Claim the invite atomically: one use only.
        const took = await tx
          .update(invites)
          .set({ usedBy: user.id, usedAt: new Date() })
          .where(and(eq(invites.code, row.code), isNull(invites.usedBy), isNull(invites.revokedAt)))
          .returning({ code: invites.code })
        if (!took.length) throw new HttpError('gone', 'This invite was already used.')
      }
      const before = await friendshipBetween(tx, user.id, row.inviterId)
      const view = await befriend(tx, user.id, row.inviterId)
      return { view, fresh: before?.row.status !== 'accepted' }
    })
    if (fresh && !usedByMe) await notify(db, [{ userId: row.inviterId, type: 'invite_accepted', actorId: user.id, payload: { guestName: row.guestName } }])
    return { friend: await friendOut(db, user.id, view), claimableVisits: await claimableCount(db, row.inviterId, row.guestName, user.id) }
  }, LOOKUP_LIMIT)

  defineRoute(app, ctx, ROUTES.revokeInvite, async ({ params, user }) => {
    const db = ctx.db()
    const row = await inviteByCode(db, params.code)
    if (!row || row.inviterId !== user.id) throw new HttpError('not_found', 'Invite not found.')
    if (row.usedBy) throw new HttpError('conflict', 'This invite was already used.')
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.code, row.code))
    return { ok: true as const }
  })

  defineRoute(app, ctx, ROUTES.notifications, async ({ query, user }) => {
    const db = ctx.db()
    const limit = query.limit ?? 20
    const cursor = decodeCursor(query.cursor)
    const rows = await db
      .select({ n: notifications, ts: sql<string>`${notifications.createdAt}::text` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), cursor ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1)
    const page = rows.slice(0, limit)
    const people = await publicUsers(db, page.map((r) => r.n.actorId))
    const year = ctx.now().getUTCFullYear()
    // Rows of a type this build doesn't know are skipped rather than breaking the inbox.
    const items = page.filter(({ n }) => (NOTIFICATION_TYPES as readonly string[]).includes(n.type)).map(({ n }) => {
      const actor = n.actorId ? people.get(n.actorId) ?? null : null
      return {
        id: n.id,
        type: n.type as NotificationType,
        text: notificationText(n.type, actor?.displayName ?? null, n.payload, year),
        actor,
        visitId: n.visitId,
        payload: n.payload,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      }
    })
    return { items, unread: await unreadCount(db, user), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].ts, page[page.length - 1].n.id) : null }
  })

  defineRoute(app, ctx, ROUTES.readNotifications, async ({ body, user }) => {
    const db = ctx.db()
    if (body.all) {
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
    } else if (body.ids?.length) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, user.id), inArray(notifications.id, body.ids), isNull(notifications.readAt)))
    }
    return { unread: await unreadCount(db, user) }
  })
}

async function unreadCount(db: Db, user: SessionUser): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
  return Number(r[0]?.n ?? 0)
}

async function inviteByCode(db: Db, code: string) {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{4,40}$/.test(c)) return null
  return (await db.select().from(invites).where(eq(invites.code, c)).limit(1))[0] ?? null
}

function inviteProblem(row: typeof invites.$inferSelect, now: Date): 'expired' | 'used' | 'revoked' | null {
  if (row.revokedAt) return 'revoked'
  if (row.usedBy) return 'used'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return null
}

/** Exact, case-insensitive lookup by @handle, email or id. */
async function findUser(db: Db, by: { handle?: string; email?: string; userId?: string }): Promise<{ id: string } | null> {
  let where
  if (by.userId) where = eq(users.id, by.userId)
  else if (by.email) where = sql`lower(${users.email}) = lower(${by.email.trim()})`
  else if (by.handle) {
    const h = by.handle.trim().replace(/^@/, '').toLowerCase()
    if (!h) return null
    where = sql`lower(${users.handle}) = ${h}`
  } else return null
  return (await db.select({ id: users.id }).from(users).where(where).limit(1))[0] ?? null
}
