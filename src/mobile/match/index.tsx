/**
 * Venue and game matcher (workstream 12): pick the directory game the voice note was about, or
 * add a new venue and/or game. Uses ROUTES.directoryMatch, directorySearch, venuePage,
 * createVenue and createGame. Light: no three.js.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiCallError } from '../../contracts/errors'
import { GENRES, type Genre } from '../../contracts/types'
import type { GameMatch, GameSummary, VenueMatch, VenueSummary } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import { placeLine } from '../../public/shared/format'
import {
  bestGame,
  gameToSummary,
  initialQuery,
  newVenueDefaults,
  rankGames,
  rankVenues,
  validateNewVenue,
  venueLabel,
  venueToSummary,
  type MatchHints,
} from './logic'

export type { MatchHints } from './logic'

export interface MatcherProps {
  hints: MatchHints
  onPick(choice: { venue: VenueSummary; game: GameSummary }): void
  onCancel?(): void
  /** Open straight on a venue's rooms or the "add a venue" form (from the review form's room search). */
  initialMode?: MatcherMode
  /** Tests: swap the transport. */
  fetch?: typeof fetch
}

export type MatcherMode = Mode
type Mode = { kind: 'list' } | { kind: 'venue'; venue: VenueSummary } | { kind: 'newVenue' } | { kind: 'newGame'; venue: VenueSummary }

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : undefined)

function niceError(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.code === 'unauthorized') return 'Sign in again to add venues and games.'
    if (err.code === 'not_implemented') return 'The directory is not available yet. Try again later.'
    return err.message
  }
  return "Couldn't reach the directory. Check your connection and try again."
}

/** Fallback summary when the venue page can't be loaded (fields the matcher doesn't show stay empty). */
function venueFromGame(g: GameSummary): VenueSummary {
  return { id: g.venueId, slug: g.venueSlug, name: g.venueName, brand: null, address: '', city: g.city, citySlug: '', region: '', country: g.country, lat: null, lng: null, status: 'active', gameCount: 1 }
}

const input = 'w-full rounded-xl border border-panel-edge bg-white px-3 py-3 text-base text-ink outline-none focus:border-accent'
const card = 'flex w-full items-center justify-between gap-3 rounded-2xl border border-panel-edge bg-white px-4 py-3 text-left active:bg-paper'
const primary = 'w-full rounded-2xl bg-accent px-4 py-3 text-base font-bold text-accent-ink disabled:opacity-50'
const secondary = 'w-full rounded-2xl border border-panel-edge px-4 py-3 text-base font-semibold text-ink'

