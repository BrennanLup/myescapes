/**
 * API error contract (Phase 2). Every non-2xx JSON response is an `ApiError`.
 * `error` is a human-readable message that is safe to show; `code` is for code.
 *
 * Owned by the orchestrator (workstream 1).
 */
import { z } from 'zod'

export const ERROR_CODES = [
  /** 400: the request failed schema validation. `details` lists the issues. */
  'invalid',
  /** 401: no signed-in user. */
  'unauthorized',
  /** 403: signed in, but not allowed (see "Who can do what" in docs/PHASE2_PLAN.md). */
  'forbidden',
  /** 404: missing, or hidden from this user (never reveal that a private thing exists). */
  'not_found',
  /** 409: a uniqueness or state conflict (already friends, review already exists...). */
  'conflict',
  /** 409: the @handle is taken or reserved. */
  'handle_taken',
  /** 403: a public review needs a display name and @handle first (onboarding). */
  'onboarding_required',
  /** 429: a per-user or global daily spending cap is reached. Body is a `SpendingCapError`. */
  'spending_cap',
  /** 429: too many requests in a short time. */
  'rate_limited',
  /** 413: upload too large. */
  'too_large',
  /** 415: unsupported upload type. */
  'unsupported_media',
  /** 400: an Escape of the Day result for a day that is not the user's server day. */
  'wrong_day',
  /** 410: an invite that expired, was revoked or was already used. */
  'gone',
  /** 501: the route exists in the contract but is not built yet. */
  'not_implemented',
  /** 503: the database is not reachable or not migrated yet. */
  'db_unavailable',
  /** 502: an upstream provider (OpenAI, Anthropic, Google) failed. */
  'upstream',
  /** 500: anything else. */
  'internal',
] as const
export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

/** Default HTTP status for each code. Server helpers use this; clients may switch on `code`. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  handle_taken: 409,
  onboarding_required: 403,
  spending_cap: 429,
  rate_limited: 429,
  too_large: 413,
  unsupported_media: 415,
  wrong_day: 400,
  gone: 410,
  not_implemented: 501,
  db_unavailable: 503,
  upstream: 502,
  internal: 500,
}

export const SPENDING_KINDS = ['transcription', 'extraction'] as const
export const SpendingKindSchema = z.enum(SPENDING_KINDS)
export type SpendingKind = z.infer<typeof SpendingKindSchema>

/** What a spending cap counts: seconds of audio for transcription, calls for extraction. */
export const SPENDING_UNITS: Record<SpendingKind, 'seconds' | 'calls'> = {
  transcription: 'seconds',
  extraction: 'calls',
}

export const SpendingCapInfoSchema = z.object({
  kind: SpendingKindSchema,
  /** `user`: this user's daily limit. `global`: the app-wide daily ceiling (env vars). */
  scope: z.enum(['user', 'global']),
  unit: z.enum(['seconds', 'calls']),
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  /** ISO timestamp of the next reset (midnight UTC). */
  resetsAt: z.string(),
})
export type SpendingCapInfo = z.infer<typeof SpendingCapInfoSchema>

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: ErrorCodeSchema.optional(),
  /** Validation issues (`invalid`) or other structured detail. Never secrets. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** Present when `code` is `spending_cap`. */
  cap: SpendingCapInfoSchema.optional(),
  /** What the client should fall back to, e.g. `typing` (transcription) or `mock` (extraction). */
  fallback: z.enum(['typing', 'mock']).optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

/** A 429 when a spending cap is hit. Transcription falls back to typing, extraction to mock. */
export const SpendingCapErrorSchema = ApiErrorSchema.extend({
  code: z.literal('spending_cap'),
  cap: SpendingCapInfoSchema,
  fallback: z.enum(['typing', 'mock']),
})
export type SpendingCapError = z.infer<typeof SpendingCapErrorSchema>

/** Error thrown by `callApi` for non-2xx responses. */
export class ApiCallError extends Error {
  readonly status: number
  readonly code: ErrorCode | undefined
  readonly body: ApiError | undefined
  constructor(status: number, body: ApiError | undefined, fallbackMessage: string) {
    super(body?.error ?? fallbackMessage)
    this.name = 'ApiCallError'
    this.status = status
    this.code = body?.code
    this.body = body
  }
}
