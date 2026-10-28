/**
 * Phase 2 HTTP API: every route, with its method, path, auth level, request schemas
 * (params, query, body) and response schema. The server validates requests with these
 * schemas; `callApi` validates responses on the client.
 *
 * Paths use Fastify syntax (`/api/games/:slug`). All bodies are JSON unless `body` is
 * `'multipart'`. Errors are `ApiError` (src/contracts/errors.ts).
 *
 * Phase 1 routes (`/api/data`, `/api/entries`, `/api/wishlist`, `/api/extract`, `/api/status`)
 * stay in `api.ts`; this file re-lists the ones that change shape.
 *
 * Owned by the orchestrator (workstream 1). Request changes; don't edit.
 */
import { z } from 'zod'
import { ApiCallError, ApiErrorSchema } from './errors'
import {
  AccountExportSchema,
  CityPageSchema,
  CrewSuggestionSchema,
  CrewTagSchema,
  DailyResultInputSchema,
  DailyResultSchema,
  DailyTodaySchema,
  DisplayNameSchema,
  FriendRequestSchema,
  FriendSchema,
  GamePageSchema,
  GameMatchSchema,
  GameSchema,
  GuestClaimSchema,
  HandleSchema,
  InvitePreviewSchema,
  InviteSchema,
  IsoDate,
  LeaderboardEntrySchema,
  LogRowSchema,
  MeSchema,
  MergeCandidateSchema,
  NewGameSchema,
  NewVenueSchema,
  NotificationSchema,
  PendingTagSchema,
  PhotoV2Schema,
  PublicUserSchema,
  RelationSchema,
  SpoilerFilterSchema,
  EnrichStartSchema,
  EnrichStatusSchema,
  ReportInputSchema,
  ReportSchema,
  ReviewInputSchema,
  ReviewPageSchema,
  ReviewV2Schema,
  StreakSchema,
  UsageSummarySchema,
  VenueMatchSchema,
  VenuePageSchema,
  VenueSchema,
  VenueSummarySchema,
  GameSummarySchema,
  VisibilitySchema,
  VisitDetailSchema,
  VisitEditSchema,
  VisitFactsSchema,
  VisitPuzzleInputSchema,
  WishlistItemV2Schema,
} from './models'
import { HomeViewSchema, PresenceListSchema } from './realtime'
import { DatasetSchema, EntryInputSchema, EntrySchema, ReviewDraftSchema } from './types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * - `public`: anyone, signed in or not.
 * - `optional`: anyone; the response depends on whether a user is signed in.
 * - `user`: a signed-in user (401 `unauthorized` otherwise).
 * - `admin`: a signed-in admin (403 `forbidden` otherwise).
 * - `test`: exists only when NODE_ENV=test (404 in every other environment).
 */
export type RouteAuth = 'public' | 'optional' | 'user' | 'admin' | 'test'

export interface RouteSpec {
  method: HttpMethod
  path: string
  auth: RouteAuth
  /** Workstream that implements it (docs/PHASE2_PLAN.md). */
  ws: number
  summary: string
  params?: z.ZodType
  query?: z.ZodType
  /** JSON body schema, or `'multipart'` for file uploads (fields documented in `summary`). */
  body?: z.ZodType | 'multipart'
  response: z.ZodType
  /** Success status (default 200). */
  status?: number
}

const route = <const S extends RouteSpec>(spec: S): S => spec

const Ok = z.object({ ok: z.literal(true) })
const IdParams = z.object({ id: z.string().min(1) })
const SlugParams = z.object({ slug: z.string().min(1) })
const CodeParams = z.object({ code: z.string().min(1) })
const UserIdParams = z.object({ userId: z.string().min(1) })
const Cursor = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() })
/** `filter`: spoiler filter. `spoilers=1`: include the comments of spoiler-flagged reviews. */
const ReviewListQuery = Cursor.extend({ filter: SpoilerFilterSchema.optional(), spoilers: z.string().max(8).optional() })
const TimeZoneQuery = z.object({ tz: z.string().max(64).optional() })

