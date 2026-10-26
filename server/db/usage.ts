/**
 * Spending caps (workstreams 10 and 11 call these). Per-user daily limits plus a global daily
 * ceiling, counted in `usage_counters` per UTC day. Over a limit, transcription falls back to
 * typing and extraction to mock, with a friendly message.
 *
 * Limits come from env vars (whole numbers), falling back to SPENDING_CAP_DEFAULTS:
 *   CAP_TRANSCRIBE_SECONDS_PER_USER, CAP_EXTRACT_CALLS_PER_USER,
 *   CAP_TRANSCRIBE_SECONDS_GLOBAL, CAP_EXTRACT_CALLS_GLOBAL
 */
import { and, eq, sql } from 'drizzle-orm'
import { SPENDING_CAP_DEFAULTS, type UsageSummary } from '../../src/contracts/models'
import { SPENDING_UNITS, type SpendingCapInfo, type SpendingKind } from '../../src/contracts/errors'
import { HttpError } from '../http'
import type { Db } from './client'
import { GLOBAL_SUBJECT, usageCounters } from './schema'

export interface Caps {
  transcription: { user: number; global: number }
  extraction: { user: number; global: number }
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): Caps {
  return {
    transcription: {
      user: intEnv(env, 'CAP_TRANSCRIBE_SECONDS_PER_USER', SPENDING_CAP_DEFAULTS.transcriptionSecondsPerUser),
      global: intEnv(env, 'CAP_TRANSCRIBE_SECONDS_GLOBAL', SPENDING_CAP_DEFAULTS.transcriptionSecondsGlobal),
    },
    extraction: {
      user: intEnv(env, 'CAP_EXTRACT_CALLS_PER_USER', SPENDING_CAP_DEFAULTS.extractionCallsPerUser),
      global: intEnv(env, 'CAP_EXTRACT_CALLS_GLOBAL', SPENDING_CAP_DEFAULTS.extractionCallsGlobal),
    },
  }
}

/** UTC calendar day `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Next UTC midnight, ISO. */
export function nextUtcMidnight(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return d.toISOString()
}

async function used(db: Db, subject: string, day: string, kind: SpendingKind): Promise<number> {
  const rows = await db
    .select({ amount: usageCounters.amount })
    .from(usageCounters)
    .where(and(eq(usageCounters.subject, subject), eq(usageCounters.day, day), eq(usageCounters.kind, kind)))
  return rows[0]?.amount ?? 0
}

/** Adds `amount` to a counter only if the total stays within `limit`. Returns false when it would not. */
async function addWithin(db: Db, subject: string, day: string, kind: SpendingKind, amount: number, limit: number): Promise<boolean> {
  if (amount > limit) return false
  const rows = await db
    .insert(usageCounters)
    .values({ subject, day, kind, amount })
    .onConflictDoUpdate({
      target: [usageCounters.subject, usageCounters.day, usageCounters.kind],
      set: { amount: sql`${usageCounters.amount} + ${amount}`, updatedAt: new Date() },
      setWhere: sql`${usageCounters.amount} + ${amount} <= ${limit}`,
    })
    .returning({ amount: usageCounters.amount })
  return rows.length > 0
}

export type ReserveResult = { ok: true } | { ok: false; cap: SpendingCapInfo }

/**
 * Atomically count `amount` (seconds for transcription, calls for extraction) against the
 * user's and the global daily cap. Nothing is counted when either cap would be exceeded.
 */
export async function reserveUsage(
  db: Db,
  opts: { userId: string; kind: SpendingKind; amount: number; now?: Date; caps?: Caps },
): Promise<ReserveResult> {
  const now = opts.now ?? new Date()
  const caps = opts.caps ?? capsFromEnv()
  const day = utcDay(now)
  const amount = Math.max(0, Math.ceil(opts.amount))
  const limits = caps[opts.kind]
  const info = async (scope: 'user' | 'global'): Promise<SpendingCapInfo> => ({
    kind: opts.kind,
    scope,
    unit: SPENDING_UNITS[opts.kind],
    limit: limits[scope],
    used: await used(db, scope === 'user' ? opts.userId : GLOBAL_SUBJECT, day, opts.kind),
    resetsAt: nextUtcMidnight(now),
  })
  let failed: 'user' | 'global' | null = null
  try {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db
      if (!(await addWithin(t, opts.userId, day, opts.kind, amount, limits.user))) {
        failed = 'user'
        throw new Error('cap')
      }
      if (!(await addWithin(t, GLOBAL_SUBJECT, day, opts.kind, amount, limits.global))) {
        failed = 'global'
        throw new Error('cap')
      }
    })
  } catch (err) {
    if (!failed) throw err
    return { ok: false, cap: await info(failed) }
  }
  return { ok: true }
}

/** Give back a reservation (e.g. the provider call failed). Never goes below zero. */
export async function releaseUsage(db: Db, opts: { userId: string; kind: SpendingKind; amount: number; now?: Date }) {
  const day = utcDay(opts.now ?? new Date())
  const amount = Math.max(0, Math.ceil(opts.amount))
  for (const subject of [opts.userId, GLOBAL_SUBJECT]) {
    await db
      .update(usageCounters)
      .set({ amount: sql`greatest(${usageCounters.amount} - ${amount}, 0)` })
      .where(and(eq(usageCounters.subject, subject), eq(usageCounters.day, day), eq(usageCounters.kind, opts.kind)))
  }
}

/** A 429 `spending_cap` error with the fallback the client should use. */
export function spendingCapError(cap: SpendingCapInfo): HttpError {
  const what = cap.kind === 'transcription' ? 'voice transcription' : 'review drafting'
  const message =
    cap.scope === 'user'
      ? `You've reached today's limit for ${what}. You can keep going by typing; it resets at midnight UTC.`
      : `My Escapes has reached today's limit for ${what}. You can keep going by typing; it resets at midnight UTC.`
  return new HttpError('spending_cap', message, { cap, fallback: cap.kind === 'transcription' ? 'typing' : 'mock' })
}

export async function usageSummary(db: Db, userId: string, now = new Date(), caps = capsFromEnv()): Promise<UsageSummary> {
  const day = utcDay(now)
  return {
    day,
    transcriptionSeconds: { used: await used(db, userId, day, 'transcription'), limit: caps.transcription.user },
    extractionCalls: { used: await used(db, userId, day, 'extraction'), limit: caps.extraction.user },
    resetsAt: nextUtcMidnight(now),
  }
}
