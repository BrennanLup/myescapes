/**
 * Review helpers shared by the social routes and, through exports, by the directory's game page
 * (workstreams 5, 16, 18). Owned by workstream 33.
 *
 * Visibility rule (one place, used everywhere):
 *   - the author always sees their own review (hidden or not, with the transcript);
 *   - a hidden review is seen by nobody else;
 *   - `public`: anyone, once the author is onboarded (has an @handle and a display name, the
 *     `authorIsPublic` rule). A "public" review of an author who is not onboarded is treated as friends-only, so public pages never show a Google name
 *     the person didn't choose;
 *   - `friends`: the author's accepted friends;
 *   - `private`: the author only.
 *
 * Public averages count only public, non-hidden reviews by onboarded authors whose scores are not
 * an untouched copy (`scores_copied`). A visit counts once (escape rate) when it has at least one
 * public review.
 *
 * Spoilers: on public responses (`GET /api/games/:slug/reviews`, `GET /api/reviews/:id` for anyone
 * but the author) the comments of a review flagged `containsSpoilers` are blanked unless the
 * caller passes `?spoilers=1`. Puzzle details (`puzzleHighlights`) are blanked the same way.
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { Aggregate, GameSummary, PublicReview, PuzzleHighlight, ReviewInput, ReviewV2, SpoilerFilter, Visibility } from '../../src/contracts/models'
import { GENRES, RATING_KEYS, type Genre, type PuzzleType, type Ratings } from '../../src/contracts/types'
import type { Db } from '../db/client'
import { games, reviews, users, venues, visitPhotos, visitPuzzles, visits } from '../db/schema'
import { friendIds, publicUsers } from './friends.lib'
import { authorIsPublic } from '../auth/users'
import { canSeeVisitPhotos, participantStatus, visitIsPublic } from './photos.access'

export type ReviewRow = typeof reviews.$inferSelect

export function ratingsOf(r: ReviewRow): Ratings {
  return {
    overall: { score: r.overallScore, comment: r.overallComment },
    puzzles: { score: r.puzzlesScore, comment: r.puzzlesComment },
    setting: { score: r.settingScore, comment: r.settingComment },
    storyline: { score: r.storylineScore, comment: r.storylineComment },
    difficulty: { score: r.difficultyScore, comment: r.difficultyComment },
  }
}

/** Column values for a review from contract ratings. */
export function ratingColumns(r: Ratings) {
  return {
    overallScore: r.overall.score,
    overallComment: r.overall.comment ?? '',
    puzzlesScore: r.puzzles.score,
    puzzlesComment: r.puzzles.comment ?? '',
    settingScore: r.setting.score,
    settingComment: r.setting.comment ?? '',
    storylineScore: r.storyline.score,
    storylineComment: r.storyline.comment ?? '',
    difficultyScore: r.difficulty.score,
    difficultyComment: r.difficulty.comment ?? '',
  }
}

/** True when any of the five scores differs. */
export function scoresChanged(row: ReviewRow, next: Ratings): boolean {
  const cur = ratingsOf(row)
  return RATING_KEYS.some((k) => cur[k].score !== next[k].score)
}

/** Ratings with every comment blanked (spoiler-protected public view). */
export function withoutComments(r: Ratings): Ratings {
  const out = {} as Ratings
  for (const k of RATING_KEYS) out[k] = { score: r[k].score, comment: '' }
  return out
}

/** Does the caller ask to reveal spoilers? `?spoilers=1|true|show` (read from the raw query). */
export function wantsSpoilers(query: unknown): boolean {
  const v = (query as Record<string, unknown> | undefined)?.spoilers
  return v === '1' || v === 'true' || v === 'show'
}

export interface AuthorInfo {
  id: string
  /** Null until onboarding (an @handle and a display name, see `authorIsPublic`). */
  handle: string | null
}

/** The one visibility rule. `friendsOfViewer` = ids of the viewer's accepted friends. */
export function reviewVisibleTo(
  r: Pick<ReviewRow, 'authorId' | 'visibility' | 'hiddenAt'>,
  author: AuthorInfo | undefined,
  viewerId: string | null,
  friendsOfViewer: Set<string>,
): boolean {
  if (viewerId && r.authorId === viewerId) return true
  if (r.hiddenAt) return false
  const vis = r.visibility as Visibility
  if (vis === 'private') return false
  if (vis === 'public' && author?.handle) return true
  return Boolean(viewerId) && friendsOfViewer.has(r.authorId)
}

