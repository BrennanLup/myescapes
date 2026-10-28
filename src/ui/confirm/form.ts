/**
 * Pure form logic for the confirm screen: draft -> editable form -> Entry.
 * No React in here so it is easy to unit test.
 */
import type { GameSummary, VenueSummary } from '@/contracts/models'
import {
  EntrySchema,
  GENRES,
  makeId,
  RATING_KEYS,
  type Entry,
  type Genre,
  type PuzzleType,
  type RatingKey,
  type ReviewDraft,
  type Room,
} from '@/contracts/types'

export const BOOL_FEATURES = ['visibleTimer', 'multiRoom', 'flashlights', 'liveActors'] as const
export type BoolFeature = (typeof BOOL_FEATURES)[number]

export const FEATURE_LABELS: Record<BoolFeature, string> = {
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

/** "an overall score", "a setting score" (for the "Set …" messages). */
export function scoreName(k: RatingKey): string {
  const w = RATING_LABELS[k].toLowerCase()
  return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w} score`
}

export interface FormPuzzle {
  /** Local React key; not saved. */
  key: string
  description: string
  type: PuzzleType | ''
  memorable: boolean
}

/** The directory game the room fields came from (picked in the room search). */
export interface DirectoryLink {
  gameId: string
  name: string
  venueName: string
  city: string
  country: string
}

/** The directory venue picked in the room search (a venue row, no specific room). */
export interface VenueLink {
  venueId: string
  /** What the company and city fields were set to: editing either one unlinks the venue. */
  company: string
  city: string
  country: string
}

export interface FormState {
  room: { name: string; company: string; city: string; genre: Genre | ''; address: string; website: string }
  /** Set while the room fields still describe a directory game; saving then reuses that game. */
  link: DirectoryLink | null
  /** Set while the company and city still describe a picked directory venue; saving adds the room there. */
  venue: VenueLink | null
  review: {
    date: string
    crew: string[]
    ratings: Record<RatingKey, { score: number | null; comment: string }>
    puzzles: FormPuzzle[]
    escaped: boolean | null
    escapeTimeMinutes: number | null
    visibleTimer: boolean | null
    multiRoom: boolean | null
    flashlights: boolean | null
    liveActors: boolean | null
    toolsUsed: string[]
    voiceTranscript: string
  }
  mode: ReviewDraft['mode']
}

/** Local date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

let keySeq = 0
export const puzzleKey = () => `pzk_${++keySeq}`

const uniq = (xs: string[]) => {
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

/**
 * Flags that describe the whole draft rather than one field. They are shown as a
 * note at the top of the form instead of a "check this" chip.
 */
export const DRAFT_NOTES: Record<string, string> = {
  'extraction.fallback': "Claude couldn't be reached, so the offline extractor filled this in. Give every field a quick look.",
}

/** Turn an extractor draft into editable form state, the initial field flags and any draft-level notes. */
export function draftToForm(
  draft: ReviewDraft,
  today: string = todayISO(),
): { form: FormState; flags: string[]; notes: string[] } {
  const d = draft.review
  const all = [...new Set(draft.flags ?? [])]
  const notes = all.filter((f) => f in DRAFT_NOTES).map((f) => DRAFT_NOTES[f])
  // Field flags are dotted paths into room/review; anything else is not a field.
  const flags = all.filter((f) => !(f in DRAFT_NOTES) && /^(room|review)\./.test(f))
  let date = d.date ?? ''
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = today
    if (!flags.includes('review.date')) flags.push('review.date')
  }
  const ratings = {} as FormState['review']['ratings']
  for (const k of RATING_KEYS) {
    const r = d.ratings?.[k]
    ratings[k] = { score: r?.score ?? null, comment: r?.comment ?? '' }
  }
  const form: FormState = {
    room: {
      name: draft.room.name ?? '',
      company: draft.room.company ?? '',
      city: draft.room.city ?? '',
      genre: draft.room.genre ?? '',
      address: draft.room.address ?? '',
      website: draft.room.website ?? '',
    },
    link: null,
    venue: null,
    review: {
      date,
      crew: uniq(d.crew ?? []),
      ratings,
      puzzles: (d.puzzles ?? []).map((p) => ({ key: puzzleKey(), description: p.description, type: p.type ?? '', memorable: !!p.memorable })),
      escaped: d.escaped,
      escapeTimeMinutes: d.escapeTimeMinutes,
      visibleTimer: d.visibleTimer,
      multiRoom: d.multiRoom,
      flashlights: d.flashlights,
      liveActors: d.liveActors,
      toolsUsed: uniq(d.toolsUsed ?? []),
      voiceTranscript: d.voiceTranscript ?? '',
    },
    mode: draft.mode,
  }
  return { form, flags, notes }
}

export type FormErrors = Record<string, string>

/** Validate the form. Keys are dotted field paths; empty object means valid. */
export function validateForm(form: FormState): FormErrors {
  const e: FormErrors = {}
  const { room, review } = form
  if (!room.name.trim()) e['room.name'] = 'Room name is required'
  if (!room.company.trim()) e['room.company'] = 'Company is required'
  if (!room.city.trim()) e['room.city'] = 'City is required'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date)) e['review.date'] = 'Pick the date you played'
  for (const k of RATING_KEYS) {
    const s = review.ratings[k].score
    if (s === null || !Number.isFinite(s)) e[`review.ratings.${k}.score`] = `Set ${scoreName(k)}`
    else if (!Number.isInteger(s) || s < 1 || s > 100) e[`review.ratings.${k}.score`] = 'Score must be a whole number 1-100'
  }
  if (review.escaped === null) e['review.escaped'] = 'Did you escape?'
  const t = review.escapeTimeMinutes
  if (t !== null && (!Number.isFinite(t) || t < 0 || t > 600)) e['review.escapeTimeMinutes'] = 'Minutes must be between 0 and 600'
  // The four features are optional ("Not sure" is null), as on the phone.
  review.puzzles.forEach((p, i) => {
    const hasText = p.description.trim().length > 0
    if (hasText && !p.type) e[`review.puzzles.${i}.type`] = 'Pick a puzzle type'
    if (!hasText && p.type) e[`review.puzzles.${i}.description`] = 'Describe the puzzle (or remove it)'
  })
  return e
}

/** Human label for a dotted path (used in the flag summary and save reason). */
export function labelFor(path: string): string {
  const parts = path.split('.')
  if (parts[0] === 'room') {
    const m: Record<string, string> = { name: 'Room name', company: 'Company', city: 'City', genre: 'Genre', address: 'Address', website: 'Website' }
    return m[parts[1]] ?? path
  }
  if (parts[0] === 'review') {
    const f = parts[1]
    if (f === 'ratings') {
      const k = parts[2] as RatingKey
      const base = RATING_LABELS[k] ?? parts[2]
      return parts[3] === 'comment' ? `${base} comment` : `${base} score`
    }
    if (f === 'puzzles') {
      if (parts[2] === undefined) return 'Puzzles'
      const n = Number(parts[2]) + 1
      const sub = parts[3] === 'type' ? ' type' : parts[3] === 'description' ? ' description' : parts[3] === 'memorable' ? ' memorable' : ''
      return `Puzzle ${n}${sub}`
    }
    const m: Record<string, string> = {
      date: 'Date',
      crew: 'Crew',
      escaped: 'Escaped?',
      escapeTimeMinutes: 'Escape time',
      toolsUsed: 'Tools',
      voiceTranscript: 'Transcript',
      ...FEATURE_LABELS,
    }
    return m[f] ?? path
  }
  return path
}

const norm = (s: string) => s.trim().toLowerCase()

/** Existing room with the same name + company + city (case-insensitive), if any. */
export function findExistingRoom(room: Pick<FormState['room'], 'name' | 'company' | 'city'>, rooms: Room[]): Room | undefined {
  const n = norm(room.name)
  const c = norm(room.company)
  const ci = norm(room.city)
  if (!n || !c || !ci) return undefined
  return rooms.find((r) => norm(r.name) === n && norm(r.company) === c && norm(r.city) === ci)
}

/**
 * Build a validated Entry from a valid form. Throws if the form is invalid.
 * Reuses an existing room id when the room was already logged (a revisit).
 */
export function draftToEntry(form: FormState, existingRooms: Room[] = []): Entry {
  const errors = validateForm(form)
  const keys = Object.keys(errors)
  if (keys.length) throw new Error(`Form is not complete: ${keys.map(labelFor).join(', ')}`)
  const f = form.room
  const linked = form.link && linkMatches(form) ? form.link : null
  const atVenue = !linked && form.venue && venueMatches(form) ? form.venue : null
  const existing = (linked && existingRooms.find((r) => r.id === linked.gameId)) || findExistingRoom(f, existingRooms)
  const room: Room = existing
    ? {
        ...existing,
        address: existing.address || f.address.trim(),
        website: existing.website || f.website.trim(),
      }
    : {
        // A directory game id: the server saves the visit against that game (server/db/dataset.ts).
        id: linked ? linked.gameId : makeId('room'),
        name: f.name.trim(),
        company: f.company.trim(),
        city: f.city.trim(),
        // Genre is optional in the form ("Not sure"); a room still needs one, so it is "other".
        genre: f.genre || 'other',
        address: f.address.trim(),
        website: f.website.trim(),
        photos: [],
        // A picked directory venue: the server adds the room there instead of matching by name.
        ...(atVenue ? { venueId: atVenue.venueId } : {}),
      }
  const r = form.review
  const reviewId = makeId('rev')
  const ratings = {} as Entry['review']['ratings']
  for (const k of RATING_KEYS) ratings[k] = { score: r.ratings[k].score as number, comment: r.ratings[k].comment.trim() }
  const entry: Entry = {
    room,
    review: {
      id: reviewId,
      roomId: room.id,
      date: r.date,
      crew: uniq(r.crew),
      ratings,
      puzzles: r.puzzles
        .filter((p) => p.description.trim())
        .map((p) => ({ id: makeId('pz'), reviewId, description: p.description.trim(), type: p.type as PuzzleType, memorable: p.memorable })),
      escaped: r.escaped as boolean,
      escapeTimeMinutes: r.escapeTimeMinutes,
      visibleTimer: r.visibleTimer,
      multiRoom: r.multiRoom,
      flashlights: r.flashlights,
      liveActors: r.liveActors,
      toolsUsed: uniq(r.toolsUsed),
      voiceTranscript: r.voiceTranscript,
      photos: [],
    },
  }
  return EntrySchema.parse(entry)
}

/** After removing puzzle `idx`, shift `review.puzzles.N.*` flags down so they stay attached. */
export function shiftPuzzleFlags(flags: string[], idx: number): string[] {
  const out: string[] = []
  for (const fl of flags) {
    const m = /^review\.puzzles\.(\d+)(\..*)?$/.exec(fl)
    if (!m) {
      out.push(fl)
      continue
    }
    const n = Number(m[1])
    if (n === idx) continue
    out.push(n > idx ? `review.puzzles.${n - 1}${m[2] ?? ''}` : fl)
  }
  return out
}

const isGenre = (g: string | null | undefined): g is Genre => !!g && (GENRES as readonly string[]).includes(g)

/**
 * Fill the room fields from a directory game. `venue`, when known, adds the address and prefers
 * the venue's brand as the company. Keeps a genre the user already chose if the game has none.
 */
export function linkGame(form: FormState, game: GameSummary, venue?: Pick<VenueSummary, 'name' | 'brand' | 'address'> | null): FormState {
  const company = (venue?.brand || game.venueName || venue?.name || '').trim()
  return {
    ...form,
    room: {
      ...form.room,
      name: game.name,
      company,
      city: game.city,
      genre: isGenre(game.genre) ? game.genre : form.room.genre,
      address: venue?.address?.trim() || form.room.address,
    },
    link: { gameId: game.id, name: game.name, venueName: company, city: game.city, country: game.country },
    venue: null,
  }
}

/** A venue without a specific room: fill the company, city and address, keep the room name. */
export function linkVenue(form: FormState, venue: Pick<VenueSummary, 'name' | 'brand' | 'address' | 'city'> & Partial<Pick<VenueSummary, 'id' | 'country'>>): FormState {
  const company = (venue.brand || venue.name).trim()
  return {
    ...form,
    room: { ...form.room, company, city: venue.city, address: venue.address || form.room.address },
    link: null,
    venue: venue.id ? { venueId: venue.id, company, city: venue.city, country: venue.country ?? '' } : null,
  }
}

/** "Add a new room": the typed text becomes the room name; a picked venue stays (the new room is there). */
export function newRoomNamed(form: FormState, name: string): FormState {
  return { ...form, room: { ...form.room, name: name.trim() }, link: null }
}

/** Whether the company and city still describe the picked venue (editing either one unlinks it). */
export function venueMatches(form: FormState): boolean {
  const v = form.venue
  if (!v) return false
  return norm(form.room.company) === norm(v.company) && norm(form.room.city) === norm(v.city)
}

/** Whether the room fields still describe the linked game (editing the name, company or city unlinks it). */
export function linkMatches(form: FormState): boolean {
  const l = form.link
  if (!l) return false
  return norm(form.room.name) === norm(l.name) && norm(form.room.company) === norm(l.venueName) && norm(form.room.city) === norm(l.city)
}

/**
 * Whether a directory game can be linked without asking: the form still has no directory link or
 * venue, and its room name and city are exactly the game's (case and spacing aside). Used for the
 * extractor's "Is it …?" match, so an exact hit doesn't leave Company empty and blocking Save.
 */
export function canAutoLink(form: FormState, game: Pick<GameSummary, 'name' | 'city'>): boolean {
  if (form.link || form.venue) return false
  const city = norm(form.room.city)
  return !!city && norm(form.room.name) === norm(game.name) && city === norm(game.city)
}

/** Genre for display: "sci-fi" -> "Sci-fi" (sentence case, like every other label in the form). */
export function genreLabel(g: string): string {
  return g ? g[0].toUpperCase() + g.slice(1) : g
}
