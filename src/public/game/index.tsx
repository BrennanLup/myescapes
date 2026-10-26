/**
 * Public game page /games/:slug (workstream 16): game, venue, aggregates, puzzle highlights behind
 * "Show spoilers", reviews (18), attribution, "Open in Google Maps". Uses ROUTES.gamePage.
 */
import type { RouteProps } from '../../router'
import { Link } from '../../router'
import { ROUTES, callApi } from '../../contracts/routes'
import type { GamePage as GamePageData, PuzzleHighlight } from '../../contracts/models'
import { PUZZLE_TYPE_LABELS } from '../../contracts/types'
import { AggregateScores, ReportButton, ReviewList } from '../reviews'
import { DirectoryAttribution } from '../shared/Attribution'
import { Card, PageStatus, PublicPage } from '../shared/Layout'
import { SpoilerReveal } from '../shared/Spoiler'
import { genreLabel, googleMapsLink, hostOf, pageTitle, placeLine, playersLabel, safeHttpUrl } from '../shared/format'
import { useApi, useDocumentTitle } from '../shared/useApi'

export function GamePage({ params }: RouteProps) {
  const slug = params.slug ?? ''
  const [state, retry] = useApi(`game:${slug}`, (signal) => callApi(ROUTES.gamePage, { params: { slug } }, { signal }))
  useDocumentTitle(pageTitle(state.status === 'ready' ? `${state.data.game.name} at ${state.data.venue.name}` : null))
  if (state.status !== 'ready') {
    return (
      <PublicPage testId="game-page">
        <PageStatus kind={state.status} what="game" message={state.status === 'error' ? state.message : undefined} onRetry={retry} />
      </PublicPage>
    )
  }
  return <GamePageView data={state.data} />
}

export function PuzzleHighlights({ puzzles }: { puzzles: PuzzleHighlight[] }) {
  if (!puzzles.length) return null
  return (
    <section aria-labelledby="puzzles-heading" className="mt-6">
      <h2 id="puzzles-heading" className="font-display text-xl font-semibold">
        Puzzle highlights
      </h2>
      <p className="m-0 mb-2 text-sm text-ink-soft">
        {puzzles.length} {puzzles.length === 1 ? 'puzzle' : 'puzzles'} players remembered. Hidden so you don't spoil your own game.
      </p>
      <SpoilerReveal testId="puzzle-spoilers" hint="Puzzle details are spoilers">
        <ol data-testid="puzzle-list" className="m-0 list-decimal space-y-2 pl-5">
          {puzzles.map((p, i) => (
            <li key={i}>
              <span className="font-semibold">{p.description}</span>{' '}
              <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink-soft">{PUZZLE_TYPE_LABELS[p.type]}</span>
              {p.memorableCount > 0 && <span className="ml-2 text-xs text-ink-soft">memorable for {p.memorableCount}</span>}
              {p.notes && <p className="m-0 mt-1 text-sm whitespace-pre-line text-ink-soft">{p.notes}</p>}
            </li>
          ))}
        </ol>
      </SpoilerReveal>
    </section>
  )
}

export function GamePageView({ data }: { data: GamePageData }) {
  const { game, venue } = data
  const facts = [genreLabel(game.genre), playersLabel(game.minPlayers, game.maxPlayers), game.durationMinutes ? `${game.durationMinutes} min` : null].filter(Boolean)
  const website = safeHttpUrl(game.website)
  const maps = googleMapsLink({ url: data.googleMapsUrl, name: venue.name, address: venue.address, city: venue.city })
  return (
    <PublicPage testId="game-page" footer={<DirectoryAttribution entries={data.attribution} />}>
      <Card>
        <p className="m-0 text-sm text-ink-soft">
          <Link to={`/venues/${venue.slug}`} className="font-semibold text-[#b9561f]">
            {venue.name}
          </Link>
          {' · '}
          {venue.citySlug ? (
            <Link to={`/cities/${venue.citySlug}`} className="text-ink-soft">
              {placeLine(venue.city, venue.region)}
            </Link>
          ) : (
            placeLine(venue.city, venue.region)
          )}
        </p>
        <h1 className="m-0 mt-1 font-display text-3xl font-semibold sm:text-4xl">{game.name}</h1>
        {game.status === 'closed' && <p className="m-0 mt-1 font-semibold text-bad">This game has closed.</p>}
        {facts.length > 0 && <p className="m-0 mt-2 text-ink-soft">{facts.join(' · ')}</p>}
        {game.description && <p className="mt-3 mb-0 whitespace-pre-line">{game.description}</p>}
        <p className="m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {venue.address && <span>{placeLine(venue.address, venue.city)}</span>}
          <a href={maps} target="_blank" rel="noopener noreferrer" data-testid="google-maps-link" className="font-semibold text-[#b9561f]">
            Open in Google Maps
          </a>
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-[#b9561f]">
              {hostOf(website)}
            </a>
          )}
        </p>

        <section aria-labelledby="scores-heading" className="mt-6">
          <h2 id="scores-heading" className="sr-only">
            Scores
          </h2>
          <AggregateScores aggregate={data.aggregate} />
        </section>

        <PuzzleHighlights puzzles={data.puzzles} />

        <section aria-labelledby="reviews-heading" className="mt-6">
          <h2 id="reviews-heading" className="font-display text-xl font-semibold">
            Reviews
          </h2>
          <ReviewList key={game.id} gameSlug={game.slug} initial={data.reviews} />
        </section>

        <p className="mt-6 mb-0 text-right">
          <ReportButton targetType="game" targetId={game.id} label="Report a problem with this game" />
        </p>
      </Card>
    </PublicPage>
  )
}
