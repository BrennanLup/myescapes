/**
 * Formatting helpers shared by the public pages (workstreams 16-19). Pure, no React.
 */
import type { Genre, RatingKey } from '../../contracts/types'
import type { PublicUser } from '../../contracts/models'

export const RATING_LABELS: Record<RatingKey, string> = {
  overall: 'Overall',
  puzzles: 'Puzzles',
  setting: 'Setting',
  storyline: 'Story',
  difficulty: 'Difficulty',
}

const GENRE_LABELS: Record<Genre, string> = {
  horror: 'Horror',
  mystery: 'Mystery',
  adventure: 'Adventure',
  'sci-fi': 'Sci-fi',
  fantasy: 'Fantasy',
  heist: 'Heist',
  historical: 'Historical',
  comedy: 'Comedy',
  thriller: 'Thriller',
  other: 'Other',
}

export function genreLabel(genre: Genre | null | undefined): string | null {
  return genre ? (GENRE_LABELS[genre] ?? genre) : null
}

/** `2026-10-12` -> `Oct 12, 2026`. Parsed as a calendar date (no time-zone shift). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** A 1-100 score (or an average) as a whole number, an em dash when missing. */
export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined || Number.isNaN(score) ? '—' : String(Math.round(score))
}

export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return null
  return `${Math.round(minutes)} min`
}

export function formatPercent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function playersLabel(min: number | null, max: number | null): string | null {
  if (min && max) return min === max ? plural(min, 'player') : `${min}-${max} players`
  if (min) return `${min}+ players`
  if (max) return `Up to ${max} players`
  return null
}

/**
 * The public name of a user: display name plus @handle. Built only from `PublicUser`, which has no
 * email field, so an email can never reach a public page through this.
 */
export function publicName(user: PublicUser): { name: string; handle: string | null } {
  const handle = user.handle ? `@${user.handle}` : null
  const name = user.displayName.trim() || handle || 'Player'
  return { name, handle }
}

export function initials(name: string): string {
  const parts = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return s.toUpperCase()
}

/**
 * "Open in Google Maps" link. With a stored place id, Google's documented Maps URL links straight
 * to the place; otherwise it is a search for the name and address. We only ever link, never fetch.
 */
export function googleMapsLink(opts: { url?: string | null; placeId?: string | null; name: string; address?: string | null; city?: string | null }): string {
  if (opts.url) return opts.url
  const query = [opts.name, opts.address, opts.city].filter((s) => s && s.trim()).join(', ')
  const base = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  return opts.placeId ? `${base}&query_place_id=${encodeURIComponent(opts.placeId)}` : base
}

/** Only http(s) links are rendered as links (a venue website comes from user input or imports). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null
  const trimmed = url.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A readable place line: "San Francisco, CA, US". Skips blanks and the unknown country `ZZ`. */
export function placeLine(...parts: (string | null | undefined)[]): string {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    if (!p || !p.trim() || p === 'ZZ') continue
    // Skip a part the line already says (an address that already ends in its city).
    if (seen.has(p.trim().toLowerCase())) continue
    out.push(p.trim())
    for (const seg of p.split(',')) seen.add(seg.trim().toLowerCase())
  }
  return out.join(', ')
}

/** The browser tab title for a public page. */
export function pageTitle(title: string | null): string {
  return title ? `${title} · My Escapes` : 'My Escapes'
}
