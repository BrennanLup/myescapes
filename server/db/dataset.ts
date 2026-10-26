/**
 * Phase 1 compatibility: the 3D room still speaks `Dataset` / `Entry` (src/contracts/types.ts).
 * These functions map a signed-in user's Postgres rows to and from those shapes, so the room
 * keeps working while workstream 20 moves it to the Phase 2 API. Also used by
 * scripts/migrate-phase1 (28) to import Phase 1 entries.
 *
 * Mapping: Room = a game (+ its venue), Review = one visit + my review on it.
 * Room.id = game id, Review.id = visit id.
 */
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { GENRES, type CrewMember, type Dataset, type Entry, type Genre, type Puzzle, type PuzzleType, type Review, type Room, type WishlistItem } from '../../src/contracts/types'
import type { Db } from './client'
import { games, reviews, users, venues, visitParticipants, visitPhotos, visitPuzzles, visits, wishlistItems } from './schema'
import { filterPuzzleIds } from '../routes/reviews.lib'
import { applyFacts, recordEdit, replacePuzzles } from '../routes/visits.lib'
import { citySlug, slugify, uniqueSlug } from './util'

const DEFAULT_SCORE = 50

function asGenre(g: string | null): Genre {
  return g && (GENRES as readonly string[]).includes(g) ? (g as Genre) : 'other'
}

/** The signed-in user's whole room in the Phase 1 shape. */
export async function datasetForUser(db: Db, userId: string): Promise<Dataset> {
  const mine = await db
    .select({ visit: visits, game: games, venue: venues })
    .from(visitParticipants)
    .innerJoin(visits, eq(visits.id, visitParticipants.visitId))
    .innerJoin(games, eq(games.id, visits.gameId))
    .innerJoin(venues, eq(venues.id, games.venueId))
    .where(and(eq(visitParticipants.userId, userId), inArray(visitParticipants.status, ['owner', 'accepted'])))
    .orderBy(asc(visits.date))

  const visitIds = mine.map((m) => m.visit.id)
  const [myReviews, puzzles, crew, photos, wish] = await Promise.all([
    visitIds.length ? db.select().from(reviews).where(and(inArray(reviews.visitId, visitIds), eq(reviews.authorId, userId))) : [],
    visitIds.length ? db.select().from(visitPuzzles).where(inArray(visitPuzzles.visitId, visitIds)).orderBy(asc(visitPuzzles.position)) : [],
    visitIds.length
      ? db
          .select({ visitId: visitParticipants.visitId, userId: visitParticipants.userId, guestName: visitParticipants.guestName, status: visitParticipants.status, name: users.name, displayName: users.displayName })
          .from(visitParticipants)
          .leftJoin(users, eq(users.id, visitParticipants.userId))
          .where(inArray(visitParticipants.visitId, visitIds))
          .orderBy(asc(visitParticipants.createdAt))
      : [],
    visitIds.length ? db.select({ id: visitPhotos.id, visitId: visitPhotos.visitId, caption: visitPhotos.caption }).from(visitPhotos).where(and(inArray(visitPhotos.visitId, visitIds), sql`${visitPhotos.hiddenAt} is null`)) : [],
    getWishlistForUser(db, userId),
  ])

  const rooms = new Map<string, Room>()
  const out: Review[] = []
  const crewNames = new Map<string, CrewMember>()
  for (const { visit, game, venue } of mine) {
    if (!rooms.has(game.id)) {
      rooms.set(game.id, {
        id: game.id,
        name: game.name,
        company: venue.brand || venue.name,
        city: venue.city,
        genre: asGenre(game.genre),
        address: venue.address,
        website: game.website ?? venue.website ?? '',
        photos: [],
      })
    }
    const r = myReviews.find((x) => x.visitId === visit.id)
    const names = crew
      .filter((c) => c.visitId === visit.id && c.userId !== userId && c.status !== 'declined')
      .map((c) => (c.userId ? c.displayName || c.name || 'Friend' : c.guestName || 'Guest'))
    for (const n of names) if (!crewNames.has(n.toLowerCase())) crewNames.set(n.toLowerCase(), { id: `crew_${slugify(n)}`, name: n })
    const vp = puzzles.filter((p) => p.visitId === visit.id)
    const memorable = new Set(r?.memorablePuzzleIds ?? [])
    const rating = (score: number | undefined, comment: string | undefined) => ({ score: score ?? DEFAULT_SCORE, comment: comment ?? '' })
    out.push({
      id: visit.id,
      roomId: game.id,
      date: visit.date,
      crew: names,
      ratings: {
        overall: rating(r?.overallScore, r?.overallComment),
        puzzles: rating(r?.puzzlesScore, r?.puzzlesComment),
        setting: rating(r?.settingScore, r?.settingComment),
        storyline: rating(r?.storylineScore, r?.storylineComment),
        difficulty: rating(r?.difficultyScore, r?.difficultyComment),
      },
      puzzles: vp.map((p): Puzzle => ({ id: p.id, reviewId: visit.id, description: p.description, type: p.type as PuzzleType, memorable: memorable.has(p.id) })),
      escaped: visit.escaped ?? false,
      escapeTimeMinutes: visit.escapeTimeMinutes,
      visibleTimer: visit.visibleTimer ?? false,
      multiRoom: visit.multiRoom ?? false,
      flashlights: visit.flashlights ?? false,
      liveActors: visit.liveActors ?? false,
      toolsUsed: visit.toolsUsed,
      voiceTranscript: r?.transcript ?? '',
      photos: photos.filter((p) => p.visitId === visit.id).map((p) => ({ url: `/api/photos/${p.id}`, caption: p.caption || undefined })),
    })
  }
  return {
    rooms: [...rooms.values()],
    reviews: out,
    wishlist: wish.map(({ gameId: _gameId, ...w }) => w),
    crew: [...crewNames.values()],
    source: 'postgres',
  }
}

