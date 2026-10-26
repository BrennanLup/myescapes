/**
 * Visits and participants: create, read, shared-fact edits with history, delete, leave, tag, respond, inbox, crew chips.
 * Owned by workstream 32 (server/routes/visits*). Shared helpers: visits.lib.ts.
 *
 * Rules (docs/PHASE2_PLAN.md, "Who can do what"):
 *   - see a visit: owner / accepted / pending participants (pending to answer the tag); others 404;
 *   - edit shared facts and puzzles: owner / accepted, every change recorded in visit_edits;
 *   - tag a user: only the tagger's accepted friends (403); guests are plain names;
 *   - leave: any participant; my review goes, the visit stays for the others (and is deleted once
 *     no account holder is left on it);
 *   - delete: the creator, only while nobody else (with an account) has accepted (409 otherwise).
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { CrewSuggestion, PendingTag } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { games, reviews, users, visitEdits, visitParticipants, visits } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { acceptedFriendships, notify, publicUsers, visitsTogetherCounts } from './friends.lib'
import { filterPuzzleIds, gameSummaries, upsertReview } from './reviews.lib'
import {
  acceptParticipant,
  addCrew,
  applyFacts,
  editNotices,
  inTx,
  MEMBER_STATUSES,
  recordEdit,
  replacePuzzles,
  visitDetail,
  visitForViewer,
} from './visits.lib'

export async function visitsRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.createVisit, async ({ body, user }) => {
    const db = ctx.db()
    const game = (await db.select({ id: games.id, status: games.status }).from(games).where(eq(games.id, body.gameId)).limit(1))[0]
    if (!game || game.status === 'hidden') throw new HttpError('not_found', 'Game not found.')
    if (body.review?.visibility === 'public' && !user.onboarded) {
      throw new HttpError('onboarding_required', 'Choose a display name and @handle before posting a public review.')
    }
    const { visitId, notices } = await inTx(db, async (tx) => {
      const visit = (await tx.insert(visits).values({ gameId: body.gameId, createdBy: user.id, ...body.facts }).returning())[0]
      await tx.insert(visitParticipants).values({ visitId: visit.id, userId: user.id, status: 'owner', addedBy: user.id, respondedAt: new Date() })
      const { idMap } = await replacePuzzles(tx, visit.id, body.puzzles, user.id)
      if (body.review) {
        const memorable = body.review.memorablePuzzleIds.map((id) => idMap.get(id) ?? id)
        await upsertReview(tx, visit.id, user.id, { ...body.review, memorablePuzzleIds: memorable })
      }
      // Crew last, so friends who auto-accept get a copy of my review.
      const crew = await addCrew(tx, visit, user.id, body.crew)
      return { visitId: visit.id, notices: crew.notices }
    })
    await notify(db, notices)
    return visitDetail(db, visitId, user.id)
  })

  defineRoute(app, ctx, ROUTES.visit, async ({ params, user }) => {
    const db = ctx.db()
    await visitForViewer(db, params.id, user.id)
    return visitDetail(db, params.id, user.id)
  })

  defineRoute(app, ctx, ROUTES.updateVisit, async ({ params, body, user }) => {
    const db = ctx.db()
    const notices = await inTx(db, async (tx) => {
      const { visit } = await visitForViewer(tx, params.id, user.id, MEMBER_STATUSES)
      const changes = body.facts ? await applyFacts(tx, visit, body.facts) : {}
      if (body.puzzles) {
        const p = await replacePuzzles(tx, visit.id, body.puzzles, user.id)
        if (p.changed) changes.puzzles = { from: p.before, to: p.after }
        // Memorable ids pointing at removed puzzles are dropped.
        const rows = await tx.select({ id: reviews.id, ids: reviews.memorablePuzzleIds }).from(reviews).where(eq(reviews.visitId, visit.id))
        for (const r of rows) {
          const kept = await filterPuzzleIds(tx, visit.id, r.ids)
          if (kept.length !== r.ids.length) await tx.update(reviews).set({ memorablePuzzleIds: kept }).where(eq(reviews.id, r.id))
        }
      }
      if (!Object.keys(changes).length) return []
      await recordEdit(tx, visit.id, user.id, changes)
      await tx.update(visits).set({ updatedAt: new Date() }).where(eq(visits.id, visit.id))
      const fresh = (await tx.select().from(visits).where(eq(visits.id, visit.id)))[0]
      return editNotices(tx, fresh, user.id, Object.keys(changes))
    })
    await notify(db, notices)
    return visitDetail(db, params.id, user.id)
  })

  defineRoute(app, ctx, ROUTES.visitEdits, async ({ params, user }) => {
    const db = ctx.db()
    await visitForViewer(db, params.id, user.id, MEMBER_STATUSES)
    const rows = await db.select().from(visitEdits).where(eq(visitEdits.visitId, params.id)).orderBy(desc(visitEdits.createdAt), desc(visitEdits.id))
    const people = await publicUsers(db, rows.map((r) => r.editorId))
    return {
      edits: rows.map((r) => ({
        id: r.id,
        visitId: r.visitId,
        // Deleted accounts keep the name they had ("edited by Mia").
        editor: r.editorId ? people.get(r.editorId) ?? null : r.editorName ? { id: '', handle: null, displayName: r.editorName, image: null } : null,
        changes: r.changes,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })

  defineRoute(app, ctx, ROUTES.deleteVisit, async ({ params, user }) => {
    const db = ctx.db()
    await inTx(db, async (tx) => {
      const { visit } = await visitForViewer(tx, params.id, user.id)
      if (visit.createdBy !== user.id) throw new HttpError('forbidden', 'Only the person who logged this visit can delete it. You can leave it instead.')
      const others = await tx
        .select({ id: visitParticipants.id })
        .from(visitParticipants)
        .where(and(eq(visitParticipants.visitId, visit.id), ne(visitParticipants.userId, user.id), inArray(visitParticipants.status, MEMBER_STATUSES)))
        .limit(1)
      if (others.length) throw new HttpError('conflict', 'Someone else has added this visit to their room, so it can\'t be deleted. Leave it instead.')
      await tx.delete(visits).where(eq(visits.id, visit.id))
    })
    return { deleted: true as const }
  })

  defineRoute(app, ctx, ROUTES.leaveVisit, async ({ params, user }) => {
    const db = ctx.db()
    await inTx(db, async (tx) => {
      const { visit, me } = await visitForViewer(tx, params.id, user.id)
      await tx.delete(reviews).where(and(eq(reviews.visitId, visit.id), eq(reviews.authorId, user.id)))
      await tx.delete(visitParticipants).where(eq(visitParticipants.id, me.id))
      // A creator who left is no longer its creator: no delete rights, no Phase 1 saves onto it.
      if (visit.createdBy === user.id) await tx.update(visits).set({ createdBy: null }).where(eq(visits.id, visit.id))
      // The visit stays for the others; once no account holder is left on it, nobody could see it.
      const left = await tx
        .select({ id: visitParticipants.id })
        .from(visitParticipants)
        .where(and(eq(visitParticipants.visitId, visit.id), sql`${visitParticipants.userId} is not null`, inArray(visitParticipants.status, ['owner', 'accepted', 'pending'])))
        .limit(1)
      if (!left.length) await tx.delete(visits).where(eq(visits.id, visit.id))
    })
    return { left: true as const }
  })

  defineRoute(app, ctx, ROUTES.tagParticipants, async ({ params, body, user }) => {
    const db = ctx.db()
    const notices = await inTx(db, async (tx) => {
      const { visit } = await visitForViewer(tx, params.id, user.id, MEMBER_STATUSES)
      return (await addCrew(tx, visit, user.id, body.crew)).notices
    })
    await notify(db, notices)
    return visitDetail(db, params.id, user.id)
  })

  defineRoute(app, ctx, ROUTES.respondToTag, async ({ params, body, user }) => {
    const db = ctx.db()
    const { status, notices } = await inTx(db, async (tx) => {
      const { visit, me } = await visitForViewer(tx, params.id, user.id)
      if (me.status !== 'pending') {
        if (body.accept) return { status: 'accepted' as const, notices: [] }
        throw new HttpError('conflict', 'This visit is already in your room. Leave it instead.')
      }
      if (!body.accept) {
        await tx.update(visitParticipants).set({ status: 'declined', respondedAt: new Date() }).where(eq(visitParticipants.id, me.id))
        return { status: 'declined' as const, notices: [] }
      }
      return { status: 'accepted' as const, notices: await acceptParticipant(tx, visit, me, user.id) }
    })
    await notify(db, notices)
    return { visit: status === 'accepted' ? await visitDetail(db, params.id, user.id) : null, status }
  })

  defineRoute(app, ctx, ROUTES.pendingTags, async ({ user }) => {
    const db = ctx.db()
    const rows = await db
      .select({ participantId: visitParticipants.id, addedBy: visitParticipants.addedBy, createdAt: visitParticipants.createdAt, visit: visits })
      .from(visitParticipants)
      .innerJoin(visits, eq(visits.id, visitParticipants.visitId))
      .where(and(eq(visitParticipants.userId, user.id), eq(visitParticipants.status, 'pending')))
      .orderBy(desc(visitParticipants.createdAt))
    const [people, summaries] = await Promise.all([
      publicUsers(db, rows.flatMap((r) => [r.addedBy, r.visit.createdBy])),
      gameSummaries(db, rows.map((r) => r.visit.gameId)),
    ])
    const tags: PendingTag[] = rows.flatMap((r) => {
      const taggedBy = (r.addedBy && people.get(r.addedBy)) || (r.visit.createdBy && people.get(r.visit.createdBy)) || null
      const game = summaries.get(r.visit.gameId)
      if (!taggedBy || !game) return []
      return [{ visitId: r.visit.id, participantId: r.participantId, game, date: r.visit.date, taggedBy, createdAt: r.createdAt.toISOString() }]
    })
    return { tags }
  })

  defineRoute(app, ctx, ROUTES.crewSuggestions, async ({ user }) => {
    const db = ctx.db()
    const friends = await acceptedFriendships(db, user.id)
    const ids = friends.map((f) => f.other)
    const [people, together] = await Promise.all([publicUsers(db, ids), visitsTogetherCounts(db, user.id, ids)])
    const friendChips: CrewSuggestion[] = ids
      .flatMap((id) => {
        const u = people.get(id)
        return u ? [{ kind: 'friend' as const, user: u, visitsTogether: together.get(id) ?? 0 }] : []
      })
      .sort((a, b) => b.visitsTogether - a.visitsTogether || a.user.displayName.localeCompare(b.user.displayName))

    // Guest names on visits I'm a member of, most used first.
    const myVisits = db
      .select({ id: visitParticipants.visitId })
      .from(visitParticipants)
      .where(and(eq(visitParticipants.userId, user.id), inArray(visitParticipants.status, MEMBER_STATUSES)))
    const guestRows = await db
      .select({ name: visitParticipants.guestName, createdAt: visitParticipants.createdAt })
      .from(visitParticipants)
      .where(and(inArray(visitParticipants.visitId, myVisits), isNull(visitParticipants.userId), ne(visitParticipants.status, 'declined')))
      .orderBy(asc(visitParticipants.createdAt))
    const me = (await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, user.id)))[0]
    const skip = new Set([me?.name, me?.displayName].filter(Boolean).map((n) => n!.trim().toLowerCase()))
    const guests = new Map<string, { name: string; n: number; last: number }>()
    for (const g of guestRows) {
      const name = g.name?.trim()
      if (!name || skip.has(name.toLowerCase())) continue
      const key = name.toLowerCase()
      const cur = guests.get(key)
      if (cur) {
        cur.n++
        cur.last = Math.max(cur.last, g.createdAt.getTime())
      } else guests.set(key, { name, n: 1, last: g.createdAt.getTime() })
    }
    const guestChips: CrewSuggestion[] = [...guests.values()]
      .sort((a, b) => b.n - a.n || b.last - a.last)
      .slice(0, 30)
      .map((g) => ({ kind: 'guest' as const, guestName: g.name, visitsTogether: g.n }))
    return { suggestions: [...friendChips, ...guestChips] }
  })
}
