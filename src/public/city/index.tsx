/** Public city page /cities/:slug (workstream 17): the venues in a city. Uses ROUTES.cityPage. */
import { useState } from 'react'
import type { RouteProps } from '../../router'
import { Link } from '../../router'
import { ROUTES, callApi } from '../../contracts/routes'
import type { CityPage as CityPageData, VenueSummary } from '../../contracts/models'
import { DirectoryAttribution } from '../shared/Attribution'
import { Card, PageStatus, PublicPage } from '../shared/Layout'
import { pageTitle, placeLine, plural } from '../shared/format'
import { useApi, useDocumentTitle } from '../shared/useApi'

export function CityPage({ params }: RouteProps) {
  const slug = params.slug ?? ''
  const [state, retry] = useApi(`city:${slug}`, (signal) => callApi(ROUTES.cityPage, { params: { slug } }, { signal }))
  useDocumentTitle(pageTitle(state.status === 'ready' ? `Escape rooms in ${state.data.city.name}` : null))
  if (state.status !== 'ready') {
    return (
      <PublicPage testId="city-page">
        <PageStatus kind={state.status} what="city" message={state.status === 'error' ? state.message : undefined} onRetry={retry} />
      </PublicPage>
    )
  }
  return <CityPageView data={state.data} />
}

/** Visible venues, open ones first, then by number of games, then by name. Optional text filter. */
export function filterVenues(venues: VenueSummary[], query: string): VenueSummary[] {
  const q = query.trim().toLowerCase()
  return venues
    .filter((v) => v.status !== 'hidden')
    .filter((v) => !q || [v.name, v.brand ?? '', v.address].some((s) => s.toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.gameCount - a.gameCount || a.name.localeCompare(b.name))
}

export function CityPageView({ data }: { data: CityPageData }) {
  const { city } = data
  const [query, setQuery] = useState('')
  const visible = filterVenues(data.venues, '')
  const venues = filterVenues(data.venues, query)
  return (
    <PublicPage testId="city-page" footer={<DirectoryAttribution entries={data.attribution} />}>
      <Card>
        <p className="m-0 text-sm text-ink-soft">{placeLine(city.region, city.country)}</p>
        <h1 className="m-0 mt-1 font-display text-3xl font-semibold sm:text-4xl">Escape rooms in {city.name}</h1>
        <p className="m-0 mt-2 text-ink-soft">
          {plural(visible.length, 'venue')} in the directory.{' '}
          <Link to={`/reviews?city=${encodeURIComponent(city.slug)}`} data-testid="city-reviews-link" className="font-semibold text-[#b9561f]">
            Read reviews in {city.name}
          </Link>
        </p>

        {visible.length > 6 && (
          <label className="mt-4 block">
            <span className="sr-only">Filter venues</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or street"
              className="w-full rounded-full border border-panel-edge bg-white px-4 py-2"
            />
          </label>
        )}

        {venues.length ? (
          <ul data-testid="city-venues" className="m-0 mt-4 list-none space-y-2 p-0">
            {venues.map((v) => (
              <li key={v.id} data-testid="venue-row" className="rounded-xl border border-panel-edge bg-white/60 px-4 py-3">
                <Link to={`/venues/${v.slug}`} className="font-display text-lg font-semibold text-ink">
                  {v.name}
                </Link>
                <p className="m-0 text-sm text-ink-soft">
                  {[v.address || null, v.status === 'closed' ? 'Closed' : null, v.gameCount ? plural(v.gameCount, 'game') : null].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-ink-soft">{query ? 'No venues match that filter.' : 'No venues listed here yet.'}</p>
        )}
      </Card>
    </PublicPage>
  )
}
