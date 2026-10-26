/**
 * Moderation: reports and admin hide. Owned by workstream 25 (server/routes/admin*).
 *
 * - Any signed-in user can report a review, photo, game or venue they can see. Reporting the same
 *   thing twice while the first report is open returns the existing report.
 * - Admins (users.is_admin, or an email listed in ADMIN_EMAILS: see server/context.ts) see the queue,
 *   resolve reports (hide the target, or dismiss) and hide or unhide things directly.
 * - Hiding sets `hidden_at` on reviews and photos, and `status = 'hidden'` on games and venues.
 *   Public queries must leave hidden things out (photos: server/routes/photos.access.ts).
 */
import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { REPORT_REASONS, REPORT_TARGETS, type PublicUser, type Report } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { friendships, games, reports, reviews, users, venues, visitPhotos } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { viewablePhoto } from './photos.access'

type TargetType = (typeof REPORT_TARGETS)[number]
type ReportRow = typeof reports.$inferSelect

async function areFriends(db: Db, x: string, y: string): Promise<boolean> {
  // friendships stores each pair once, with user_a < user_b.
  const p = x < y ? { userA: x, userB: y } : { userA: y, userB: x }
  const row = (
    await db
      .select({ status: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB)))
      .limit(1)
  )[0]
  return row?.status === 'accepted'
}

/** True when `viewerId` can see the target, so may report it. Missing or invisible targets are both 404. */
export async function canSeeTarget(db: Db, type: TargetType, id: string, viewerId: string): Promise<boolean> {
  switch (type) {
    case 'review': {
      const r = (await db.select({ authorId: reviews.authorId, visibility: reviews.visibility, hiddenAt: reviews.hiddenAt }).from(reviews).where(eq(reviews.id, id)).limit(1))[0]
      if (!r) return false
      if (r.authorId === viewerId) return true
      if (r.hiddenAt) return false
      if (r.visibility === 'public') return true
      if (r.visibility === 'friends') return areFriends(db, r.authorId, viewerId)
      return false
    }
    case 'photo':
      return Boolean(await viewablePhoto(db, id, viewerId))
    case 'game': {
      const g = (await db.select({ status: games.status }).from(games).where(eq(games.id, id)).limit(1))[0]
      return Boolean(g && g.status !== 'hidden')
    }
    case 'venue': {
      const v = (await db.select({ status: venues.status }).from(venues).where(eq(venues.id, id)).limit(1))[0]
      return Boolean(v && v.status !== 'hidden')
    }
  }
}

/** Hide or unhide a target. Returns false when it doesn't exist. */
export async function setHidden(db: Db, type: TargetType, id: string, hidden: boolean, reason: string, now: Date): Promise<boolean> {
  switch (type) {
    case 'review': {
      const r = await db
        .update(reviews)
        .set(hidden ? { hiddenAt: now, hiddenReason: reason } : { hiddenAt: null, hiddenReason: null })
        .where(eq(reviews.id, id))
        .returning({ id: reviews.id })
      return r.length > 0
    }
    case 'photo': {
      const r = await db.update(visitPhotos).set({ hiddenAt: hidden ? now : null }).where(eq(visitPhotos.id, id)).returning({ id: visitPhotos.id })
      return r.length > 0
    }
    case 'game': {
      const g = (await db.select({ status: games.status }).from(games).where(eq(games.id, id)).limit(1))[0]
      if (!g) return false
      // Unhiding restores `active`; a `closed` game stays closed.
      if (hidden) await db.update(games).set({ status: 'hidden' }).where(eq(games.id, id))
      else if (g.status === 'hidden') await db.update(games).set({ status: 'active' }).where(eq(games.id, id))
      return true
    }
    case 'venue': {
      const v = (await db.select({ status: venues.status }).from(venues).where(eq(venues.id, id)).limit(1))[0]
      if (!v) return false
      if (hidden) await db.update(venues).set({ status: 'hidden' }).where(eq(venues.id, id))
      else if (v.status === 'hidden') await db.update(venues).set({ status: 'active' }).where(eq(venues.id, id))
      return true
    }
  }
}

