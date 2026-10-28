/**
 * Public review feed /reviews: every public review of every room, newest first, with the
 * All · Spoiler-free · Spoilers only filter. `?city=<slug>` narrows it to one city (linked from
 * city pages). Uses ROUTES.reviewFeed.
 */
import type { RouteProps } from '../../router'
import { Link, useSearch } from '../../router'
import { ROUTES, callApi } from '../../contracts/routes'
import { ReviewList } from '../reviews'
import { Card, PublicPage } from '../shared/Layout'
import { pageTitle } from '../shared/format'
import { useDocumentTitle } from '../shared/useApi'

export function cityFromSearch(search: string): string | null {
  try {
    const c = new URLSearchParams(search).get('city')
    return c && /^[\p{L}\p{N}-]{1,120}$/u.test(c) ? c : null
  } catch {
    return null
  }
}

/** "san-francisco-ca-us" → "San Francisco" (good enough for a heading; the slug's tail is region and country). */
export function cityLabel(slug: string): string {
  const parts = slug.split('-')
  const words = parts.length > 2 ? parts.slice(0, -2) : parts
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function ReviewsFeedPage(_props: RouteProps) {
  const city = cityFromSearch(useSearch())
  useDocumentTitle(pageTitle(city ? `Escape room reviews in ${cityLabel(city)}` : 'Escape room reviews'))
  return (
    <PublicPage testId="reviews-feed-page">
      <Card>
        <h1 className="m-0 font-display text-3xl font-semibold sm:text-4xl">{city ? `Reviews in ${cityLabel(city)}` : 'Escape room reviews'}</h1>
        <p className="m-0 mt-2 text-ink-soft">
          What players thought of the rooms they played, newest first. Spoilers stay hidden until you ask, or pick Spoiler-free to skip those reviews.
          {city && (
            <>
              {' '}
              <Link to="/reviews" className="font-semibold text-[#b9561f]">
                See reviews everywhere
              </Link>
            </>
          )}
        </p>
        <div className="mt-5">
          <ReviewList
            key={city ?? 'all'}
            initial={null}
            fetchPage={(cursor, filter) => callApi(ROUTES.reviewFeed, { query: { cursor, ...(filter !== 'all' ? { filter } : {}), ...(city ? { city } : {}) } })}
          />
        </div>
      </Card>
    </PublicPage>
  )
}
