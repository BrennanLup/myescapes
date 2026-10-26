/**
 * Read helpers for the account routes (workstream 4): my rooms (`LogRow`), visit details for the
 * export, and the contract mappings they need. Every loader takes the viewer's id and only
 * returns what that viewer may see.
 */
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { GameSummary, LogRow, Participant, PhotoV2, ReviewV2, VenueSummary, VisitDetail } from '../../src/contracts/models'
import type { Genre, PuzzleType } from '../../src/contracts/types'
import { GENRES } from '../../src/contracts/types'
import type { Db } from '../db/client'
import { friendships, games, reviews, users, venues, visitParticipants, visitPhotos, visitPuzzles, visits } from '../db/schema'
import { toPublicUser } from '../db/util'
import { authorIsPublic } from '../auth/users'

type UserRow = typeof users.$inferSelect
type ReviewRow = typeof reviews.$inferSelect
type GameRow = typeof games.$inferSelect
type VenueRow = typeof venues.$inferSelect
type VisitRow = typeof visits.$inferSelect

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function asGenre(g: string | null): Genre | null {
  return g && (GENRES as readonly string[]).includes(g) ? (g as Genre) : null
}

export function reviewToContract(r: ReviewRow, author: Pick<UserRow, 'id' | 'handle' | 'displayName' | 'name' | 'image'>, viewerId: string | null): ReviewV2 {
  return {
    id: r.id,
    visitId: r.visitId,
    author: toPublicUser(author),
    ratings: {
      overall: { score: r.overallScore, comment: r.overallComment },
      puzzles: { score: r.puzzlesScore, comment: r.puzzlesComment },
      setting: { score: r.settingScore, comment: r.settingComment },
      storyline: { score: r.storylineScore, comment: r.storylineComment },
      difficulty: { score: r.difficultyScore, comment: r.difficultyComment },
    },
    // Transcripts are visible only to their author (privacy policy).
    transcript: viewerId && viewerId === r.authorId ? r.transcript : null,
    memorablePuzzleIds: r.memorablePuzzleIds,
    visibility: r.visibility,
    containsSpoilers: r.containsSpoilers,
    scoresCopied: r.scoresCopied,
    copiedFromReviewId: r.copiedFromReviewId,
    hidden: r.hiddenAt !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

/** Game summaries with public aggregates (public, not hidden, not copied, author onboarded). */
export async function gameSummaries(db: Db, gameIds: string[]): Promise<Map<string, GameSummary>> {
  const out = new Map<string, GameSummary>()
  if (!gameIds.length) return out
  const ids = [...new Set(gameIds)]
  const rows = await db.select({ game: games, venue: venues }).from(games).innerJoin(venues, eq(venues.id, games.venueId)).where(inArray(games.id, ids))
  const aggs = await db
    .select({ gameId: visits.gameId, n: sql<number>`count(*)::int`, avg: sql<number | null>`avg(${reviews.overallScore})::float8` })
    .from(reviews)
    .innerJoin(visits, eq(visits.id, reviews.visitId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(and(inArray(visits.gameId, ids), eq(reviews.visibility, 'public'), isNull(reviews.hiddenAt), eq(reviews.scoresCopied, false), authorIsPublic()))
    .groupBy(visits.gameId)
  const agg = new Map(aggs.map((a) => [a.gameId, a]))
  for (const { game, venue } of rows) out.set(game.id, gameSummary(game, venue, agg.get(game.id)))
  return out
}

function gameSummary(game: GameRow, venue: VenueRow, agg?: { n: number; avg: number | null }): GameSummary {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    genre: asGenre(game.genre),
    status: game.status,
    venueId: venue.id,
    venueName: venue.name,
    venueSlug: venue.slug,
    city: venue.city,
    country: venue.country,
    reviewCount: agg?.n ?? 0,
    avgOverall: agg?.avg == null ? null : Math.round(agg.avg * 10) / 10,
  }
}

export async function venueSummaries(db: Db, venueIds: string[]): Promise<Map<string, VenueSummary>> {
  const out = new Map<string, VenueSummary>()
  if (!venueIds.length) return out
  const ids = [...new Set(venueIds)]
  const rows = await db.select().from(venues).where(inArray(venues.id, ids))
  const counts = await db
    .select({ venueId: games.venueId, n: sql<number>`count(*)::int` })
    .from(games)
    .where(and(inArray(games.venueId, ids), ne(games.status, 'hidden')))
    .groupBy(games.venueId)
  const count = new Map(counts.map((c) => [c.venueId, c.n]))
  for (const v of rows) {
    out.set(v.id, {
      id: v.id,
      slug: v.slug,
      name: v.name,
      brand: v.brand,
      address: v.address,
      city: v.city,
      citySlug: v.citySlug,
      region: v.region,
      country: v.country,
      lat: v.lat,
      lng: v.lng,
      status: v.status,
      gameCount: count.get(v.id) ?? 0,
    })
  }
  return out
}

/** User ids the viewer is (accepted) friends with. */
export async function friendIdsOf(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ a: friendships.userA, b: friendships.userB })
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userA, userId), eq(friendships.userB, userId))))
  return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)))
}

