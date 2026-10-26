/**
 * Guest-name claiming and same-room merge detection.
 * Owned by workstream 34 (server/routes/claims*).
 *
 * Claiming: "Brennan has 23 visits with a guest named Mia. Is that you?" A claim links a friend's
 * guest-name participant rows to my account with the same accept flow as tagging (status
 * accepted, my review starts as a flagged copy of the friend's). Only accepted friends' guest
 * names can be claimed. `GET /api/claims` suggests names that are likely me: the guest name on an
 * invite I accepted first, then guest names equal to my display name, Google name or first name.
 *
 * Merging: if a friend logged the same game within a day of my date, `GET /api/visits/merge-candidates`
 * offers their visit, and `POST /api/visits/:id/join` adds me to it. With `fromVisitId` my separate
 * log is folded in: my review (and, when I created that log, its crew, photos and new puzzles)
 * move over, `resolve` picks the conflicting facts (recorded as my edit), both reviews are kept,
 * and the duplicate visit is removed.
 */
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { GuestClaim, MergeCandidate, VisitFacts } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { invites, reviews, users, visitParticipants, visitPhotos, visitPuzzles, visits } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { friendIds, notify, publicUsers, type NotifyInput } from './friends.lib'
import { copyReviewFor, gameSummaries, upsertReview } from './reviews.lib'
import {
  applyFacts,
  diffFacts,
  factsOf,
  getVisitRow,
  inTx,
  MEMBER_STATUSES,
  myParticipant,
  recordEdit,
  visitDetail,
  visitNoticePayload,
  type VisitRow,
} from './visits.lib'

const DAY_MS = 24 * 3600 * 1000

/** Whole days between two YYYY-MM-DD dates. */
export function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS)
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Names that are probably me: display name, Google name, and their first words. Lowercase. */
export function namesForUser(u: { name: string; displayName: string | null }): Set<string> {
  const out = new Set<string>()
  for (const n of [u.displayName, u.name]) {
    const s = n?.trim().toLowerCase()
    if (!s) continue
    out.add(s)
    const first = s.split(/\s+/)[0]
    if (first && first.length >= 2) out.add(first)
  }
  return out
}

/** Guest rows from `inviterIds` that `me` could claim (not on visits I'm already on). */
async function claimableRows(db: Db, me: string, inviterIds: string[], guestName?: string) {
  if (!inviterIds.length) return []
  const mine = db.select({ id: visitParticipants.visitId }).from(visitParticipants).where(eq(visitParticipants.userId, me))
  return db
    .select({ participantId: visitParticipants.id, guestName: visitParticipants.guestName, addedBy: visitParticipants.addedBy, visit: visits })
    .from(visitParticipants)
    .innerJoin(visits, eq(visits.id, visitParticipants.visitId))
    .where(
      and(
        isNull(visitParticipants.userId),
        inArray(visitParticipants.addedBy, inviterIds),
        ne(visitParticipants.status, 'declined'),
        notInArray(visitParticipants.visitId, mine),
        guestName ? sql`lower(trim(${visitParticipants.guestName})) = lower(trim(${guestName}))` : undefined,
      ),
    )
    .orderBy(asc(visits.date), asc(visitParticipants.id))
}

