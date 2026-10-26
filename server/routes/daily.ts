/**
 * Escape of the Day results API (workstream 23): today (server day per user), start, submit,
 * streak, friends leaderboard. Rules for the server day live in ./daily.logic.ts.
 *
 * - The puzzle for a day is created on first request and stored in `daily_puzzles`, so it never
 *   changes once someone has seen it: kind and seed come from the date (src/daily/engine), and
 *   the theme is a real game from the directory, picked by a hash of the date.
 * - A result row is created at the first play of a day (POST /api/daily/start), which fixes the
 *   time zone and start time. The submit completes it once (409 after that).
 * - The leaderboard shows me and my accepted friends, with no streaks (the privacy policy says a
 *   streak is visible only to its owner) and no grids.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { DailyPuzzle, DailyResult, DailyToday, LeaderboardEntry } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import { dailySpec, generateDaily, scoreResult, validateResultShape } from '../../src/daily/engine'
import { hashString } from '../../src/gate/rng'
import type { AppContext, SessionUser } from '../context'
import type { Db } from '../db/client'
import { dailyPuzzles, dailyResults, friendships, games, users, venues } from '../db/schema'
import { toPublicUser } from '../db/util'
import { defineRoute, httpError } from '../http'
import { computeStreak, resolveServerDay, type ServerDay } from './daily.logic'

type PuzzleRow = typeof dailyPuzzles.$inferSelect
type ResultRow = typeof dailyResults.$inferSelect

/** Picks the day's theme: an active game at an active venue, chosen by a hash of the date. */
async function pickTheme(db: Db, day: string): Promise<{ gameId: string; theme: NonNullable<PuzzleRow['theme']> } | null> {
  const active = and(eq(games.status, 'active'), eq(venues.status, 'active'))
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(games)
    .innerJoin(venues, eq(games.venueId, venues.id))
    .where(active)
  if (!n) return null
  const offset = hashString(`eotd-theme:${day}`) % n
  const row = (
    await db
      .select({ id: games.id, name: games.name, slug: games.slug, venueName: venues.name, city: venues.city })
      .from(games)
      .innerJoin(venues, eq(games.venueId, venues.id))
      .where(active)
      .orderBy(asc(games.id))
      .limit(1)
      .offset(offset)
  )[0]
  if (!row) return null
  return { gameId: row.id, theme: { gameName: row.name, venueName: row.venueName, city: row.city, gameSlug: row.slug } }
}

/** The stored puzzle for a day, created on first use. Concurrent callers get the same row. */
export async function getOrCreatePuzzle(db: Db, day: string): Promise<PuzzleRow> {
  const existing = (await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.day, day)).limit(1))[0]
  if (existing) return existing
  const spec = dailySpec(day)
  const theme = await pickTheme(db, day)
  await db
    .insert(dailyPuzzles)
    .values({ day, number: spec.number, kind: spec.kind, seed: spec.seed, maxGuesses: spec.maxGuesses, gameId: theme?.gameId ?? null, theme: theme?.theme ?? null })
    .onConflictDoNothing()
  const row = (await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.day, day)).limit(1))[0]
  if (!row) throw httpError('internal', 'Could not prepare today\'s puzzle.')
  return row
}

function toPuzzle(row: PuzzleRow): DailyPuzzle {
  const spec = dailySpec(row.day)
  return {
    day: row.day,
    number: row.number,
    kind: (['combination', 'cipher', 'sequence', 'search'] as const).find((k) => k === row.kind) ?? spec.kind,
    seed: row.seed,
    maxGuesses: row.maxGuesses,
    theme: row.theme ?? null,
  }
}

function toResult(row: ResultRow): DailyResult {
  return {
    day: row.day,
    number: row.number,
    solved: row.solved,
    guesses: row.guesses,
    hintsUsed: row.hintsUsed,
    timeMs: row.timeMs,
    grid: (row.grid ?? []) as DailyResult['grid'],
    score: row.score,
    timeZone: row.timeZone,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}

async function latestPlay(db: Db, userId: string): Promise<ResultRow | null> {
  return (await db.select().from(dailyResults).where(eq(dailyResults.userId, userId)).orderBy(desc(dailyResults.day)).limit(1))[0] ?? null
}

async function serverDayFor(db: Db, userId: string, requestedTz: string | null | undefined, now: Date): Promise<{ sd: ServerDay; row: ResultRow | null }> {
  const latest = await latestPlay(db, userId)
  const sd = resolveServerDay({ latest: latest ? { day: latest.day, timeZone: latest.timeZone } : null, requestedTz, now })
  return { sd, row: latest && latest.day === sd.day ? latest : null }
}

async function streakFor(db: Db, userId: string, today: string) {
  const rows = await db
    .select({ day: dailyResults.day, solved: dailyResults.solved, finishedAt: dailyResults.finishedAt, timeMs: dailyResults.timeMs })
    .from(dailyResults)
    .where(eq(dailyResults.userId, userId))
  return computeStreak(rows, today)
}

async function todayFor(db: Db, user: SessionUser, requestedTz: string | null | undefined, now: Date): Promise<DailyToday> {
  const { sd, row } = await serverDayFor(db, user.id, requestedTz, now)
  const puzzle = await getOrCreatePuzzle(db, sd.day)
  return {
    serverDay: sd.day,
    timeZone: sd.timeZone,
    puzzle: toPuzzle(puzzle),
    result: row ? toResult(row) : null,
    streak: await streakFor(db, user.id, sd.day),
    nextAt: sd.nextAt.toISOString(),
  }
}

/** Me plus my accepted friends (blocked and pending don't count). */
async function circleIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: friendships.userA, b: friendships.userB })
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userA, userId), eq(friendships.userB, userId))))
  return [userId, ...rows.map((r) => (r.a === userId ? r.b : r.a))]
}