/** Phase 2 status. Replaces Phase 1's `storage: google-sheet | seed`. */
export const ServerStatusV2Schema = z.object({
  extraction: z.enum(['claude', 'mock']),
  transcription: z.enum(['openai', 'mock']),
  /** `postgres` (DATABASE_URL), `pglite` (in-process, local runs and tests) or `none`. */
  storage: z.enum(['postgres', 'pglite', 'none']),
  database: z.enum(['ready', 'migrating', 'unavailable', 'none']),
  auth: z.enum(['google', 'test', 'disabled']),
  version: z.string(),
})
export type ServerStatusV2 = z.infer<typeof ServerStatusV2Schema>

export const ROUTES = {
  // -------------------------------------------------------------------------
  // Platform (27)
  // -------------------------------------------------------------------------
  health: route({ method: 'GET', path: '/health', auth: 'public', ws: 27, summary: 'Liveness. Never touches the database.', response: z.object({ ok: z.literal(true) }) }),
  status: route({ method: 'GET', path: '/api/status', auth: 'public', ws: 27, summary: 'Which features are real or mocked, and database state.', response: ServerStatusV2Schema }),

  // -------------------------------------------------------------------------
  // Auth (3). Better Auth itself is mounted at /api/auth/* (sign-in, callback, sign-out, get-session).
  // -------------------------------------------------------------------------
  testLogin: route({
    method: 'POST', path: '/api/test/login', auth: 'test', ws: 3,
    summary: 'Test-only sign-in (NODE_ENV=test). Creates the user if needed and sets the session cookie.',
    body: z.object({ email: z.string().email(), name: z.string().min(1).max(60).optional(), handle: z.string().optional(), isAdmin: z.boolean().optional() }),
    response: z.object({ user: MeSchema }),
  }),

  // -------------------------------------------------------------------------
  // Account, profile, export, deletion (4)
  // -------------------------------------------------------------------------
  me: route({ method: 'GET', path: '/api/me', auth: 'user', ws: 4, summary: 'The signed-in user.', response: MeSchema }),
  updateMe: route({
    method: 'PATCH', path: '/api/me', auth: 'user', ws: 4,
    summary: 'Set display name and/or @handle (onboarding). 409 handle_taken when taken or reserved.',
    body: z.object({ displayName: DisplayNameSchema.optional(), handle: HandleSchema.optional() }),
    response: MeSchema,
  }),
  handleAvailable: route({
    method: 'GET', path: '/api/handles/:handle', auth: 'public', ws: 4,
    summary: 'Is this @handle free? (case-insensitive, reserved names are never available)',
    params: z.object({ handle: z.string() }),
    response: z.object({ handle: z.string(), available: z.boolean(), reason: z.enum(['taken', 'reserved', 'invalid']).nullable() }),
  }),
  exportMe: route({ method: 'GET', path: '/api/me/export', auth: 'user', ws: 4, summary: 'Download all my data as JSON (Content-Disposition: attachment).', response: AccountExportSchema }),
  deleteMe: route({
    method: 'DELETE', path: '/api/me', auth: 'user', ws: 4,
    summary: 'Delete my account: reviews, photos, voice notes, friendships, wishlist, results removed; my tags on shared visits become plain names. Signs out.',
    body: z.object({ confirm: z.literal('DELETE') }),
    response: z.object({ deleted: z.literal(true) }),
  }),
  usage: route({ method: 'GET', path: '/api/me/usage', auth: 'user', ws: 10, summary: 'My spending-cap meters for today.', response: UsageSummarySchema }),

  // -------------------------------------------------------------------------
  // My rooms and wish list (4)
  // -------------------------------------------------------------------------
  logs: route({
    method: 'GET', path: '/api/logs', auth: 'user', ws: 4,
    summary: 'My room: every visit I own or accepted, newest first, with my review and crew.',
    query: z.object({ with: z.string().optional(), without: z.string().optional() }),
    response: z.object({ rows: z.array(LogRowSchema) }),
  }),
  /** Phase 1 shape for the 3D room: the signed-in user's data, or the seed demo when signed out. */
  data: route({ method: 'GET', path: '/api/data', auth: 'optional', ws: 4, summary: 'Phase 1 Dataset for the 3D room (per user when signed in, seed demo otherwise).', response: DatasetSchema }),
  wishlist: route({ method: 'GET', path: '/api/wishlist', auth: 'optional', ws: 4, summary: 'My wish list (seed demo when signed out).', response: z.array(WishlistItemV2Schema) }),
  entries: route({
    method: 'POST', path: '/api/entries', auth: 'optional', ws: 4,
    summary: 'Phase 1 save (room + review). Signed in: stored in Postgres as a venue/game/visit/review. Signed out: the local seed overlay (Phase 1 demo, to be retired by 20).',
    body: EntryInputSchema, response: EntrySchema,
  }),
  putWishlist: route({
    method: 'PUT', path: '/api/wishlist', auth: 'optional', ws: 4,
    summary: 'Replace my whole wish list (signed out: the local seed overlay, Phase 1 demo).',
    body: z.array(WishlistItemV2Schema).max(200),
    response: z.array(WishlistItemV2Schema),
  }),

  // -------------------------------------------------------------------------
  // Directory (5)
  // -------------------------------------------------------------------------
  directorySearch: route({
    method: 'GET', path: '/api/directory/search', auth: 'public', ws: 5,
    summary: 'Fuzzy (pg_trgm) search over venues and games. Optional point biases by distance; optional city ranks that city first.',
    query: z.object({
      q: z.string().trim().min(1).max(120),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      country: z.string().length(2).optional(),
      /** Soft: rooms and venues in this city rank first; others still show (Phase 3, workstream A). */
      city: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
    response: z.object({ venues: z.array(VenueSummarySchema), games: z.array(GameSummarySchema) }),
  }),
  directoryNearby: route({
    method: 'GET', path: '/api/directory/nearby', auth: 'public', ws: 5,
    summary: 'Venues near a point, nearest first.',
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusKm: z.coerce.number().min(0.1).max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    response: z.object({ venues: z.array(VenueSummarySchema) }),
  }),
  directoryMatch: route({
    method: 'GET', path: '/api/directory/match', auth: 'public', ws: 5,
    summary: 'Scored candidates for the matcher UI (12), from extraction hints.',
    query: z.object({
      venue: z.string().max(160).optional(),
      game: z.string().max(160).optional(),
      city: z.string().max(120).optional(),
      country: z.string().length(2).optional(),
      lat: z.coerce.number().optional(),
      lng: z.coerce.number().optional(),
    }),
    response: z.object({ venues: z.array(VenueMatchSchema), games: z.array(GameMatchSchema) }),
  }),
  venuePage: route({ method: 'GET', path: '/api/venues/:slug', auth: 'public', ws: 5, summary: 'Venue page data.', params: SlugParams, response: VenuePageSchema }),
  cityPage: route({ method: 'GET', path: '/api/cities/:slug', auth: 'public', ws: 5, summary: 'City page data.', params: SlugParams, response: CityPageSchema }),
  gamePage: route({
    method: 'GET', path: '/api/games/:slug', auth: 'optional', ws: 5,
    summary: 'Game page data: game, venue, aggregate, spoiler puzzle highlights, first page of public reviews (18/33 supply reviews and aggregates).',
    params: SlugParams, response: GamePageSchema,
  }),
  createVenue: route({ method: 'POST', path: '/api/venues', auth: 'user', ws: 5, summary: 'Add a venue (source: user).', body: NewVenueSchema, response: VenueSchema, status: 201 }),
  updateVenue: route({
    method: 'PATCH', path: '/api/venues/id/:id', auth: 'user', ws: 5,
    summary: 'Suggest a correction to a venue. Recorded in `sources` as a user contribution.',
    params: IdParams, body: NewVenueSchema.partial(), response: VenueSchema,
  }),
  createGame: route({ method: 'POST', path: '/api/games', auth: 'user', ws: 5, summary: 'Add a game inside a venue (source: user).', body: NewGameSchema, response: GameSchema, status: 201 }),
  updateGame: route({
    method: 'PATCH', path: '/api/games/id/:id', auth: 'user', ws: 5,
    summary: 'Correct a game. Recorded in `sources`.',
    params: IdParams, body: NewGameSchema.omit({ venueId: true }).partial(), response: GameSchema,
  }),

  // -------------------------------------------------------------------------
  // Transcription (10) and extraction v2 (11)
  // -------------------------------------------------------------------------
  transcribe: route({
    method: 'POST', path: '/api/transcribe', auth: 'user', ws: 10,
    summary: 'multipart: `audio` (file, <= 25 MB, webm/mp4/m4a/ogg/wav/mpeg), `durationSeconds` (number), `clientId` (string, for retries). The audio is never stored. 429 spending_cap -> fallback typing.',
    body: 'multipart',
    response: z.object({
      transcript: z.string(),
      durationSeconds: z.number().nonnegative(),
      mode: z.enum(['openai', 'mock']),
      clientId: z.string().nullable(),
      /** Always true: the raw audio is discarded once the transcript exists (privacy policy). */
      audioDeleted: z.literal(true),
    }),
  }),
  extract: route({
    method: 'POST', path: '/api/extract', auth: 'optional', ws: 11,
    summary: 'Transcript -> ReviewDraft with directory hints. Over the cap it falls back to mock with a `notice`.',
    body: z.object({ transcript: z.string().min(1).max(50_000), lat: z.number().optional(), lng: z.number().optional() }),
    response: ReviewDraftSchema.extend({
      /** Hints for the directory matcher (12). */
      hints: z.object({ venue: z.string().nullable(), game: z.string().nullable(), city: z.string().nullable(), country: z.string().nullable() }).optional(),
      /** Friendly message shown on the confirm screen, e.g. when the extraction cap fell back to mock. */
      notice: z.string().nullable().optional(),
    }),
  }),

  // -------------------------------------------------------------------------
  // Visits and participants (32)
  // -------------------------------------------------------------------------
  createVisit: route({
    method: 'POST', path: '/api/visits', auth: 'user', ws: 32,
    summary: 'Log a visit: shared facts, puzzles, crew tags (friends only, or guest names) and optionally my review in one go.',
    body: z.object({
      gameId: z.string().min(1),
      facts: VisitFactsSchema,
      puzzles: z.array(VisitPuzzleInputSchema).max(40).default([]),
      crew: z.array(CrewTagSchema).max(20).default([]),
      review: ReviewInputSchema.optional(),
    }),
    response: VisitDetailSchema, status: 201,
  }),
  visit: route({ method: 'GET', path: '/api/visits/:id', auth: 'user', ws: 32, summary: 'A visit I am on (owner, accepted or pending). 404 otherwise.', params: IdParams, response: VisitDetailSchema }),
  updateVisit: route({
    method: 'PATCH', path: '/api/visits/:id', auth: 'user', ws: 32,
    summary: 'Edit shared facts and/or puzzles. Any accepted participant. Writes a visit_edits row.',
    params: IdParams,
    body: z.object({ facts: VisitFactsSchema.partial().optional(), puzzles: z.array(VisitPuzzleInputSchema).max(40).optional() }),
    response: VisitDetailSchema,
  }),
  visitEdits: route({ method: 'GET', path: '/api/visits/:id/edits', auth: 'user', ws: 32, summary: 'Edit history, newest first.', params: IdParams, response: z.object({ edits: z.array(VisitEditSchema) }) }),
  deleteVisit: route({
    method: 'DELETE', path: '/api/visits/:id', auth: 'user', ws: 32,
    summary: 'Creator only, and only while nobody else has accepted. 409 conflict otherwise (leave instead).',
    params: IdParams, response: z.object({ deleted: z.literal(true) }),
  }),
  leaveVisit: route({
    method: 'POST', path: '/api/visits/:id/leave', auth: 'user', ws: 32,
    summary: 'Remove myself: my review is removed, the visit stays for the others.',
    params: IdParams, response: z.object({ left: z.literal(true) }),
  }),
  tagParticipants: route({
    method: 'POST', path: '/api/visits/:id/participants', auth: 'user', ws: 32,
    summary: 'Tag more people. Users must be my accepted friends (403 otherwise). Auto-accept per friend applies.',
    params: IdParams, body: z.object({ crew: z.array(CrewTagSchema).min(1).max(20) }), response: VisitDetailSchema,
  }),
  respondToTag: route({
    method: 'POST', path: '/api/visits/:id/respond', auth: 'user', ws: 32,
    summary: '"Add to my room" (accept) or "That wasn\'t me" (decline). Accepting creates my review as a copy of the tagger\'s (scoresCopied).',
    params: IdParams, body: z.object({ accept: z.boolean() }),
    response: z.object({ visit: VisitDetailSchema.nullable(), status: z.enum(['accepted', 'declined']) }),
  }),
  pendingTags: route({ method: 'GET', path: '/api/tags/pending', auth: 'user', ws: 32, summary: 'Tags waiting for my answer (inbox).', response: z.object({ tags: z.array(PendingTagSchema) }) }),
  crewSuggestions: route({ method: 'GET', path: '/api/crew/suggestions', auth: 'user', ws: 32, summary: 'Crew chips: friends by visits together, then guest names I used.', response: z.object({ suggestions: z.array(CrewSuggestionSchema) }) }),

  // -------------------------------------------------------------------------
  // Reviews (33)
  // -------------------------------------------------------------------------
  putMyReview: route({
    method: 'PUT', path: '/api/visits/:id/review', auth: 'user', ws: 33,
    summary: 'Create or replace my review on a visit I accepted. Changing any score clears scoresCopied. Public needs onboarding (403 onboarding_required).',
    params: IdParams, body: ReviewInputSchema, response: ReviewV2Schema,
  }),
  review: route({
    method: 'GET', path: '/api/reviews/:id', auth: 'optional', ws: 33,
    summary: 'One review, if its visibility allows the viewer. 404 otherwise. Spoiler comments only with ?spoilers=1.',
    params: IdParams, query: z.object({ spoilers: z.string().max(8).optional() }), response: ReviewV2Schema,
  }),
  reviewFeed: route({
    method: 'GET', path: '/api/reviews', auth: 'optional', ws: 33,
    summary: 'Public reviews of every room (plus friends-only ones the viewer may see), newest first, paged. Optional spoiler filter and city.',
    query: ReviewListQuery.extend({ city: z.string().max(120).optional() }), response: ReviewPageSchema,
  }),
  updateReview: route({
    method: 'PATCH', path: '/api/reviews/:id', auth: 'user', ws: 33,
    summary: 'Author only: change visibility or the spoiler flag.',
    params: IdParams, body: z.object({ visibility: VisibilitySchema.optional(), containsSpoilers: z.boolean().optional() }), response: ReviewV2Schema,
  }),
  gameReviews: route({
    method: 'GET', path: '/api/games/:slug/reviews', auth: 'optional', ws: 33,
    summary: 'Public reviews of a game (plus friends-only ones the viewer may see), newest first, paged. Optional spoiler filter.',
    params: SlugParams, query: ReviewListQuery, response: ReviewPageSchema,
  }),

  // -------------------------------------------------------------------------
  // Guest claims and same-room merge (34)
  // -------------------------------------------------------------------------
  claims: route({ method: 'GET', path: '/api/claims', auth: 'user', ws: 34, summary: 'Guest names my friends used that may be me (from invites first).', response: z.object({ claims: z.array(GuestClaimSchema) }) }),
  claim: route({
    method: 'POST', path: '/api/claims', auth: 'user', ws: 34,
    summary: 'Claim guest-name visits from a friend (all, or the listed participant ids). Same accept flow as tagging.',
    body: z.object({ inviterId: z.string().min(1), guestName: z.string().min(1).max(60), participantIds: z.array(z.string()).optional() }),
    response: z.object({ claimed: z.number().int().nonnegative() }),
  }),
  mergeCandidates: route({
    method: 'GET', path: '/api/visits/merge-candidates', auth: 'user', ws: 34,
    summary: 'Friends\' visits of the same game within a day of `date`.',
    query: z.object({ gameId: z.string().min(1), date: IsoDate }),
    response: z.object({ candidates: z.array(MergeCandidateSchema) }),
  }),
  joinVisit: route({
    method: 'POST', path: '/api/visits/:id/join', auth: 'user', ws: 34,
    summary: 'Join a friend\'s visit of the same game. `fromVisitId` merges my own separate log into it; `resolve` picks conflicting facts. Both reviews are kept.',
    params: IdParams,
    body: z.object({ fromVisitId: z.string().optional(), resolve: VisitFactsSchema.partial().default({}), review: ReviewInputSchema.optional() }),
    response: VisitDetailSchema,
  }),

  // -------------------------------------------------------------------------
  // Friends, invites, notifications (31)
  // -------------------------------------------------------------------------
  friends: route({ method: 'GET', path: '/api/friends', auth: 'user', ws: 31, summary: 'My accepted friends.', response: z.object({ friends: z.array(FriendSchema) }) }),
  friendRequests: route({ method: 'GET', path: '/api/friends/requests', auth: 'user', ws: 31, summary: 'Incoming and outgoing requests.', response: z.object({ requests: z.array(FriendRequestSchema) }) }),
  sendFriendRequest: route({
    method: 'POST', path: '/api/friends/requests', auth: 'user', ws: 31,
    summary: 'Send a request by @handle, exact email, or user id. Blocked users get a generic 404.',
    body: z.object({ handle: z.string().optional(), email: z.string().email().optional(), userId: z.string().optional() }),
    response: z.object({ relation: RelationSchema, user: PublicUserSchema }),
  }),
  acceptFriend: route({ method: 'POST', path: '/api/friends/:userId/accept', auth: 'user', ws: 31, summary: 'Accept an incoming request.', params: UserIdParams, response: FriendSchema }),
  declineFriend: route({ method: 'POST', path: '/api/friends/:userId/decline', auth: 'user', ws: 31, summary: 'Decline an incoming request or cancel my outgoing one.', params: UserIdParams, response: Ok }),
  unfriend: route({ method: 'DELETE', path: '/api/friends/:userId', auth: 'user', ws: 31, summary: 'Unfriend. Past shared visits stay; new tags stop.', params: UserIdParams, response: Ok }),
  blockUser: route({ method: 'POST', path: '/api/friends/:userId/block', auth: 'user', ws: 31, summary: 'Block (also unfriends).', params: UserIdParams, response: Ok }),
  unblockUser: route({ method: 'POST', path: '/api/friends/:userId/unblock', auth: 'user', ws: 31, summary: 'Unblock.', params: UserIdParams, response: Ok }),
  setAutoAccept: route({
    method: 'PATCH', path: '/api/friends/:userId', auth: 'user', ws: 31,
    summary: '"Always add <friend>\'s visits to my room" (off by default).',
    params: UserIdParams, body: z.object({ autoAccept: z.boolean() }), response: FriendSchema,
  }),
  userSearch: route({
    method: 'GET', path: '/api/users/search', auth: 'user', ws: 31,
    summary: 'Exact @handle or exact email only (no browsable directory). At most 1 result; email never echoed.',
    query: z.object({ q: z.string().trim().min(1).max(254) }),
    response: z.object({ users: z.array(PublicUserSchema.extend({ relation: RelationSchema })) }),
  }),
  createInvite: route({
    method: 'POST', path: '/api/invites', auth: 'user', ws: 31,
    summary: 'Make an invite link, optionally for a guest name to claim. Expires in 30 days.',
    body: z.object({ guestName: z.string().trim().min(1).max(60).optional() }), response: InviteSchema, status: 201,
  }),
  myInvites: route({ method: 'GET', path: '/api/invites', auth: 'user', ws: 31, summary: 'My invites.', response: z.object({ invites: z.array(InviteSchema) }) }),
  invitePreview: route({ method: 'GET', path: '/api/invites/:code', auth: 'public', ws: 31, summary: 'Public preview for /invite/:code.', params: CodeParams, response: InvitePreviewSchema }),
  acceptInvite: route({
    method: 'POST', path: '/api/invites/:code/accept', auth: 'user', ws: 31,
    summary: 'Become friends with the inviter. 410 gone when expired/used/revoked.',
    params: CodeParams, response: z.object({ friend: FriendSchema, claimableVisits: z.number().int().nonnegative() }),
  }),
  revokeInvite: route({ method: 'DELETE', path: '/api/invites/:code', auth: 'user', ws: 31, summary: 'Revoke my invite.', params: CodeParams, response: Ok }),
  notifications: route({
    method: 'GET', path: '/api/notifications', auth: 'user', ws: 31,
    summary: 'My notifications, newest first, plus the unread count for the badge.',
    query: Cursor, response: z.object({ items: z.array(NotificationSchema), unread: z.number().int().nonnegative(), nextCursor: z.string().nullable() }),
  }),
  readNotifications: route({
    method: 'POST', path: '/api/notifications/read', auth: 'user', ws: 31,
    summary: 'Mark the given ids (or all) as read.',
    body: z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }), response: z.object({ unread: z.number().int().nonnegative() }),
  }),

  // -------------------------------------------------------------------------
  // Escape of the Day (23)
  // -------------------------------------------------------------------------
  dailyToday: route({
    method: 'GET', path: '/api/daily/today', auth: 'optional', ws: 23,
    summary: 'Today\'s puzzle for the caller. Signed in: the server day is fixed by the tz at the first play that day.',
    query: TimeZoneQuery, response: DailyTodaySchema,
  }),
  dailyStart: route({
    method: 'POST', path: '/api/daily/start', auth: 'user', ws: 23,
    summary: 'Record the first play of the day (fixes time zone and start time). Idempotent.',
    body: z.object({ tz: z.string().max(64) }), response: DailyTodaySchema,
  }),
  dailySubmit: route({
    method: 'POST', path: '/api/daily/results', auth: 'user', ws: 23,
    summary: 'Submit today\'s result. 400 wrong_day unless `day` is my server day; 409 if already finished.',
    body: DailyResultInputSchema, response: z.object({ result: DailyResultSchema, streak: StreakSchema }),
  }),
  dailyStreak: route({ method: 'GET', path: '/api/daily/streak', auth: 'user', ws: 23, summary: 'My streak.', response: StreakSchema }),
  dailyLeaderboard: route({
    method: 'GET', path: '/api/daily/leaderboard', auth: 'user', ws: 23,
    summary: 'Me and my friends for a day (default: my server day).',
    query: z.object({ day: IsoDate.optional() }), response: z.object({ day: IsoDate, entries: z.array(LeaderboardEntrySchema) }),
  }),

  // -------------------------------------------------------------------------
  // Photos (24)
  // -------------------------------------------------------------------------
  uploadPhoto: route({
    method: 'POST', path: '/api/visits/:id/photos', auth: 'user', ws: 24,
    summary: 'multipart: `photo` (jpeg/png/webp, resized in the browser to ~1600 px, <= 1 MB), `caption`, `width`, `height`. Accepted participants only.',
    params: IdParams, body: 'multipart', response: PhotoV2Schema, status: 201,
  }),
  photo: route({
    method: 'GET', path: '/api/photos/:id', auth: 'optional', ws: 24,
    summary: 'Image bytes. Participants, or anyone when the visit has a public review and the photo is not hidden.',
    params: IdParams, response: z.unknown(),
  }),
  deletePhoto: route({ method: 'DELETE', path: '/api/photos/:id', auth: 'user', ws: 24, summary: 'Uploader only.', params: IdParams, response: Ok }),

  // -------------------------------------------------------------------------
  // Moderation (25)
  // -------------------------------------------------------------------------
  report: route({ method: 'POST', path: '/api/reports', auth: 'user', ws: 25, summary: 'Report a review, photo, game or venue.', body: ReportInputSchema, response: z.object({ id: z.string() }), status: 201 }),
  adminReports: route({
    method: 'GET', path: '/api/admin/reports', auth: 'admin', ws: 25, summary: 'Reports queue.',
    query: z.object({ status: z.enum(['open', 'hidden', 'dismissed']).optional() }), response: z.object({ reports: z.array(ReportSchema) }),
  }),
  adminResolveReport: route({
    method: 'POST', path: '/api/admin/reports/:id/resolve', auth: 'admin', ws: 25,
    summary: 'Hide the target or dismiss the report.',
    params: IdParams, body: z.object({ action: z.enum(['hide', 'dismiss']) }), response: ReportSchema,
  }),
  adminEnrichStatus: route({
    method: 'GET', path: '/api/admin/enrich', auth: 'admin', ws: 25,
    summary: 'Room crawler: runs, totals, rooms in the directory, and the cost estimate for the rest.',
    response: EnrichStatusSchema,
  }),
  adminEnrichStart: route({
    method: 'POST', path: '/api/admin/enrich', auth: 'admin', ws: 25,
    summary: 'Start a room crawler run in the background (one at a time; stops before passing budgetUsd). 409 when one is running.',
    body: EnrichStartSchema, response: z.object({ id: z.string() }), status: 202,
  }),
  adminHide: route({
    method: 'POST', path: '/api/admin/hide', auth: 'admin', ws: 25,
    summary: 'Hide or unhide a review, photo, game or venue directly.',
    body: z.object({ targetType: z.enum(['review', 'photo', 'game', 'venue']), targetId: z.string().min(1), hidden: z.boolean() }), response: Ok,
  }),

  // -------------------------------------------------------------------------
  // Phase 3, workstream C: homes and presence (the websocket is REALTIME_PATH in realtime.ts)
  // -------------------------------------------------------------------------
  home: route({
    method: 'GET', path: '/api/homes/:handle', auth: 'user', ws: 303,
    summary: "A user's room, read-only, for the owner and their accepted friends (403 forbidden for others, 404 unknown or blocked). `?spoilers=1` reveals spoiler text.",
    params: z.object({ handle: z.string().trim().min(1).max(40) }), query: z.object({ spoilers: z.string().max(8).optional() }), response: HomeViewSchema,
  }),
  presence: route({
    method: 'GET', path: '/api/presence', auth: 'user', ws: 303,
    summary: 'Which friends are online and where (relative to me), and who is in my home now.',
    response: PresenceListSchema,
  }),
} as const satisfies Record<string, RouteSpec>

