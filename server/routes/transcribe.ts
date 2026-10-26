/**
 * Transcription: audio upload -> transcript, under the per-user and global spending caps.
 * Owned by workstream 10 (server/routes/transcribe*).
 *
 * POST /api/transcribe (signed in, multipart):
 *   audio           the recording (<= 25 MB; webm, ogg, mp4/m4a, mp3/mpeg, wav, flac)
 *   durationSeconds what the recorder measured (optional; the server never counts less than the
 *                   file size allows, so a wrong value can't dodge the cap)
 *   clientId        the phone's id for this recording, so a retry after a dropped response returns
 *                   the same transcript without being counted (or sent to OpenAI) twice
 *   language        optional ISO 639-1 hint, e.g. `en`
 *
 * Privacy: the audio is read into memory only, sent to the provider, then zero-filled and dropped
 * before the response goes out. It is never written to disk or the database (`audioDeleted: true`).
 *
 * Caps: seconds are reserved with `reserveUsage` before the provider call and given back if it
 * fails; afterwards the reservation is trimmed to the provider-measured duration. Over a cap the
 * answer is 429 `spending_cap` with `fallback: 'typing'`. Provider failures are 502 `upstream`,
 * also with `fallback: 'typing'`. Mock mode counts too, so the meter and the fallback can be
 * exercised without a key.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { capsFromEnv, releaseUsage, reserveUsage, spendingCapError, usageSummary } from '../db/usage'
import { defineRoute, HttpError, httpError } from '../http'
import { describeProviderError, mockTranscriber, openaiTranscriber, type Transcriber } from './transcribe.provider'

export function transcriptionMode(env: NodeJS.ProcessEnv = process.env): 'openai' | 'mock' {
  return env.OPENAI_API_KEY ? 'openai' : 'mock'
}

// ---------------------------------------------------------------------------
// Upload rules
// ---------------------------------------------------------------------------

/** Accepted audio types (parameters like `;codecs=opus` are ignored) and the extension sent on. */
export const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'application/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mpga': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
}
const EXTENSIONS = new Set(['webm', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'mp3', 'mpeg', 'mpga', 'wav', 'flac'])

/** Resolves the upload's type from its MIME type, else its file extension. Null when unsupported. */
export function audioKind(mimetype: string | undefined, filename: string | undefined): { mime: string; ext: string } | null {
  const mime = (mimetype ?? '').split(';')[0].trim().toLowerCase()
  if (AUDIO_TYPES[mime]) return { mime, ext: AUDIO_TYPES[mime] }
  const generic = mime === '' || mime === 'application/octet-stream'
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (generic && ext && EXTENSIONS.has(ext)) {
    const norm = ext === 'oga' || ext === 'opus' ? 'ogg' : ext === 'mpga' || ext === 'mpeg' ? 'mp3' : ext
    const back = Object.entries(AUDIO_TYPES).find(([, e]) => e === norm)?.[0] ?? 'application/octet-stream'
    return { mime: back, ext: norm }
  }
  return null
}

/**
 * The shortest the recording can plausibly be, from its size: compressed voice never exceeds
 * ~320 kbit/s (40 kB/s); uncompressed or lossless audio stays under ~192 kB/s (48 kHz stereo 16-bit).
 */
export function minPlausibleSeconds(bytes: number, ext: string): number {
  const maxBytesPerSecond = ext === 'wav' || ext === 'flac' ? 192_000 : 40_000
  return bytes / maxBytesPerSecond
}

/** Seconds to reserve before the provider call: the larger of the client's claim and the size floor, at least 1. */
export function secondsToReserve(claimed: number | null, bytes: number, ext: string): number {
  return Math.max(1, Math.ceil(Math.max(claimed ?? 0, minPlausibleSeconds(bytes, ext))))
}

const FieldsSchema = z.object({
  durationSeconds: z.coerce.number().min(0).max(4 * 60 * 60).optional(),
  clientId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'letters, digits and _ . : - only').optional(),
  language: z.string().trim().regex(/^[a-z]{2}$/, 'a two-letter ISO 639-1 code').optional(),
})

interface Upload {
  audio: Buffer | null
  filename: string
  mimetype: string
  fields: Record<string, string>
}

