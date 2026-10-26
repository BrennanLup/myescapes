/**
 * Phase 1 HTTP API contract between the browser and `server/`. All routes are JSON.
 * Phase 2 routes (with auth levels and schemas for every route) live in `routes.ts`;
 * use `callApi(ROUTES.x, ...)` for new code.
 * The server validates inputs with these schemas; the client validates responses.
 *
 * Owned by the orchestrator.
 */
import { z } from 'zod'
import {
  DatasetSchema,
  EntrySchema,
  ReviewDraftSchema,
  WishlistItemSchema,
  type Dataset,
  type Entry,
  type ReviewDraft,
  type WishlistItem,
} from './types'
import { ServerStatusV2Schema, type ServerStatusV2 } from './routes'

export const API = {
  health: '/health',
  /** GET -> Dataset */
  data: '/api/data',
  /** POST Entry -> Entry (saved, normalized) */
  entries: '/api/entries',
  /** POST ExtractRequest -> ReviewDraft */
  extract: '/api/extract',
  /** GET -> WishlistItem[]; PUT WishlistItem[] -> WishlistItem[] (replace whole list) */
  wishlist: '/api/wishlist',
  /** GET -> ServerStatus */
  status: '/api/status',
} as const

export const ExtractRequestSchema = z.object({ transcript: z.string().min(1).max(50_000) })
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>

export const WishlistPutSchema = z.array(WishlistItemSchema)

/** Which features are real vs mocked. Shown in the settings panel. Phase 2 shape (see routes.ts). */
export const ServerStatusSchema = ServerStatusV2Schema
export type ServerStatus = ServerStatusV2

export const HealthSchema = z.object({ ok: z.literal(true) })

export const ErrorSchema = z.object({ error: z.string() })

async function json<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = ErrorSchema.safeParse(await res.json())
      if (body.success) msg = body.data.error
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return schema.parse(await res.json())
}

/** HTTP status of an error thrown by `apiClient` (undefined for network or parse errors). */
export function apiErrorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}

/** Thin typed client used by every workstream. */
export const apiClient = {
  async getData(): Promise<Dataset> {
    return json(await fetch(API.data), DatasetSchema)
  },
  async saveEntry(entry: Entry): Promise<Entry> {
    return json(
      await fetch(API.entries, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) }),
      EntrySchema,
    )
  },
  async extract(transcript: string): Promise<ReviewDraft> {
    return json(
      await fetch(API.extract, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript } satisfies ExtractRequest),
      }),
      ReviewDraftSchema,
    )
  },
  async getWishlist(): Promise<WishlistItem[]> {
    return json(await fetch(API.wishlist), WishlistPutSchema)
  },
  async putWishlist(items: WishlistItem[]): Promise<WishlistItem[]> {
    return json(
      await fetch(API.wishlist, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(items) }),
      WishlistPutSchema,
    )
  },
  async getStatus(): Promise<ServerStatus> {
    return json(await fetch(API.status), ServerStatusSchema)
  },
}