/** SQL for "counts in public averages / public listings". Needs `users` joined on the author. */
export function publicReviewCondition(): SQL {
  return and(eq(reviews.visibility, 'public'), isNull(reviews.hiddenAt), authorIsPublic(users)) as SQL
}

/** Map a row to the contract. `viewerId` decides whether the transcript is included. */
export async function toReviewV2(db: Db, rows: ReviewRow[], viewerId: string | null, opts: { hideSpoilerComments?: boolean } = {}): Promise<ReviewV2[]> {
  const authors = await publicUsers(db, rows.map((r) => r.authorId))
  return rows.flatMap((r) => {
    const author = authors.get(r.authorId)
    if (!author) return []
    const mine = viewerId === r.authorId
    const ratings = ratingsOf(r)
    return [
      {
        id: r.id,
        visitId: r.visitId,
        author,
        ratings: !mine && opts.hideSpoilerComments && r.containsSpoilers ? withoutComments(ratings) : ratings,
        transcript: mine ? r.transcript : null,
        memorablePuzzleIds: r.memorablePuzzleIds,
        visibility: r.visibility as Visibility,
        containsSpoilers: r.containsSpoilers,
        scoresCopied: r.scoresCopied,
        copiedFromReviewId: r.copiedFromReviewId,
        hidden: Boolean(r.hiddenAt),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } satisfies ReviewV2,
    ]
  })
}

/** Handles of the given users (for `reviewVisibleTo`). */
export async function authorInfo(db: Db, ids: Iterable<string>): Promise<Map<string, AuthorInfo>> {
  const list = [...new Set(ids)]
  if (!list.length) return new Map()
  const rows = await db.select({ id: users.id, handle: users.handle, displayName: users.displayName }).from(users).where(inArray(users.id, list))
  return new Map(rows.map((u) => [u.id, { id: u.id, handle: u.handle && u.displayName ? u.handle : null }]))
}

/** Keep only memorable ids that are puzzles of the visit. */
export async function filterPuzzleIds(db: Db, visitId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const valid = new Set(
    (await db.select({ id: visitPuzzles.id }).from(visitPuzzles).where(and(eq(visitPuzzles.visitId, visitId), inArray(visitPuzzles.id, ids)))).map((p) => p.id),
  )
  return [...new Set(ids.filter((id) => valid.has(id)))]
}

/** Insert or replace `authorId`'s review on a visit from contract input. Returns the row. */
export async function upsertReview(db: Db, visitId: string, authorId: string, input: ReviewInput): Promise<ReviewRow> {
  const existing = (await db.select().from(reviews).where(and(eq(reviews.visitId, visitId), eq(reviews.authorId, authorId))).limit(1))[0]
  const memorablePuzzleIds = await filterPuzzleIds(db, visitId, input.memorablePuzzleIds ?? [])
  const values = {
    ...ratingColumns(input.ratings),
    transcript: input.transcript ?? '',
    memorablePuzzleIds,
    visibility: input.visibility ?? 'public',
    containsSpoilers: input.containsSpoilers ?? false,
  }
  if (existing) {
    // A copy stays a copy until the author changes at least one score.
    const scoresCopied = existing.scoresCopied && !scoresChanged(existing, input.ratings)
    return (
      await db
        .update(reviews)
        .set({ ...values, scoresCopied })
        .where(eq(reviews.id, existing.id))
        .returning()
    )[0]
  }
  return (await db.insert(reviews).values({ visitId, authorId, ...values, scoresCopied: false }).returning())[0]
}

/**
 * Give `userId` a review on `visitId` that copies `fromAuthorId`'s scores and comments (owner's
 * decision), flagged `scoresCopied` so it stays out of public averages. The transcript is never
 * copied (it belongs to its author). No-op when the user already has a review or the source has none.
 * A public copy needs an @handle, so non-onboarded users get a friends-only copy.
 */