/**
 * Save a Phase 1 entry for a user: find or create the venue (by name + city) and game, then
 * upsert the visit (keyed by `legacyId` = the entry's review id, or by visit id when the review
 * id already is one of this user's visits), the user's review and the puzzles.
 * Crew names become guest participants. Returns the entry as `datasetForUser` would show it.
 */
export async function saveEntryForUser(db: Db, userId: string, entry: Entry): Promise<Entry> {
  const { room, review } = entry
  const visitId = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db
    const venueName = room.company.trim() || room.name.trim()
    const cslug = citySlug(room.city, '', '')
    let venue = (
      await tx
        .select()
        .from(venues)
        .where(and(sql`lower(${venues.name}) = lower(${venueName})`, eq(venues.citySlug, cslug)))
        .limit(1)
    )[0]
    if (!venue) {
      const slug = await uniqueSlug(tx, venues, venues.slug, slugify(`${venueName} ${room.city}`))
      venue = (
        await tx
          .insert(venues)
          .values({ slug, name: venueName, brand: room.company || null, address: room.address, city: room.city, citySlug: cslug, region: '', country: 'ZZ', website: room.website || null, createdBy: userId })
          .returning()
      )[0]
    }
    let game = (
      await tx
        .select()
        .from(games)
        .where(and(eq(games.venueId, venue.id), sql`lower(${games.name}) = lower(${room.name})`))
        .limit(1)
    )[0]
    if (!game) {
      const slug = await uniqueSlug(tx, games, games.slug, slugify(`${room.name} ${venueName} ${room.city}`))
      game = (await tx.insert(games).values({ venueId: venue.id, slug, name: room.name, genre: room.genre, website: room.website || null, createdBy: userId }).returning())[0]
    }

    const facts = {
      gameId: game.id,
      date: review.date,
      escaped: review.escaped,
      escapeTimeMinutes: review.escapeTimeMinutes,
      visibleTimer: review.visibleTimer,
      multiRoom: review.multiRoom,
      flashlights: review.flashlights,
      liveActors: review.liveActors,
      toolsUsed: review.toolsUsed,
    }
    // The visit to update: one I'm still on (owner or accepted). By visit id (what datasetForUser
    // hands out), or by my own Phase 1 legacy id. A creator who left is not on it any more.
    const existing = (
      await tx
        .select({ visit: visits })
        .from(visits)
        .innerJoin(visitParticipants, and(eq(visitParticipants.visitId, visits.id), eq(visitParticipants.userId, userId)))
        .where(
          and(
            inArray(visitParticipants.status, ['owner', 'accepted']),
            sql`(${visits.id} = ${review.id} or (${visits.createdBy} = ${userId} and ${visits.legacyId} = ${review.id}))`,
          ),
        )
        .limit(1)
    )[0]?.visit
    let id: string
    let shared = false
    if (existing) {
      id = existing.id
      const others = await tx
        .select({ id: visitParticipants.id })
        .from(visitParticipants)
        .where(and(eq(visitParticipants.visitId, id), ne(visitParticipants.userId, userId), inArray(visitParticipants.status, ['owner', 'accepted'])))
        .limit(1)
      shared = others.length > 0
      // Shared facts go through the same path as PATCH /api/visits/:id (recorded as my edit).
      const { gameId: _g, ...rest } = facts
      const changes = await applyFacts(tx, existing, rest)
      // Moving a shared visit to another game would change it for the others too: only when it's mine alone.
      if (existing.gameId !== game.id && !shared) await tx.update(visits).set({ gameId: game.id }).where(eq(visits.id, id))
      // Phase 1 puzzles carry no notes: keep the stored ones.
      const notes = new Map((await tx.select({ id: visitPuzzles.id, notes: visitPuzzles.notes }).from(visitPuzzles).where(eq(visitPuzzles.visitId, id))).map((x) => [x.id, x.notes]))
      const p = await replacePuzzles(tx, id, review.puzzles.map((x) => ({ id: x.id, description: x.description, type: x.type, notes: notes.get(x.id) ?? '' })), userId)
      if (p.changed) changes.puzzles = { from: p.before, to: p.after }
      if (shared) {
        // Memorable ids on the others' reviews that point at removed puzzles are dropped.
        const rows = await tx.select({ id: reviews.id, ids: reviews.memorablePuzzleIds }).from(reviews).where(and(eq(reviews.visitId, id), ne(reviews.authorId, userId)))
        for (const r of rows) {
          const kept = await filterPuzzleIds(tx, id, r.ids)
          if (kept.length !== r.ids.length) await tx.update(reviews).set({ memorablePuzzleIds: kept }).where(eq(reviews.id, r.id))
        }
        if (Object.keys(changes).length) {
          await recordEdit(tx, id, userId, changes)
          await tx.update(visits).set({ updatedAt: new Date() }).where(eq(visits.id, id))
        }
      }
    } else {
      id = (await tx.insert(visits).values({ ...facts, createdBy: userId, legacyId: review.id }).returning({ id: visits.id }))[0].id
      await tx.insert(visitParticipants).values({ visitId: id, userId, status: 'owner', addedBy: userId })
      if (review.puzzles.length) {
        await tx.insert(visitPuzzles).values(review.puzzles.map((p, position) => ({ visitId: id, position, description: p.description, type: p.type, createdBy: userId })))
      }
    }

    // Guests: replace the plain-name participants I added with the entry's crew. Names other
    // people added stay.
    await tx.delete(visitParticipants).where(and(eq(visitParticipants.visitId, id), isNull(visitParticipants.userId), eq(visitParticipants.addedBy, userId)))
    const kept = new Set(
      (await tx.select({ n: visitParticipants.guestName }).from(visitParticipants).where(and(eq(visitParticipants.visitId, id), isNull(visitParticipants.userId)))).map((r) => (r.n ?? '').trim().toLowerCase()),
    )
    const me = (await tx.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, userId)))[0]
    const myNames = new Set([me?.name, me?.displayName].filter(Boolean).map((n) => n!.toLowerCase()))
    const guests = [...new Set(review.crew.map((c) => c.trim()).filter((c) => c && !myNames.has(c.toLowerCase()) && !kept.has(c.toLowerCase())))]
    if (guests.length) await tx.insert(visitParticipants).values(guests.map((guestName, i) => ({ visitId: id, guestName, status: 'accepted' as const, addedBy: userId, createdAt: new Date(Date.now() + i) })))

    // Stored puzzles in entry order (position = index), for my memorable picks.
    const stored = await tx.select({ id: visitPuzzles.id }).from(visitPuzzles).where(eq(visitPuzzles.visitId, id)).orderBy(asc(visitPuzzles.position), asc(visitPuzzles.createdAt))
    const memorable = review.puzzles.flatMap((p, i) => (p.memorable && stored[i] ? [stored[i].id] : []))

    const rv = {
      overallScore: review.ratings.overall.score,
      overallComment: review.ratings.overall.comment,
      puzzlesScore: review.ratings.puzzles.score,
      puzzlesComment: review.ratings.puzzles.comment,
      settingScore: review.ratings.setting.score,
      settingComment: review.ratings.setting.comment,
      storylineScore: review.ratings.storyline.score,
      storylineComment: review.ratings.storyline.comment,
      difficultyScore: review.ratings.difficulty.score,
      difficultyComment: review.ratings.difficulty.comment,
      transcript: review.voiceTranscript,
      memorablePuzzleIds: memorable,
      scoresCopied: false,
    }
    await tx
      .insert(reviews)
      .values({ visitId: id, authorId: userId, ...rv })
      .onConflictDoUpdate({ target: [reviews.visitId, reviews.authorId], set: rv })
    return id
  })
  const data = await datasetForUser(db, userId)
  const saved = data.reviews.find((r) => r.id === visitId)!
  return { room: data.rooms.find((r) => r.id === saved.roomId)!, review: saved }
}

