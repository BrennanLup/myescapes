/**
 * Venue and game matcher (workstream 12): pick a directory match for the extracted venue/game,
 * or create a new venue/game. Uses ROUTES.directoryMatch, createVenue, createGame. STUB.
 */
import type { GameSummary, VenueSummary } from '../../contracts/models'

export interface MatchHints {
  venue: string | null
  game: string | null
  city: string | null
  country: string | null
}

export interface MatcherProps {
  hints: MatchHints
  onPick(choice: { venue: VenueSummary; game: GameSummary }): void
  onCancel?(): void
}

export function VenueGameMatcher(_props: MatcherProps) {
  return <div data-testid="venue-game-matcher">Matching venues is coming soon.</div>
}