export type RouteName = keyof typeof ROUTES
export const ROUTE_LIST: readonly (RouteSpec & { name: RouteName })[] = Object.entries(ROUTES).map(([name, spec]) => ({
  ...(spec as RouteSpec),
  name: name as RouteName,
}))

// ---------------------------------------------------------------------------
// Typed client
// ---------------------------------------------------------------------------

type In<S, K extends 'params' | 'query' | 'body'> = S extends Record<K, infer T> ? (T extends z.ZodType ? z.input<T> : T extends 'multipart' ? FormData : never) : never
type HasKey<S, K extends string> = S extends Record<K, unknown> ? true : false

export type RouteInput<S extends RouteSpec> = (HasKey<S, 'params'> extends true ? { params: In<S, 'params'> } : { params?: undefined }) &
  (HasKey<S, 'query'> extends true ? { query?: In<S, 'query'> } : { query?: undefined }) &
  (HasKey<S, 'body'> extends true ? { body: In<S, 'body'> } : { body?: undefined })

export type RouteOutput<S extends RouteSpec> = z.output<S['response']>

/** Fills `:name` segments, URL-encoding each value. */
export function buildPath(path: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
  const filled = path.replace(/:([A-Za-z_]+)/g, (_, key: string) => {
    const v = params?.[key]
    if (v === undefined || v === null || v === '') throw new Error(`missing path param ${key} for ${path}`)
    return encodeURIComponent(String(v))
  })
  if (!query) return filled
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `${filled}?${s}` : filled
}

/**
 * Call a Phase 2 route: `await callApi(ROUTES.gamePage, { params: { slug } })`.
 * Sends cookies (same origin), validates the response, throws `ApiCallError` on non-2xx.
 */
export async function callApi<S extends RouteSpec>(spec: S, input: RouteInput<S> = {} as RouteInput<S>, init: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<RouteOutput<S>> {
  const { params, query, body } = input as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }
  const url = buildPath(spec.path, params, query)
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) payload = body
    else {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }
  const res = await (init.fetch ?? fetch)(url, { method: spec.method, headers, body: payload, credentials: 'same-origin', signal: init.signal })
  if (!res.ok) {
    let parsed: z.infer<typeof ApiErrorSchema> | undefined
    try {
      const j = ApiErrorSchema.safeParse(await res.json())
      if (j.success) parsed = j.data
    } catch {
      /* not JSON */
    }
    throw new ApiCallError(res.status, parsed, `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as RouteOutput<S>
  return spec.response.parse(await res.json()) as RouteOutput<S>
}
