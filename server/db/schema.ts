/**
 * Drizzle schema for every Phase 2 table. Owned by workstream 2 (foundation).
 *
 * Conventions:
 * - Ids are text. Better Auth creates its own ids; our tables default to a prefixed random id.
 * - Timestamps are `timestamptz`; calendar days are `date` in string mode (`YYYY-MM-DD`).
 * - Column names are snake_case in SQL and camelCase in TypeScript.
 * - Better Auth tables use plural names (`usePlural: true` in the Drizzle adapter) and the
 *   field names Better Auth expects (`emailVerified`, `expiresAt`, `providerId`, ...).
 *
 * Changing this file? Run `npm run db:generate` to write a new migration in server/db/migrations,
 * and commit both. Never edit a migration that has shipped.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { randomBytes } from 'node:crypto'

/** `prefix_` + 20 url-safe random chars. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(15).toString('base64url')}`
}

const id = (prefix: string) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId(prefix))
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/** Raw bytes (photos). pg returns Buffer, PGlite returns Uint8Array: both are Uint8Array. */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
})

// ---------------------------------------------------------------------------
// Better Auth (workstream 3): users, sessions, accounts, verifications
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Google profile name. Public pages use `displayName` instead. */
    name: text('name').notNull(),
    /** Never shown publicly (privacy policy). */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // --- My Escapes additions (Better Auth `user.additionalFields`) ---
    /** Lowercase @handle, unique. Null until onboarding. */
    handle: text('handle'),
    displayName: text('display_name'),
    isAdmin: boolean('is_admin').notNull().default(false),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_handle_lower_uq').on(sql`lower(${t.handle})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId), uniqueIndex('accounts_provider_uq').on(t.providerId, t.accountId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

// ---------------------------------------------------------------------------
// Directory (workstreams 5-9): cities, venues, games, sources
// ---------------------------------------------------------------------------

export const ENTITY_STATUS = ['active', 'closed', 'hidden'] as const

export const cities = pgTable(
  'cities',
  {
    /** `san-francisco-ca-us` */
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    region: text('region').notNull().default(''),
    country: text('country').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt: createdAt(),
  },
  (t) => [index('cities_country_idx').on(t.country)],
)