export async function copyReviewFor(db: Db, visitId: string, userId: string, fromAuthorId: string | null): Promise<ReviewRow | null> {
  const mine = (await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.visitId, visitId), eq(reviews.authorId, userId))).limit(1))[0]
  if (mine) return null
  const source = fromAuthorId
    ? (await db.select().from(reviews).where(and(eq(reviews.visitId, visitId), eq(reviews.authorId, fromAuthorId))).limit(1))[0]
    : undefined
  if (!source) return null
  const me = (await db.select({ handle: users.handle, displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1))[0]
  let visibility = source.visibility
  if (visibility === 'public' && !(me?.handle && me.displayName)) visibility = 'friends'
  const rows = await db
    .insert(reviews)
    .values({
      visitId,
      authorId: userId,
      ...ratingColumns(ratingsOf(source)),
      transcript: '',
      memorablePuzzleIds: source.memorablePuzzleIds,
      visibility,
      containsSpoilers: source.containsSpoilers,
      scoresCopied: true,
      copiedFromReviewId: source.id,
    })
    .onConflictDoNothing()
    .returning()
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Aggregates and game summaries
// ---------------------------------------------------------------------------

const round1 = (n: number | null) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10)
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

type AvgRow = { gameId: string; n: number; overall: unknown; puzzles: unknown; setting: unknown; storyline: unknown; difficulty: unknown }
type VisitAggRow = { gameId: string; visits: number; escapedKnown: number; escaped: number; avgMinutes: unknown }

