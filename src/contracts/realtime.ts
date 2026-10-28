/**
 * Realtime protocol (Phase 3, workstream C): the JSON messages sent over the websocket at
 * `/api/realtime`, shared by the server hub (server/realtime) and the client (src/net).
 *
 * Connecting: open `wss://<origin>/api/realtime` from a signed-in, onboarded browser (the session
 * cookie authenticates the upgrade; signed-out visitors get a 401 and no socket). The server
 * answers with `hello`. Then send `join` with a home's @handle: only the owner and their accepted
 * friends may join. Each socket is in at most one home at a time; joining another home leaves the
 * first one. Every message is one JSON object with a `type`.
 *
 * Rates (enforced by the server; keep the client under them):
 *   - `state` at most STATE_HZ per second. The server keeps the latest state per player and
 *     broadcasts the changed ones to the home every STATE_BROADCAST_MS in one `states` message.
 *   - `chat` at most CHAT_BURST messages per CHAT_WINDOW_MS, CHAT_MAX_LENGTH characters each.
 *   - `emote` at most EMOTE_BURST per EMOTE_WINDOW_MS.
 *   - Anything sustained above FLOOD_MESSAGES_PER_SECOND closes the socket (4008).
 * A socket that sends nothing for IDLE_TIMEOUT_MS is closed (4000); a connection that stops
 * answering transport pings is terminated. Send `ping` now and then while the tab is open.
 */
import { z } from 'zod'
import { PublicUserSchema } from './models'
import { DatasetSchema } from './types'

export const REALTIME_PATH = '/api/realtime'

export const REALTIME_LIMITS = {
  /** Players in one home, owner included. The owner is always let into their own home. */
  MAX_PLAYERS_PER_HOME: 12,
  /** Open sockets per user (tabs/devices). The oldest is closed when a new one goes over. */
  MAX_SOCKETS_PER_USER: 4,
  /** Largest accepted message, bytes. */
  MAX_MESSAGE_BYTES: 4096,
  STATE_HZ: 10,
  STATE_BROADCAST_MS: 100,
  CHAT_MAX_LENGTH: 200,
  CHAT_BURST: 5,
  CHAT_WINDOW_MS: 10_000,
  EMOTE_BURST: 3,
  EMOTE_WINDOW_MS: 5_000,
  JOIN_BURST: 6,
  JOIN_WINDOW_MS: 10_000,
  FLOOD_MESSAGES_PER_SECOND: 40,
  IDLE_TIMEOUT_MS: 10 * 60_000,
  HEARTBEAT_MS: 20_000,
  /** Guests' right to be in a home (still friends, not blocked) is re-checked this often. */
  REVALIDATE_MS: 60_000,
} as const

/** Close codes the server uses (4000-4999 are application codes). */
export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  IDLE: 4000,
  REPLACED: 4001,
  INVALID: 4002,
  FLOOD: 4008,
  SERVER_SHUTDOWN: 4010,
} as const

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Generous bounds around the 20 m x 16 m room (and future rooms): anything outside is a bad client. */
const Coord = z.number().finite().min(-100).max(100)

export const CAMERA_MODES = ['first', 'third'] as const
export const CameraModeSchema = z.enum(CAMERA_MODES)
export type CameraMode = z.infer<typeof CameraModeSchema>

export const ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'sit', 'emote'] as const
export const AnimationSchema = z.enum(ANIMATIONS)
export type Animation = z.infer<typeof AnimationSchema>

export const EMOTES = ['wave', 'cheer', 'dance'] as const
export const EmoteSchema = z.enum(EMOTES)
export type Emote = z.infer<typeof EmoteSchema>

/** One player's pose. `p` = [x, y, z] in metres (feet position), `yaw`/`pitch` in radians. */
export const PlayerStateSchema = z.object({
  p: z.tuple([Coord, Coord, Coord]),
  yaw: z.number().finite().min(-1000).max(1000),
  pitch: z
    .number()
    .finite()
    .min(-Math.PI / 2 - 0.01)
    .max(Math.PI / 2 + 0.01),
  cam: CameraModeSchema,
  anim: AnimationSchema,
  /** Horizontal speed in m/s, for blending the walk cycle. */
  v: z.number().finite().min(0).max(30).optional(),
})
export type PlayerState = z.infer<typeof PlayerStateSchema>

