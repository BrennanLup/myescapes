/** Public venue page /venues/:slug (workstream 17): the venue and its games. Uses ROUTES.venuePage. */
import type { RouteProps } from '../../router'
import { Link } from '../../router'
import { ROUTES, callApi } from '../../contracts/routes'
import type { GameSummary, VenuePage as VenuePageData } from '../../contracts/models'
import { ReportButton } from '../reviews'
import { DirectoryAttribution } from '../shared/Attribution'
import { Card, PageStatus, PublicPage } from '../shared/Layout'
import { formatScore, genreLabel, googleMapsLink, hostOf, pageTitle, placeLine, plural, safeHttpUrl } from '../shared/format'
import { useApi, useDocumentTitle } from '../shared/useApi'

export function VenuePage({ params }: RouteProps) {
  const slug = params.slug ?? ''
  const [state, retry] = useApi(`venue:${slug}`, (signal) => callApi(ROUTES.venuePage, { params: { slug } }, { signal }))
  useDocumentTitle(pageTitle(state.status === 'ready' ? `${state.data.venue.name}, ${state.data.venue.city}` : null))
  if (state.status !== 'ready') {
    return (
      <PublicPage testId="venue-page">
        <PageStatus kind={state.status} what="venue" message={state.status === 'error' ? state.message : undefined} onRetry={retry} />
      </PublicPage>
    )
  }
  return <VenuePageView data={state.data} />
}

/** Active games first (most reviewed first), closed ones last; hidden ones never show. */
export function sortGames(games: GameSummary[]): GameSummary[] {
  return games
    .filter((g) => g.status !== 'hidden')
    .slice()
    .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.reviewCount - a.reviewCount || a.name.localeCompare(b.name))
}

export function GameRow({ game }: { game: GameSummary }) {
  const genre = genreLabel(game.genre)
  return (
    <li data-testid="game-row" className="flex items-center gap-3 rounded-xl border border-panel-edge bg-white/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link to={`/games/${game.slug}`} className="font-display text-lg font-semibold text-ink">
          {game.name}
        </Link>
        <p className="m-0 text-sm text-ink-soft">
          {[genre, game.status === 'closed' ? 'Closed' : null, game.reviewCount ? plural(game.reviewCount, 'review') : 'No reviews yet'].filter(Boolean).join(' · ')}
        </p>
      </div>
      <span className="font-display text-2xl font-semibold text-accent" aria-label={game.avgOverall === null ? 'No score yet' : `Average ${Math.round(game.avgOverall)} out of 100`}>
        {formatScore(game.avgOverall)}
      </span>
    </li>
  )
}

export function VenuePageView({ data }: { data: VenuePageData }) {
  const { venue } = data
  const games = sortGames(data.games)
  const website = safeHttpUrl(venue.website)
  const maps = googleMapsLink({ url: data.googleMapsUrl, placeId: venue.googlePlaceId, name: venue.name, address: venue.address, city: venue.city })
  return (
    <PublicPage testId="venue-page" footer={<DirectoryAttribution entries={data.attribution} />}>
      <Card>
        <p className="m-0 text-sm text-ink-soft">
          {venue.citySlug ? (
            <Link to={`/cities/${venue.citySlug}`} className="font-semibold text-[#b9561f]">
              {placeLine(venue.city, venue.region, venue.country)}
            </Link>
          ) : (
            placeLine(venue.city, venue.region, venue.country)
          )}
        </p>
        <h1 className="m-0 mt-1 font-display text-3xl font-semibold sm:text-4xl">{venue.name}</h1>
        {venue.brand && venue.brand !== venue.name && <p className="m-0 text-ink-soft">by {venue.brand}</p>}
        {venue.status === 'closed' && <p className="m-0 mt-1 font-semibold text-bad">This venue has closed.</p>}
        <p className="m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {venue.address && <span>{placeLine(venue.address, venue.postalCode)}</span>}
          {venue.phone && <span>{venue.phone}</span>}
          <a href={maps} target="_blank" rel="noopener noreferrer" data-testid="google-maps-link" className="font-semibold text-[#b9561f]">
            Open in Google Maps
          </a>
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-[#b9561f]">
              {hostOf(website)}
            </a>
          )}
        </p>

        <h2 className="mt-6 font-display text-xl font-semibold">{games.length ? `Games (${games.length})` : 'Games'}</h2>
        {games.length ? (
          <ul data-testid="venue-games" className="m-0 list-none space-y-2 p-0">
            {games.map((g) => (
              <GameRow key={g.id} game={g} />
            ))}
          </ul>
        ) : (
          <p className="text-ink-soft">No games listed yet. Played one here? Log it from the app and it will show up.</p>
        )}

        <p className="mt-6 mb-0 text-right">
          <ReportButton targetType="venue" targetId={venue.id} label="Report a problem with this venue" />
        </p>
      </Card>
    </PublicPage>
  )
}