export function VenueGameMatcher({ hints, onPick, onCancel, initialMode, fetch: fetchImpl }: MatcherProps) {
  const opts = useMemo(() => (fetchImpl ? { fetch: fetchImpl } : {}), [fetchImpl])
  const [query, setQuery] = useState(() => initialQuery(hints))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [venues, setVenues] = useState<VenueMatch[]>([])
  const [games, setGames] = useState<GameMatch[]>([])
  const [mode, setMode] = useState<Mode>(initialMode ?? { kind: 'list' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    callApi(ROUTES.directoryMatch, { query: { venue: clean(hints.venue), game: clean(hints.game), city: clean(hints.city), country: hints.country && /^[a-z]{2}$/i.test(hints.country) ? hints.country.toUpperCase() : undefined } }, opts)
      .then((r) => {
        if (!live) return
        setVenues(rankVenues(r.venues))
        setGames(rankGames(r.games))
        setError(null)
      })
      .catch((err) => live && setError(niceError(err)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [hints.venue, hints.game, hints.city, hints.country, opts])

  const search = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoading(true)
    try {
      const r = await callApi(ROUTES.directorySearch, { query: { q, limit: 20 } }, opts)
      // Search results have no match score: keep the server's order.
      const n = Math.max(r.games.length, 1)
      setGames(rankGames(r.games.map((game, i) => ({ game, score: Math.max(0, 0.7 - (i / n) * 0.7) }))))
      const m = Math.max(r.venues.length, 1)
      setVenues(rankVenues(r.venues.map((venue, i) => ({ venue, score: Math.max(0, 0.7 - (i / m) * 0.7) }))))
      setError(null)
    } catch (err) {
      setError(niceError(err))
    } finally {
      setLoading(false)
    }
  }

  const pickGame = async (g: GameSummary) => {
    setBusy(true)
    let venue = venues.find((v) => v.venue.id === g.venueId)?.venue
    if (!venue) {
      try {
        venue = venueToSummary((await callApi(ROUTES.venuePage, { params: { slug: g.venueSlug } }, opts)).venue)
      } catch {
        venue = venueFromGame(g)
      }
    }
    setBusy(false)
    onPick({ venue, game: g })
  }

  const best = bestGame(games)

  if (mode.kind === 'newVenue') {
    return <NewVenueForm hints={hints} opts={opts} onBack={() => setMode({ kind: 'list' })} onCreated={(venue) => setMode({ kind: 'newGame', venue })} />
  }
  if (mode.kind === 'newGame') {
    return <NewGameForm hints={hints} venue={mode.venue} opts={opts} onBack={() => setMode({ kind: 'venue', venue: mode.venue })} onCreated={(game) => onPick({ venue: mode.venue, game })} />
  }
  if (mode.kind === 'venue') {
    return (
      <VenueGames
        venue={mode.venue}
        matches={games.filter((g) => g.game.venueId === mode.venue.id).map((g) => g.game)}
        opts={opts}
        onBack={() => setMode({ kind: 'list' })}
        onPick={(game) => onPick({ venue: mode.venue, game })}
        onNewGame={() => setMode({ kind: 'newGame', venue: mode.venue })}
      />
    )
  }

  return (
    <section data-testid="venue-game-matcher" className="space-y-4">
      <div>
        <h2 className="font-display text-xl">Which room was it?</h2>
        <p className="text-sm text-ink-soft">Pick it from the directory, or add it if it's new.</p>
      </div>
      <form onSubmit={search} className="flex gap-2" role="search">
        <input data-testid="matcher-search" aria-label="Search rooms and venues" className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Room or venue name" />
        <button type="submit" className="rounded-xl bg-teal px-4 font-semibold text-white">
          Search
        </button>
      </form>
      {error && (
        <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      {loading ? (
        <p data-testid="matcher-loading" className="text-sm text-ink-soft">
          Looking in the directory...
        </p>
      ) : (
        <>
          {games.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Rooms</h3>
              {games.slice(0, 8).map(({ game, score }) => (
                <button key={game.id} type="button" disabled={busy} data-testid={`match-game-${game.id}`} className={card} onClick={() => void pickGame(game)}>
                  <span>
                    <span className="block font-semibold">{game.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {game.venueName}
                      {game.city ? `, ${game.city}` : ''}
                    </span>
                  </span>
                  {best?.game.id === game.id ? (
                    <span className="shrink-0 rounded-full bg-good px-2 py-1 text-xs font-bold text-white">Best match</span>
                  ) : score >= 0.5 ? (
                    <span className="shrink-0 text-xs text-ink-soft">Likely</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {venues.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Venues</h3>
              {venues.slice(0, 6).map(({ venue }) => (
                <button key={venue.id} type="button" data-testid={`match-venue-${venue.id}`} className={card} onClick={() => setMode({ kind: 'venue', venue })}>
                  <span>
                    <span className="block font-semibold">{venue.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {placeLine(venue.address, venue.city)} · {venue.gameCount} room{venue.gameCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span aria-hidden className="text-ink-soft">
                    ›
                  </span>
                </button>
              ))}
            </div>
          )}
          {games.length === 0 && venues.length === 0 && !error && (
            <p data-testid="matcher-empty" className="text-sm text-ink-soft">
              Nothing in the directory matches yet. Add it below and you'll be the first to review it.
            </p>
          )}
        </>
      )}
      <button type="button" data-testid="new-venue" className={secondary} onClick={() => setMode({ kind: 'newVenue' })}>
        Can't find it? Add a new venue
      </button>
      {onCancel && (
        <button type="button" className="w-full py-2 text-sm text-ink-soft underline" onClick={onCancel}>
          Back
        </button>
      )}
    </section>
  )
}

function VenueGames({ venue, matches, opts, onBack, onPick, onNewGame }: { venue: VenueSummary; matches: GameSummary[]; opts: { fetch?: typeof fetch }; onBack(): void; onPick(g: GameSummary): void; onNewGame(): void }) {
  const [games, setGames] = useState<GameSummary[]>(matches)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    callApi(ROUTES.venuePage, { params: { slug: venue.slug } }, opts)
      .then((p) => {
        if (!live) return
        const ids = new Set(p.games.map((g) => g.id))
        setGames([...p.games.filter((g) => g.status !== 'hidden'), ...matches.filter((g) => !ids.has(g.id))])
      })
      .catch(() => {
        /* keep the matches we already have */
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // matches is derived from props each render; the venue is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.slug, opts])
  return (
    <section data-testid="matcher-venue" className="space-y-4">
      <div>
        <button type="button" className="text-sm text-ink-soft underline" onClick={onBack}>
          ‹ All matches
        </button>
        <h2 className="mt-1 font-display text-xl">{venue.name}</h2>
        <p className="text-sm text-ink-soft">{venueLabel(venue)}</p>
      </div>
      {loading && games.length === 0 ? <p className="text-sm text-ink-soft">Loading rooms...</p> : null}
      <div className="space-y-2">
        {games.map((g) => (
          <button key={g.id} type="button" data-testid={`venue-game-${g.id}`} className={card} onClick={() => onPick(g)}>
            <span className="font-semibold">{g.name}</span>
            {g.genre && <span className="text-xs text-ink-soft">{g.genre}</span>}
          </button>
        ))}
        {!loading && games.length === 0 && <p className="text-sm text-ink-soft">No rooms listed here yet.</p>}
      </div>
      <button type="button" data-testid="new-game" className={secondary} onClick={onNewGame}>
        Add a room at {venue.name}
      </button>
    </section>
  )
}

function NewVenueForm({ hints, opts, onBack, onCreated }: { hints: MatchHints; opts: { fetch?: typeof fetch }; onBack(): void; onCreated(v: VenueSummary): void }) {
  const d = useMemo(() => newVenueDefaults(hints), [hints])
  const [name, setName] = useState(d.name)
  const [city, setCity] = useState(d.city)
  const [region, setRegion] = useState('')
  const [country, setCountry] = useState(d.country)
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateNewVenue({ name, city, country })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const v = await callApi(ROUTES.createVenue, { body: { name: name.trim(), city: city.trim(), region: region.trim(), country: country.trim().toUpperCase(), address: address.trim(), website: website.trim() || null } }, opts)
      onCreated(venueToSummary(v))
    } catch (err) {
      setError(niceError(err))
    } finally {
      setBusy(false)
    }
  }
  const field = (label: string, key: string, value: string, set: (s: string) => void, extra: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input data-testid={`new-venue-${key}`} className={input} value={value} onChange={(e) => set(e.target.value)} {...extra} />
      {errors[key] && <span className="mt-1 block text-sm text-bad">{errors[key]}</span>}
    </label>
  )
  return (
    <form data-testid="new-venue-form" onSubmit={submit} className="space-y-3" noValidate>
      <button type="button" className="text-sm text-ink-soft underline" onClick={onBack}>
        ‹ Back to matches
      </button>
      <h2 className="font-display text-xl">Add a venue</h2>
      {field('Venue name', 'name', name, setName, { autoComplete: 'organization' })}
      {field('City', 'city', city, setCity, { autoComplete: 'address-level2' })}
      <div className="grid grid-cols-2 gap-3">
        {field('State / region', 'region', region, setRegion, { autoComplete: 'address-level1' })}
        {field('Country', 'country', country, (s) => setCountry(s.toUpperCase().slice(0, 2)), { maxLength: 2, autoCapitalize: 'characters' })}
      </div>
      {field('Street address (optional)', 'address', address, setAddress, { autoComplete: 'street-address' })}
      {field('Website (optional)', 'website', website, setWebsite, { inputMode: 'url' })}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button type="submit" data-testid="new-venue-submit" disabled={busy} className={primary}>
        {busy ? 'Adding...' : 'Add venue'}
      </button>
    </form>
  )
}

function NewGameForm({ hints, venue, opts, onBack, onCreated }: { hints: MatchHints; venue: VenueSummary; opts: { fetch?: typeof fetch }; onBack(): void; onCreated(g: GameSummary): void }) {
  const [name, setName] = useState(hints.game?.trim() ?? '')
  const [genre, setGenre] = useState<Genre | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name the room')
      return
    }
    setBusy(true)
    try {
      const g = await callApi(ROUTES.createGame, { body: { venueId: venue.id, name: name.trim(), genre: genre || null } }, opts)
      onCreated(gameToSummary(g, venue))
    } catch (err) {
      setError(niceError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form data-testid="new-game-form" onSubmit={submit} className="space-y-3" noValidate>
      <button type="button" className="text-sm text-ink-soft underline" onClick={onBack}>
        ‹ Back
      </button>
      <h2 className="font-display text-xl">Add a room</h2>
      <p className="text-sm text-ink-soft">at {venueLabel(venue)}</p>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Room name</span>
        <input data-testid="new-game-name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Genre (optional)</span>
        <select data-testid="new-game-genre" className={input} value={genre} onChange={(e) => setGenre(e.target.value as Genre | '')}>
          <option value="">Not sure</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button type="submit" data-testid="new-game-submit" disabled={busy} className={primary}>
        {busy ? 'Adding...' : 'Add room'}
      </button>
    </form>
  )
}