async function toApi(db: Db, rows: ReportRow[]): Promise<Report[]> {
  const ids = [...new Set(rows.map((r) => r.reporterId).filter((x): x is string => Boolean(x)))]
  const people = ids.length
    ? await db.select({ id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image }).from(users).where(inArray(users.id, ids))
    : []
  const byId = new Map<string, PublicUser>(people.map((p) => [p.id, { id: p.id, handle: p.handle, displayName: p.displayName || p.handle || p.name, image: p.image }]))
  return rows.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: (REPORT_REASONS as readonly string[]).includes(r.reason) ? (r.reason as Report['reason']) : 'other',
    note: r.note,
    status: r.status,
    reporter: r.reporterId ? (byId.get(r.reporterId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }))
}

/** Close every open report on a target as `hidden`. */
async function closeOpenReports(db: Db, type: TargetType, id: string, adminId: string, now: Date) {
  await db
    .update(reports)
    .set({ status: 'hidden', resolvedBy: adminId, resolvedAt: now })
    .where(and(eq(reports.targetType, type), eq(reports.targetId, id), eq(reports.status, 'open')))
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(
    app,
    ctx,
    ROUTES.report,
    async ({ body, user }) => {
      const db = ctx.db()
      if (!(await canSeeTarget(db, body.targetType, body.targetId, user.id))) throw new HttpError('not_found', 'That item was not found.')
      const existing = (
        await db
          .select({ id: reports.id })
          .from(reports)
          .where(and(eq(reports.reporterId, user.id), eq(reports.targetType, body.targetType), eq(reports.targetId, body.targetId), eq(reports.status, 'open')))
          .limit(1)
      )[0]
      if (existing) return { id: existing.id }
      const [row] = await db
        .insert(reports)
        .values({ reporterId: user.id, targetType: body.targetType, targetId: body.targetId, reason: body.reason, note: body.note })
        .returning({ id: reports.id })
      return { id: row.id }
    },
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
  )

  defineRoute(app, ctx, ROUTES.adminReports, async ({ query }) => {
    const db = ctx.db()
    const status = query.status ?? 'open'
    const rows = await db.select().from(reports).where(eq(reports.status, status)).orderBy(desc(reports.createdAt)).limit(200)
    return { reports: await toApi(db, rows) }
  })

  defineRoute(app, ctx, ROUTES.adminResolveReport, async ({ params, body, user }) => {
    const db = ctx.db()
    const now = ctx.now()
    const report = (await db.select().from(reports).where(eq(reports.id, params.id)).limit(1))[0]
    if (!report) throw new HttpError('not_found', 'Report not found.')
    if (body.action === 'hide') {
      // The target may already be gone (deleted by its owner); the report still closes.
      await setHidden(db, report.targetType, report.targetId, true, `report:${report.reason}`, now)
      await closeOpenReports(db, report.targetType, report.targetId, user.id, now)
      await db.update(reports).set({ status: 'hidden', resolvedBy: user.id, resolvedAt: now }).where(eq(reports.id, report.id))
    } else {
      await db.update(reports).set({ status: 'dismissed', resolvedBy: user.id, resolvedAt: now }).where(eq(reports.id, report.id))
    }
    const updated = (await db.select().from(reports).where(eq(reports.id, report.id)).limit(1))[0]
    return (await toApi(db, [updated]))[0]
  })

  defineRoute(app, ctx, ROUTES.adminHide, async ({ body, user }) => {
    const db = ctx.db()
    const now = ctx.now()
    const found = await setHidden(db, body.targetType, body.targetId, body.hidden, 'admin', now)
    if (!found) throw new HttpError('not_found', 'That item was not found.')
    if (body.hidden) await closeOpenReports(db, body.targetType, body.targetId, user.id, now)
    return { ok: true as const }
  })
}