export const venues = pgTable(
  'venues',
  {
    id: id('ven'),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    brand: text('brand'),
    address: text('address').notNull().default(''),
    city: text('city').notNull(),
    citySlug: text('city_slug').notNull(),
    region: text('region').notNull().default(''),
    /** ISO 3166-1 alpha-2, uppercase. */
    country: text('country').notNull(),
    postalCode: text('postal_code'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    website: text('website'),
    phone: text('phone'),
    /** The only Google Places field we may store. */
    googlePlaceId: text('google_place_id'),
    fsqId: text('fsq_id'),
    osmId: text('osm_id'),
    status: text('status', { enum: ENTITY_STATUS }).notNull().default('active'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('venues_fsq_uq').on(t.fsqId),
    uniqueIndex('venues_osm_uq').on(t.osmId),
    index('venues_city_idx').on(t.country, t.citySlug),
    index('venues_latlng_idx').on(t.lat, t.lng),
    index('venues_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

export const games = pgTable(
  'games',
  {
    id: id('gam'),
    venueId: text('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** One of GENRES (src/contracts/types.ts), or null when unknown. */
    genre: text('genre'),
    minPlayers: integer('min_players'),
    maxPlayers: integer('max_players'),
    durationMinutes: integer('duration_minutes'),
    description: text('description'),
    website: text('website'),
    status: text('status', { enum: ENTITY_STATUS }).notNull().default('active'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('games_venue_idx').on(t.venueId),
    uniqueIndex('games_venue_name_uq').on(t.venueId, sql`lower(${t.name})`),
    index('games_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

export const DIRECTORY_SOURCE = ['foursquare', 'osm', 'user', 'google'] as const

/** Where each fact came from (licensing and attribution). One row per entity per source record. */
export const sources = pgTable(
  'sources',
  {
    id: id('src'),
    entityType: text('entity_type', { enum: ['venue', 'game'] }).notNull(),
    entityId: text('entity_id').notNull(),
    source: text('source', { enum: DIRECTORY_SOURCE }).notNull(),
    /** Foursquare fsq_id, OSM `node/123`, Google place id, or the contributing user id. */
    sourceId: text('source_id').notNull(),
    /** e.g. `Apache-2.0`, `ODbL-1.0`, `user-contribution`. */
    license: text('license').notNull(),
    attribution: text('attribution').notNull().default(''),
    /** The fields this source supplied, as imported. */
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sources_entity_source_uq').on(t.entityType, t.entityId, t.source, t.sourceId),
    index('sources_entity_idx').on(t.entityType, t.entityId),
  ],
)

// ---------------------------------------------------------------------------
// Visits (shared) and reviews (personal) (workstreams 32-34)
// ---------------------------------------------------------------------------

export const visits = pgTable(
  'visits',
  {
    id: id('vis'),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** Set null when the creator deletes their account (the visit stays for the others). */
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    escaped: boolean('escaped'),
    escapeTimeMinutes: real('escape_time_minutes'),
    visibleTimer: boolean('visible_timer'),
    multiRoom: boolean('multi_room'),
    flashlights: boolean('flashlights'),
    liveActors: boolean('live_actors'),
    toolsUsed: jsonb('tools_used').$type<string[]>().notNull().default([]),
    /** Phase 1 review id when imported by scripts/migrate-phase1 (idempotent re-runs). */
    legacyId: text('legacy_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('visits_game_date_idx').on(t.gameId, t.date),
    index('visits_created_by_idx').on(t.createdBy),
    uniqueIndex('visits_legacy_uq').on(t.createdBy, t.legacyId),
  ],
)

export const PARTICIPANT_STATUS = ['owner', 'accepted', 'pending', 'declined'] as const

export const visitParticipants = pgTable(
  'visit_participants',
  {
    id: id('par'),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    /** Null for guests, and for users whose account was deleted (their name moves to guestName first). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestName: text('guest_name'),
    status: text('status', { enum: PARTICIPANT_STATUS }).notNull(),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('visit_participants_user_uq').on(t.visitId, t.userId),
    index('visit_participants_user_idx').on(t.userId, t.status),
    index('visit_participants_guest_idx').on(sql`lower(${t.guestName})`),
    check('visit_participants_who_ck', sql`${t.userId} is not null or ${t.guestName} is not null`),
  ],
)

export const VISIBILITY = ['public', 'friends', 'private'] as const

export const reviews = pgTable(
  'reviews',
  {
    id: id('rev'),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    overallScore: integer('overall_score').notNull(),
    overallComment: text('overall_comment').notNull().default(''),
    puzzlesScore: integer('puzzles_score').notNull(),
    puzzlesComment: text('puzzles_comment').notNull().default(''),
    settingScore: integer('setting_score').notNull(),
    settingComment: text('setting_comment').notNull().default(''),
    storylineScore: integer('storyline_score').notNull(),
    storylineComment: text('storyline_comment').notNull().default(''),
    difficultyScore: integer('difficulty_score').notNull(),
    difficultyComment: text('difficulty_comment').notNull().default(''),
    /** Voice transcript. Visible only to the author. */
    transcript: text('transcript').notNull().default(''),
    memorablePuzzleIds: jsonb('memorable_puzzle_ids').$type<string[]>().notNull().default([]),
    visibility: text('visibility', { enum: VISIBILITY }).notNull().default('public'),
    containsSpoilers: boolean('contains_spoilers').notNull().default(false),
    /** True until the author changes at least one score of a copied review. Excluded from averages. */
    scoresCopied: boolean('scores_copied').notNull().default(false),
    copiedFromReviewId: text('copied_from_review_id'),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenReason: text('hidden_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('reviews_visit_author_uq').on(t.visitId, t.authorId),
    index('reviews_author_idx').on(t.authorId),
    check(
      'reviews_scores_ck',
      sql`${t.overallScore} between 1 and 100 and ${t.puzzlesScore} between 1 and 100 and ${t.settingScore} between 1 and 100 and ${t.storylineScore} between 1 and 100 and ${t.difficultyScore} between 1 and 100`,
    ),
  ],
)

export const visitPuzzles = pgTable(
  'visit_puzzles',
  {
    id: id('pzl'),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    description: text('description').notNull(),
    /** One of PUZZLE_TYPES. */
    type: text('type').notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('visit_puzzles_visit_idx').on(t.visitId, t.position)],
)

export const visitPhotos = pgTable(
  'visit_photos',
  {
    id: id('pho'),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    /** Account deletion removes the person's photos. */
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    caption: text('caption').notNull().default(''),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('visit_photos_visit_idx').on(t.visitId)],
)

export const visitEdits = pgTable(
  'visit_edits',
  {
    id: id('edt'),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    editorId: text('editor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Display name at edit time, so history still reads "edited by Mia" after deletion. */
    editorName: text('editor_name').notNull().default(''),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('visit_edits_visit_idx').on(t.visitId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Friends, invites, notifications (workstreams 31, 34, 35)
// ---------------------------------------------------------------------------

export const FRIENDSHIP_STATUS = ['pending', 'accepted', 'blocked'] as const

/** One row per pair, stored with `userA < userB` (compare ids as strings). */
export const friendships = pgTable(
  'friendships',
  {
    id: id('frd'),
    userA: text('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: text('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: FRIENDSHIP_STATUS }).notNull(),
    requestedBy: text('requested_by').notNull(),
    blockedBy: text('blocked_by'),
    /** A auto-accepts tags from B. Off by default. */
    aAutoAccepts: boolean('a_auto_accepts').notNull().default(false),
    /** B auto-accepts tags from A. Off by default. */
    bAutoAccepts: boolean('b_auto_accepts').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('friendships_pair_uq').on(t.userA, t.userB),
    index('friendships_b_idx').on(t.userB),
    check('friendships_order_ck', sql`${t.userA} < ${t.userB}`),
  ],
)

export const invites = pgTable(
  'invites',
  {
    code: text('code').primaryKey(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guestName: text('guest_name'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_inviter_idx').on(t.inviterId)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: id('ntf'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** One of NOTIFICATION_TYPES (src/contracts/models.ts). */
    type: text('type').notNull(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    visitId: text('visit_id').references(() => visits.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Wish list (workstream 4)
// ---------------------------------------------------------------------------

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: id('wsh'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    city: text('city').notNull().default(''),
    link: text('link').notNull().default(''),
    addedBy: text('added_by').notNull().default(''),
    priority: integer('priority').notNull().default(0),
    done: boolean('done').notNull().default(false),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('wishlist_user_idx').on(t.userId, t.priority)],
)

// ---------------------------------------------------------------------------
// Escape of the Day (workstreams 21-23)
// ---------------------------------------------------------------------------

export const dailyPuzzles = pgTable('daily_puzzles', {
  day: date('day', { mode: 'string' }).primaryKey(),
  number: integer('number').notNull().unique(),
  /** One of DAILY_KINDS. */
  kind: text('kind').notNull(),
  seed: text('seed').notNull(),
  maxGuesses: integer('max_guesses').notNull().default(6),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  theme: jsonb('theme').$type<{ gameName: string; venueName: string; city: string; gameSlug: string | null } | null>(),
  createdAt: createdAt(),
})

/**
 * One row per user per server day. Created at the first play (fixing `timeZone` and `startedAt`),
 * completed by the result submit (`finishedAt`).
 */
export const dailyResults = pgTable(
  'daily_results',
  {
    id: id('dly'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    number: integer('number').notNull(),
    timeZone: text('time_zone').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    solved: boolean('solved').notNull().default(false),
    guesses: integer('guesses').notNull().default(0),
    hintsUsed: integer('hints_used').notNull().default(0),
    timeMs: integer('time_ms').notNull().default(0),
    score: integer('score').notNull().default(0),
    grid: jsonb('grid').$type<string[][]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('daily_results_user_day_uq').on(t.userId, t.day), index('daily_results_day_idx').on(t.day)],
)

// ---------------------------------------------------------------------------
// Moderation (workstream 25)
// ---------------------------------------------------------------------------

export const reports = pgTable(
  'reports',
  {
    id: id('rpt'),
    reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: text('target_type', { enum: ['review', 'photo', 'game', 'venue'] }).notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note').notNull().default(''),
    status: text('status', { enum: ['open', 'hidden', 'dismissed'] }).notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('reports_status_idx').on(t.status, t.createdAt), index('reports_target_idx').on(t.targetType, t.targetId)],
)

// ---------------------------------------------------------------------------
// Spending caps (workstreams 10, 11). See server/db/usage.ts.
// ---------------------------------------------------------------------------

/** Daily counters. `subject` is a user id, or `__global__` for the app-wide ceiling. No FK on purpose. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    subject: text('subject').notNull(),
    /** UTC day. */
    day: date('day', { mode: 'string' }).notNull(),
    /** `transcription` (seconds) or `extraction` (calls). */
    kind: text('kind', { enum: ['transcription', 'extraction'] }).notNull(),
    amount: integer('amount').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.subject, t.day, t.kind] })],
)

export const GLOBAL_SUBJECT = '__global__'
