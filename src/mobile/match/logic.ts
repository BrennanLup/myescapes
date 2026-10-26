/**
 * Pure helpers for the venue and game matcher (workstream 12). No React, easy to test.
 */
import type { Game, GameMatch, GameSummary, NewGame, NewVenue, Venue, VenueMatch, VenueSummary } from '../../contracts/models'

export interface MatchHints {
  venue: string | null
  game: string | null
  city: string | null
  country: string | null
}

export const EMPTY_HINTS: MatchHints = { venue: null, game: null, city: null, country: null }

/** Above this score the top game is shown as the "best match" and preselected. */
export const STRONG_MATCH = 0.75

export function venueToSummary(v: Venue, gameCount = 0): VenueSummary {
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    brand: v.brand,
    address: v.address,
    city: v.city,
    citySlug: v.citySlug,
    region: v.region,
    country: v.country,
    lat: v.lat,
    lng: v.lng,
    status: v.status,
    gameCount,
  }
}

export function gameToSummary(g: Game, venue: Pick<VenueSummary, 'id' | 'name' | 'slug' | 'city' | 'country'>): GameSummary {
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    genre: g.genre,
    status: g.status,
    venueId: venue.id,
    venueName: venue.name,
    venueSlug: venue.slug,
    city: venue.city,
    country: venue.country,
    reviewCount: 0,
    avgOverall: null,
  }
}

const REGION_RE = /^[a-z]{2,3}[-_]([a-z]{2})$/i

/** A 2-letter country for a new venue: the extraction hint, else the phone's locale, else US. */
export function guessCountry(hints: Pick<MatchHints, 'country'>, languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): string {
  const h = hints.country?.trim()
  if (h && /^[a-z]{2}$/i.test(h)) return h.toUpperCase()
  for (const l of languages) {
    const m = REGION_RE.exec(l ?? '')
    if (m) return m[1].toUpperCase()
  }
  return 'US'
}

/** Visible matches, best first, without duplicates; hidden entries never show. */
export function rankGames(games: GameMatch[]): GameMatch[] {
  const seen = new Set<string>()
  return [...games]
    .filter((g) => g.game.status !== 'hidden')
    .sort((a, b) => b.score - a.score)
    .filter((g) => (seen.has(g.game.id) ? false : (seen.add(g.game.id), true)))
}

export function rankVenues(venues: VenueMatch[]): VenueMatch[] {
  const seen = new Set<string>()
  return [...venues]
    .filter((v) => v.venue.status !== 'hidden')
    .sort((a, b) => b.score - a.score)
    .filter((v) => (seen.has(v.venue.id) ? false : (seen.add(v.venue.id), true)))
}

/** The game to preselect, if one is clearly the right one. */
export function bestGame(games: GameMatch[]): GameMatch | null {
  const top = rankGames(games)[0]
  return top && top.score >= STRONG_MATCH ? top : null
}

export function newVenueDefaults(hints: MatchHints, languages?: readonly string[]): NewVenue {
  return {
    name: hints.venue?.trim() ?? '',
    brand: null,
    address: '',
    city: hints.city?.trim() ?? '',
    region: '',
    country: guessCountry(hints, languages),
    website: null,
    phone: null,
  }
}

export function newGameDefaults(hints: MatchHints, venueId: string): NewGame {
  return { venueId, name: hints.game?.trim() ?? '' }
}

/** Form errors for a new venue, keyed by field. Empty when valid. */
export function validateNewVenue(v: Pick<NewVenue, 'name' | 'city' | 'country'>): Record<string, string> {
  const e: Record<string, string> = {}
  if (!v.name.trim()) e.name = 'Name the venue'
  if (!v.city.trim()) e.city = 'Which city?'
  if (!/^[a-z]{2}$/i.test(v.country.trim())) e.country = 'Two-letter country code, like US or CA'
  return e
}

/** "The Lost Observatory · Starlight Escapes, San Francisco" */
export function gameLabel(g: Pick<GameSummary, 'name' | 'venueName' | 'city'>): string {
  return `${g.name} · ${g.venueName}${g.city ? `, ${g.city}` : ''}`
}

export function venueLabel(v: Pick<VenueSummary, 'name' | 'city' | 'region'>): string {
  return `${v.name}${v.city ? ` · ${v.city}` : ''}${v.region ? `, ${v.region}` : ''}`
}

/** The search box starts with what the voice note said. */
export function initialQuery(h: MatchHints): string {
  return (h.game ?? h.venue ?? '').trim()
}
