/**
 * Public reviews (workstream 18): review list with author cards (handle + display name, never
 * email), "played together" links, spoiler blur, report button, aggregate scores.
 *
 * Everything here renders only `PublicReview` / `PublicUser` shapes, which carry no email and no
 * transcript, so neither can reach a public page.
 */
import { useState, type FormEvent } from 'react'
import { ROUTES, callApi } from '../../contracts/routes'
import { ApiCallError } from '../../contracts/errors'
import { REPORT_REASONS, type Aggregate, type PublicReview, type PublicUser, type ReportInput, type ReviewPage } from '../../contracts/models'
import { RATING_KEYS } from '../../contracts/types'
import { useSession } from '../../auth'
import { formatDate, formatMinutes, formatPercent, formatScore, initials, plural, publicName, RATING_LABELS } from '../shared/format'
import { SpoilerReveal } from '../shared/Spoiler'

export { computeAggregate, type AggregateInput } from './aggregate'

// ---------------------------------------------------------------------------
// Author card
// ---------------------------------------------------------------------------

export function AuthorCard({ user, size = 'md' }: { user: PublicUser; size?: 'sm' | 'md' }) {
  const { name, handle } = publicName(user)
  const px = size === 'sm' ? 24 : 36
  const [broken, setBroken] = useState(false)
  const image = user.image && /^https?:\/\//i.test(user.image) && !broken ? user.image : null
  return (
    <span data-testid="author-card" className="inline-flex min-w-0 items-center gap-2 align-middle">
      {image ? (
        <img
          src={image}
          alt=""
          width={px}
          height={px}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className="shrink-0 rounded-full object-cover"
          style={{ width: px, height: px }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-teal font-display font-semibold text-white"
          style={{ width: px, height: px, fontSize: px * 0.4 }}
        >
          {initials(name)}
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-semibold">{name}</span>
        {handle && size === 'md' && <span className="block truncate text-xs text-ink-soft">{handle}</span>}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Aggregate scores
// ---------------------------------------------------------------------------

export function AggregateScores({ aggregate }: { aggregate: Aggregate }) {
  const { avg } = aggregate
  if (aggregate.reviewCount === 0 && aggregate.visitCount === 0) {
    return (
      <div data-testid="aggregate-scores" className="rounded-xl bg-paper p-4 text-ink-soft">
        No public reviews yet. Played it? Log it and yours will be the first.
      </div>
    )
  }
  return (
    <div data-testid="aggregate-scores" className="rounded-xl border border-panel-edge bg-paper p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Overall</div>
          <div data-testid="aggregate-overall" className="font-display text-4xl font-semibold text-accent">
            {formatScore(avg.overall)}
            <span className="text-base text-ink-soft">/100</span>
          </div>
        </div>
        <Stat label="Escape rate" value={formatPercent(aggregate.escapeRate)} testId="aggregate-escape-rate" />
        <Stat label="Avg. escape time" value={formatMinutes(aggregate.avgEscapeMinutes) ?? '—'} />
        <Stat label="Reviews" value={String(aggregate.reviewCount)} testId="aggregate-review-count" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RATING_KEYS.filter((k) => k !== 'overall').map((k) => (
          <div key={k} className="rounded-lg bg-panel px-3 py-2">
            <dt className="text-xs text-ink-soft">{RATING_LABELS[k]}</dt>
            <dd className="m-0 font-display text-lg font-semibold">{formatScore(avg[k])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 mb-0 text-xs text-ink-soft">
        Averages of {plural(aggregate.reviewCount, 'public review')} over {plural(aggregate.visitCount, 'visit')}. Scores copied from a teammate's review aren't counted
        until that player changes them.
      </p>
    </div>
  )
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{label}</div>
      <div data-testid={testId} className="font-display text-xl font-semibold">
        {value}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Report button
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<(typeof REPORT_REASONS)[number], string> = {
  spam: 'Spam or advertising',
  offensive: 'Offensive or abusive',
  wrong_info: 'Wrong information',
  spoilers: 'Unmarked spoilers',
  privacy: 'Shares private information',
  other: 'Something else',
}

type ReportState = { step: 'closed' } | { step: 'open' } | { step: 'sending' } | { step: 'sent' } | { step: 'sign-in' } | { step: 'error'; message: string }

function signInHref(): string {
  const here = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search
  return `/welcome?next=${encodeURIComponent(here)}`
}

export function ReportButton({ targetType, targetId, label = 'Report' }: { targetType: ReportInput['targetType']; targetId: string; label?: string }) {
  const session = useSession()
  const [state, setState] = useState<ReportState>({ step: 'closed' })
  const [reason, setReason] = useState<ReportInput['reason']>(targetType === 'review' ? 'spoilers' : 'wrong_info')
  const [note, setNote] = useState('')

  const open = () => setState(session.status === 'signed-out' ? { step: 'sign-in' } : { step: 'open' })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setState({ step: 'sending' })
    try {
      await callApi(ROUTES.report, { body: { targetType, targetId, reason, note } })
      setState({ step: 'sent' })
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) setState({ step: 'sign-in' })
      else setState({ step: 'error', message: err instanceof ApiCallError && err.body?.error ? err.body.error : "Couldn't send the report. Try again." })
    }
  }

  if (state.step === 'closed') {
    return (
      <button type="button" data-testid="report-button" onClick={open} className="text-xs font-semibold text-ink-soft underline hover:text-bad">
        {label}
      </button>
    )
  }
  if (state.step === 'sent') {
    return (
      <p role="status" data-testid="report-sent" className="m-0 text-xs text-good">
        Thanks. We'll take a look.
      </p>
    )
  }
  if (state.step === 'sign-in') {
    return (
      <p role="status" data-testid="report-sign-in" className="m-0 text-xs text-ink-soft">
        <a href={signInHref()} className="font-semibold text-[#b9561f]">
          Sign in
        </a>{' '}
        to report this.{' '}
        <button type="button" onClick={() => setState({ step: 'closed' })} className="underline">
          Cancel
        </button>
      </p>
    )
  }
  const sending = state.step === 'sending'
  return (
    <form data-testid="report-form" onSubmit={submit} className="mt-2 w-full rounded-xl border border-panel-edge bg-paper p-3 text-sm">
      <fieldset disabled={sending} className="m-0 border-0 p-0">
        <legend className="mb-1 font-semibold">What's wrong?</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 py-0.5">
            <input type="radio" name={`reason-${targetId}`} value={r} checked={reason === r} onChange={() => setReason(r)} />
            {REASON_LABELS[r]}
          </label>
        ))}
        <label className="mt-2 block">
          <span className="text-xs text-ink-soft">Anything else? (optional)</span>
          <textarea
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-panel-edge bg-white p-2"
          />
        </label>
        {state.step === 'error' && (
          <p role="alert" className="m-0 mt-2 text-bad">
            {state.message}
          </p>
        )}
        <div className="mt-2 flex gap-3">
          <button type="submit" className="rounded-full bg-bad px-4 py-1 font-semibold text-white">
            {sending ? 'Sending…' : 'Send report'}
          </button>
          <button type="button" onClick={() => setState({ step: 'closed' })} className="underline">
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Review card and list
// ---------------------------------------------------------------------------

export function reviewAnchor(reviewId: string): string {
  return `review-${reviewId}`
}

function Comments({ review }: { review: PublicReview }) {
  const comments = RATING_KEYS.map((k) => ({ key: k, text: review.ratings[k].comment.trim() })).filter((c) => c.text)
  if (!comments.length) return null
  const body = (
    <div data-testid="review-comments" className="space-y-1">
      {comments.map((c) => (
        <p key={c.key} className="m-0 whitespace-pre-line">
          {c.key !== 'overall' && <span className="font-semibold">{RATING_LABELS[c.key]}: </span>}
          {c.text}
        </p>
      ))}
    </div>
  )
  if (!review.containsSpoilers) return body
  return (
    <SpoilerReveal testId="review-spoiler" hint="This review has spoilers">
      {body}
    </SpoilerReveal>
  )
}

export function ReviewCard({ review }: { review: PublicReview }) {
  const time = formatMinutes(review.escapeTimeMinutes)
  return (
    <article id={reviewAnchor(review.id)} data-testid="review-card" data-review-id={review.id} className="rounded-xl border border-panel-edge bg-white/60 p-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AuthorCard user={review.author} />
        <span className="text-sm text-ink-soft">{formatDate(review.date)}</span>
        {review.escaped !== null && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${review.escaped ? 'bg-good' : 'bg-bad'}`}>
            {review.escaped ? `Escaped${time ? ` in ${time}` : ''}` : `Didn't escape${time ? ` (${time})` : ''}`}
          </span>
        )}
        <span className="ml-auto font-display text-2xl font-semibold text-accent" aria-label={`Overall ${review.ratings.overall.score} out of 100`}>
          {review.ratings.overall.score}
        </span>
      </header>

      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-ink-soft">
        {RATING_KEYS.filter((k) => k !== 'overall').map((k) => (
          <li key={k}>
            {RATING_LABELS[k]} <span className="font-semibold text-ink">{review.ratings[k].score}</span>
          </li>
        ))}
      </ul>

      {review.scoresCopied && (
        <p data-testid="copied-scores-note" className="m-0 mt-2 text-xs text-ink-soft italic">
          These scores are a copy of a teammate's review, so they aren't counted in the averages.
        </p>
      )}

      <div className="mt-3">
        <Comments review={review} />
      </div>

      {review.photos.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {review.photos.map((p) => (
            <img
              key={p.id}
              src={p.url}
              alt={p.caption || 'Photo from this visit'}
              loading="lazy"
              className="h-24 w-24 shrink-0 rounded-lg object-cover"
              width={96}
              height={96}
            />
          ))}
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {review.playedWith.length > 0 && (
          <span data-testid="played-with" className="flex flex-wrap items-center gap-2 text-ink-soft">
            Played together with
            {review.playedWith.map((p) => (
              <a key={p.reviewId} href={`#${reviewAnchor(p.reviewId)}`} className="text-ink no-underline hover:underline">
                <AuthorCard user={p.author} size="sm" />
              </a>
            ))}
          </span>
        )}
        <span className="ml-auto">
          <ReportButton targetType="review" targetId={review.id} />
        </span>
      </footer>
    </article>
  )
}

export function ReviewList({
  gameSlug,
  initial,
  fetchPage = (cursor) => callApi(ROUTES.gameReviews, { params: { slug: gameSlug }, query: { cursor } }),
}: {
  gameSlug: string
  initial: ReviewPage
  /** Loads the page after `cursor` (injectable for tests). */
  fetchPage?: (cursor: string) => Promise<ReviewPage>
}) {
  const [reviews, setReviews] = useState(initial.reviews)
  const [cursor, setCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const more = async () => {
    if (!cursor) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(cursor)
      setReviews((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...page.reviews.filter((r) => !seen.has(r.id))]
      })
      setCursor(page.nextCursor)
    } catch {
      setError("Couldn't load more reviews.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="review-list" className="space-y-3">
      {reviews.length === 0 && <p className="m-0 text-ink-soft">No public reviews yet.</p>}
      {reviews.map((r) => (
        <ReviewCard key={r.id} review={r} />
      ))}
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          data-testid="more-reviews"
          onClick={more}
          disabled={loading}
          className="rounded-full border border-panel-edge bg-paper px-4 py-2 font-semibold"
        >
          {loading ? 'Loading…' : 'More reviews'}
        </button>
      )}
    </div>
  )
}