export async function claimsRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.claims, async ({ user }) => {
    const db = ctx.db()
    const friends = [...(await friendIds(db, user.id))]
    if (!friends.length) return { claims: [] }
    const me = (await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, user.id)))[0]
    const likely = me ? namesForUser(me) : new Set<string>()
    const fromInvites = await db
      .select({ inviterId: invites.inviterId, guestName: invites.guestName })
      .from(invites)
      .where(and(eq(invites.usedBy, user.id), sql`${invites.guestName} is not null`))
    const invited = new Set(fromInvites.map((i) => `${i.inviterId}\u0000${i.guestName!.trim().toLowerCase()}`))

    const rows = await claimableRows(db, user.id, friends)
    const groups = new Map<string, { inviterId: string; guestName: string; fromInvite: boolean; visits: typeof rows }>()
    for (const r of rows) {
      const name = r.guestName?.trim()
      if (!name || !r.addedBy) continue
      const key = `${r.addedBy}\u0000${name.toLowerCase()}`
      const fromInvite = invited.has(key)
      if (!fromInvite && !likely.has(name.toLowerCase())) continue
      const g = groups.get(key) ?? { inviterId: r.addedBy, guestName: name, fromInvite, visits: [] }
      if (!g.visits.some((v) => v.visit.id === r.visit.id)) g.visits.push(r)
      groups.set(key, g)
    }
    const list = [...groups.values()].sort((a, b) => Number(b.fromInvite) - Number(a.fromInvite) || b.visits.length - a.visits.length)
    const [people, summaries] = await Promise.all([
      publicUsers(db, list.map((g) => g.inviterId)),
      gameSummaries(db, list.flatMap((g) => g.visits.map((v) => v.visit.gameId))),
    ])
    const claims: GuestClaim[] = list.flatMap((g) => {
      const inviter = people.get(g.inviterId)
      if (!inviter) return []
      const visitsOut = g.visits.flatMap((v) => {
        const game = summaries.get(v.visit.gameId)
        return game ? [{ visitId: v.visit.id, participantId: v.participantId, game, date: v.visit.date }] : []
      })
      return visitsOut.length ? [{ inviter, guestName: g.guestName, visits: visitsOut }] : []
    })
    return { claims }
  })

  defineRoute(app, ctx, ROUTES.claim, async ({ body, user }) => {
    const db = ctx.db()
    const friends = await friendIds(db, user.id)
    if (!friends.has(body.inviterId)) throw new HttpError('not_found', 'No guest names to claim from this person.')
    const claimed = await inTx(db, async (tx) => {
      let rows = await claimableRows(tx, user.id, [body.inviterId], body.guestName)
      if (body.participantIds) {
        const pick = new Set(body.participantIds)
        rows = rows.filter((r) => pick.has(r.participantId))
      }
      const done = new Set<string>()
      for (const r of rows) {
        if (done.has(r.visit.id)) {
          // A second guest row with the same name on one visit: it was me too.
          await tx.delete(visitParticipants).where(eq(visitParticipants.id, r.participantId))
          continue
        }
        const existing = await myParticipant(tx, r.visit.id, user.id)
        if (existing) {
          // Can't happen through claimableRows (it skips my visits), but stay safe under races.
          await tx.delete(visitParticipants).where(eq(visitParticipants.id, r.participantId))
          continue
        }
        await tx
          .update(visitParticipants)
          .set({ userId: user.id, guestName: null, status: 'accepted', respondedAt: new Date() })
          .where(and(eq(visitParticipants.id, r.participantId), isNull(visitParticipants.userId)))
        await copyReviewFor(tx, r.visit.id, user.id, r.addedBy ?? r.visit.createdBy)
        done.add(r.visit.id)
      }
      return done.size
    })
    if (claimed) await notify(db, [{ userId: body.inviterId, type: 'tag_accepted', actorId: user.id, payload: { claimed, guestName: body.guestName.trim() } }])
    return { claimed }
  })

  defineRoute(app, ctx, ROUTES.mergeCandidates, async ({ query, user }) => {
    const db = ctx.db()
    const friends = [...(await friendIds(db, user.id))]
    if (!friends.length) return { candidates: [] }
    const near = and(eq(visits.gameId, query.gameId), sql`${visits.date} between ${addDays(query.date, -1)} and ${addDays(query.date, 1)}`)
    const mine = db.select({ id: visitParticipants.visitId }).from(visitParticipants).where(eq(visitParticipants.userId, user.id))
    const withFriend = db
      .select({ id: visitParticipants.visitId })
      .from(visitParticipants)
      .where(and(inArray(visitParticipants.userId, friends), inArray(visitParticipants.status, MEMBER_STATUSES)))
    const rows = await db
      .select()
      .from(visits)
      .where(and(near, inArray(visits.id, withFriend), notInArray(visits.id, mine)))
      .orderBy(asc(visits.date), asc(visits.createdAt))
    if (!rows.length) return { candidates: [] }

    // My own log of the same room (if any) is the "draft" the conflicts are measured against.
    const own = (
      await db
        .select({ visit: visits })
        .from(visits)
        .innerJoin(visitParticipants, eq(visitParticipants.visitId, visits.id))
        .where(and(near, eq(visitParticipants.userId, user.id), inArray(visitParticipants.status, MEMBER_STATUSES)))
        .orderBy(asc(visits.createdAt))
        .limit(1)
    )[0]?.visit
    const members = await db
      .select({ visitId: visitParticipants.visitId, userId: visitParticipants.userId })
      .from(visitParticipants)
      .where(and(inArray(visitParticipants.visitId, rows.map((r) => r.id)), inArray(visitParticipants.userId, friends), inArray(visitParticipants.status, MEMBER_STATUSES)))
      .orderBy(asc(visitParticipants.createdAt))
    const [people, summaries] = await Promise.all([
      publicUsers(db, [...rows.map((r) => r.createdBy), ...members.map((m) => m.userId)]),
      gameSummaries(db, [query.gameId]),
    ])
    const game = summaries.get(query.gameId)
    if (!game) return { candidates: [] }
    const friendSet = new Set(friends)
    const candidates: MergeCandidate[] = rows
      .sort((a, b) => daysApart(a.date, query.date) - daysApart(b.date, query.date))
      .flatMap((v) => {
        const by = v.createdBy && friendSet.has(v.createdBy) ? v.createdBy : members.find((m) => m.visitId === v.id)?.userId
        const loggedBy = by ? people.get(by) : undefined
        if (!loggedBy) return []
        const facts = factsOf(v)
        const conflicts = own ? diffFacts(factsOf(own), facts) : v.date !== query.date ? ['date'] : []
        return [{ visitId: v.id, game, facts, loggedBy, conflicts }]
      })
    return { candidates }
  })

  defineRoute(app, ctx, ROUTES.joinVisit, async ({ params, body, user }) => {
    const db = ctx.db()
    if (body.review?.visibility === 'public' && !user.onboarded) {
      throw new HttpError('onboarding_required', 'Choose a display name and @handle before posting a public review.')
    }
    const notices = await inTx(db, async (tx) => {
      const target = await getVisitRow(tx, params.id)
      if (!target) throw new HttpError('not_found', 'Visit not found.')
      const mineOnTarget = await myParticipant(tx, target.id, user.id)
      const friends = await friendIds(tx, user.id)
      const friendMembers = friends.size
        ? await tx
            .select({ userId: visitParticipants.userId })
            .from(visitParticipants)
            .where(and(eq(visitParticipants.visitId, target.id), inArray(visitParticipants.userId, [...friends]), inArray(visitParticipants.status, MEMBER_STATUSES)))
        : []
      const alreadyMember = mineOnTarget?.status === 'owner' || mineOnTarget?.status === 'accepted'
      if (!alreadyMember && mineOnTarget?.status !== 'pending' && !friendMembers.length) throw new HttpError('not_found', 'Visit not found.')

      let from: VisitRow | null = null
      if (body.fromVisitId) {
        if (body.fromVisitId === target.id) throw new HttpError('invalid', 'Pick a different visit to merge.')
        from = await getVisitRow(tx, body.fromVisitId)
        const meOnFrom = from ? await myParticipant(tx, from.id, user.id) : null
        if (!from || !meOnFrom || !MEMBER_STATUSES.includes(meOnFrom.status)) throw new HttpError('not_found', 'Your visit to merge was not found.')
        if (from.gameId !== target.gameId) throw new HttpError('invalid', 'Only visits of the same game can be merged.')
        if (daysApart(from.date, target.date) > 1) throw new HttpError('invalid', 'Only visits within a day of each other can be merged.')
      }

      const notices: NotifyInput[] = []
      // 1. Me on the target visit.
      if (!mineOnTarget) {
        await tx.insert(visitParticipants).values({ visitId: target.id, userId: user.id, status: 'accepted', addedBy: user.id, respondedAt: new Date() })
      } else if (!alreadyMember) {
        await tx.update(visitParticipants).set({ status: 'accepted', respondedAt: new Date() }).where(eq(visitParticipants.id, mineOnTarget.id))
      }

      // 2. Fold my separate log in.
      if (from) await mergeInto(tx, from, target, user.id)

      // 3. Conflicting facts I picked (an edit by me, in the history).
      const changes = await applyFacts(tx, target, body.resolve as Partial<VisitFacts>)
      await recordEdit(tx, target.id, user.id, changes)

      // 4. My review: the one I sent, else the one I brought, else a flagged copy of the logger's.
      if (body.review) await upsertReview(tx, target.id, user.id, body.review)
      else {
        const source = target.createdBy && friends.has(target.createdBy) ? target.createdBy : (friendMembers[0]?.userId ?? target.createdBy)
        await copyReviewFor(tx, target.id, user.id, source)
      }

      if (!alreadyMember) {
        if (mineOnTarget?.status === 'pending') notices.push(...(await acceptParticipantNotice(tx, target, mineOnTarget.addedBy, user.id)))
        else if (target.createdBy) {
          notices.push({ userId: target.createdBy, type: 'tag_accepted', actorId: user.id, visitId: target.id, payload: { ...(await visitNoticePayload(tx, target)), joined: true } })
        }
      }
      return notices
    })
    await notify(db, notices)
    return visitDetail(db, params.id, user.id)
  })
}

