/**
 * Phase 2 domain contracts: accounts, the public directory, shared visits with personal
 * reviews, friends, invites, notifications, Escape of the Day, moderation and usage.
 * Phase 1 shapes (Room, Review, Dataset, ReviewDraft...) stay in `types.ts`.
 *
 * Every shape is a Zod schema plus its inferred type. Ids are opaque strings.
 * Dates are ISO `YYYY-MM-DD`; timestamps are ISO 8601 strings.
 *
 * Owned by the orchestrator (workstream 1). Request changes; don't edit.
 */
import { z } from 'zod'
import { GenreSchema, PuzzleTypeSchema, RatingsSchema } from './types'

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
export const Timestamp = z.string().min(1)
export const Slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lowercase slug')

// ---------------------------------------------------------------------------
// Users, handles, profiles (workstreams 3, 4)
// ---------------------------------------------------------------------------

/** 3-24 chars, starts with a letter, letters, digits and underscores. Stored lowercase. */
export const HANDLE_RE = /^[a-z][a-z0-9_]{2,23}$/
export const HandleSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^@/, '').toLowerCase())
  .pipe(z.string().regex(HANDLE_RE, 'handle must be 3-24 letters, digits or _, starting with a letter'))
export type Handle = z.infer<typeof HandleSchema>

/** Handles nobody may take (routes, staff-looking names). Compared lowercase. */
export const RESERVED_HANDLES = [
  'admin', 'administrator', 'api', 'about', 'privacy', 'terms', 'settings', 'daily', 'games', 'venues',
  'cities', 'invite', 'invites', 'me', 'm', 'help', 'support', 'staff', 'mod', 'moderator', 'root',
  'system', 'myescapes', 'escape', 'official', 'null', 'undefined', 'anonymous', 'guest',
] as const

export const DisplayNameSchema = z.string().trim().min(1).max(60)

/** What anyone may see about a user. Never includes the email. */
export const PublicUserSchema = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  displayName: z.string(),
  image: z.string().nullable(),
})
export type PublicUser = z.infer<typeof PublicUserSchema>

/** The signed-in user, as returned by `GET /api/me`. */
export const MeSchema = PublicUserSchema.extend({
  email: z.string(),
  /** True once a display name and @handle are chosen (needed before any review is public). */
  onboarded: z.boolean(),
  isAdmin: z.boolean(),
  createdAt: Timestamp,
})
export type Me = z.infer<typeof MeSchema>

// ---------------------------------------------------------------------------
// Directory: cities, venues, games, sources (workstreams 5-9, 16, 17)
// ---------------------------------------------------------------------------

export const DIRECTORY_SOURCES = ['foursquare', 'osm', 'user', 'google'] as const
export const DirectorySourceSchema = z.enum(DIRECTORY_SOURCES)
export type DirectorySource = z.infer<typeof DirectorySourceSchema>

/** Attribution line a public page must show for the facts it displays. */
export const AttributionSchema = z.object({
  source: DirectorySourceSchema,
  license: z.string(),
  text: z.string(),
  url: z.string().optional(),
})
export type Attribution = z.infer<typeof AttributionSchema>

export const ENTITY_STATUSES = ['active', 'closed', 'hidden'] as const
export const EntityStatusSchema = z.enum(ENTITY_STATUSES)

export const CitySchema = z.object({
  slug: Slug,
  name: z.string(),
  region: z.string(),
  /** ISO 3166-1 alpha-2, uppercase. */
  country: z.string().length(2),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
})
export type City = z.infer<typeof CitySchema>

export const VenueSchema = z.object({
  id: z.string(),
  slug: Slug,
  name: z.string(),
  brand: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  citySlug: z.string(),
  region: z.string(),
  country: z.string(),
  postalCode: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  /** Google place id (the only Places field we may store). Powers "Open in Google Maps". */
  googlePlaceId: z.string().nullable(),
  status: EntityStatusSchema,
})
export type Venue = z.infer<typeof VenueSchema>

export const VenueSummarySchema = VenueSchema.pick({
  id: true, slug: true, name: true, brand: true, address: true, city: true, citySlug: true, region: true,
  country: true, lat: true, lng: true, status: true,
}).extend({
  gameCount: z.number().int().nonnegative(),
  /** Distance from the query point in km, when the query had one. */
  distanceKm: z.number().nullable().optional(),
})
export type VenueSummary = z.infer<typeof VenueSummarySchema>

