/**
 * Extraction v2 (workstream 11): transcript -> ReviewDraft + directory hints + an optional notice,
 * under the per-user and global daily spending caps.
 *
 * Mode and caps:
 * - Claude runs when ANTHROPIC_API_KEY is set (or a test injects a client). Each Claude call
 *   reserves one `extraction` unit for the signed-in user (signed-out callers share one
 *   `__anonymous__` bucket with the per-user limit) and for the global ceiling, before calling.
 *   If the Claude path fails and the mock extractor fills in, the unit is given back.
 * - Over a cap, or when the usage counter can't be written (database down), it fails closed: the
 *   mock extractor runs and `notice` explains why, so the person can still confirm and save.
 * - Mock mode costs nothing, so it never touches the counters.
 */
import type { ReviewDraft } from '../../src/contracts/types'
import type { SpendingCapInfo } from '../../src/contracts/errors'
import type { AppContext, SessionUser } from '../context'
import type { Db } from '../db/client'
import { capsFromEnv, releaseUsage, reserveUsage } from '../db/usage'
import { anthropicClientFactory, claudeExtract, type ClientFactory } from './claude'
import { buildHints, nearbyDirectory, nearbyPromptText, validLatLng, type ExtractHints, type NearbyVenue } from './hints'
import { mockExtract } from './mock'

/** Usage-counter subject shared by every signed-out caller (no IPs are stored). */
export const ANONYMOUS_SUBJECT = '__anonymous__'

export function extractionMode(env: NodeJS.ProcessEnv = process.env): 'claude' | 'mock' {
  return env.ANTHROPIC_API_KEY ? 'claude' : 'mock'
}

export type ExtractV2Result = ReviewDraft & { hints: ExtractHints; notice: string | null }

export interface ExtractDeps {
  /** Inject a client (tests). When given, the Claude path runs regardless of the env key. */
  clientFactory?: ClientFactory
  /** Warning sink (defaults to console.warn). Messages never include the API key. */
  log?: (msg: string) => void
}

export interface ExtractV2Input {
  transcript: string
  lat?: number
  lng?: number
  user: SessionUser | null
  ctx: AppContext
  deps?: ExtractDeps
}

export const NOTICES = {
  dbUnavailable:
    "AI drafting is unavailable for a moment, so this draft was filled in by the simple offline extractor. Please check each field before saving.",
  signedOutCap:
    "Today's AI drafting for signed-out visitors is used up, so this draft was filled in by the simple offline extractor. Sign in to get AI drafts, or check each field before saving.",
}

export function capNotice(cap: SpendingCapInfo, signedIn: boolean): string {
  if (!signedIn) return NOTICES.signedOutCap
  if (cap.scope === 'global') {
    return "My Escapes has reached today's AI drafting limit, so this draft was filled in by the simple offline extractor. Please check each field before saving; AI drafts come back after midnight UTC."
  }
  return `You've used today's ${cap.limit} AI-drafted reviews, so this draft was filled in by the simple offline extractor. Please check each field before saving; the limit resets at midnight UTC.`
}

function dbOrNull(ctx: AppContext): Db | null {
  try {
    return ctx.db()
  } catch {
    return null
  }
}

async function nearbyOrEmpty(db: Db | null, lat: number | undefined, lng: number | undefined, log: (m: string) => void): Promise<NearbyVenue[]> {
  if (!db || !validLatLng(lat, lng)) return []
  try {
    return await nearbyDirectory(db, lat!, lng!)
  } catch (err) {
    log(`nearby directory lookup failed (${err instanceof Error ? err.name : 'unknown'}); continuing without it`)
    return []
  }
}

export async function extractV2(input: ExtractV2Input): Promise<ExtractV2Result> {
  const { transcript, user, ctx } = input
  const deps = input.deps ?? {}
  const log = deps.log ?? ((m: string) => console.warn(`[extract] ${m}`))
  const now = ctx.now()
  const db = dbOrNull(ctx)
  let useClaude = Boolean(deps.clientFactory) || extractionMode(ctx.env) === 'claude'
  let notice: string | null = null
  let reservedFor: string | null = null

  if (useClaude) {
    const subject = user?.id ?? ANONYMOUS_SUBJECT
    if (!db) {
      useClaude = false
      notice = NOTICES.dbUnavailable
    } else {
      try {
        const r = await reserveUsage(db, { userId: subject, kind: 'extraction', amount: 1, now, caps: capsFromEnv(ctx.env) })
        if (r.ok) reservedFor = subject
        else {
          useClaude = false
          notice = capNotice(r.cap, Boolean(user))
        }
      } catch (err) {
        log(`usage counter unavailable (${err instanceof Error ? err.name : 'unknown'}); using mock extractor`)
        useClaude = false
        notice = NOTICES.dbUnavailable
      }
    }
  }

  const nearby = await nearbyOrEmpty(db, input.lat, input.lng, log)

  let draft: ReviewDraft
  let rawHints: Partial<ExtractHints> = {}
  if (useClaude) {
    const client = deps.clientFactory ? deps.clientFactory() : anthropicClientFactory(ctx.env)
    const res = await claudeExtract(transcript, { client, now, log, nearbyText: nearbyPromptText(nearby) })
    draft = res.draft
    rawHints = res.hints
    if (res.fellBack && reservedFor && db) {
      try {
        await releaseUsage(db, { userId: reservedFor, kind: 'extraction', amount: 1, now })
      } catch {
        // Over-counting by one is harmless; never fail the request for it.
      }
    }
  } else {
    draft = mockExtract(transcript, { now })
  }

  return { ...draft, hints: buildHints(draft, { transcript, raw: rawHints, nearby }), notice }
}
