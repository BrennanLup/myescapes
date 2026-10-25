/**
 * Shared data contracts. Every entity in the app is defined here as a Zod schema
 * plus its inferred TypeScript type. Client and server both import from this file.
 *
 * Owned by the orchestrator. Workstreams must not edit; request changes instead.
 */
import { z } from 'zod'

export const Id = z.string().min(1)

/** A photo. `url` is any URL the browser can load (e.g. `/seed/photos/x.svg`, a data: URL, https://...). */
export const PhotoSchema = z.object({
  url: z.string().min(1),
  caption: z.string().optional(),
})
export type Photo = z.infer<typeof PhotoSchema>

export const GENRES = [
  'horror',
  'mystery',
  'adventure',
  'sci-fi',
  'fantasy',
  'heist',
  'historical',
  'comedy',
  'thriller',
  'other',
] as const
export const GenreSchema = z.enum(GENRES)
export type Genre = z.infer<typeof GenreSchema>

export const RoomSchema = z.object({
  id: Id,
  name: z.string().min(1),
  /** Company / brand that runs the room. */
  company: z.string().min(1),
  city: z.string().min(1),
  genre: GenreSchema,
  address: z.string().default(''),
  website: z.string().default(''),
  photos: z.array(PhotoSchema).default([]),
})
export type Room = z.infer<typeof RoomSchema>

/** A score from 1 to 100 with a free-form comment. */
export const RatingSchema = z.object({
  score: z.number().int().min(1).max(100),
  comment: z.string().default(''),
})
export type Rating = z.infer<typeof RatingSchema>

export const RATING_KEYS = ['overall', 'puzzles', 'setting', 'storyline', 'difficulty'] as const
export type RatingKey = (typeof RATING_KEYS)[number]

export const RatingsSchema = z.object({
  overall: RatingSchema,
  puzzles: RatingSchema,
  setting: RatingSchema,
  storyline: RatingSchema,
  difficulty: RatingSchema,
})
export type Ratings = z.infer<typeof RatingsSchema>

export const PUZZLE_TYPES = ['lock-and-key', 'logic', 'math', 'physical', 'search', 'audio-visual'] as const
export const PuzzleTypeSchema = z.enum(PUZZLE_TYPES)
export type PuzzleType = z.infer<typeof PuzzleTypeSchema>

export const PuzzleSchema = z.object({
  id: Id,
  reviewId: Id,
  description: z.string().min(1),
  type: PuzzleTypeSchema,
  memorable: z.boolean().default(false),
})
export type Puzzle = z.infer<typeof PuzzleSchema>

/** Common tool vocabulary. `toolsUsed` accepts any string; these are the suggested values. */
export const COMMON_TOOLS = [
  'UV light',
  'magnets',
  'keypads',
  'padlocks',
  'writing boards',
  'flashlights',
  'mirrors',
  'maps',
  'cipher wheel',
  'RFID',
  'pressure plates',
  'audio clues',
] as const

export const ReviewSchema = z.object({
  id: Id,
  roomId: Id,
  /** ISO date `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Crew member names. */
  crew: z.array(z.string()).default([]),
  ratings: RatingsSchema,
  puzzles: z.array(PuzzleSchema).default([]),
  escaped: z.boolean(),
  /** Minutes taken (or minutes used when failing). Null when unknown. */
  escapeTimeMinutes: z.number().min(0).max(600).nullable(),
  visibleTimer: z.boolean(),
  multiRoom: z.boolean(),
  flashlights: z.boolean(),
  liveActors: z.boolean(),
  toolsUsed: z.array(z.string()).default([]),
  voiceTranscript: z.string().default(''),
  photos: z.array(PhotoSchema).default([]),
})
export type Review = z.infer<typeof ReviewSchema>

export const WishlistItemSchema = z.object({
  id: Id,
  name: z.string().min(1),
  city: z.string().default(''),
  link: z.string().default(''),
  addedBy: z.string().default(''),
  /** Lower number = higher priority. Used as the sort order on the board. */
  priority: z.number().int(),
  /** Extension beyond the brief: lets the crew mark a wish as done. */
  done: z.boolean().default(false),
})
export type WishlistItem = z.infer<typeof WishlistItemSchema>

