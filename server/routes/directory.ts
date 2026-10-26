/**
 * Directory API (workstream 5): search, nearby, match, venue/game/city pages, user-contributed
 * venues and games. Queries live in directory.queries.ts; the committed Foursquare seed loads in
 * the background from directory.seed.ts once the database is ready.
 *
 * Contributions:
 * - Anyone signed in can add a venue or a game. An exact duplicate (same name in the same city, or
 *   a similar name under 75 m away; same name at the same venue for games) returns the existing one.
 * - The creator (and admins) can edit freely. Anyone else may only fill fields that are empty;
 *   their other changes are kept in `sources` as a suggestion for an admin.
 * - Every contribution is recorded in `sources` (source `user`, licence `user-contribution`).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Game, NewGame, NewVenue, Venue } from '../../src/contracts/models'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext, SessionUser } from '../context'
import type { Db } from '../db/client'
import { cities, games, sources, venues } from '../db/schema'
import { citySlug, googleMapsUrl, haversineKm, isUniqueViolation, slugify, uniqueSlug } from '../db/util'
import { defineRoute, httpError } from '../http'
import { gameAggregate, publicReviewPage, puzzleHighlights, wantsSpoilers } from './reviews.lib'
import {
  attributionFor,
  gamesAtVenue,
  hasTrgm,
  matchDirectory,
  nearbyVenues,
  rowsOf,
  searchGames,
  searchVenues,
  toGenre,
  venueSummaryById,
  venuesInCity,
} from './directory.queries'
import { seedLoaderEnabled, startDirectorySeedLoader } from './directory.seed'

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } }
const READ_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } }

type VenueRow = typeof venues.$inferSelect
type GameRow = typeof games.$inferSelect

export function toVenue(v: VenueRow): Venue {
  return {
    id: v.id, slug: v.slug, name: v.name, brand: v.brand, address: v.address, city: v.city, citySlug: v.citySlug, region: v.region,
    country: v.country, postalCode: v.postalCode, lat: v.lat, lng: v.lng, website: v.website, phone: v.phone,
    googlePlaceId: v.googlePlaceId, status: v.status,
  }
}

export function toGame(g: GameRow): Game {
  return {
    id: g.id, venueId: g.venueId, slug: g.slug, name: g.name, genre: toGenre(g.genre), minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    durationMinutes: g.durationMinutes, description: g.description, website: g.website, status: g.status,
  }
}

/** Only http(s) links are stored, so a page never renders a `javascript:` URL. */
export function safeWebsite(url: string | null | undefined): string | null {
  if (!url) return null
  const s = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    const u = new URL(s)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * A PATCH changes only the fields the client sent. The contract's partial schemas still fill
 * schema defaults (address and region default to ''), which would wipe them.
 */
export function sentKeys<T extends object>(parsed: T, raw: unknown): Partial<T> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<T> = {}
  for (const k of Object.keys(raw) as (keyof T)[]) if (k in parsed) out[k] = parsed[k]
  return out
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

async function ensureCity(db: Db, name: string, region: string, country: string, lat: number | null, lng: number | null): Promise<string> {
  const slug = citySlug(name, region, country)
  await db.insert(cities).values({ slug, name, region, country, lat, lng }).onConflictDoNothing({ target: cities.slug })
  return slug
}

async function recordContribution(db: Db, entityType: 'venue' | 'game', entityId: string, user: SessionUser, fields: Record<string, unknown>) {
  const existing = (
    await db
      .select({ id: sources.id, fields: sources.fields })
      .from(sources)
      .where(and(eq(sources.entityType, entityType), eq(sources.entityId, entityId), eq(sources.source, 'user'), eq(sources.sourceId, user.id)))
      .limit(1)
  )[0]
  if (existing) {
    const prev = existing.fields ?? {}
    const merged: Record<string, unknown> = { ...prev }
    for (const k of ['created', 'applied', 'suggested'] as const) {
      if (fields[k] && typeof fields[k] === 'object') merged[k] = { ...((prev[k] as object) ?? {}), ...(fields[k] as object) }
    }
    await db.update(sources).set({ fields: merged, fetchedAt: new Date() }).where(eq(sources.id, existing.id))
    return
  }
  await db.insert(sources).values({
    entityType, entityId, source: 'user', sourceId: user.id, license: 'user-contribution', attribution: 'My Escapes players', fields, userId: user.id,
  })
}

/** Splits a patch into fields to apply now and fields kept as a suggestion. */
export function splitPatch<T extends Record<string, unknown>>(current: T, patch: Partial<T>, canEdit: boolean): { apply: Partial<T>; suggest: Partial<T> } {
  const apply: Partial<T> = {}
  const suggest: Partial<T> = {}
  for (const [k, v] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (v === undefined) continue
    const cur = current[k]
    if (cur === v) continue
    const empty = cur == null || cur === ''
    if (canEdit || empty) apply[k] = v
    else suggest[k] = v
  }
  return { apply, suggest }
}

async function findDuplicateVenue(db: Db, v: { name: string; citySlug: string; country: string; lat: number | null; lng: number | null }): Promise<VenueRow | null> {
  const key = norm(v.name)
  const sameCity = await db
    .select()
    .from(venues)
    .where(and(eq(venues.citySlug, v.citySlug), eq(venues.country, v.country), sql`${venues.status} <> 'hidden'`, sql`lower(${venues.name}) = ${v.name.toLowerCase()}`))
    .limit(1)
  if (sameCity[0]) return sameCity[0]
  if (v.lat == null || v.lng == null) return null
  // Under ~75 m with a similar name.
  const d = 0.001
  const near = await db
    .select()
    .from(venues)
    .where(and(sql`${venues.status} <> 'hidden'`, sql`${venues.lat} between ${v.lat - d}::float8 and ${v.lat + d}::float8`, sql`${venues.lng} between ${v.lng - d * 2}::float8 and ${v.lng + d * 2}::float8`))
    .limit(50)
  const trgm = await hasTrgm(db)
  for (const n of near) {
    if (n.lat == null || n.lng == null || haversineKm(v.lat, v.lng, n.lat, n.lng) * 1000 > 75) continue
    if (norm(n.name) === key) return n
    if (trgm) {
      const sim = rowsOf<{ s: number }>(await db.execute(sql`select similarity(${n.name}::text, ${v.name}::text) as s`))[0]?.s ?? 0
      if (Number(sim) >= 0.5) return n
    }
  }
  return null
}

async function insertWithUniqueSlug<T>(db: Db, base: string, table: typeof venues | typeof games, insert: (slug: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await uniqueSlug(db, table, table.slug, attempt ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base)
    try {
      return await insert(slug)
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  }
  throw httpError('conflict', 'Could not pick a unique address for this page. Try again.')
}

async function createVenue(db: Db, user: SessionUser, body: NewVenue): Promise<Venue> {
  const lat = body.lat ?? null
  const lng = body.lng ?? null
  if ((lat == null) !== (lng == null)) throw httpError('invalid', 'Give both latitude and longitude, or neither.')
  const region = body.region ?? ''
  const cSlug = citySlug(body.city, region, body.country)
  const dup = await findDuplicateVenue(db, { name: body.name, citySlug: cSlug, country: body.country, lat, lng })
  if (dup) return toVenue(dup)
  await ensureCity(db, body.city, region, body.country, lat, lng)
  const nameSlug = slugify(body.name, 60)
  const city = slugify(body.city, 40)
  const base = nameSlug.includes(city) ? nameSlug : slugify(`${body.name} ${body.city}`, 100)
  const row = await insertWithUniqueSlug(db, base, venues, async (slug) =>
    (
      await db
        .insert(venues)
        .values({
          slug, name: body.name, brand: body.brand ?? null, address: body.address ?? '', city: body.city, citySlug: cSlug, region, country: body.country,
          postalCode: body.postalCode ?? null, lat, lng, website: safeWebsite(body.website), phone: body.phone ?? null, createdBy: user.id,
        })
        .returning()
    )[0],
  )
  await recordContribution(db, 'venue', row.id, user, { created: { ...body } })
  return toVenue(row)
}

async function updateVenue(db: Db, user: SessionUser, id: string, patch: Partial<NewVenue>): Promise<Venue> {
  const v = (await db.select().from(venues).where(eq(venues.id, id)).limit(1))[0]
  if (!v || v.status === 'hidden') throw httpError('not_found', 'No such venue.')
  const canEdit = user.isAdmin || v.createdBy === user.id
  const cleaned: Partial<VenueRow> = {}
  for (const [k, val] of Object.entries(patch)) {
    if (val === undefined) continue
    ;(cleaned as Record<string, unknown>)[k] = k === 'website' ? safeWebsite(val as string | null) : val
  }
  if (('lat' in cleaned) !== ('lng' in cleaned)) throw httpError('invalid', 'Give both latitude and longitude, or neither.')
  const { apply, suggest } = splitPatch(v as unknown as Record<string, unknown>, cleaned as Record<string, unknown>, canEdit)
  if (apply.lat !== undefined || apply.lng !== undefined) {
    // Coordinates move together.
    apply.lat = cleaned.lat ?? null
    apply.lng = cleaned.lng ?? null
  }
  let updated = v
  if (Object.keys(apply).length) {
    const next = { ...v, ...(apply as Partial<VenueRow>) }
    if (apply.city !== undefined || apply.region !== undefined || apply.country !== undefined) {
      next.citySlug = await ensureCity(db, next.city, next.region, next.country, next.lat, next.lng)
    }
    updated = (
      await db
        .update(venues)
        .set({
          name: next.name, brand: next.brand, address: next.address, city: next.city, citySlug: next.citySlug, region: next.region, country: next.country,
          postalCode: next.postalCode, lat: next.lat, lng: next.lng, website: next.website, phone: next.phone,
        })
        .where(eq(venues.id, id))
        .returning()
    )[0]
  }
  if (Object.keys(apply).length || Object.keys(suggest).length) {
    await recordContribution(db, 'venue', id, user, {
      ...(Object.keys(apply).length ? { applied: apply } : {}),
      ...(Object.keys(suggest).length ? { suggested: suggest } : {}),
    })
  }
  return toVenue(updated)
}

function checkPlayers(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && min > max) throw httpError('invalid', 'Minimum players is more than maximum players.')
}

async function createGame(db: Db, user: SessionUser, body: NewGame): Promise<Game> {
  const v = (await db.select().from(venues).where(eq(venues.id, body.venueId)).limit(1))[0]
  if (!v || v.status === 'hidden') throw httpError('not_found', 'No such venue.')
  checkPlayers(body.minPlayers, body.maxPlayers)
  const existing = (
    await db
      .select()
      .from(games)
      .where(and(eq(games.venueId, v.id), sql`lower(${games.name}) = ${body.name.toLowerCase()}`))
      .limit(1)
  )[0]
  if (existing) {
    if (existing.status === 'hidden') throw httpError('conflict', 'This game was removed by a moderator.')
    return toGame(existing)
  }
  const base = slugify(`${body.name} ${v.name.toLowerCase().includes(v.city.toLowerCase()) ? v.name : `${v.name} ${v.city}`}`, 110)
  try {
    const row = await insertWithUniqueSlug(db, base, games, async (slug) =>
      (
        await db
          .insert(games)
          .values({
            venueId: v.id, slug, name: body.name, genre: body.genre ?? null, minPlayers: body.minPlayers ?? null, maxPlayers: body.maxPlayers ?? null,
            durationMinutes: body.durationMinutes ?? null, description: body.description ?? null, website: safeWebsite(body.website), createdBy: user.id,
          })
          .returning()
      )[0],
    )
    await recordContribution(db, 'game', row.id, user, { created: { ...body } })
    return toGame(row)
  } catch (err) {
    // Two people adding the same game at once: the unique (venue, lower(name)) index decides.
    const again = (await db.select().from(games).where(and(eq(games.venueId, v.id), sql`lower(${games.name}) = ${body.name.toLowerCase()}`)).limit(1))[0]
    if (again) return toGame(again)
    throw err
  }
}

async function updateGame(db: Db, user: SessionUser, id: string, patch: Partial<Omit<NewGame, 'venueId'>>): Promise<Game> {
  const g = (await db.select().from(games).where(eq(games.id, id)).limit(1))[0]
  if (!g || g.status === 'hidden') throw httpError('not_found', 'No such game.')
  const canEdit = user.isAdmin || g.createdBy === user.id
  const cleaned: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(patch)) if (val !== undefined) cleaned[k] = k === 'website' ? safeWebsite(val as string | null) : val
  const { apply, suggest } = splitPatch(g as unknown as Record<string, unknown>, cleaned, canEdit)
  const next = { ...g, ...(apply as Partial<GameRow>) }
  checkPlayers(next.minPlayers, next.maxPlayers)
  let updated = g
  if (Object.keys(apply).length) {
    try {
      updated = (
        await db
          .update(games)
          .set({
            name: next.name, genre: next.genre, minPlayers: next.minPlayers, maxPlayers: next.maxPlayers, durationMinutes: next.durationMinutes,
            description: next.description, website: next.website,
          })
          .where(eq(games.id, id))
          .returning()
      )[0]
    } catch (err) {
      if (isUniqueViolation(err)) throw httpError('conflict', 'This venue already has a game with that name.')
      throw err
    }
  }
  if (Object.keys(apply).length || Object.keys(suggest).length) {
    await recordContribution(db, 'game', id, user, {
      ...(Object.keys(apply).length ? { applied: apply } : {}),
      ...(Object.keys(suggest).length ? { suggested: suggest } : {}),
    })
  }
  return toGame(updated)
}