async function readUpload(req: FastifyRequest): Promise<Upload> {
  if (!req.isMultipart()) {
    throw httpError('unsupported_media', 'Send the recording as multipart/form-data with an `audio` file.')
  }
  const out: Upload = { audio: null, filename: '', mimetype: '', fields: {} }
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'audio' || out.audio) {
        // Drain anything unexpected without keeping it.
        await part.toBuffer().then((b) => b.fill(0))
        continue
      }
      out.audio = await part.toBuffer()
      out.filename = part.filename
      out.mimetype = part.mimetype
    } else if (typeof part.value === 'string' && part.value !== '') {
      out.fields[part.fieldname] = part.value
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Retry cache: a dropped response must not cost a second transcription.
// ---------------------------------------------------------------------------

export interface TranscribeResult {
  transcript: string
  durationSeconds: number
  mode: 'openai' | 'mock'
  clientId: string | null
  audioDeleted: true
}

export class RecentResults {
  private readonly map = new Map<string, { at: number; value: TranscribeResult }>()
  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly max = 200,
  ) {}
  get(key: string, now: number): TranscribeResult | null {
    const hit = this.map.get(key)
    if (!hit) return null
    if (now - hit.at > this.ttlMs) {
      this.map.delete(key)
      return null
    }
    return hit.value
  }
  set(key: string, value: TranscribeResult, now: number) {
    this.map.delete(key)
    this.map.set(key, { at: now, value })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface TranscribeRoutesOptions {
  /** Inject a provider (tests). Defaults to OpenAI with OPENAI_API_KEY, else the mock. */
  transcriber?: Transcriber
  /** Warning sink (defaults to console.warn). Never receives keys, audio or transcripts. */
  log?: (msg: string) => void
}

/** Per-IP burst limit on top of the daily caps. */
export const TRANSCRIBE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' }

export async function transcribeRoutes(app: FastifyInstance, ctx: AppContext, opts: TranscribeRoutesOptions = {}) {
  const log = opts.log ?? ((m: string) => console.warn(`[transcribe] ${m}`))
  let provider: Transcriber | null = opts.transcriber ?? null
  const getProvider = () => (provider ??= transcriptionMode(ctx.env) === 'openai' ? openaiTranscriber(ctx.env) : mockTranscriber())
  const recent = new RecentResults()

  defineRoute(
    app,
    ctx,
    ROUTES.transcribe,
    async ({ req, user }) => {
      const upload = await readUpload(req)
      const audio = upload.audio
      try {
        if (!audio || audio.length === 0) throw httpError('invalid', 'No recording received. Attach it as the `audio` file field.')
        const kind = audioKind(upload.mimetype, upload.filename)
        if (!kind) {
          throw httpError('unsupported_media', 'That recording format is not supported. Use webm, ogg, m4a/mp4, mp3, wav or flac.')
        }
        const parsed = FieldsSchema.safeParse(upload.fields)
        if (!parsed.success) {
          const details = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
          throw new HttpError('invalid', `Invalid upload fields: ${details.map((d) => `${d.path}: ${d.message}`).join('; ')}`, { details })
        }
        const { durationSeconds: claimed, clientId, language } = parsed.data
        const now = ctx.now()
        const cacheKey = clientId ? `${user.id}\u0000${clientId}` : null
        const cached = cacheKey ? recent.get(cacheKey, now.getTime()) : null
        if (cached) return cached

        const db = ctx.db()
        const reserved = secondsToReserve(claimed ?? null, audio.length, kind.ext)
        const r = await reserveUsage(db, { userId: user.id, kind: 'transcription', amount: reserved, now, caps: capsFromEnv(ctx.env) })
        if (!r.ok) throw spendingCapError(r.cap)

        const p = getProvider()
        let text: string
        let measured: number | null
        try {
          const out = await p.transcribe({ audio, filename: `voice-note.${kind.ext}`, mimeType: kind.mime, language })
          text = out.text
          measured = out.durationSeconds
        } catch (err) {
          await releaseUsage(db, { userId: user.id, kind: 'transcription', amount: reserved, now }).catch(() => {})
          log(`provider failed (${describeProviderError(err)})`)
          throw httpError('upstream', "We couldn't transcribe that recording. You can type your notes instead, or try again.", { fallback: 'typing' })
        }

        // Trim the reservation to what the provider measured (never below the size floor).
        const seconds = Math.max(measured ?? claimed ?? 0, minPlausibleSeconds(audio.length, kind.ext))
        const counted = Math.max(1, Math.ceil(seconds))
        if (counted < reserved) {
          await releaseUsage(db, { userId: user.id, kind: 'transcription', amount: reserved - counted, now }).catch(() => {})
        } else if (counted > reserved) {
          // The provider measured more than claimed. Count what still fits; the transcript is already paid for.
          await reserveUsage(db, { userId: user.id, kind: 'transcription', amount: counted - reserved, now, caps: capsFromEnv(ctx.env) }).catch(() => null)
        }

        const result: TranscribeResult = {
          transcript: text,
          durationSeconds: Math.round(seconds * 10) / 10,
          mode: p.mode,
          clientId: clientId ?? null,
          audioDeleted: true,
        }
        if (cacheKey) recent.set(cacheKey, result, now.getTime())
        return result
      } finally {
        // The raw audio never outlives the request (privacy policy).
        audio?.fill(0)
        upload.audio = null
      }
    },
    { config: { rateLimit: TRANSCRIBE_RATE_LIMIT } },
  )

  defineRoute(app, ctx, ROUTES.usage, async ({ user }) => usageSummary(ctx.db(), user.id, ctx.now(), capsFromEnv(ctx.env)))
}
