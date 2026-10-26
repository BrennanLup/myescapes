/**
 * Visit helpers shared by the visits, reviews and claims routes. Owned by workstream 32.
 *
 * Access ("Who can do what", docs/PHASE2_PLAN.md):
 *   - see a visit: owner / accepted participants, plus pending (to answer the tag). Everyone else
 *     gets 404 and only reaches it through a public review;
 *   - edit shared facts and puzzles: owner / accepted (recorded in visit_edits);
 *   - tag a user: only the tagger's accepted friends.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { CrewTag, Participant, ParticipantStatus, PhotoV2, VisitDetail, VisitFacts, VisitPuzzleInput } from '../../src/contracts/models'
import { VISIT_FACT_KEYS } from '../../src/contracts/models'
import type { PuzzleType } from '../../src/contracts/types'
import type { Db } from '../db/client'
import { games, reviews, users, venues, visitEdits, visitParticipants, visitPhotos, visitPuzzles, visits } from '../db/schema'
import { HttpError } from '../http'
import { acceptedFriendships, friendIds, publicUsers, type NotifyInput } from './friends.lib'
import { authorInfo, copyReviewFor, gameSummaries, reviewVisibleTo, toReviewV2 } from './reviews.lib'

export type VisitRow = typeof visits.$inferSelect
export type ParticipantRow = typeof visitParticipants.$inferSelect

/** Run `fn` in a transaction with a `Db`-typed handle. */
export function inTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (txRaw) => fn(txRaw as unknown as Db))
}

export const SEE_STATUSES: ParticipantStatus[] = ['owner', 'accepted', 'pending']
export const MEMBER_STATUSES: ParticipantStatus[] = ['owner', 'accepted']

export const isMember = (p: ParticipantRow | null | undefined) => Boolean(p && (p.status === 'owner' || p.status === 'accepted'))

export function factsOf(v: VisitRow): VisitFacts {
  return {
    date: v.date,
    escaped: v.escaped,
    escapeTimeMinutes: v.escapeTimeMinutes,
    visibleTimer: v.visibleTimer,
    multiRoom: v.multiRoom,
    flashlights: v.flashlights,
    liveActors: v.liveActors,
    toolsUsed: v.toolsUsed,
  }
}

/** Fact keys whose values differ (arrays compared by value). */
export function diffFacts(a: Partial<VisitFacts>, b: Partial<VisitFacts>, keys: readonly (keyof VisitFacts)[] = VISIT_FACT_KEYS): (keyof VisitFacts)[] {
  return keys.filter((k) => k in a && k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

export async function getVisitRow(db: Db, id: string): Promise<VisitRow | null> {
  return (await db.select().from(visits).where(eq(visits.id, id)).limit(1))[0] ?? null
}

export async function myParticipant(db: Db, visitId: string, userId: string): Promise<ParticipantRow | null> {
  return (await db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, visitId), eq(visitParticipants.userId, userId))).limit(1))[0] ?? null
}

/** The visit and my participant row, or 404 when I can't see it (never reveals that it exists). */
export async function visitForViewer(db: Db, id: string, userId: string, statuses: ParticipantStatus[] = SEE_STATUSES) {
  const visit = await getVisitRow(db, id)
  const me = visit ? await myParticipant(db, id, userId) : null
  if (!visit || !me || !SEE_STATUSES.includes(me.status)) throw new HttpError('not_found', 'Visit not found.')
  if (!statuses.includes(me.status)) throw new HttpError('forbidden', me.status === 'pending' ? 'Add this visit to your room first.' : 'Not allowed.')
  return { visit, me }
}

// ---------------------------------------------------------------------------
// Visit detail
// ---------------------------------------------------------------------------

export function photoUrl(id: string) {
  return `/api/photos/${id}`
}