export async function directoryRoutes(app: FastifyInstance, ctx: AppContext) {
  if (seedLoaderEnabled(ctx.env)) {
    let stop: (() => void) | null = null
    app.addHook('onReady', async () => {
      stop = startDirectorySeedLoader(ctx)
    })
    app.addHook('onClose', async () => {
      stop?.()
    })
  }

  defineRoute(
    app,
    ctx,
    ROUTES.directorySearch,
    async ({ query }) => {
      const db = ctx.db()
      const limit = query.limit ?? 10
      const [v, g] = await Promise.all([searchVenues(db, { ...query, limit }), searchGames(db, { ...query, limit })])
      return { venues: v, games: g }
    },
    { config: READ_LIMIT },
  )

  defineRoute(app, ctx, ROUTES.directoryNearby, async ({ query }) => ({ venues: await nearbyVenues(ctx.db(), query) }), { config: READ_LIMIT })

  defineRoute(app, ctx, ROUTES.directoryMatch, async ({ query }) => matchDirectory(ctx.db(), query), { config: READ_LIMIT })

  defineRoute(app, ctx, ROUTES.venuePage, async ({ params }) => {
    const db = ctx.db()
    const v = (await db.select().from(venues).where(eq(venues.slug, params.slug)).limit(1))[0]
    if (!v || v.status === 'hidden') throw httpError('not_found', 'No such venue.')
    const list = await gamesAtVenue(db, v.id)
    return {
      venue: toVenue(v),
      games: list,
      attribution: await attributionFor(db, [{ type: 'venue', ids: [v.id] }]),
      googleMapsUrl: googleMapsUrl(v.googlePlaceId, v.name),
    }
  })

  defineRoute(app, ctx, ROUTES.cityPage, async ({ params }) => {
    const db = ctx.db()
    const c = (await db.select().from(cities).where(eq(cities.slug, params.slug)).limit(1))[0]
    if (!c) throw httpError('not_found', 'No such city.')
    const list = await venuesInCity(db, c.slug)
    if (!list.length) throw httpError('not_found', 'No such city.')
    return {
      city: { slug: c.slug, name: c.name, region: c.region, country: c.country, lat: c.lat, lng: c.lng },
      venues: list,
      attribution: await attributionFor(db, [{ type: 'venue', ids: list.map((v) => v.id) }]),
    }
  })

  defineRoute(app, ctx, ROUTES.gamePage, async ({ params, user, req }) => {
    const db = ctx.db()
    const g = (await db.select().from(games).where(eq(games.slug, params.slug)).limit(1))[0]
    if (!g || g.status === 'hidden') throw httpError('not_found', 'No such game.')
    const venue = await venueSummaryById(db, g.venueId)
    if (!venue || venue.status === 'hidden') throw httpError('not_found', 'No such game.')
    const placeId = (await db.select({ p: venues.googlePlaceId }).from(venues).where(eq(venues.id, g.venueId)).limit(1))[0]?.p ?? null
    const [aggregate, puzzles, reviews, attribution] = await Promise.all([
      // One visibility, spoiler and copied-score rule for the game page and GET /api/games/:slug/reviews
      // (reviews.lib.ts), so the first page's nextCursor continues on the paged endpoint.
      gameAggregate(db, g.id),
      puzzleHighlights(db, g.id, { reveal: wantsSpoilers(req.query) }),
      publicReviewPage(db, g.id, user?.id ?? null, { revealSpoilers: wantsSpoilers(req.query) }),
      attributionFor(db, [
        { type: 'game', ids: [g.id] },
        { type: 'venue', ids: [g.venueId] },
      ]),
    ])
    return { game: toGame(g), venue, aggregate, puzzles, reviews, attribution, googleMapsUrl: googleMapsUrl(placeId, venue.name) }
  })

  defineRoute(app, ctx, ROUTES.createVenue, async ({ user, body }) => createVenue(ctx.db(), user, body), { config: WRITE_LIMIT })
  defineRoute(app, ctx, ROUTES.updateVenue, async ({ user, params, body, req }) => updateVenue(ctx.db(), user, params.id, sentKeys(body, req.body)), { config: WRITE_LIMIT })
  defineRoute(app, ctx, ROUTES.createGame, async ({ user, body }) => createGame(ctx.db(), user, body), { config: WRITE_LIMIT })
  defineRoute(app, ctx, ROUTES.updateGame, async ({ user, params, body, req }) => updateGame(ctx.db(), user, params.id, sentKeys(body, req.body)), { config: WRITE_LIMIT })
}