export async function dailyRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.dailyToday, async ({ query, user }) => {
    const db = ctx.db()
    const now = ctx.now()
    if (user) return todayFor(db, user, query.tz, now)
    // Signed out: the puzzle for the zone sent, nothing stored.
    const sd = resolveServerDay({ latest: null, requestedTz: query.tz, now })
    const puzzle = await getOrCreatePuzzle(db, sd.day)
    return { serverDay: sd.day, timeZone: sd.timeZone, puzzle: toPuzzle(puzzle), result: null, streak: null, nextAt: sd.nextAt.toISOString() }
  })

  defineRoute(app, ctx, ROUTES.dailyStart, async ({ body, user }) => {
    const db = ctx.db()
    const now = ctx.now()
    const { sd, row } = await serverDayFor(db, user.id, body.tz, now)
    if (!row) {
      const puzzle = await getOrCreatePuzzle(db, sd.day)
      // Unique (user, day): a second, concurrent start is a no-op and the first one's zone stays.
      await db
        .insert(dailyResults)
        .values({ userId: user.id, day: sd.day, number: puzzle.number, timeZone: sd.timeZone, startedAt: now })
        .onConflictDoNothing()
    }
    return todayFor(db, user, body.tz, now)
  })

  defineRoute(app, ctx, ROUTES.dailySubmit, async ({ body, user }) => {
    const db = ctx.db()
    const now = ctx.now()
    const { sd, row } = await serverDayFor(db, user.id, null, now)
    if (body.day !== sd.day) throw httpError('wrong_day', `That result is for ${body.day}, but your day is ${sd.day}.`)
    if (!row) throw httpError('conflict', 'Start today\'s escape before sending a result.')
    if (row.finishedAt) throw httpError('conflict', 'You already finished today\'s escape. Come back tomorrow!')
    const puzzle = await getOrCreatePuzzle(db, sd.day)
    if (body.number !== puzzle.number) throw httpError('invalid', `Today is Escape #${puzzle.number}.`)
    const problem = validateResultShape(body, puzzle.maxGuesses)
    if (problem) throw httpError('invalid', problem)
    const slots = generateDaily(toPuzzle(puzzle)).slots
    if (body.grid.some((r) => !r.every((m) => m === 'hint') && r.length !== slots)) throw httpError('invalid', `Each guess row has ${slots} marks today.`)
    // The server's clock bounds the time: it can't be longer than since the recorded start.
    const elapsed = Math.max(0, now.getTime() - row.startedAt.getTime())
    const timeMs = Math.min(body.timeMs, elapsed)
    const score = scoreResult({ ...body, timeMs })
    const updated = await db
      .update(dailyResults)
      .set({ solved: body.solved, guesses: body.guesses, hintsUsed: body.hintsUsed, timeMs, score, grid: body.grid, finishedAt: now })
      .where(and(eq(dailyResults.id, row.id), isNull(dailyResults.finishedAt)))
      .returning()
    if (!updated[0]) throw httpError('conflict', 'You already finished today\'s escape. Come back tomorrow!')
    return { result: toResult(updated[0]), streak: await streakFor(db, user.id, sd.day) }
  })

  defineRoute(app, ctx, ROUTES.dailyStreak, async ({ user }) => {
    const db = ctx.db()
    const { sd } = await serverDayFor(db, user.id, null, ctx.now())
    return streakFor(db, user.id, sd.day)
  })

  defineRoute(app, ctx, ROUTES.dailyLeaderboard, async ({ query, user }) => {
    const db = ctx.db()
    const day = query.day ?? (await serverDayFor(db, user.id, null, ctx.now())).sd.day
    const ids = await circleIds(db, user.id)
    const rows = await db
      .select({
        solved: dailyResults.solved,
        guesses: dailyResults.guesses,
        timeMs: dailyResults.timeMs,
        score: dailyResults.score,
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        name: users.name,
        image: users.image,
      })
      .from(dailyResults)
      .innerJoin(users, eq(dailyResults.userId, users.id))
      .where(and(eq(dailyResults.day, day), inArray(dailyResults.userId, ids), isNotNull(dailyResults.finishedAt)))
      .orderBy(desc(dailyResults.solved), desc(dailyResults.score), asc(dailyResults.timeMs), asc(users.id))
    const entries: LeaderboardEntry[] = rows.map((r) => ({ user: toPublicUser(r), solved: r.solved, guesses: r.guesses, timeMs: r.timeMs, score: r.score }))
    return { day, entries }
  })
}