export async function venueSummary(db: Db, venueId: string) {
  const v = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0]
  if (!v) throw new HttpError('not_found', 'Venue not found.')
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(games).where(and(eq(games.venueId, venueId), sql`${games.status} <> 'hidden'`)))[0]
  return {
    id: v.id, slug: v.slug, name: v.name, brand: v.brand, address: v.address, city: v.city, citySlug: v.citySlug, region: v.region,
    country: v.country, lat: v.lat, lng: v.lng, status: v.status, gameCount: Number(n?.n ?? 0),
  }
}

export async function participantsOf(db: Db, visitIds: string[]): Promise<Map<string, (Participant & { userId: string | null; createdAt: Date })[]>> {
  const out = new Map<string, (Participant & { userId: string | null; createdAt: Date })[]>()
  if (!visitIds.length) return out
  const rows = await db.select().from(visitParticipants).where(inArray(visitParticipants.visitId, visitIds)).orderBy(asc(visitParticipants.createdAt), asc(visitParticipants.id))
  const people = await publicUsers(db, rows.map((r) => r.userId))
  for (const r of rows) {
    if (r.status === 'declined') continue
    const list = out.get(r.visitId) ?? []
    const user = r.userId ? people.get(r.userId) ?? null : null
    list.push({ id: r.id, user, guestName: user ? null : r.guestName ?? 'Guest', status: r.status, addedBy: r.addedBy, userId: r.userId, createdAt: r.createdAt })
    out.set(r.visitId, list)
  }
  return out
}