export const CrewMemberSchema = z.object({
  id: Id,
  name: z.string().min(1),
  userId: z.string().optional(),
  email: z.string().optional(),
})
export type CrewMember = z.infer<typeof CrewMemberSchema>

/** Everything the client needs to render the world. Returned by `GET /api/data`. */
export const DatasetSchema = z.object({
  rooms: z.array(RoomSchema),
  reviews: z.array(ReviewSchema),
  wishlist: z.array(WishlistItemSchema),
  crew: z.array(CrewMemberSchema),
  /** Which storage backend served the data. */
  source: z.enum(['google-sheet', 'seed']),
})
export type Dataset = z.infer<typeof DatasetSchema>

/** A room + its review saved together (the add-entry flow creates both). */
export const EntrySchema = z.object({ room: RoomSchema, review: ReviewSchema })
export type Entry = z.infer<typeof EntrySchema>

// ---------------------------------------------------------------------------
// Extraction draft (voice transcript -> structured review, before confirmation)
// ---------------------------------------------------------------------------

const nullable = <T extends z.ZodTypeAny>(s: T) => s.nullable()

export const DraftRatingSchema = z.object({
  score: nullable(z.number().int().min(1).max(100)),
  comment: z.string().default(''),
})

export const DraftPuzzleSchema = z.object({
  description: z.string(),
  type: nullable(PuzzleTypeSchema),
  memorable: z.boolean().default(false),
})

/**
 * What the extractor returns. Every unknown field is `null` and its dotted path
 * (e.g. `room.city`, `review.ratings.storyline.score`, `review.escapeTimeMinutes`)
 * is listed in `flags`. Nothing is saved until the confirm screen turns it into an Entry.
 */
export const ReviewDraftSchema = z.object({
  room: z.object({
    name: nullable(z.string()),
    company: nullable(z.string()),
    city: nullable(z.string()),
    genre: nullable(GenreSchema),
    address: nullable(z.string()),
    website: nullable(z.string()),
  }),
  review: z.object({
    date: nullable(z.string()),
    crew: z.array(z.string()).default([]),
    ratings: z.object({
      overall: DraftRatingSchema,
      puzzles: DraftRatingSchema,
      setting: DraftRatingSchema,
      storyline: DraftRatingSchema,
      difficulty: DraftRatingSchema,
    }),
    puzzles: z.array(DraftPuzzleSchema).default([]),
    escaped: nullable(z.boolean()),
    escapeTimeMinutes: nullable(z.number()),
    visibleTimer: nullable(z.boolean()),
    multiRoom: nullable(z.boolean()),
    flashlights: nullable(z.boolean()),
    liveActors: nullable(z.boolean()),
    toolsUsed: z.array(z.string()).default([]),
    voiceTranscript: z.string().default(''),
  }),
  flags: z.array(z.string()).default([]),
  /** `claude` when extracted by the Anthropic API, `mock` when the rule-based fallback ran. */
  mode: z.enum(['claude', 'mock']),
})
export type ReviewDraft = z.infer<typeof ReviewDraftSchema>

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const SORT_KEYS = ['city', 'brand', 'genre', 'date', 'rating', 'escapeTime'] as const
export const SortKeySchema = z.enum(SORT_KEYS)
export type SortKey = z.infer<typeof SortKeySchema>

export const SORT_LABELS: Record<SortKey, string> = {
  city: 'City',
  brand: 'Brand',
  genre: 'Genre',
  date: 'Date',
  rating: 'Rating',
  escapeTime: 'Escape time',
}

/** Helper: newest review for a room (rooms can be replayed). */
export function latestReviewFor(roomId: string, reviews: Review[]): Review | undefined {
  let best: Review | undefined
  for (const r of reviews) {
    if (r.roomId !== roomId) continue
    if (!best || r.date > best.date) best = r
  }
  return best
}

/** Helper: short random id, safe in browser and node. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}
