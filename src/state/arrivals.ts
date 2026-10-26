/**
 * "The new polaroid pins itself to your board": which rooms arrived since this browser last
 * opened the 3D room. Only a timestamp is kept (localStorage, like the sound and graphics
 * settings); no room data is stored in the browser.
 */
import type { LogRow } from '@/contracts/models'

export const LAST_SEEN_KEY = 'myescapes.room.lastSeen.v1'
/** At most this many rooms fly in at once; the rest just appear. */
export const MAX_ARRIVALS = 5

const stamp = (row: LogRow) => row.myReview?.createdAt ?? null

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN
  return Date.parse(iso)
}

/** Room ids (game ids) of rows whose review was created after `lastSeen`, oldest first. */
export function newArrivals(rows: readonly LogRow[], lastSeen: string | null): string[] {
  const since = ms(lastSeen)
  if (Number.isNaN(since)) return []
  const fresh = rows
    .map((r) => ({ id: r.game.id, t: ms(stamp(r)) }))
    .filter((r) => !Number.isNaN(r.t) && r.t > since)
    .sort((a, b) => a.t - b.t)
  return [...new Set(fresh.map((r) => r.id))].slice(-MAX_ARRIVALS)
}

/** The newest of the rows' review timestamps and `now`, as ISO. */
export function lastSeenMark(rows: readonly LogRow[], now: number = Date.now()): string {
  let best = now
  for (const r of rows) {
    const t = ms(stamp(r))
    if (!Number.isNaN(t) && t > best) best = t
  }
  return new Date(best).toISOString()
}

export function readLastSeen(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? null
  } catch {
    return null
  }
}

export function writeLastSeen(rows: readonly LogRow[], now?: number): void {
  try {
    globalThis.localStorage?.setItem(LAST_SEEN_KEY, lastSeenMark(rows, now))
  } catch {
    /* private mode: no fly-in next time, nothing else changes */
  }
}