/** May `viewerId` see this review inside a visit they are on? */
export function reviewVisibleTo(r: ReviewRow, viewerId: string, friends: Set<string>): boolean {
  if (r.authorId === viewerId) return true
  if (r.hiddenAt) return false
  if (r.visibility === 'public') return true
  if (r.visibility === 'friends') return friends.has(r.authorId)
  return false
}

interface Bundle {
  visit: VisitRow
  game: GameSummary
  venue: VenueSummary
  participants: Participant[]
  /** Participant rows with their status, for crew filters. */
  rawParticipants: { userId: string | null; guestName: string | null; status: string; handle: string | null }[]
  photos: PhotoV2[]
  reviews: ReviewV2[]
  myReview: ReviewV2 | null
  puzzles: VisitDetail['puzzles']
  myStatus: Participant['status'] | null
}

/** Everything about these visits that `viewerId` may see. Caller must have checked participation. */
export async function loadVisitBundles(db: Db, visitIds: string[], viewerId: string): Promise<Bundle[]> {
  if (!visitIds.length) return []
  const vs = await db.select().from(visits).where(inArray(visits.id, visitIds))
  const gameIds = vs.map((v) => v.gameId)
  const gameMap = await gameSummaries(db, gameIds)
  const venueMap = await venueSummaries(db, [...gameMap.values()].map((g) => g.venueId))
  const [parts, photos, revs, puzzles, friends] = await Promise.all([
    db
      .select({ p: visitParticipants, u: { id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image } })
      .from(visitParticipants)
      .leftJoin(users, eq(users.id, visitParticipants.userId))
      .where(inArray(visitParticipants.visitId, visitIds))
      .orderBy(asc(visitParticipants.createdAt), asc(visitParticipants.id)),
    db
      .select({ id: visitPhotos.id, visitId: visitPhotos.visitId, uploaderId: visitPhotos.uploaderId, caption: visitPhotos.caption, width: visitPhotos.width, height: visitPhotos.height, hiddenAt: visitPhotos.hiddenAt, createdAt: visitPhotos.createdAt })
      .from(visitPhotos)
      .where(inArray(visitPhotos.visitId, visitIds))
      .orderBy(asc(visitPhotos.createdAt), asc(visitPhotos.id)),
    db
      .select({ r: reviews, u: { id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image } })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(inArray(reviews.visitId, visitIds))
      .orderBy(asc(reviews.createdAt)),
    db.select().from(visitPuzzles).where(inArray(visitPuzzles.visitId, visitIds)).orderBy(asc(visitPuzzles.position), asc(visitPuzzles.createdAt)),
    friendIdsOf(db, viewerId),
  ])
  const out: Bundle[] = []
  for (const visit of vs) {
    const game = gameMap.get(visit.gameId)
    const venue = game ? venueMap.get(game.venueId) : undefined
    if (!game || !venue) continue
    const vp = parts.filter((x) => x.p.visitId === visit.id)
    const mine = vp.find((x) => x.p.userId === viewerId)
    const visibleReviews = revs.filter((x) => x.r.visitId === visit.id && reviewVisibleTo(x.r, viewerId, friends)).map((x) => reviewToContract(x.r, x.u, viewerId))
    out.push({
      visit,
      game,
      venue,
      participants: vp
        .filter((x) => x.p.status !== 'declined' || x.p.userId === viewerId)
        .map((x) => ({ id: x.p.id, user: x.u && x.u.id ? toPublicUser(x.u) : null, guestName: x.p.guestName, status: x.p.status, addedBy: x.p.addedBy })),
      rawParticipants: vp.map((x) => ({ userId: x.p.userId, guestName: x.p.guestName, status: x.p.status, handle: x.u?.handle ?? null })),
      photos: photos
        .filter((p) => p.visitId === visit.id && (!p.hiddenAt || p.uploaderId === viewerId))
        .map((p) => ({ id: p.id, visitId: p.visitId, url: `/api/photos/${p.id}`, uploaderId: p.uploaderId, caption: p.caption, width: p.width, height: p.height, createdAt: p.createdAt.toISOString() })),
      reviews: visibleReviews,
      myReview: visibleReviews.find((r) => r.author.id === viewerId) ?? null,
      puzzles: puzzles
        .filter((p) => p.visitId === visit.id)
        .map((p, i) => ({ id: p.id, description: p.description, type: p.type as PuzzleType, notes: p.notes, position: i })),
      myStatus: mine?.p.status ?? null,
    })
  }
  return out
}