export async function getWishlistForUser(db: Db, userId: string) {
  const rows = await db.select().from(wishlistItems).where(eq(wishlistItems.userId, userId)).orderBy(asc(wishlistItems.priority), asc(wishlistItems.createdAt))
  return rows.map((w) => ({ id: w.id, name: w.name, city: w.city, link: w.link, addedBy: w.addedBy, priority: w.priority, done: w.done, gameId: w.gameId }))
}

/** Replace the user's whole wish list. Item ids are kept when they are new or already the user's. */
export async function putWishlistForUser(db: Db, userId: string, items: (WishlistItem & { gameId?: string | null })[]) {
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db
    const ids = items.map((i) => i.id)
    // Ids owned by someone else must not be reused (they would collide with the primary key).
    const foreign = ids.length
      ? new Set(
          (await tx.select({ id: wishlistItems.id, userId: wishlistItems.userId }).from(wishlistItems).where(inArray(wishlistItems.id, ids)))
            .filter((r) => r.userId !== userId)
            .map((r) => r.id),
        )
      : new Set<string>()
    await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId))
    if (items.length) {
      await tx.insert(wishlistItems).values(
        items.map((i) => ({
          ...(foreign.has(i.id) ? {} : { id: i.id }),
          userId,
          name: i.name,
          city: i.city,
          link: i.link,
          addedBy: i.addedBy,
          priority: i.priority,
          done: i.done,
          gameId: i.gameId ?? null,
        })),
      )
    }
  })
  return getWishlistForUser(db, userId)
}