/** The full visit as `viewerId` may see it. Call only after an access check. */
export async function visitDetail(db: Db, visitId: string, viewerId: string): Promise<VisitDetail> {
  const visit = await getVisitRow(db, visitId)
  if (!visit) throw new HttpError('not_found', 'Visit not found.')
  const summaries = await gameSummaries(db, [visit.gameId])
  const game = summaries.get(visit.gameId)
  if (!game) throw new HttpError('not_found', 'Game not found.')
  const [venue, puzzles, parts, photos, revRows, friends] = await Promise.all([
    venueSummary(db, game.venueId),
    db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, visitId)).orderBy(asc(visitPuzzles.position), asc(visitPuzzles.createdAt)),
    participantsOf(db, [visitId]),
    db
      .select({ id: visitPhotos.id, visitId: visitPhotos.visitId, uploaderId: visitPhotos.uploaderId, caption: visitPhotos.caption, width: visitPhotos.width, height: visitPhotos.height, createdAt: visitPhotos.createdAt })
      .from(visitPhotos)
      .where(and(eq(visitPhotos.visitId, visitId), sql`${visitPhotos.hiddenAt} is null`))
      .orderBy(asc(visitPhotos.createdAt)),
    db.select().from(reviews).where(eq(reviews.visitId, visitId)).orderBy(asc(reviews.createdAt)),
    friendIds(db, viewerId),
  ])
  const authors = await authorInfo(db, revRows.map((r) => r.authorId))
  const visible = revRows.filter((r) => reviewVisibleTo(r, authors.get(r.authorId), viewerId, friends))
  const puzzleIds = new Set(puzzles.map((p) => p.id))
  const reviewsOut = (await toReviewV2(db, visible, viewerId)).map((r) => ({ ...r, memorablePuzzleIds: r.memorablePuzzleIds.filter((id) => puzzleIds.has(id)) }))
  const participants = (parts.get(visitId) ?? []).map(({ userId: _u, createdAt: _c, ...p }) => p)
  const mine = (parts.get(visitId) ?? []).find((p) => p.userId === viewerId)
  return {
    id: visit.id,
    game,
    venue,
    facts: factsOf(visit),
    puzzles: puzzles.map((p) => ({ id: p.id, description: p.description, type: p.type as PuzzleType, notes: p.notes, position: p.position })),
    participants,
    photos: photos.map((p): PhotoV2 => ({ ...p, url: photoUrl(p.id), createdAt: p.createdAt.toISOString() })),
    reviews: reviewsOut,
    createdBy: visit.createdBy,
    myStatus: mine?.status ?? null,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

/**
 * Replace a visit's puzzles with `input` (order = position). Inputs with an id of an existing puzzle
 * of this visit keep it; any other id is treated as a client-side temporary id. Returns the
 * temporary-or-kept id -> stored id mapping, and the descriptions before/after (for edit history).
 */
export async function replacePuzzles(db: Db, visitId: string, input: VisitPuzzleInput[], userId: string) {
  const existing = await db.select().from(visitPuzzles).where(eq(visitPuzzles.visitId, visitId)).orderBy(asc(visitPuzzles.position))
  const byId = new Map(existing.map((p) => [p.id, p]))
  const idMap = new Map<string, string>()
  const keep = new Set<string>()
  for (const [position, p] of input.entries()) {
    const old = p.id ? byId.get(p.id) : undefined
    if (old && !keep.has(old.id)) {
      keep.add(old.id)
      idMap.set(old.id, old.id)
      if (old.description !== p.description || old.type !== p.type || old.notes !== (p.notes ?? '') || old.position !== position) {
        await db.update(visitPuzzles).set({ description: p.description, type: p.type, notes: p.notes ?? '', position }).where(eq(visitPuzzles.id, old.id))
      }
    } else {
      const row = (await db.insert(visitPuzzles).values({ visitId, position, description: p.description, type: p.type, notes: p.notes ?? '', createdBy: userId }).returning({ id: visitPuzzles.id }))[0]
      if (p.id) idMap.set(p.id, row.id)
      keep.add(row.id)
    }
  }
  const removed = existing.filter((p) => !keep.has(p.id)).map((p) => p.id)
  if (removed.length) await db.delete(visitPuzzles).where(inArray(visitPuzzles.id, removed))
  const summarize = (list: { description: string; type: string; notes: string }[]) => list.map((p) => ({ description: p.description, type: p.type, notes: p.notes }))
  const before = summarize(existing)
  const after = summarize(input.map((p) => ({ description: p.description, type: p.type, notes: p.notes ?? '' })))
  return { idMap, changed: JSON.stringify(before) !== JSON.stringify(after), before, after }
}

// ---------------------------------------------------------------------------
// Tagging and accepting
// ---------------------------------------------------------------------------

/** Visit facts for notification payloads. */
export async function visitNoticePayload(db: Db, visit: VisitRow): Promise<Record<string, unknown>> {
  const g = (await db.select({ name: games.name, slug: games.slug }).from(games).where(eq(games.id, visit.gameId)).limit(1))[0]
  return { gameName: g?.name ?? '', gameSlug: g?.slug ?? null, date: visit.date }
}

export interface CrewResult {
  added: number
  notices: NotifyInput[]
}

/**
 * Tag people on a visit as `tagger`. Users must be the tagger's accepted friends (403 otherwise).
 * Friends who auto-accept the tagger are added as `accepted` (with a copied review); others are
 * `pending`. Guests become plain-name participants. Existing participants are left alone, and
 * tagging yourself is ignored. Run inside a transaction.
 */
export async function addCrew(db: Db, visit: VisitRow, tagger: string, crew: CrewTag[]): Promise<CrewResult> {
  const userIds = [...new Set(crew.flatMap((c) => ('userId' in c ? [c.userId] : [])).filter((id) => id !== tagger))]
  const friendships = new Map((await acceptedFriendships(db, tagger)).map((f) => [f.other, f]))
  const notFriends = userIds.filter((id) => !friendships.has(id))
  if (notFriends.length) throw new HttpError('forbidden', 'You can only tag your friends. Add other people as guest names.')

  const existing = await db.select().from(visitParticipants).where(eq(visitParticipants.visitId, visit.id))
  const onVisit = new Set(existing.flatMap((p) => (p.userId ? [p.userId] : [])))
  const guestNames = new Set(existing.flatMap((p) => (!p.userId && p.guestName ? [p.guestName.trim().toLowerCase()] : [])))

  const payload = await visitNoticePayload(db, visit)
  const notices: NotifyInput[] = []
  let added = 0
  const now = Date.now()
  for (const id of userIds) {
    if (onVisit.has(id)) continue
    // "Always add <tagger>'s visits to my room": the tagged friend's flag towards the tagger.
    const auto = friendships.get(id)!.theirAutoAccept
    await db.insert(visitParticipants).values({
      visitId: visit.id, userId: id, status: auto ? 'accepted' : 'pending', addedBy: tagger,
      respondedAt: auto ? new Date() : null, createdAt: new Date(now + added),
    })
    if (auto) await copyReviewFor(db, visit.id, id, tagger)
    notices.push({ userId: id, type: auto ? 'tag_auto_added' : 'tagged', actorId: tagger, visitId: visit.id, payload })
    onVisit.add(id)
    added++
  }
  // Guest names that match a tagged/participating user's name are still kept: names are free text.
  for (const c of crew) {
    if (!('guestName' in c)) continue
    const name = c.guestName.trim()
    const key = name.toLowerCase()
    if (!name || guestNames.has(key)) continue
    await db.insert(visitParticipants).values({ visitId: visit.id, guestName: name, status: 'accepted', addedBy: tagger, createdAt: new Date(now + added) })
    guestNames.add(key)
    added++
  }
  return { added, notices }
}

/**
 * Accept a pending participant row for `userId`: status accepted and a review copied from the
 * person who tagged them (or the visit creator). Returns the notice for the tagger.
 */
export async function acceptParticipant(db: Db, visit: VisitRow, row: ParticipantRow, userId: string, extraPayload: Record<string, unknown> = {}): Promise<NotifyInput[]> {
  await db.update(visitParticipants).set({ status: 'accepted', respondedAt: new Date() }).where(eq(visitParticipants.id, row.id))
  const source = row.addedBy && row.addedBy !== userId ? row.addedBy : visit.createdBy
  await copyReviewFor(db, visit.id, userId, source)
  const to = row.addedBy && row.addedBy !== userId ? row.addedBy : visit.createdBy
  if (!to) return []
  return [{ userId: to, type: 'tag_accepted', actorId: userId, visitId: visit.id, payload: { ...(await visitNoticePayload(db, visit)), ...extraPayload } }]
}

/** Record a shared-fact edit (`changes` non-empty). */
export async function recordEdit(db: Db, visitId: string, editorId: string, changes: Record<string, { from: unknown; to: unknown }>) {
  if (!Object.keys(changes).length) return
  const u = (await db.select({ displayName: users.displayName, name: users.name }).from(users).where(eq(users.id, editorId)).limit(1))[0]
  await db.insert(visitEdits).values({ visitId, editorId, editorName: u?.displayName || u?.name || '', changes })
}

/** Apply partial facts to a visit, returning the recorded changes. */
export async function applyFacts(db: Db, visit: VisitRow, patch: Partial<VisitFacts>): Promise<Record<string, { from: unknown; to: unknown }>> {
  const cur = factsOf(visit)
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const set: Partial<VisitFacts> = {}
  for (const k of VISIT_FACT_KEYS) {
    if (!(k in patch) || patch[k] === undefined) continue
    if (JSON.stringify(cur[k]) === JSON.stringify(patch[k])) continue
    changes[k] = { from: cur[k], to: patch[k] }
    ;(set as Record<string, unknown>)[k] = patch[k]
  }
  if (Object.keys(set).length) await db.update(visits).set(set).where(eq(visits.id, visit.id))
  return changes
}

/** Notify the other members of a visit that someone edited it. */
export async function editNotices(db: Db, visit: VisitRow, editorId: string, fields: string[]): Promise<NotifyInput[]> {
  const members = await db
    .select({ userId: visitParticipants.userId })
    .from(visitParticipants)
    .where(and(eq(visitParticipants.visitId, visit.id), inArray(visitParticipants.status, MEMBER_STATUSES)))
  const payload = { ...(await visitNoticePayload(db, visit)), fields }
  return members.flatMap((m) => (m.userId && m.userId !== editorId ? [{ userId: m.userId, type: 'visit_edited' as const, actorId: editorId, visitId: visit.id, payload }] : []))
}