async function acceptParticipantNotice(db: Db, visit: VisitRow, addedBy: string | null, me: string): Promise<NotifyInput[]> {
  const to = addedBy && addedBy !== me ? addedBy : visit.createdBy
  return to ? [{ userId: to, type: 'tag_accepted', actorId: me, visitId: visit.id, payload: { ...(await visitNoticePayload(db, visit)), joined: true } }] : []
}

/**
 * Fold `from` (my own log) into `target`. If I created `from`, everything moves (crew, photos,
 * new puzzles, reviews) and `from` is deleted. Otherwise only my review moves and I leave `from`.
 */
async function mergeInto(db: Db, from: VisitRow, target: VisitRow, me: string) {
  const [fromPuzzles, targetPuzzles] = await Promise.all([
    db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, from.id)).orderBy(asc(visitPuzzles.position)),
    db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, target.id)).orderBy(asc(visitPuzzles.position)),
  ])
  const key = (d: string) => d.trim().toLowerCase()
  const targetByDesc = new Map(targetPuzzles.map((p) => [key(p.description), p.id]))
  const owner = from.createdBy === me
  // from-puzzle id -> target-puzzle id
  const idMap = new Map<string, string>()
  let position = targetPuzzles.reduce((m, p) => Math.max(m, p.position + 1), 0)
  for (const p of fromPuzzles) {
    const same = targetByDesc.get(key(p.description))
    if (same) idMap.set(p.id, same)
    else if (owner) {
      await db.update(visitPuzzles).set({ visitId: target.id, position: position++ }).where(eq(visitPuzzles.id, p.id))
      targetByDesc.set(key(p.description), p.id)
      idMap.set(p.id, p.id)
    }
  }

  const targetAuthors = new Set((await db.select({ a: reviews.authorId }).from(reviews).where(eq(reviews.visitId, target.id))).map((r) => r.a))
  const fromReviews = await db.select().from(reviews).where(eq(reviews.visitId, from.id))
  for (const r of fromReviews) {
    if (!owner && r.authorId !== me) continue
    if (targetAuthors.has(r.authorId)) continue
    const memorable = r.memorablePuzzleIds.flatMap((id) => (idMap.has(id) ? [idMap.get(id)!] : []))
    await db.update(reviews).set({ visitId: target.id, memorablePuzzleIds: memorable }).where(eq(reviews.id, r.id))
    targetAuthors.add(r.authorId)
  }

  if (!owner) {
    await db.delete(reviews).where(and(eq(reviews.visitId, from.id), eq(reviews.authorId, me)))
    await db.delete(visitParticipants).where(and(eq(visitParticipants.visitId, from.id), eq(visitParticipants.userId, me)))
    const left = await db
      .select({ id: visitParticipants.id })
      .from(visitParticipants)
      .where(and(eq(visitParticipants.visitId, from.id), sql`${visitParticipants.userId} is not null`, inArray(visitParticipants.status, ['owner', 'accepted', 'pending'])))
      .limit(1)
    if (!left.length) await db.delete(visits).where(eq(visits.id, from.id))
    return
  }

  // Crew: users not yet on the target keep their status; guests are added unless the name is there.
  const targetParts = await db.select().from(visitParticipants).where(eq(visitParticipants.visitId, target.id))
  const onTarget = new Set(targetParts.flatMap((p) => (p.userId ? [p.userId] : [])))
  const guestNames = new Set(targetParts.flatMap((p) => (!p.userId && p.guestName ? [key(p.guestName)] : [])))
  const fromParts = await db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, from.id), ne(visitParticipants.status, 'declined')))
  for (const p of fromParts) {
    if (p.userId === me) continue
    if (p.userId) {
      if (onTarget.has(p.userId)) continue
      await db.update(visitParticipants).set({ visitId: target.id, status: p.status === 'owner' ? 'accepted' : p.status }).where(eq(visitParticipants.id, p.id))
      onTarget.add(p.userId)
    } else if (p.guestName && !guestNames.has(key(p.guestName))) {
      await db.update(visitParticipants).set({ visitId: target.id }).where(eq(visitParticipants.id, p.id))
      guestNames.add(key(p.guestName))
    }
  }
  await db.update(visitPhotos).set({ visitId: target.id }).where(eq(visitPhotos.visitId, from.id))
  await db.delete(visits).where(eq(visits.id, from.id))
}

