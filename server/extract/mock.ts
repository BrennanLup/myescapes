/**
 * Rule-based extractor used when no ANTHROPIC_API_KEY is set (and as the fallback
 * when the Claude path fails). Regexes and keyword lists only; anything it cannot
 * find stays null and is flagged.
 */
import { PUZZLE_TYPES, type Genre, type PuzzleType, type RatingKey, type ReviewDraft } from '../../src/contracts/types'
import { emptyDraft, finalizeDraft } from './draft'

export const KNOWN_CITIES = [
  'San Francisco',
  'Toronto',
  'Oakland',
  'New York',
  'Vancouver',
  'Montreal',
  'Los Angeles',
  'Chicago',
  'Seattle',
  'Berkeley',
  'San Jose',
  'Portland',
  'Boston',
  'Austin',
  'Denver',
  'London',
  'Ottawa',
  'Calgary',
] as const

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/** Split into sentences, keeping decimals like "8.5" intact. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'“0-9])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Split a sentence into clauses so a negation in one clause does not leak into another. */
function clauses(sentence: string): string[] {
  return sentence.split(/[,;]|\b(?:but|though|although|however|whereas)\b/i).map((c) => c.trim()).filter(Boolean)
}

const NEGATION = /\b(?:no|not|never|none|nope|without|lacked|lacking|missing)\b|n['’]t\b/i

/**
 * Look for `keyword` in the text. Returns true when mentioned affirmatively, false when
 * negated ("no timer", "didn't have flashlights", "timer? no"), null when not mentioned.
 */
export function mentionPolarity(text: string, keyword: RegExp): boolean | null {
  let result: boolean | null = null
  // Keep spoken Q&A in one sentence: "Visible timer? No." -> "Visible timer - No."
  const normalized = text.replace(/\?\s+(yes|yeah|yep|no|nope)\b/gi, ' - $1')
  for (const s of sentences(normalized)) {
    for (const clause of clauses(s)) {
      const m = keyword.exec(clause)
      if (!m) continue
      const before = clause.slice(0, m.index).split(/\s+/).slice(-6).join(' ')
      const after = clause.slice(m.index + m[0].length)
      const negatedBefore = NEGATION.test(before)
      const answeredNo = /^\s*[?:-]*\s*(?:no|nope|none|false)\b/i.test(after)
      const answeredYes = /^\s*[?:-]*\s*(?:yes|yep|yeah|true)\b/i.test(after)
      // A later explicit statement wins over an earlier one.
      result = answeredYes ? true : !(negatedBefore || answeredNo)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

const CAP_WORD = `[A-Z0-9][\\w'’&!-]*`
const CONNECTOR = `(?:of|the|and|&|a|an|to|for|on)`
/** A run of capitalised words, allowing lowercase connectors in the middle ("Escape from the Tower"). */
const TITLE = `(?:${CAP_WORD})(?:\\s+(?:${CONNECTOR}\\s+)*${CAP_WORD})*`
const STOP_WORDS = new Set(['I', 'We', 'It', 'They', 'He', 'She', 'You', 'My', 'Our', 'This', 'That', 'There'])
const NOT_PLACES = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'The', 'A', 'An', 'I', 'We', 'My', 'Our',
])

function cleanTitle(raw: string | undefined): string | null {
  if (!raw) return null
  let t = raw.trim().replace(/^["'“”‘’]+|["'“”‘’.,!?]+$/g, '').trim()
  // Drop trailing connector words picked up at the end of the run.
  t = t.replace(new RegExp(`(?:\\s+${CONNECTOR})+$`, 'i'), '').trim()
  if (!t || STOP_WORDS.has(t)) return null
  return t
}

export function findRoomName(text: string): string | null {
  const quoted = `["“']([^"”']{2,60})["”']`
  const patterns = [
    new RegExp(`\\b(?:called|named|titled)\\s+${quoted}`),
    new RegExp(`\\b(?:called|named|titled)\\s+(${TITLE})`),
    new RegExp(`\\broom\\s+(?:was|is)\\s+${quoted}`),
    new RegExp(`\\broom\\s+(?:was|is)\\s+(${TITLE})`),
    new RegExp(`\\b(?:did|played|tried|finished|beat|booked)\\s+${quoted}`),
    new RegExp(`\\b(?:did|played|tried|finished|beat|booked)\\s+(${TITLE})`),
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    const name = cleanTitle(m?.[1])
    if (name && !/^(?:A|An|The)$/.test(name)) return name
  }
  return null
}

export function findCity(text: string): string | null {
  const lower = text.toLowerCase()
  let best: { city: string; index: number } | null = null
  for (const city of KNOWN_CITIES) {
    const i = lower.indexOf(city.toLowerCase())
    if (i >= 0 && (!best || i < best.index)) best = { city, index: i }
  }
  if (best) return best.city
  const re = /\bin\s+(?:downtown\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g
  for (const m of text.matchAll(re)) {
    const first = m[1].split(' ')[0]
    if (!NOT_PLACES.has(first)) return m[1]
  }
  return null
}

export function findCompany(text: string, exclude: (string | null)[] = []): string | null {
  const bad = exclude.filter(Boolean).map((s) => s!.toLowerCase())
  const patterns = [
    new RegExp(`\\b(?:run by|made by|by|from)\\s+(${TITLE})`, 'g'),
    new RegExp(`\\b(?:at|over at)\\s+(${TITLE})`, 'g'),
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = cleanTitle(m[1])
      if (!name) continue
      const first = name.split(/\s+/)[0]
      if (NOT_PLACES.has(first) || /^\d/.test(name)) continue
      if (bad.some((b) => b === name.toLowerCase() || b.startsWith(name.toLowerCase()))) continue
      if (KNOWN_CITIES.some((c) => c.toLowerCase() === name.toLowerCase())) continue
      return name
    }
  }
  return null
}

const GENRE_SYNONYMS: [Genre, RegExp][] = [
  ['sci-fi', /\b(?:space(?:ship|station)?|alien|robots?|futuristic|astronaut|galaxy|planet)\b/i],
  ['horror', /\b(?:haunted|zombies?|creepy|scary|terrifying|demon|asylum|serial killer)\b/i],
  ['mystery', /\b(?:detective|murder|whodunn?it|investigat\w*|sherlock|crime scene)\b/i],
  ['heist', /\b(?:bank|vault|robbery|steal|stealing|casino|jewel thief)\b/i],
  ['fantasy', /\b(?:wizard|witch|magic(?:al)?|dragons?|fairy|enchanted|spell)\b/i],
  ['adventure', /\b(?:pirates?|jungle|temple|treasure|explorer|expedition|tomb)\b/i],
  ['historical', /\b(?:egypt\w*|medieval|victorian|ancient|world war|renaissance|1920s|prohibition)\b/i],
  ['comedy', /\b(?:funny|hilarious|silly|goofy|comedic)\b/i],
  ['thriller', /\b(?:spy|bomb|suspense|espionage|secret agent|countdown to)\b/i],
]

const GENRE_DIRECT: [Genre, RegExp][] = [
  ['sci-fi', /\b(?:sci[- ]?fi|science fiction|scifi)\b/i],
  ['horror', /\bhorror\b/i],
  ['mystery', /\bmystery\b/i],
  ['adventure', /\badventure\b/i],
  ['fantasy', /\bfantasy\b/i],
  ['heist', /\bheist\b/i],
  ['historical', /\bhistor(?:ical|y)\b/i],
  ['comedy', /\bcomedy\b/i],
  ['thriller', /\bthriller\b/i],
]

export function findGenre(text: string): Genre | null {
  let best: { genre: Genre; index: number } | null = null
  for (const [genre, re] of GENRE_DIRECT) {
    const m = re.exec(text)
    if (m && (!best || m.index < best.index)) best = { genre, index: m.index }
  }
  if (best) return best.genre
  let top: { genre: Genre; hits: number } | null = null
  for (const [genre, re] of GENRE_SYNONYMS) {
    const hits = [...text.matchAll(new RegExp(re.source, 'gi'))].length
    if (hits > 0 && (!top || hits > top.hits)) top = { genre, hits }
  }
  return top?.genre ?? null
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

const RATING_WORDS: Record<RatingKey, RegExp> = {
  overall: /\b(?:overall|total|in general|all in all|give it|gave it|rate it|rated it|i'?d say)\b/gi,
  puzzles: /\bpuzzles?\b/gi,
  setting: /\b(?:setting|set design|sets?|decor|theming|atmosphere|immersion|scenery|production)\b/gi,
  storyline: /\b(?:story(?:line)?|plot|narrative|lore)\b/gi,
  difficulty: /\b(?:difficulty|difficult|hardness|challenge level)\b/gi,
}

/** Words that, right after a bare number, mean it is not a score. */
const NOT_SCORE_UNIT = /^\s*(?:minutes?|mins?|seconds?|hours?|people|players|of us|friends|rooms?|puzzles?|clues?|hints?|%|percent|pm|am|th|st|nd|rd)\b/i

interface FoundScore {
  index: number
  score: number
}

function toScore(value: number, scale: number | null): number | null {
  let s: number
  if (scale === 10) s = value * 10
  else if (scale === 5) s = value * 20
  else if (scale === 100) s = value
  else s = value <= 10 ? value * 10 : value
  s = Math.round(s)
  if (!Number.isFinite(s) || s < 1 || s > 100) return null
  return s
}

/** Explicitly scaled scores in a sentence: "87 out of 100", "9/10", "8.5 out of ten". */
function scaledScores(sentence: string): FoundScore[] {
  const out: FoundScore[] = []
  const re = /\b(\d{1,3}(?:\.\d+)?)\s*(?:out of|outta|\/|of)\s*(100|10|5|a hundred|ten|five)\b/gi
  for (const m of sentence.matchAll(re)) {
    const scaleWord = m[2].toLowerCase()
    const scale = scaleWord === 'a hundred' ? 100 : scaleWord === 'ten' ? 10 : scaleWord === 'five' ? 5 : Number(scaleWord)
    const s = toScore(Number(m[1]), scale)
    if (s !== null) out.push({ index: m.index, score: s })
  }
  return out
}

/** Bare numbers right after a category keyword: "difficulty about 70", "overall 85". */
function bareScores(sentence: string, keyword: RegExp, taken: FoundScore[]): FoundScore[] {
  const out: FoundScore[] = []
  for (const k of sentence.matchAll(new RegExp(keyword.source, 'gi'))) {
    const tail = sentence.slice(k.index + k[0].length)
    const m = /^(?:\W+(?:[a-z']+\W+){0,4}?)?(\d{1,3}(?:\.\d+)?)\b/i.exec(tail)
    if (!m) continue
    const numIndex = k.index + k[0].length + m[0].length - m[1].length
    const rest = sentence.slice(numIndex + m[1].length)
    if (NOT_SCORE_UNIT.test(rest)) continue
    if (/^\s*(?:out of|outta|\/|of)\s*(?:100|10|5|a hundred|ten|five)\b/i.test(rest)) continue // already scaled
    if (taken.some((t) => t.index === numIndex)) continue
    const s = toScore(Number(m[1]), null)
    if (s !== null) out.push({ index: numIndex, score: s })
  }
  return out
}

/** Find which category a score at `index` belongs to: the nearest preceding keyword, else the nearest following. */
function categoryAt(sentence: string, index: number): RatingKey | null {
  let before: { key: RatingKey; dist: number } | null = null
  let after: { key: RatingKey; dist: number } | null = null
  for (const key of Object.keys(RATING_WORDS) as RatingKey[]) {
    for (const m of sentence.matchAll(new RegExp(RATING_WORDS[key].source, 'gi'))) {
      const end = m.index + m[0].length
      if (end <= index) {
        const d = index - end
        if (!before || d < before.dist) before = { key, dist: d }
      } else if (m.index > index) {
        const d = m.index - index
        if (!after || d < after.dist) after = { key, dist: d }
      }
    }
  }
  return before?.key ?? after?.key ?? null
}

export function findRatings(text: string): ReviewDraft['review']['ratings'] {
  const ratings: ReviewDraft['review']['ratings'] = {
    overall: { score: null, comment: '' },
    puzzles: { score: null, comment: '' },
    setting: { score: null, comment: '' },
    storyline: { score: null, comment: '' },
    difficulty: { score: null, comment: '' },
  }
  const ss = sentences(text)
  for (const s of ss) {
    const scaled = scaledScores(s)
    const found: FoundScore[] = [...scaled]
    for (const key of Object.keys(RATING_WORDS) as RatingKey[]) found.push(...bareScores(s, RATING_WORDS[key], found))
    found.sort((a, b) => a.index - b.index)
    for (const f of found) {
      // A lone scaled score with no category word ("I'd say 8 out of 10") is the overall score.
      const key = categoryAt(s, f.index) ?? 'overall'
      if (ratings[key].score !== null) continue
      ratings[key] = { score: f.score, comment: s }
    }
  }
  // Comment-only mentions for categories without a score (not puzzles: too many incidental mentions).
  for (const key of ['setting', 'storyline', 'difficulty'] as const) {
    if (ratings[key].comment) continue
    const s = ss.find((x) => new RegExp(RATING_WORDS[key].source, 'i').test(x))
    if (s) ratings[key] = { ...ratings[key], comment: s }
  }
  return ratings
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export function findEscaped(text: string): boolean | null {
  if (
    /\b(?:did\s*n['’]?t|did not|could\s*n['’]?t|could not|failed to|never|not)\s+(?:quite\s+|actually\s+|manage to\s+)?(?:escape|get out|make it|finish|beat|solve it)/i.test(text) ||
    /\b(?:ran out of time|time ran out|we failed|we lost|out of time|no escape for us)\b/i.test(text)
  )
    return false
  if (/\b(?:escaped|got out|made it out|beat the room|broke out|we won|finished (?:it|the room)|solved it|made it)\b/i.test(text)) return true
  return null
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
}
const NUM = `(\\d{1,3}(?:\\.\\d+)?|${Object.keys(NUM_WORDS).join('|')})`
const toNum = (s: string) => (s.toLowerCase() in NUM_WORDS ? NUM_WORDS[s.toLowerCase()] : Number(s))

export function findEscapeTime(text: string): number | null {
  const left = new RegExp(`\\bwith\\s+(?:about\\s+|just\\s+|only\\s+)?${NUM}\\s+(?:minutes?|mins?)\\s+(?:left|remaining|to spare|on the clock)`, 'i').exec(text)
  if (left) return Math.max(0, 60 - toNum(left[1]))
  const took = new RegExp(
    `\\b(?:in|took(?:\\s+us)?|after|time was|time of|finished at|clocked)\\s+(?:about\\s+|around\\s+|just\\s+|only\\s+|under\\s+)?${NUM}\\s*(?:minutes?|mins?)\\b`,
    'i',
  ).exec(text)
  if (took) return toNum(took[1])
  const flat = new RegExp(`\\b${NUM}\\s+minutes?\\s+(?:flat|exactly|on the dot)\\b`, 'i').exec(text)
  if (flat) return toNum(flat[1])
  return null
}

// ---------------------------------------------------------------------------
// Features, tools, crew
// ---------------------------------------------------------------------------

const FEATURE_KEYWORDS = {
  visibleTimer: /\b(?:visible\s+)?(?:timer|clock|countdown)\b/i,
  multiRoom: /\b(?:multi[- ]?room|multiple rooms|more than one room|second room|another room|next room|several rooms|(?:two|three|four|five) rooms|rooms opened up)\b/i,
  flashlights: /\b(?:flash ?lights?|torch(?:es)?)\b/i,
  liveActors: /\b(?:live actors?|actors?|actress|actresses|live performers?|performers?|in-character host)\b/i,
} as const

function findMultiRoom(text: string): boolean | null {
  if (/\b(?:single room|one room|just one room|only one room|one big room)\b/i.test(text)) {
    const p = mentionPolarity(text, /\b(?:single room|one room|just one room|only one room|one big room)\b/i)
    if (p !== null) return !p
  }
  return mentionPolarity(text, FEATURE_KEYWORDS.multiRoom)
}

/** A "UV flashlight" is a UV light, not a flashlight. */
const withoutUvTorches = (text: string) => text.replace(/\b(?:uv|ultra ?violet|black ?light)\s+(?:flash ?lights?|torch(?:es)?)\b/gi, 'UV light')

export function findFeatures(text: string) {
  return {
    visibleTimer: mentionPolarity(text, FEATURE_KEYWORDS.visibleTimer),
    multiRoom: findMultiRoom(text),
    flashlights: mentionPolarity(withoutUvTorches(text), FEATURE_KEYWORDS.flashlights),
    liveActors: mentionPolarity(text, FEATURE_KEYWORDS.liveActors),
  }
}

/** COMMON_TOOLS entries with spoken synonyms. */
export const TOOL_SYNONYMS: [string, RegExp][] = [
  ['UV light', /\b(?:uv|ultra ?violet|black ?light)(?:\s+(?:light|torch|flashlight|lamp|pen))?\b/i],
  ['magnets', /\bmagnet(?:s|ic)?\b/i],
  ['keypads', /\bkey ?pads?\b/i],
  ['padlocks', /\b(?:pad ?locks?|combination locks?|combo locks?)\b/i],
  ['writing boards', /\b(?:writing boards?|white ?boards?|chalk ?boards?|dry[- ]erase(?: boards?)?|scratch paper|notepads?|clipboards?)\b/i],
  ['flashlights', /\b(?:flash ?lights?|torch(?:es)?)\b/i],
  ['mirrors', /\bmirrors?\b/i],
  ['maps', /\bmaps?\b/i],
  ['cipher wheel', /\b(?:cipher|decoder|caesar) wheels?\b/i],
  ['RFID', /\b(?:rfid|nfc)\b/i],
  ['pressure plates', /\bpressure (?:plates?|pads?|sensors?)\b/i],
  ['audio clues', /\b(?:audio clues?|sound clues?|audio recordings?|voice recordings?|tape recorder|recordings?)\b/i],
]

export function findTools(text: string): string[] {
  const out: string[] = []
  for (const [tool, re] of TOOL_SYNONYMS) {
    if (mentionPolarity(tool === 'flashlights' ? withoutUvTorches(text) : text, re) === true) out.push(tool)
  }
  return out
}

const NAME = `[A-Z][a-z]+(?:-[A-Z][a-z]+)?`
const NOT_NAMES = new Set([
  'The', 'A', 'An', 'My', 'Our', 'Some', 'Friends', 'Family', 'Me', 'Us', 'I', 'We', 'It', 'This', 'That', 'Just', 'Only',
  'Visible', 'Live', 'No', 'About', 'Around', 'Time', 'Minutes',
])

export function findCrew(text: string, exclude: (string | null)[] = []): string[] {
  const bad = new Set(exclude.filter(Boolean).flatMap((s) => s!.split(/\s+/)))
  const list = `(${NAME}(?:\\s*,\\s*${NAME})*(?:\\s*,?\\s*(?:and|&)\\s+${NAME})?)`
  const res = [
    new RegExp(`\\b(?:with|crew was|team was|group was|crew:|team:|played it with|went with)\\s+(?:my\\s+(?:friends?|crew|team|buddies)\\s+)?${list}`, 'g'),
    new RegExp(`\\b(?:friends?|crew|team)\\s+${list}`, 'g'),
    // "Sam, Lee and I tried ..." / "me, Sam and Lee"
    new RegExp(`(${NAME}(?:\\s*,\\s*${NAME})*),?\\s+and\\s+(?:I|me)\\b`, 'g'),
    new RegExp(`\\b(?:me|myself)\\s*,\\s*${list}`, 'g'),
  ]
  const names: string[] = []
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const parts = m[1].split(/\s*(?:,|\band\b|&)\s*/).map((p) => p.trim()).filter(Boolean)
      if (parts.some((p) => NOT_NAMES.has(p) || bad.has(p) || NOT_PLACES.has(p))) continue
      for (const p of parts) if (!names.includes(p)) names.push(p)
    }
  }
  return names
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

const PUZZLE_TRIGGER = /\b(?:puzzles?|(?:un)?lock(?:s|ed)?|padlocks?|codes?|ciphers?|riddles?|search(?:ed|ing)?|combination|keypad)\b/i

const PUZZLE_TYPE_KEYWORDS: Record<PuzzleType, RegExp> = {
  'lock-and-key': /\b(?:(?:un)?lock(?:s|ed)?|padlocks?|keys?|combination|keypad|codes?|safe)\b/gi,
  logic: /\b(?:logic(?:al)?|riddles?|deduc\w*|patterns?|sequences?|ciphers?|decod\w*|deciphe\w*|sudoku|clever)\b/gi,
  math: /\b(?:math\w*|numbers?|count(?:ing)?|calculat\w*|add(?:ed)? up|sums?|equations?|arithmetic)\b/gi,
  physical: /\b(?:physical\w*|rotat\w*|turn(?:ed|ing)?|push\w*|pull\w*|lift\w*|climb\w*|crawl\w*|throw\w*|maze|balanc\w*|align\w*|stack\w*|dexterity)\b/gi,
  search: /\b(?:search\w*|find(?:ing)?|found|hidden|hunt\w*|scour\w*|look(?:ed|ing)? (?:everywhere|around)|scavenger)\b/gi,
  'audio-visual': /\b(?:audio|sounds?|listen\w*|music|songs?|notes?|lights?|video|screens?|projector|projection|uv|colou?rs?|morse|visual)\b/gi,
}

export function classifyPuzzle(sentence: string): PuzzleType | null {
  let best: { type: PuzzleType; hits: number } | null = null
  for (const type of PUZZLE_TYPES) {
    const hits = [...sentence.matchAll(PUZZLE_TYPE_KEYWORDS[type])].length
    if (hits > 0 && (!best || hits > best.hits)) best = { type, hits }
  }
  return best?.type ?? null
}

const MEMORABLE = /\b(?:favou?rite|best|loved|memorable|highlight|coolest|stand-?out)\b/i

export function findPuzzles(
  text: string,
  ratingSentences: Set<string>,
  names: (string | null)[] = [],
): ReviewDraft['review']['puzzles'] {
  const out: ReviewDraft['review']['puzzles'] = []
  const proper = names.filter((n): n is string => Boolean(n))
  for (const s of sentences(text)) {
    // Ignore trigger words inside proper names ("Puzzle Palace", "The Lock Room").
    const plain = proper.reduce((acc, n) => acc.split(n).join(' '), s)
    if (!PUZZLE_TRIGGER.test(plain)) continue
    if (ratingSentences.has(s)) continue
    // A bare heading like "Puzzles." or "Puzzles, then." is not a puzzle.
    if (plain.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).length < 4) continue
    // Sentences that only talk about puzzles in general ("the puzzles were great") are not a puzzle.
    if (/^\s*(?:the\s+)?puzzles\s+(?:were|are)\b/i.test(s)) continue
    // "We used a UV light, magnets and ..." lists tools, not a puzzle.
    if (/^\s*(?:we|i)\s+used\b/i.test(s) && !/\bpuzzles?\b/i.test(s)) continue
    out.push({ description: s.replace(/^(?:and|also|then|so)\s+/i, '').replace(/^./, (c) => c.toUpperCase()), type: classifyPuzzle(s), memorable: MEMORABLE.test(s) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

const STREET = /\b(\d{1,5}\s+(?:[A-Z][\w'-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Place|Pl|Square|Sq|Wharf|Court|Ct|Terrace|Parkway|Pkwy)\b\.?)/

/** "the address is 1420 Valencia Street" or any "<number> <Name> Street" phrase. */
export function findAddress(text: string): string | null {
  const said = /\baddress (?:is|was)\s+([^.;!?]+?)(?:,\s+and\b|\s+and\s+the\b|[.;!?]|$)/i.exec(text)
  if (said) return said[1].trim().replace(/,$/, '')
  const m = STREET.exec(text)
  return m ? m[1].replace(/\.$/, '').trim() : null
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const pad = (n: number) => String(n).padStart(2, '0')

export function findDate(text: string, now: Date = new Date()): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (iso) return iso[0]
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i.test(text)) return ymd(now)
  if (/\b(?:yesterday|last night)\b/i.test(text)) return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const monthRe = MONTHS.map((m) => m.slice(0, 3) + `(?:${m.slice(3)})?`).join('|')
  const md = new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text)
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text)
  let month: number | null = null
  let day: number | null = null
  let year: number | null = null
  if (md) {
    month = MONTHS.findIndex((m) => m.startsWith(md[1].toLowerCase().slice(0, 3)))
    day = Number(md[2])
    year = md[3] ? Number(md[3]) : null
  } else if (dm) {
    month = MONTHS.findIndex((m) => m.startsWith(dm[2].toLowerCase().slice(0, 3)))
    day = Number(dm[1])
    year = dm[3] ? Number(dm[3]) : null
  }
  if (month === null || month < 0 || day === null || day < 1 || day > 31) return null
  if (year === null) {
    year = now.getFullYear()
    // A month/day later than today without a year most likely means last year.
    if (new Date(year, month, day) > now) year -= 1
  }
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function mockExtract(transcript: string, opts: { now?: Date } = {}): ReviewDraft {
  const text = transcript.replace(/\s+/g, ' ').trim()
  const draft = emptyDraft(transcript, 'mock')

  const name = findRoomName(text)
  const city = findCity(text)
  const company = findCompany(text, [name, city])
  draft.room = { ...draft.room, name, city, company, genre: findGenre(text), address: findAddress(text) }

  const ratings = findRatings(text)
  const ratingSentences = new Set(
    Object.values(ratings)
      .filter((r) => r.score !== null)
      .map((r) => r.comment),
  )
  const escaped = findEscaped(text)
  draft.review = {
    ...draft.review,
    date: findDate(text, opts.now),
    crew: findCrew(text, [name, city, company]),
    ratings,
    puzzles: findPuzzles(text, ratingSentences, [name, company, city]),
    escaped,
    escapeTimeMinutes: findEscapeTime(text),
    ...findFeatures(text),
    toolsUsed: findTools(text),
  }
  return finalizeDraft(draft, transcript)
}