export const GameSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  slug: Slug,
  name: z.string(),
  genre: GenreSchema.nullable(),
  minPlayers: z.number().int().positive().nullable(),
  maxPlayers: z.number().int().positive().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  status: EntityStatusSchema,
})
export type Game = z.infer<typeof GameSchema>

export const GameSummarySchema = GameSchema.pick({ id: true, slug: true, name: true, genre: true, status: true }).extend({
  venueId: z.string(),
  venueName: z.string(),
  venueSlug: z.string(),
  city: z.string(),
  country: z.string(),
  /** Public reviews counted in the averages (copied scores excluded). */
  reviewCount: z.number().int().nonnegative(),
  avgOverall: z.number().nullable(),
})
export type GameSummary = z.infer<typeof GameSummarySchema>

export const NewVenueSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(300).default(''),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).default(''),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  postalCode: z.string().trim().max(20).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
})
export type NewVenue = z.infer<typeof NewVenueSchema>

export const NewGameSchema = z.object({
  venueId: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  genre: GenreSchema.nullable().optional(),
  minPlayers: z.number().int().min(1).max(50).nullable().optional(),
  maxPlayers: z.number().int().min(1).max(50).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
})
export type NewGame = z.infer<typeof NewGameSchema>

/** A scored directory candidate for the venue/game matcher (workstream 12). `score` is 0..1. */
export const VenueMatchSchema = z.object({ venue: VenueSummarySchema, score: z.number().min(0).max(1) })
export const GameMatchSchema = z.object({ game: GameSummarySchema, score: z.number().min(0).max(1) })
export type VenueMatch = z.infer<typeof VenueMatchSchema>
export type GameMatch = z.infer<typeof GameMatchSchema>

// ---------------------------------------------------------------------------
// Visits (shared) and reviews (personal) (workstreams 32, 33, 34)
// ---------------------------------------------------------------------------

/** Shared facts of a play-through. Null = unknown. Any accepted participant may edit them. */
export const VisitFactsSchema = z.object({
  date: IsoDate,
  escaped: z.boolean().nullable(),
  escapeTimeMinutes: z.number().min(0).max(600).nullable(),
  visibleTimer: z.boolean().nullable(),
  multiRoom: z.boolean().nullable(),
  flashlights: z.boolean().nullable(),
  liveActors: z.boolean().nullable(),
  toolsUsed: z.array(z.string().max(60)).max(40),
})
export type VisitFacts = z.infer<typeof VisitFactsSchema>
export const VISIT_FACT_KEYS = Object.keys(VisitFactsSchema.shape) as (keyof VisitFacts)[]

export const VisitPuzzleSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(500),
  type: PuzzleTypeSchema,
  /** Per-puzzle note. Puzzles and notes are spoilers: hidden behind "Show spoilers" on public pages. */
  notes: z.string().max(2000).default(''),
  position: z.number().int().nonnegative(),
})
export type VisitPuzzle = z.infer<typeof VisitPuzzleSchema>

export const VisitPuzzleInputSchema = VisitPuzzleSchema.omit({ id: true, position: true }).extend({
  /** Keep an existing puzzle's id when re-saving. */
  id: z.string().optional(),
})
export type VisitPuzzleInput = z.infer<typeof VisitPuzzleInputSchema>

export const PARTICIPANT_STATUSES = ['owner', 'accepted', 'pending', 'declined'] as const
export const ParticipantStatusSchema = z.enum(PARTICIPANT_STATUSES)
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>

/** A person on a visit: a user (friend) or a plain guest name. */
export const ParticipantSchema = z.object({
  id: z.string(),
  user: PublicUserSchema.nullable(),
  /** Set for guests (no account), and for users whose account was deleted. */
  guestName: z.string().nullable(),
  status: ParticipantStatusSchema,
  addedBy: z.string().nullable(),
})
export type Participant = z.infer<typeof ParticipantSchema>

/** How the log form tags someone: a friend's user id or a plain guest name. */
export const CrewTagSchema = z.union([
  z.object({ userId: z.string().min(1) }),
  z.object({ guestName: z.string().trim().min(1).max(60) }),
])
export type CrewTag = z.infer<typeof CrewTagSchema>

export const PhotoV2Schema = z.object({
  id: z.string(),
  visitId: z.string(),
  /** Same-origin URL that serves the bytes (`/api/photos/:id`). */
  url: z.string(),
  uploaderId: z.string().nullable(),
  caption: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: Timestamp,
})
export type PhotoV2 = z.infer<typeof PhotoV2Schema>

