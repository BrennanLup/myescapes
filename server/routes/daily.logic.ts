/**
 * Escape of the Day server rules (workstream 23), kept pure so they are easy to test.
 *
 * The server's record of a user's day: the first play of a day stores the time zone the player
 * was in. Until that day is over in that stored zone, the user's day stays the same whatever time
 * zone or device clock they send later. After it ends, the next day is worked out from the zone
 * they send (or the last stored one). A user's day never moves backwards, so switching to a
 * western zone can't replay a day, and a streak needs a solve on each calendar day.
 */
import { DAILY_EPOCH, type Streak } from '../../src/contracts/models'
import { addDays, localDay, normalizeTimeZone, startOfDay } from '../../src/daily/engine'

export interface LatestPlay {
  day: string
  timeZone: string
}

export interface ServerDay {
  day: string
  timeZone: string
  /** True when a result row already exists for `day` (its time zone is fixed). */
  fixed: boolean
  /** When the next puzzle opens for this user. */
  nextAt: Date
}

const atLeastEpoch = (day: string) => (day < DAILY_EPOCH ? DAILY_EPOCH : day)

export function resolveServerDay(opts: { latest: LatestPlay | null; requestedTz?: string | null; now: Date }): ServerDay {
  const { latest, now } = opts
  const requested = normalizeTimeZone(opts.requestedTz)
  if (latest && atLeastEpoch(localDay(latest.timeZone, now)) <= latest.day) {
    // Still inside the day of the last play, in the zone fixed then.
    return { day: latest.day, timeZone: latest.timeZone, fixed: true, nextAt: startOfDay(addDays(latest.day, 1), latest.timeZone) }
  }
  const tz = requested ?? latest?.timeZone ?? 'UTC'
  const candidate = atLeastEpoch(localDay(tz, now))
  if (latest && candidate <= latest.day) {
    // The stored day is over in its own zone but not yet in the zone sent now: wait for it.
    return { day: latest.day, timeZone: latest.timeZone, fixed: true, nextAt: startOfDay(addDays(latest.day, 1), tz) }
  }
  return { day: candidate, timeZone: tz, fixed: false, nextAt: startOfDay(addDays(candidate, 1), tz) }
}

export interface PlayRow {
  day: string
  solved: boolean
  finishedAt: Date | null
  timeMs: number
}

/**
 * Streaks count consecutive calendar days with a solve. `current` is the run ending today or
 * yesterday (server day); a failed finish today resets it to 0.
 */
export function computeStreak(rows: readonly PlayRow[], today: string): Streak {
  const finished = rows.filter((r) => r.finishedAt !== null)
  const solvedDays = [...new Set(finished.filter((r) => r.solved).map((r) => r.day))].sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const d of solvedDays) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  const lastSolvedDay = solvedDays.length ? solvedDays[solvedDays.length - 1] : null
  const failedToday = finished.some((r) => r.day === today && !r.solved)
  let current = 0
  if (lastSolvedDay && !failedToday && (lastSolvedDay === today || lastSolvedDay === addDays(today, -1))) current = run
  const solvedTimes = finished.filter((r) => r.solved).map((r) => r.timeMs)
  return {
    current,
    best,
    played: finished.length,
    solved: solvedDays.length,
    lastSolvedDay,
    bestTimeMs: solvedTimes.length ? Math.min(...solvedTimes) : null,
  }
}
