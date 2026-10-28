/**
 * Pure form logic for the mobile confirm step (workstream 14): extraction draft -> editable form
 * -> `POST /api/visits` body. No React here.
 */
import type { CrewTag, ReviewInput, Visibility, VisitFacts, VisitPuzzle, VisitPuzzleInput } from '../../contracts/models'
import { RATING_KEYS, type PuzzleType, type RatingKey, type ReviewDraft } from '../../contracts/types'
import type { CreateVisitBody } from './api'
import type { MatchHints } from '../match/logic'

export const BOOL_FACTS = ['visibleTimer', 'multiRoom', 'flashlights', 'liveActors'] as const
export type BoolFact = (typeof BOOL_FACTS)[number]

export const FACT_LABELS: Record<BoolFact, string> = {
  visibleTimer: 'Visible timer',
  multiRoom: 'Multiple rooms',
  flashlights: 'Flashlights',
  liveActors: 'Live actors',
}

export const RATING_LABELS: Record<RatingKey, string> = {
  overall: 'Overall',
  puzzles: 'Puzzles',
  setting: 'Setting',
  storyline: 'Storyline',
  difficulty: 'Difficulty',
}

export interface FormPuzzle {
  key: string
  description: string
  type: PuzzleType | ''
  memorable: boolean
}

export interface LogForm {
  date: string
  escaped: boolean | null
  escapeTimeMinutes: number | null
  visibleTimer: boolean | null
  multiRoom: boolean | null
  flashlights: boolean | null
  liveActors: boolean | null
  toolsUsed: string[]
  puzzles: FormPuzzle[]
  ratings: Record<RatingKey, { score: number | null; comment: string }>
  visibility: Visibility
  containsSpoilers: boolean
  transcript: string
}

/** Local date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

let seq = 0
export const puzzleKey = () => `mpz_${++seq}`

function uniq(xs: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const t = x.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/** Draft flag paths (`review.ratings.overall.score`) -> form paths (`ratings.overall.score`). Room flags are the matcher's job. */
export function formFlags(flags: readonly string[]): string[] {
  return [...new Set(flags.filter((f) => f.startsWith('review.')).map((f) => f.slice('review.'.length)))]
}

export function draftToForm(draft: ReviewDraft, opts: { today?: string; transcript?: string } = {}): { form: LogForm; flags: string[] } {
  const d = draft.review
  const flags = formFlags(draft.flags ?? [])
  let date = d.date ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = opts.today ?? todayISO()
    if (!flags.includes('date')) flags.push('date')
  }
  const ratings = {} as LogForm['ratings']
  for (const k of RATING_KEYS) ratings[k] = { score: d.ratings?.[k]?.score ?? null, comment: d.ratings?.[k]?.comment ?? '' }
  return {
    form: {
      date,
      escaped: d.escaped,
      escapeTimeMinutes: d.escapeTimeMinutes,
      visibleTimer: d.visibleTimer,
      multiRoom: d.multiRoom,
      flashlights: d.flashlights,
      liveActors: d.liveActors,
      toolsUsed: uniq(d.toolsUsed ?? []),
      puzzles: (d.puzzles ?? []).filter((p) => p.description.trim()).map((p) => ({ key: puzzleKey(), description: p.description.trim().slice(0, 500), type: p.type ?? '', memorable: !!p.memorable })),
      ratings,
      visibility: 'public',
      containsSpoilers: false,
      transcript: opts.transcript ?? d.voiceTranscript ?? '',
    },
    flags,
  }
}

/** Matcher hints from the extraction (or, for an older server, from the draft's room fields). */
export function hintsFrom(draft: ReviewDraft & { hints?: MatchHints }): MatchHints {
  if (draft.hints) return draft.hints
  return { venue: draft.room.company, game: draft.room.name, city: draft.room.city, country: null }
}

export type FormErrors = Record<string, string>

export function validateLogForm(form: LogForm, today: string = todayISO()): FormErrors {
  const e: FormErrors = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) e.date = 'Pick the date you played'
  else if (form.date > today) e.date = "That date hasn't happened yet"
  for (const k of RATING_KEYS) {
    const s = form.ratings[k].score
    if (s === null || !Number.isFinite(s)) e[`ratings.${k}.score`] = `Set ${/^[aeiou]/i.test(RATING_LABELS[k]) ? 'an' : 'a'} ${RATING_LABELS[k].toLowerCase()} score`
    else if (!Number.isInteger(s) || s < 1 || s > 100) e[`ratings.${k}.score`] = 'A whole number from 1 to 100'
  }
  const t = form.escapeTimeMinutes
  if (t !== null && (!Number.isFinite(t) || t < 0 || t > 600)) e.escapeTimeMinutes = 'Minutes between 0 and 600'
  form.puzzles.forEach((p, i) => {
    if (p.description.trim() && !p.type) e[`puzzles.${i}.type`] = 'Pick a puzzle type'
  })
  return e
}

export function factsOf(form: LogForm): VisitFacts {
  return {
    date: form.date,
    escaped: form.escaped,
    escapeTimeMinutes: form.escapeTimeMinutes,
    visibleTimer: form.visibleTimer,
    multiRoom: form.multiRoom,
    flashlights: form.flashlights,
    liveActors: form.liveActors,
    toolsUsed: uniq(form.toolsUsed).map((t) => t.slice(0, 60)).slice(0, 40),
  }
}

export function puzzlesOf(form: LogForm): VisitPuzzleInput[] {
  return form.puzzles
    .filter((p) => p.description.trim() && p.type)
    .slice(0, 40)
    .map((p) => ({ description: p.description.trim().slice(0, 500), type: p.type as PuzzleType, notes: '' }))
}

export function reviewOf(form: LogForm, memorablePuzzleIds: string[] = []): ReviewInput {
  const ratings = {} as ReviewInput['ratings']
  for (const k of RATING_KEYS) ratings[k] = { score: form.ratings[k].score as number, comment: form.ratings[k].comment.trim() }
  return {
    ratings,
    transcript: form.transcript.slice(0, 50_000),
    memorablePuzzleIds,
    visibility: form.visibility,
    containsSpoilers: form.containsSpoilers,
  }
}

/** The body for `POST /api/visits`. Call only on a valid form. */
export function toCreateVisitBody(form: LogForm, gameId: string, crew: CrewTag[]): CreateVisitBody {
  return { gameId, facts: factsOf(form), puzzles: puzzlesOf(form), crew: crew.slice(0, 20), review: reviewOf(form) }
}

/**
 * Memorable puzzles can only be named by id once the visit exists: map the form's memorable
 * puzzles (in saved order) to the created visit's puzzle ids.
 */
export function memorableIds(form: LogForm, saved: readonly VisitPuzzle[]): string[] {
  const kept = form.puzzles.filter((p) => p.description.trim() && p.type)
  const ordered = [...saved].sort((a, b) => a.position - b.position)
  const ids: string[] = []
  kept.forEach((p, i) => {
    if (p.memorable && ordered[i]) ids.push(ordered[i].id)
  })
  return ids
}

/** Parse a number input: '' -> null. */
export function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