export const VISIBILITIES = ['public', 'friends', 'private'] as const
export const VisibilitySchema = z.enum(VISIBILITIES)
export type Visibility = z.infer<typeof VisibilitySchema>

export const ReviewV2Schema = z.object({
  id: z.string(),
  visitId: z.string(),
  author: PublicUserSchema,
  ratings: RatingsSchema,
  /**
   * Voice transcript. Null unless the viewer is the author: the privacy policy says voice notes
   * and transcripts are visible only to their owner.
   */
  transcript: z.string().nullable(),
  /** Ids of visit puzzles this author found memorable. */
  memorablePuzzleIds: z.array(z.string()),
  visibility: VisibilitySchema,
  /** Comments contain spoilers: blurred until revealed. */
  containsSpoilers: z.boolean(),
  /** True while the scores are still an untouched copy of another review (left out of public averages). */
  scoresCopied: z.boolean(),
  copiedFromReviewId: z.string().nullable(),
  /** Set when a moderator hid it. Hidden reviews are only visible to their author. */
  hidden: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type ReviewV2 = z.infer<typeof ReviewV2Schema>

export const ReviewInputSchema = z.object({
  ratings: RatingsSchema,
  transcript: z.string().max(50_000).default(''),
  memorablePuzzleIds: z.array(z.string()).default([]),
  visibility: VisibilitySchema.default('public'),
  containsSpoilers: z.boolean().default(false),
})
export type ReviewInput = z.infer<typeof ReviewInputSchema>

export const VisitDetailSchema = z.object({
  id: z.string(),
  game: GameSummarySchema,
  venue: VenueSummarySchema,
  facts: VisitFactsSchema,
  puzzles: z.array(VisitPuzzleSchema),
  participants: z.array(ParticipantSchema),
  photos: z.array(PhotoV2Schema),
  /** Reviews this viewer may see (their own always, others by visibility). */
  reviews: z.array(ReviewV2Schema),
  createdBy: z.string().nullable(),
  /** The viewer's own participant status on this visit. */
  myStatus: ParticipantStatusSchema.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type VisitDetail = z.infer<typeof VisitDetailSchema>

export const VisitEditSchema = z.object({
  id: z.string(),
  visitId: z.string(),
  editor: PublicUserSchema.nullable(),
  /** field -> { from, to }. Field is a VisitFacts key or `puzzles`. */
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  createdAt: Timestamp,
})
export type VisitEdit = z.infer<typeof VisitEditSchema>

/** One row of "my rooms": a visit I own or accepted, with my review. Feeds the 3D room and mobile table. */
export const LogRowSchema = z.object({
  visitId: z.string(),
  date: IsoDate,
  game: GameSummarySchema,
  venue: VenueSummarySchema,
  escaped: z.boolean().nullable(),
  escapeTimeMinutes: z.number().nullable(),
  myReview: ReviewV2Schema.nullable(),
  /** Other people on the visit (accepted users, pending users by name, guests). */
  crew: z.array(ParticipantSchema),
  coverPhotoUrl: z.string().nullable(),
})
export type LogRow = z.infer<typeof LogRowSchema>

/** A tag waiting for my answer (inbox): "Brennan says you played X together on Oct 12". */
export const PendingTagSchema = z.object({
  visitId: z.string(),
  participantId: z.string(),
  game: GameSummarySchema,
  date: IsoDate,
  taggedBy: PublicUserSchema,
  createdAt: Timestamp,
})
export type PendingTag = z.infer<typeof PendingTagSchema>

/** Friend chips for the crew field, most frequent teammates first, then recent guest names. */
export const CrewSuggestionSchema = z.union([
  z.object({ kind: z.literal('friend'), user: PublicUserSchema, visitsTogether: z.number().int() }),
  z.object({ kind: z.literal('guest'), guestName: z.string(), visitsTogether: z.number().int() }),
])
export type CrewSuggestion = z.infer<typeof CrewSuggestionSchema>

/** "Brennan has 23 visits with a guest named Mia. Is that you?" */
export const GuestClaimSchema = z.object({
  inviter: PublicUserSchema,
  guestName: z.string(),
  visits: z.array(z.object({ visitId: z.string(), participantId: z.string(), game: GameSummarySchema, date: IsoDate })),
})
export type GuestClaim = z.infer<typeof GuestClaimSchema>

/** "Looks like Mia already logged this on Oct 12. Join her visit?" */
export const MergeCandidateSchema = z.object({
  visitId: z.string(),
  game: GameSummarySchema,
  facts: VisitFactsSchema,
  loggedBy: PublicUserSchema,
  /** Fact keys whose values differ from the caller's draft (shown side by side). */
  conflicts: z.array(z.string()),
})
export type MergeCandidate = z.infer<typeof MergeCandidateSchema>

// ---------------------------------------------------------------------------
// Public pages (workstreams 16, 17, 18)
// ---------------------------------------------------------------------------

/** A review as shown on public pages. Author shows handle + display name, never email. */
export const PublicReviewSchema = z.object({
  id: z.string(),
  visitId: z.string(),
  author: PublicUserSchema,
  date: IsoDate,
  ratings: RatingsSchema,
  containsSpoilers: z.boolean(),
  scoresCopied: z.boolean(),
  escaped: z.boolean().nullable(),
  escapeTimeMinutes: z.number().nullable(),
  /** Other public reviews from the same visit ("played together"). */
  playedWith: z.array(z.object({ reviewId: z.string(), author: PublicUserSchema })),
  photos: z.array(PhotoV2Schema),
  createdAt: Timestamp,
  /** The reviewed room. Set on the all-rooms review feed, left out on a game page. */
  game: GameSummarySchema.optional(),
})
export type PublicReview = z.infer<typeof PublicReviewSchema>

/** Public averages. Count only public, non-hidden reviews whose scores are not copies. */
export const AggregateSchema = z.object({
  reviewCount: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  /** Escape rate over public visits, each visit counted once. Null when no data. */
  escapeRate: z.number().min(0).max(1).nullable(),
  avgEscapeMinutes: z.number().nullable(),
  avg: z.object({
    overall: z.number().nullable(),
    puzzles: z.number().nullable(),
    setting: z.number().nullable(),
    storyline: z.number().nullable(),
    difficulty: z.number().nullable(),
  }),
})
export type Aggregate = z.infer<typeof AggregateSchema>

/** Puzzle highlights for a game page. Spoilers: the UI hides them until "Show spoilers". */
export const PuzzleHighlightSchema = z.object({
  description: z.string(),
  type: PuzzleTypeSchema,
  notes: z.string(),
  memorableCount: z.number().int().nonnegative(),
  spoiler: z.literal(true),
})
export type PuzzleHighlight = z.infer<typeof PuzzleHighlightSchema>

export const PageCursorSchema = z.string().nullable()

/** Review list spoiler filter: everything, only reviews without spoilers, or only reviews with spoilers. */
export const SPOILER_FILTERS = ['all', 'free', 'only'] as const
export const SpoilerFilterSchema = z.enum(SPOILER_FILTERS)
export type SpoilerFilter = z.infer<typeof SpoilerFilterSchema>

export const ReviewPageSchema = z.object({ reviews: z.array(PublicReviewSchema), nextCursor: PageCursorSchema })
export type ReviewPage = z.infer<typeof ReviewPageSchema>

export const GamePageSchema = z.object({
  game: GameSchema,
  venue: VenueSummarySchema,
  aggregate: AggregateSchema,
  puzzles: z.array(PuzzleHighlightSchema),
  reviews: ReviewPageSchema,
  attribution: z.array(AttributionSchema),
  googleMapsUrl: z.string().nullable(),
})
export type GamePage = z.infer<typeof GamePageSchema>

export const VenuePageSchema = z.object({
  venue: VenueSchema,
  games: z.array(GameSummarySchema),
  attribution: z.array(AttributionSchema),
  googleMapsUrl: z.string().nullable(),
})
export type VenuePage = z.infer<typeof VenuePageSchema>

export const CityPageSchema = z.object({
  city: CitySchema,
  venues: z.array(VenueSummarySchema),
  attribution: z.array(AttributionSchema),
})
export type CityPage = z.infer<typeof CityPageSchema>

// ---------------------------------------------------------------------------
// Friends, invites, notifications (workstreams 31, 34, 35)
// ---------------------------------------------------------------------------

export const FRIENDSHIP_STATUSES = ['pending', 'accepted', 'blocked'] as const
export const FriendshipStatusSchema = z.enum(FRIENDSHIP_STATUSES)

export const FriendSchema = z.object({
  user: PublicUserSchema,
  since: Timestamp,
  /** I auto-accept this friend's tags (off by default). */
  autoAccept: z.boolean(),
  /** They auto-accept my tags. */
  theyAutoAccept: z.boolean(),
  visitsTogether: z.number().int().nonnegative(),
})
export type Friend = z.infer<typeof FriendSchema>

export const FriendRequestSchema = z.object({
  user: PublicUserSchema,
  direction: z.enum(['incoming', 'outgoing']),
  createdAt: Timestamp,
})
export type FriendRequest = z.infer<typeof FriendRequestSchema>

/** My relationship with another user. */
export const RelationSchema = z.enum(['none', 'friends', 'request_sent', 'request_received', 'blocked'])
export type Relation = z.infer<typeof RelationSchema>

export const InviteSchema = z.object({
  code: z.string(),
  /** Absolute URL to text: `<origin>/invite/<code>`. */
  url: z.string(),
  guestName: z.string().nullable(),
  expiresAt: Timestamp,
  usedBy: PublicUserSchema.nullable(),
  createdAt: Timestamp,
})
export type Invite = z.infer<typeof InviteSchema>

/** What `/invite/:code` shows before sign-in. Public; reveals only the inviter's public name. */
export const InvitePreviewSchema = z.object({
  code: z.string(),
  inviter: PublicUserSchema,
  guestName: z.string().nullable(),
  valid: z.boolean(),
  reason: z.enum(['expired', 'used', 'revoked']).nullable(),
})
export type InvitePreview = z.infer<typeof InvitePreviewSchema>

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'tagged',
  'tag_auto_added',
  'tag_accepted',
  'visit_edited',
  'invite_accepted',
  'review_hidden',
] as const
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES)
export type NotificationType = z.infer<typeof NotificationTypeSchema>

export const NotificationSchema = z.object({
  id: z.string(),
  type: NotificationTypeSchema,
  /** Pre-rendered line, e.g. "Brennan logged The Lost Observatory with you". */
  text: z.string(),
  actor: PublicUserSchema.nullable(),
  visitId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  readAt: Timestamp.nullable(),
  createdAt: Timestamp,
})
export type Notification = z.infer<typeof NotificationSchema>

// ---------------------------------------------------------------------------
// Wish list v2 (workstream 4)
// ---------------------------------------------------------------------------

export const WishlistItemV2Schema = z.object({
  id: z.string(),
  name: z.string().min(1).max(160),
  city: z.string().max(120).default(''),
  link: z.string().max(500).default(''),
  addedBy: z.string().max(60).default(''),
  priority: z.number().int(),
  done: z.boolean().default(false),
  /** Optional link to a directory game ("Want to play" later). */
  gameId: z.string().nullable().default(null),
})
export type WishlistItemV2 = z.infer<typeof WishlistItemV2Schema>

// ---------------------------------------------------------------------------
// Escape of the Day (workstreams 21, 22, 23)
// ---------------------------------------------------------------------------

export const DAILY_KINDS = ['combination', 'cipher', 'sequence', 'search'] as const
export const DailyKindSchema = z.enum(DAILY_KINDS)
export type DailyKind = z.infer<typeof DailyKindSchema>

/** Puzzle 1 is this calendar day; numbers count up by one per day ("Escape #12"). */
export const DAILY_EPOCH = '2026-10-26'

export const DailyThemeSchema = z.object({
  gameName: z.string(),
  venueName: z.string(),
  city: z.string(),
  gameSlug: z.string().nullable(),
})
export type DailyTheme = z.infer<typeof DailyThemeSchema>

export const DailyPuzzleSchema = z.object({
  day: IsoDate,
  number: z.number().int().positive(),
  kind: DailyKindSchema,
  /** Seed for the deterministic client generator (src/daily/engine). Same for everyone. */
  seed: z.string(),
  maxGuesses: z.number().int().positive(),
  theme: DailyThemeSchema.nullable(),
})
export type DailyPuzzle = z.infer<typeof DailyPuzzleSchema>

/** One mark per guess for the share grid. */
export const DailyMarkSchema = z.enum(['hit', 'close', 'miss', 'hint'])
export const DailyResultInputSchema = z.object({
  day: IsoDate,
  number: z.number().int().positive(),
  solved: z.boolean(),
  guesses: z.number().int().min(0).max(20),
  hintsUsed: z.number().int().min(0).max(10),
  timeMs: z.number().int().min(0).max(24 * 3600 * 1000),
  /** Rows of marks, one row per guess. Spoiler-free by construction. */
  grid: z.array(z.array(DailyMarkSchema).max(12)).max(20),
})
export type DailyResultInput = z.infer<typeof DailyResultInputSchema>

export const DailyResultSchema = DailyResultInputSchema.extend({
  score: z.number().int().nonnegative(),
  /** IANA time zone fixed at the first play of that day. */
  timeZone: z.string(),
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
})
export type DailyResult = z.infer<typeof DailyResultSchema>

export const StreakSchema = z.object({
  current: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  played: z.number().int().nonnegative(),
  solved: z.number().int().nonnegative(),
  lastSolvedDay: IsoDate.nullable(),
  bestTimeMs: z.number().int().nullable(),
})
export type Streak = z.infer<typeof StreakSchema>

/**
 * `GET /api/daily/today`. `serverDay` is the server's record of the user's day: fixed by the
 * time zone at the first play that day, so changing the device clock can't game streaks.
 * Anonymous callers get the puzzle for the time zone they pass and no result/streak.
 */
export const DailyTodaySchema = z.object({
  serverDay: IsoDate,
  timeZone: z.string(),
  puzzle: DailyPuzzleSchema,
  result: DailyResultSchema.nullable(),
  streak: StreakSchema.nullable(),
  /** ISO timestamp of the next puzzle in the user's fixed time zone. */
  nextAt: Timestamp,
})
export type DailyToday = z.infer<typeof DailyTodaySchema>

export const LeaderboardEntrySchema = z.object({
  user: PublicUserSchema,
  solved: z.boolean(),
  guesses: z.number().int(),
  timeMs: z.number().int(),
  score: z.number().int(),
  /** No streak here: the privacy policy says a streak is visible only to its owner. */
})
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>

// ---------------------------------------------------------------------------
// Moderation (workstream 25)
// ---------------------------------------------------------------------------

export const REPORT_TARGETS = ['review', 'photo', 'game', 'venue'] as const
export const REPORT_REASONS = ['spam', 'offensive', 'wrong_info', 'spoilers', 'privacy', 'other'] as const
export const REPORT_STATUSES = ['open', 'hidden', 'dismissed'] as const

export const ReportInputSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).default(''),
})
export type ReportInput = z.infer<typeof ReportInputSchema>

