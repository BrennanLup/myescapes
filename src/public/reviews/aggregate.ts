/**
 * The public-average rule (workstream 18), as one pure function so the server (33/5) and the
 * client agree on it:
 *   - Only public, non-hidden reviews count.
 *   - Reviews whose scores are still an untouched copy of someone else's (`scoresCopied`) are left
 *     out of the score averages, so one opinion isn't counted twice.
 *   - Shared facts (escaped, escape time) count once per visit, over visits that have at least one
 *     public, non-hidden review (copied or not: the visit itself is real).
 */
import { RATING_KEYS, type RatingKey } from '../../contracts/types'
import type { Aggregate, Visibility } from '../../contracts/models'

export interface AggregateInput {
  visitId: string
  visibility: Visibility
  hidden: boolean
  scoresCopied: boolean
  ratings: { [K in RatingKey]: { score: number } }
  escaped: boolean | null
  escapeTimeMinutes: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeAggregate(rows: readonly AggregateInput[]): Aggregate {
  const visible = rows.filter((r) => r.visibility === 'public' && !r.hidden)
  const scored = visible.filter((r) => !r.scoresCopied)

  const avg = {} as Aggregate['avg']
  for (const key of RATING_KEYS) {
    avg[key] = scored.length ? round1(scored.reduce((s, r) => s + r.ratings[key].score, 0) / scored.length) : null
  }

  const visits = new Map<string, { escaped: boolean | null; minutes: number | null }>()
  for (const r of visible) if (!visits.has(r.visitId)) visits.set(r.visitId, { escaped: r.escaped, minutes: r.escapeTimeMinutes })
  const known = [...visits.values()].filter((v) => v.escaped !== null)
  const escapedTimes = [...visits.values()].filter((v) => v.escaped === true && v.minutes !== null).map((v) => v.minutes as number)

  return {
    reviewCount: scored.length,
    visitCount: visits.size,
    escapeRate: known.length ? known.filter((v) => v.escaped).length / known.length : null,
    avgEscapeMinutes: escapedTimes.length ? round1(escapedTimes.reduce((a, b) => a + b, 0) / escapedTimes.length) : null,
    avg,
  }
}