/** Public aggregates for many games at once. */
export async function gameAggregates(db: Db, gameIds: string[]): Promise<Map<string, Aggregate>> {
  const out = new Map<string, Aggregate>()
  if (!gameIds.length) return out
  const avgs = (await db
    .select({
      gameId: visits.gameId,
      n: sql<number>`count(*)::int`,
      overall: sql`avg(${reviews.overallScore})`,
      puzzles: sql`avg(${reviews.puzzlesScore})`,
      setting: sql`avg(${reviews.settingScore})`,
      storyline: sql`avg(${reviews.storylineScore})`,
      difficulty: sql`avg(${reviews.difficultyScore})`,
    })
    .from(reviews)
    .innerJoin(visits, eq(visits.id, reviews.visitId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(and(inArray(visits.gameId, gameIds), publicReviewCondition(), eq(reviews.scoresCopied, false)))
    .groupBy(visits.gameId)) as AvgRow[]

  // Visits with at least one public review (copied or not), each counted once.
  const publicVisitIds = db
    .select({ id: reviews.visitId })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(publicReviewCondition())
  const vrows = (await db
    .select({
      gameId: visits.gameId,
      visits: sql<number>`count(*)::int`,
      escapedKnown: sql<number>`count(${visits.escaped})::int`,
      escaped: sql<number>`count(*) filter (where ${visits.escaped})::int`,
      avgMinutes: sql`avg(${visits.escapeTimeMinutes}) filter (where ${visits.escaped})`,
    })
    .from(visits)
    .where(and(inArray(visits.gameId, gameIds), inArray(visits.id, publicVisitIds)))
    .groupBy(visits.gameId)) as VisitAggRow[]

  for (const id of gameIds) {
    const a = avgs.find((r) => r.gameId === id)
    const v = vrows.find((r) => r.gameId === id)
    out.set(id, {
      reviewCount: a ? Number(a.n) : 0,
      visitCount: v ? Number(v.visits) : 0,
      escapeRate: v && Number(v.escapedKnown) > 0 ? Number(v.escaped) / Number(v.escapedKnown) : null,
      avgEscapeMinutes: v ? round1(num(v.avgMinutes)) : null,
      avg: {
        overall: a ? round1(num(a.overall)) : null,
        puzzles: a ? round1(num(a.puzzles)) : null,
        setting: a ? round1(num(a.setting)) : null,
        storyline: a ? round1(num(a.storyline)) : null,
        difficulty: a ? round1(num(a.difficulty)) : null,
      },
    })
  }
  return out
}

export async function gameAggregate(db: Db, gameId: string): Promise<Aggregate> {
  return (await gameAggregates(db, [gameId])).get(gameId)!
}

export type GameSummaryOut = GameSummary

const asGenre = (g: string | null): Genre | null => (g && (GENRES as readonly string[]).includes(g) ? (g as Genre) : null)

/** `GameSummary` rows (with public review count and average) for many games. */
export async function gameSummaries(db: Db, gameIds: string[]): Promise<Map<string, GameSummaryOut>> {
  const ids = [...new Set(gameIds)]
  if (!ids.length) return new Map()
  const rows = await db
    .select({ game: games, venue: venues })
    .from(games)
    .innerJoin(venues, eq(venues.id, games.venueId))
    .where(inArray(games.id, ids))
  const aggs = await gameAggregates(db, ids)
  return new Map(
    rows.map(({ game, venue }) => [
      game.id,
      {
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
        reviewCount: aggs.get(game.id)?.reviewCount ?? 0,
        avgOverall: aggs.get(game.id)?.avg.overall ?? null,
      },
    ]),
  )
}

/**
 * Puzzle highlights for a game page: puzzles from visits with a public review, grouped by
 * description, most memorable first. Spoilers: description and notes are blanked unless `reveal`.
 */
export async function puzzleHighlights(db: Db, gameId: string, opts: { reveal?: boolean; limit?: number } = {}): Promise<PuzzleHighlight[]> {
  const publicVisitIds = db
    .select({ id: reviews.visitId })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(publicReviewCondition())
  const rows = await db
    .select({ id: visitPuzzles.id, description: visitPuzzles.description, type: visitPuzzles.type, notes: visitPuzzles.notes })
    .from(visitPuzzles)
    .innerJoin(visits, eq(visits.id, visitPuzzles.visitId))
    .where(and(eq(visits.gameId, gameId), inArray(visits.id, publicVisitIds)))
    .orderBy(asc(visitPuzzles.position))
  if (!rows.length) return []
  const memorable = await db
    .select({ ids: reviews.memorablePuzzleIds })
    .from(reviews)
    .innerJoin(visits, eq(visits.id, reviews.visitId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(and(eq(visits.gameId, gameId), publicReviewCondition()))
  const counts = new Map<string, number>()
  for (const m of memorable) for (const id of m.ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const groups = new Map<string, { description: string; type: string; notes: string; memorableCount: number; order: number }>()
  rows.forEach((p, i) => {
    const key = p.description.trim().toLowerCase()
    const g = groups.get(key)
    const c = counts.get(p.id) ?? 0
    if (g) {
      g.memorableCount += c
      if (!g.notes && p.notes) g.notes = p.notes
    } else groups.set(key, { description: p.description, type: p.type, notes: p.notes, memorableCount: c, order: i })
  })
  return [...groups.values()]
    .sort((a, b) => b.memorableCount - a.memorableCount || a.order - b.order)
    .slice(0, opts.limit ?? 12)
    .map((g) => ({
      description: opts.reveal ? g.description : '',
      type: g.type as PuzzleType,
      notes: opts.reveal ? g.notes : '',
      memorableCount: g.memorableCount,
      spoiler: true as const,
    }))
}

// ---------------------------------------------------------------------------
// Keyset cursors: base64url("<timestamptz text>|<id>")
// ---------------------------------------------------------------------------

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): { ts: string; id: string } | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const i = raw.lastIndexOf('|')
    if (i <= 0) return null
    const ts = raw.slice(0, i)
    const id = raw.slice(i + 1)
    if (!id || !TS_RE.test(ts)) return null
    return { ts, id }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public review pages
// ---------------------------------------------------------------------------

const PAGE = 20

/**
 * A page of reviews of a game as `viewer` may see them on a public page: public reviews by
 * onboarded authors, plus friends-only (or not-yet-onboarded public) reviews by the viewer's
 * friends. Hidden and private reviews never appear, not even the viewer's own (the public page
 * shows what others see). Newest first by review creation time.
 */
export async function publicReviewPage(
  db: Db,
  gameId: string,
  viewer: string | null,
  opts: { cursor?: string; limit?: number; revealSpoilers?: boolean; filter?: SpoilerFilter },
): Promise<{ reviews: PublicReview[]; nextCursor: string | null }> {
  return publicReviewList(db, viewer, { ...opts, gameId })
}

/**
 * The public review list: one game's (`gameId`) or every room's (the /reviews feed, which also
 * carries each review's `game`). Same visibility rule either way; reviews of hidden games or
 * venues stay out of the feed. `filter` keeps all reviews, only spoiler-free ones, or only ones
 * flagged as spoilers. `citySlug` narrows the feed to one city.
 */
export async function publicReviewList(
  db: Db,
  viewer: string | null,
  opts: { gameId?: string; citySlug?: string; cursor?: string; limit?: number; revealSpoilers?: boolean; filter?: SpoilerFilter },
): Promise<{ reviews: PublicReview[]; nextCursor: string | null }> {
  const gameId = opts.gameId
  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 50)
  const friends = [...(await friendIds(db, viewer))]
  const visibleCond = friends.length
    ? sql`(${reviews.visibility} = 'public' and ${authorIsPublic(users)}) or (${reviews.visibility} in ('public', 'friends') and ${inArray(reviews.authorId, friends)})`
    : sql`${reviews.visibility} = 'public' and ${authorIsPublic(users)}`
  const cursor = decodeCursor(opts.cursor)
  const feed = !gameId
  const where = and(
    gameId ? eq(visits.gameId, gameId) : undefined,
    feed ? sql`${visits.gameId} in (select ${games.id} from ${games} join ${venues} on ${venues.id} = ${games.venueId} where ${games.status} <> 'hidden' and ${venues.status} <> 'hidden'${opts.citySlug ? sql` and ${venues.citySlug} = ${opts.citySlug}` : sql``})` : undefined,
    opts.filter === 'free' ? eq(reviews.containsSpoilers, false) : opts.filter === 'only' ? eq(reviews.containsSpoilers, true) : undefined,
    sql`${reviews.hiddenAt} is null`,
    sql`(${visibleCond})`,
    cursor ? sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
  )
  const rows = await db
    .select({ review: reviews, visit: visits, ts: sql<string>`${reviews.createdAt}::text` })
    .from(reviews)
    .innerJoin(visits, eq(visits.id, reviews.visitId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1].ts, page[page.length - 1].review.id) : null
  if (!page.length) return { reviews: [], nextCursor: null }

  const visitIds = [...new Set(page.map((r) => r.visit.id))]
  // "Played together": other reviews on the same visits that this viewer may see.
  const siblings = await db.select().from(reviews).where(inArray(reviews.visitId, visitIds))
  const [authors, friendSet] = await Promise.all([authorInfo(db, siblings.map((s) => s.authorId)), friendIds(db, viewer)])
  const visibleSiblings = siblings.filter((s) => {
    if (s.hiddenAt || s.visibility === 'private') return false
    return reviewVisibleTo(s, authors.get(s.authorId), viewer, friendSet)
  })
  const people = await publicUsers(db, [...page.map((r) => r.review.authorId), ...visibleSiblings.map((s) => s.authorId)])
  // Photos follow the photo rule (photos.access.ts): shown only when the viewer could open them,
  // i.e. the visit is public or the viewer is on it. A friends-only review never exposes its photos.
  const photoVisits: string[] = []
  for (const id of visitIds) {
    if (canSeeVisitPhotos(await participantStatus(db, id, viewer)) || (await visitIsPublic(db, id))) photoVisits.push(id)
  }
  const photos = !photoVisits.length ? [] : await db
    .select({ id: visitPhotos.id, visitId: visitPhotos.visitId, uploaderId: visitPhotos.uploaderId, caption: visitPhotos.caption, width: visitPhotos.width, height: visitPhotos.height, createdAt: visitPhotos.createdAt })
    .from(visitPhotos)
    .where(and(inArray(visitPhotos.visitId, photoVisits), sql`${visitPhotos.hiddenAt} is null`))
    .orderBy(visitPhotos.createdAt)

  const summaries = feed ? await gameSummaries(db, page.map((r) => r.visit.gameId)) : null
  const out: PublicReview[] = page.flatMap(({ review, visit }) => {
    const author = people.get(review.authorId)
    if (!author) return []
    const ratings = ratingsOf(review)
    return [
      {
        id: review.id,
        visitId: visit.id,
        author,
        date: visit.date,
        ratings: review.containsSpoilers && !opts.revealSpoilers ? withoutComments(ratings) : ratings,
        containsSpoilers: review.containsSpoilers,
        scoresCopied: review.scoresCopied,
        escaped: visit.escaped,
        escapeTimeMinutes: visit.escapeTimeMinutes,
        playedWith: visibleSiblings
          .filter((s) => s.visitId === visit.id && s.id !== review.id && people.has(s.authorId))
          .map((s) => ({ reviewId: s.id, author: people.get(s.authorId)! })),
        photos: photos
          .filter((p) => p.visitId === visit.id)
          .map((p) => ({ ...p, url: `/api/photos/${p.id}`, createdAt: p.createdAt.toISOString() })),
        createdAt: review.createdAt.toISOString(),
        ...(summaries?.get(visit.gameId) ? { game: summaries.get(visit.gameId)! } : {}),
      },
    ]
  })
  return { reviews: out, nextCursor }
}