/**
 * The look a player wears, as workstream B's `Outfit` (src/world/avatars/catalog.ts), kept loose
 * here (a small flat record of ids, colours and flags) and bounded in size. The server ignores the
 * look a client sends: it shows the look saved through `PUT /api/me/avatar` (where ownership of
 * locked items is checked), and an `outfit` message just asks it to reload that saved look.
 */
export const RealtimeOutfitSchema = z
  .record(z.string().min(1).max(32), z.union([z.string().max(64), z.number().finite(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 24, { message: 'too many outfit fields' })
export type RealtimeOutfit = z.infer<typeof RealtimeOutfitSchema>

export const HandleSchema = z.string().trim().min(1).max(40)

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), home: HandleSchema, state: PlayerStateSchema.optional(), outfit: RealtimeOutfitSchema.optional() }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('state'), s: PlayerStateSchema }),
  z.object({ type: z.literal('outfit'), outfit: RealtimeOutfitSchema }),
  z.object({ type: z.literal('emote'), emote: EmoteSchema }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(1000) }),
  /** The owner removes a guest from their home for this visit (the guest can come back). */
  z.object({ type: z.literal('kick'), sid: z.string().min(1).max(64) }),
  z.object({ type: z.literal('ping'), n: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

/** Someone in the same home. `sid` is this connection's id (one user may have two tabs). */
export const RemotePlayerSchema = z.object({
  sid: z.string(),
  user: PublicUserSchema,
  isOwner: z.boolean(),
  state: PlayerStateSchema.nullable(),
  outfit: RealtimeOutfitSchema.nullable(),
  joinedAt: z.number(),
})
export type RemotePlayer = z.infer<typeof RemotePlayerSchema>

/**
 * Where a friend is, seen from the person receiving it:
 * `own_home` (in their own room), `your_home` (in the receiver's room), `elsewhere` (visiting
 * someone else; whose is not said), `lobby` (connected, in no home), or `offline`.
 */
export const PRESENCE_WHERE = ['own_home', 'your_home', 'elsewhere', 'lobby', 'offline'] as const
export const PresenceWhereSchema = z.enum(PRESENCE_WHERE)
export type PresenceWhere = z.infer<typeof PresenceWhereSchema>

export const REALTIME_ERROR_CODES = [
  'invalid',
  'not_found',
  'not_friends',
  'home_full',
  'rate_limited',
  'not_joined',
  'forbidden',
  'unavailable',
] as const
export const RealtimeErrorCodeSchema = z.enum(REALTIME_ERROR_CODES)
export type RealtimeErrorCode = z.infer<typeof RealtimeErrorCodeSchema>

export const LEAVE_REASONS = ['left', 'disconnected', 'idle', 'replaced', 'kicked', 'removed', 'shutdown'] as const
export const LeaveReasonSchema = z.enum(LEAVE_REASONS)
export type LeaveReason = z.infer<typeof LeaveReasonSchema>

export const HomeRefSchema = z.object({ handle: z.string(), owner: PublicUserSchema })
export type HomeRef = z.infer<typeof HomeRefSchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
  /** First message on every socket. */
  z.object({ type: z.literal('hello'), sid: z.string(), you: PublicUserSchema, serverTime: z.number(), limits: z.record(z.string(), z.number()) }),
  /** Answer to `join`: you are in. `players` lists everyone else already there. */
  z.object({ type: z.literal('joined'), home: HomeRefSchema, sid: z.string(), isOwner: z.boolean(), players: z.array(RemotePlayerSchema), serverTime: z.number() }),
  /** You are no longer in the home (answer to `leave`, or the reason you were removed). */
  z.object({ type: z.literal('left'), home: z.string(), reason: LeaveReasonSchema }),
  z.object({ type: z.literal('player_joined'), player: RemotePlayerSchema }),
  z.object({ type: z.literal('player_left'), sid: z.string(), userId: z.string(), reason: LeaveReasonSchema }),
  /** Latest poses of the players whose state changed, stamped with the server time. */
  z.object({ type: z.literal('states'), at: z.number(), players: z.array(z.object({ sid: z.string(), s: PlayerStateSchema })) }),
  z.object({ type: z.literal('outfit'), sid: z.string(), outfit: RealtimeOutfitSchema }),
  z.object({ type: z.literal('emote'), sid: z.string(), emote: EmoteSchema, at: z.number() }),
  /** Chat is relayed to everyone in the home, the sender included, and never stored. */
  z.object({ type: z.literal('chat'), id: z.string(), sid: z.string(), user: PublicUserSchema, text: z.string(), at: z.number() }),
  /** A friend came online, went offline or moved. */
  z.object({ type: z.literal('presence'), user: PublicUserSchema, online: z.boolean(), where: PresenceWhereSchema }),
  /** Someone entered or left your home while you were connected somewhere else ("Mia is in your room"). */
  z.object({ type: z.literal('visitor'), user: PublicUserSchema, joined: z.boolean() }),
  z.object({ type: z.literal('error'), code: RealtimeErrorCodeSchema, message: z.string(), retryAfterMs: z.number().optional(), about: z.string().optional() }),
  z.object({ type: z.literal('pong'), n: z.number().optional(), serverTime: z.number() }),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

// ---------------------------------------------------------------------------
// HTTP shapes (GET /api/presence, GET /api/homes/:handle) live in routes.ts; these are their parts.
// ---------------------------------------------------------------------------

export const FriendPresenceSchema = z.object({
  user: PublicUserSchema,
  online: z.boolean(),
  where: PresenceWhereSchema,
  /** People in this friend's home right now (0 when nobody is there). */
  homeCount: z.number().int().min(0),
})
export type FriendPresence = z.infer<typeof FriendPresenceSchema>

export const PresenceListSchema = z.object({
  /** My accepted friends, online first, then by name. */
  friends: z.array(FriendPresenceSchema),
  /** Who is in my home right now (me excluded). */
  here: z.array(PublicUserSchema),
  /** False when the realtime hub is not running (the lists are then empty/offline). */
  realtime: z.boolean(),
})
export type PresenceList = z.infer<typeof PresenceListSchema>

/**
 * A friend's room, read-only, in the same `Dataset` shape the 3D room renders (`GET /api/homes/:handle`).
 * For a visitor it holds only what they could already see: visits with a review by the owner that
 * is visible to them (public or friends-only, not hidden), without the voice transcript; spoiler
 * comments are blank and puzzle descriptions read SPOILER_PLACEHOLDER unless `?spoilers=1`; crew shows public names only;
 * photo links only where the visitor may open the photo. The owner gets their full room.
 */
/** What a hidden puzzle description reads as in a visitor's room (the Phase 1 shape needs some text). */
export const SPOILER_PLACEHOLDER = 'Spoiler hidden'

export const HomeViewSchema = z.object({
  owner: PublicUserSchema,
  isOwner: z.boolean(),
  /** Always true for a visitor: no editing someone else's board. */
  readOnly: z.boolean(),
  dataset: DatasetSchema,
  /** True when spoiler comments and puzzle descriptions were blanked (ask again with `?spoilers=1`). */
  spoilersHidden: z.boolean(),
  presence: z.object({
    /** The owner has the app open right now. */
    ownerOnline: z.boolean(),
    /** Who is in this home right now (the viewer excluded). */
    visitors: z.array(PublicUserSchema),
  }),
})
export type HomeView = z.infer<typeof HomeViewSchema>

/**
 * Clean a chat line: Unicode NFC, control and invisible formatting characters removed, runs of
 * whitespace collapsed, trimmed, cut to CHAT_MAX_LENGTH characters (code points). Empty -> ''.
 */
export function sanitizeChat(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    // C0/C1 controls, zero-width and bidi override characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, REALTIME_LIMITS.CHAT_MAX_LENGTH).join('').trim()
}