export const ReportSchema = ReportInputSchema.extend({
  id: z.string(),
  status: z.enum(REPORT_STATUSES),
  reporter: PublicUserSchema.nullable(),
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
})
export type Report = z.infer<typeof ReportSchema>

// ---------------------------------------------------------------------------
// Usage and spending caps (workstreams 10, 11)
// ---------------------------------------------------------------------------

/**
 * Defaults for the spending caps. Env vars override: per-user `CAP_TRANSCRIBE_SECONDS_PER_USER`,
 * `CAP_EXTRACT_CALLS_PER_USER`; global `CAP_TRANSCRIBE_SECONDS_GLOBAL`, `CAP_EXTRACT_CALLS_GLOBAL`.
 */
export const SPENDING_CAP_DEFAULTS = {
  transcriptionSecondsPerUser: 20 * 60,
  extractionCallsPerUser: 30,
  transcriptionSecondsGlobal: 6 * 60 * 60,
  extractionCallsGlobal: 1000,
} as const

export const UsageMeterSchema = z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nonnegative() })
export const UsageSummarySchema = z.object({
  /** UTC day the counters belong to. */
  day: IsoDate,
  transcriptionSeconds: UsageMeterSchema,
  extractionCalls: UsageMeterSchema,
  resetsAt: Timestamp,
})
export type UsageSummary = z.infer<typeof UsageSummarySchema>

// ---------------------------------------------------------------------------
// Account export (workstream 4). The privacy policy promises a JSON download.
// ---------------------------------------------------------------------------

export const AccountExportSchema = z.object({
  exportedAt: Timestamp,
  format: z.literal('myescapes-export-v1'),
  me: MeSchema,
  visits: z.array(VisitDetailSchema),
  reviews: z.array(ReviewV2Schema),
  wishlist: z.array(WishlistItemV2Schema),
  friends: z.array(FriendSchema),
  invites: z.array(InviteSchema),
  dailyResults: z.array(DailyResultSchema),
  notifications: z.array(NotificationSchema),
  reports: z.array(ReportSchema),
  /** Your character (Phase 3): the saved look (catalogue ids) and wardrobe items bought with keys. */
  avatar: z
    .object({
      outfit: z.record(z.string(), z.string()).nullable(),
      purchases: z.array(z.object({ itemId: z.string(), price: z.number().int(), createdAt: Timestamp })),
    })
    .optional(),
})
export type AccountExport = z.infer<typeof AccountExportSchema>