export function bundleToVisitDetail(b: Bundle): VisitDetail {
  const v = b.visit
  return {
    id: v.id,
    game: b.game,
    venue: b.venue,
    facts: {
      date: v.date,
      escaped: v.escaped,
      escapeTimeMinutes: v.escapeTimeMinutes,
      visibleTimer: v.visibleTimer,
      multiRoom: v.multiRoom,
      flashlights: v.flashlights,
      liveActors: v.liveActors,
      toolsUsed: v.toolsUsed,
    },
    puzzles: b.puzzles,
    participants: b.participants,
    photos: b.photos,
    reviews: b.reviews,
    createdBy: v.createdBy,
    myStatus: b.myStatus,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}

/** Ids of visits the user owns or accepted ("my room"), newest first. */
export async function myVisitIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: visits.id })
    .from(visitParticipants)
    .innerJoin(visits, eq(visits.id, visitParticipants.visitId))
    .where(and(eq(visitParticipants.userId, userId), inArray(visitParticipants.status, ['owner', 'accepted'])))
    .orderBy(desc(visits.date), desc(visits.createdAt), desc(visits.id))
  return rows.map((r) => r.id)
}

/** Does crew filter `who` (a user id, @handle or guest name, case-insensitive) match this visit's crew? */
export function crewMatches(b: Bundle, who: string, viewerId: string): boolean {
  const w = who.trim().replace(/^@/, '').toLowerCase()
  if (!w) return true
  return b.rawParticipants.some(
    (p) =>
      p.userId !== viewerId &&
      p.status !== 'declined' &&
      ((p.userId !== null && p.userId.toLowerCase() === w) || (p.handle !== null && p.handle.toLowerCase() === w) || (p.guestName !== null && p.guestName.toLowerCase() === w)),
  )
}

export function bundleToLogRow(b: Bundle, viewerId: string): LogRow {
  const cover = b.photos[0]?.url ?? null
  return {
    visitId: b.visit.id,
    date: b.visit.date,
    game: b.game,
    venue: b.venue,
    escaped: b.visit.escaped,
    escapeTimeMinutes: b.visit.escapeTimeMinutes,
    myReview: b.myReview,
    crew: b.participants.filter((p) => p.user?.id !== viewerId && p.status !== 'declined'),
    coverPhotoUrl: cover,
  }
}

/** "My room" rows, newest first, with optional crew filters. */
export async function logRowsFor(db: Db, userId: string, filter: { with?: string; without?: string } = {}): Promise<LogRow[]> {
  const ids = await myVisitIds(db, userId)
  const bundles = await loadVisitBundles(db, ids, userId)
  const order = new Map(ids.map((id, i) => [id, i]))
  return bundles
    .filter((b) => (filter.with ? crewMatches(b, filter.with, userId) : true))
    .filter((b) => (filter.without ? !crewMatches(b, filter.without, userId) : true))
    .sort((a, b) => order.get(a.visit.id)! - order.get(b.visit.id)!)
    .map((b) => bundleToLogRow(b, userId))
}

export { iso }
