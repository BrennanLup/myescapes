/**
 * Public game page /games/:slug (workstream 16): game, venue, aggregates, puzzle highlights behind
 * "Show spoilers", reviews (18), attribution, "Open in Google Maps". Uses ROUTES.gamePage. STUB.
 */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function GamePage({ params }: RouteProps) {
  return <Placeholder title={`Game: ${params.slug}`} ws={16} />
}
