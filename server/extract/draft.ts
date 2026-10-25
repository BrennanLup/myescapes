/**
 * Shared helpers for building and finishing a ReviewDraft, used by both extractors.
 */
import { RATING_KEYS, type ReviewDraft } from '../../src/contracts/types'

/** Flag added when the Claude path failed and the mock extractor produced the draft. */
export const FALLBACK_FLAG = 'extraction.fallback'

export function emptyDraft(transcript: string, mode: ReviewDraft['mode']): ReviewDraft {
  const rating = () => ({ score: null, comment: '' })
  return {
    room: { name: null, company: null, city: null, genre: null, address: null, website: null },
    review: {
      date: null,
      crew: [],
      ratings: { overall: rating(), puzzles: rating(), setting: rating(), storyline: rating(), difficulty: rating() },
      puzzles: [],
      escaped: null,
      escapeTimeMinutes: null,
      visibleTimer: null,
      multiRoom: null,
      flashlights: null,
      liveActors: null,
      toolsUsed: [],
      voiceTranscript: transcript,
    },
    flags: [],
    mode,
  }
}

const ROOM_FIELDS = ['name', 'company', 'city', 'genre', 'address', 'website'] as const
const REVIEW_NULLABLE = [
  'date',
  'escaped',
  'escapeTimeMinutes',
  'visibleTimer',
  'multiRoom',
  'flashlights',
  'liveActors',
] as const

/** Dotted paths of every null field in the draft, in a stable order. */
export function nullPaths(draft: ReviewDraft): string[] {
  const out: string[] = []
  for (const k of ROOM_FIELDS) if (draft.room[k] === null) out.push(`room.${k}`)
  for (const k of REVIEW_NULLABLE) if (draft.review[k] === null) out.push(`review.${k}`)
  for (const k of RATING_KEYS) if (draft.review.ratings[k].score === null) out.push(`review.ratings.${k}.score`)
  draft.review.puzzles.forEach((p, i) => {
    if (p.type === null) out.push(`review.puzzles.${i}.type`)
  })
  return out
}

/**
 * Final pass for any draft: every null field is flagged, extra flags are kept
 * (deduplicated), and the transcript is attached.
 */
export function finalizeDraft(draft: ReviewDraft, transcript: string, extraFlags: string[] = []): ReviewDraft {
  const flags = new Set<string>()
  for (const f of nullPaths(draft)) flags.add(f)
  for (const f of draft.flags) if (typeof f === 'string' && f.trim()) flags.add(f.trim())
  for (const f of extraFlags) flags.add(f)
  return { ...draft, review: { ...draft.review, voiceTranscript: transcript }, flags: [...flags] }
}
