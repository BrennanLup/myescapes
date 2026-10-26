/**
 * Account export and deletion (workstream 4). Both are promises in the live /privacy page:
 * - "users can download their data as JSON" -> `exportAccount`
 * - "reviews, photos, voice notes and friend connections are removed. On visits shared with other
 *   people, your tag becomes a plain name" -> `deleteAccount`
 */
import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import type { AccountExport, DailyResult, Friend, Invite, Notification, Report } from '../../src/contracts/models'
import type { Db } from '../db/client'
import {
  dailyResults,
  friendships,
  invites,
  newId,
  notifications,
  reports,
  reviews,
  sources,
  usageCounters,
  users,
  visitParticipants,
  visitPhotos,
  visits,
} from '../db/schema'
import { getWishlistForUser } from '../db/dataset'
import { toPublicUser } from '../db/util'
import { meFromRow } from '../auth/users'
import { bundleToVisitDetail, loadVisitBundles, myVisitIds, reviewToContract } from './logs.load'

const publicCols = { id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image }

/** One line per notification type, for the export (the inbox renders its own). */
export function notificationText(type: string, actor: string | null, payload: Record<string, unknown>): string {
  const who = actor ?? 'Someone'
  const game = typeof payload.gameName === 'string' ? payload.gameName : 'a room'
  const date = typeof payload.date === 'string' ? ` on ${payload.date}` : ''
  switch (type) {
    case 'friend_request':
      return `${who} sent you a friend request`
    case 'friend_accepted':
      return `${who} accepted your friend request`
    case 'tagged':
      return `${who} says you played ${game} together${date}`
    case 'tag_auto_added':
      return `${who} logged ${game} with you`
    case 'tag_accepted':
      return `${who} added ${game} to their room`
    case 'visit_edited':
      return `${who} edited your visit to ${game}`
    case 'invite_accepted':
      return `${who} joined from your invite`
    case 'review_hidden':
      return `A moderator hid your review of ${game}`
    default:
      return type
  }
}

export async function exportAccount(db: Db, userId: string, origin: string, now: Date): Promise<AccountExport> {
  const me = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  if (!me) throw new Error('user not found')

  // Visits I own, accepted or was tagged on (pending), plus any visit I reviewed.
  const roomIds = await myVisitIds(db, userId)
  const pendingIds = (
    await db
      .select({ id: visitParticipants.visitId })
      .from(visitParticipants)
      .where(and(eq(visitParticipants.userId, userId), eq(visitParticipants.status, 'pending')))
  ).map((r) => r.id)
  const myReviewRows = await db.select().from(reviews).where(eq(reviews.authorId, userId)).orderBy(asc(reviews.createdAt))
  const visitIds = [...new Set([...roomIds, ...pendingIds, ...myReviewRows.map((r) => r.visitId)])]
  const bundles = await loadVisitBundles(db, visitIds, userId)

  // Friends
  const fr = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userA, userId), eq(friendships.userB, userId))))
  const friendIds = fr.map((f) => (f.userA === userId ? f.userB : f.userA))
  const friendUsers = friendIds.length ? await db.select(publicCols).from(users).where(inArray(users.id, friendIds)) : []
  const togetherRows =
    friendIds.length && roomIds.length
      ? await db
          .select({ visitId: visitParticipants.visitId, userId: visitParticipants.userId })
          .from(visitParticipants)
          .where(and(inArray(visitParticipants.visitId, roomIds), inArray(visitParticipants.userId, friendIds), inArray(visitParticipants.status, ['owner', 'accepted'])))
      : []
  const together = new Map<string, Set<string>>()
  for (const r of togetherRows) if (r.userId) together.set(r.userId, (together.get(r.userId) ?? new Set()).add(r.visitId))
  const friends: Friend[] = fr.flatMap((f) => {
    const otherId = f.userA === userId ? f.userB : f.userA
    const u = friendUsers.find((x) => x.id === otherId)
    if (!u) return []
    const iAmA = f.userA === userId
    return [
      {
        user: toPublicUser(u),
        since: (f.acceptedAt ?? f.createdAt).toISOString(),
        autoAccept: iAmA ? f.aAutoAccepts : f.bAutoAccepts,
        theyAutoAccept: iAmA ? f.bAutoAccepts : f.aAutoAccepts,
        visitsTogether: together.get(otherId)?.size ?? 0,
      },
    ]
  })

  // Invites I created
  const inv = await db.select().from(invites).where(eq(invites.inviterId, userId)).orderBy(asc(invites.createdAt))
  const usedByIds = inv.map((i) => i.usedBy).filter((x): x is string => Boolean(x))
  const usedByUsers = usedByIds.length ? await db.select(publicCols).from(users).where(inArray(users.id, usedByIds)) : []
  const base = origin.replace(/\/+$/, '')
  const invitesOut: Invite[] = inv.map((i) => {
    const u = usedByUsers.find((x) => x.id === i.usedBy)
    return {
      code: i.code,
      url: `${base}/invite/${encodeURIComponent(i.code)}`,
      guestName: i.guestName,
      expiresAt: i.expiresAt.toISOString(),
      usedBy: u ? toPublicUser(u) : null,
      createdAt: i.createdAt.toISOString(),
    }
  })

  // Escape of the Day
  const daily = await db.select().from(dailyResults).where(eq(dailyResults.userId, userId)).orderBy(asc(dailyResults.day))
  const dailyOut: DailyResult[] = daily.map((d) => ({
    day: d.day,
    number: d.number,
    solved: d.solved,
    guesses: d.guesses,
    hintsUsed: d.hintsUsed,
    timeMs: d.timeMs,
    grid: d.grid as DailyResult['grid'],
    score: d.score,
    timeZone: d.timeZone,
    startedAt: d.startedAt.toISOString(),
    finishedAt: d.finishedAt ? d.finishedAt.toISOString() : null,
  }))

  // Notifications
  const notes = await db
    .select({ n: notifications, actor: publicCols })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(eq(notifications.userId, userId))
    .orderBy(asc(notifications.createdAt))
  const notesOut: Notification[] = notes.map(({ n, actor }) => {
    const a = actor && actor.id ? toPublicUser(actor) : null
    return {
      id: n.id,
      type: n.type as Notification['type'],
      text: notificationText(n.type, a?.displayName ?? null, n.payload),
      actor: a,
      visitId: n.visitId,
      payload: n.payload,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }
  })

  // Reports I sent
  const reps = await db.select().from(reports).where(eq(reports.reporterId, userId)).orderBy(asc(reports.createdAt))
  const reportsOut: Report[] = reps.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason as Report['reason'],
    note: r.note,
    status: r.status,
    reporter: toPublicUser(me),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }))

  return {
    exportedAt: now.toISOString(),
    format: 'myescapes-export-v1',
    me: meFromRow(me),
    visits: bundles.map(bundleToVisitDetail),
    reviews: myReviewRows.map((r) => reviewToContract(r, me, userId)),
    wishlist: await getWishlistForUser(db, userId),
    friends,
    invites: invitesOut,
    dailyResults: dailyOut,
    notifications: notesOut,
    reports: reportsOut,
  }
}

