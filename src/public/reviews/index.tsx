/**
 * Public reviews (workstream 18): review list with author cards (handle + display name, never
 * email), "played together" links, spoiler blur, report button, aggregate scores. STUB.
 */
import type { Aggregate, PublicReview, PublicUser, ReviewPage } from '../../contracts/models'

export function ReviewList(_props: { gameSlug: string; initial: ReviewPage }) {
  return <div data-testid="review-list" />
}

export function AuthorCard({ user }: { user: PublicUser }) {
  return <span data-testid="author-card">{user.displayName}</span>
}

export function ReportButton(_props: { targetType: 'review' | 'photo' | 'game' | 'venue'; targetId: string }) {
  return null
}

export function AggregateScores(_props: { aggregate: Aggregate }) {
  return <div data-testid="aggregate-scores" />
}

export function ReviewCard(_props: { review: PublicReview }) {
  return <article data-testid="review-card" />
}