export interface DeletionSummary {
  visitsDeleted: number
  tagsTurnedIntoNames: number
}

/**
 * Delete an account. In one transaction:
 * 1. Visits where nobody else with an account owns or accepted: deleted (with their guests,
 *    puzzles, photos and pending tags).
 * 2. Everywhere else, my participant row becomes a plain guest name (my display name), so the
 *    others' logs still read "with Brennan". Declined rows are just removed.
 * 3. Reports about my reviews and photos are removed; reviews copied from mine lose the link.
 * 4. Directory contributions stay (they are public facts) but no longer point at me.
 * 5. The user row goes, which cascades: reviews (with transcripts), photos, friendships, invites,
 *    notifications, wish list, Escape of the Day results, sessions and Google account links.
 */
export async function deleteAccount(db: Db, userId: string): Promise<DeletionSummary> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db
    const me = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0]
    if (!me) return { visitsDeleted: 0, tagsTurnedIntoNames: 0 }
    const plainName = (me.displayName || me.name || 'Former member').trim().slice(0, 60) || 'Former member'

    const mine = await tx.select().from(visitParticipants).where(eq(visitParticipants.userId, userId))
    const created = await tx.select({ id: visits.id }).from(visits).where(eq(visits.createdBy, userId))
    const touched = [...new Set([...mine.map((p) => p.visitId), ...created.map((v) => v.id)])]

    // Visits that still have someone else with an account on them (owner or accepted).
    const kept = touched.length
      ? new Set(
          (
            await tx
              .selectDistinct({ visitId: visitParticipants.visitId })
              .from(visitParticipants)
              .where(
                and(
                  inArray(visitParticipants.visitId, touched),
                  isNotNull(visitParticipants.userId),
                  ne(visitParticipants.userId, userId),
                  inArray(visitParticipants.status, ['owner', 'accepted']),
                ),
              )
          ).map((r) => r.visitId),
        )
      : new Set<string>()
    const doomed = touched.filter((id) => !kept.has(id))

    // My reviews and photos (for tidying reports and copy links), before anything is deleted.
    const myReviewIds = (await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.authorId, userId))).map((r) => r.id)
    const myPhotoIds = (await tx.select({ id: visitPhotos.id }).from(visitPhotos).where(eq(visitPhotos.uploaderId, userId))).map((r) => r.id)

    if (doomed.length) await tx.delete(visits).where(inArray(visits.id, doomed))

    // Tags on kept visits become plain names. Declined rows simply go.
    let renamed = 0
    for (const p of mine) {
      if (!kept.has(p.visitId)) continue
      if (p.status === 'declined') {
        await tx.delete(visitParticipants).where(eq(visitParticipants.id, p.id))
        continue
      }
      await tx
        .update(visitParticipants)
        // A plain name has no account to confirm anything, so it is simply "on the visit".
        .set({ userId: null, guestName: plainName, status: 'accepted', respondedAt: null })
        .where(eq(visitParticipants.id, p.id))
      renamed++
    }
    if (kept.size) await tx.update(visits).set({ createdBy: null }).where(and(eq(visits.createdBy, userId), inArray(visits.id, [...kept])))

    if (myReviewIds.length) {
      await tx.delete(reports).where(and(eq(reports.targetType, 'review'), inArray(reports.targetId, myReviewIds)))
      await tx.update(reviews).set({ copiedFromReviewId: null }).where(inArray(reviews.copiedFromReviewId, myReviewIds))
    }
    if (myPhotoIds.length) await tx.delete(reports).where(and(eq(reports.targetType, 'photo'), inArray(reports.targetId, myPhotoIds)))

    // Directory contributions: keep the facts, drop the pointer to me.
    const mySources = await tx.select({ id: sources.id }).from(sources).where(and(eq(sources.source, 'user'), eq(sources.sourceId, userId)))
    for (const s of mySources) await tx.update(sources).set({ sourceId: newId('deleted') }).where(eq(sources.id, s.id))

    await tx.delete(usageCounters).where(eq(usageCounters.subject, userId))
    await tx.delete(users).where(eq(users.id, userId))
    return { visitsDeleted: doomed.length, tagsTurnedIntoNames: renamed }
  })
}
