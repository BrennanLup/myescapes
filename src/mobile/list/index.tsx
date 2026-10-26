/**
 * Mobile rooms table and review detail (workstream 15).
 *
 * - `RoomsTable`: my rooms (ROUTES.logs) as a compact, searchable, sortable table with a crew
 *   column and a "with Mia / without Mia" filter. Tapping a row calls `onOpen(visitId)`.
 * - `ReviewDetail`: one visit (ROUTES.visit): shared facts, crew, puzzles, photos, my review with
 *   its visibility switch, friends' reviews, and accept/decline when I'm only tagged.
 * - `VisitsToConfirm`: the "2 visits to confirm" banner for the mobile home screen, above the
 *   log button. Renders nothing when there is nothing to confirm or the user is signed out.
 *
 * Light: no three.js, nothing under src/world.
 */
import { useMemo, useState } from 'react'
import type { LogRow, ReviewV2, Visibility, VisitDetail } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import { RATING_KEYS, PUZZLE_TYPE_LABELS } from '../../contracts/types'
import { useSession } from '../../auth'
import { Link } from '../../router'
import { isUnauthorized, loadInbox, visitsToConfirm } from '../../social/client'
import { Avatar, Button, Card, ErrorLine, Loading, formatDate, useAction, useLoad, userLabel } from '../../social/ui'
import {
  applyFilters,
  crewLabel,
  crewOptions,
  decodeCrewFilter,
  encodeCrewFilter,
  escapedLabel,
  nextSort,
  overallScore,
  participantName,
  summary,
  type CrewFilter,
  type Sort,
  type SortKey,
} from './logic'

export * from './logic'

// ---------------------------------------------------------------------------
// Rooms table
// ---------------------------------------------------------------------------

const SORT_LABELS: Record<SortKey, string> = { date: 'Date', name: 'Room', score: 'Score' }

export function RoomsTable({ onOpen, refreshKey = 0 }: { onOpen(visitId: string): void; refreshKey?: number }) {
  const load = useLoad((signal) => callApi(ROUTES.logs, {}, { signal }).then((r) => r.rows), [refreshKey])
  const [q, setQ] = useState('')
  const [crew, setCrew] = useState<CrewFilter>({ mode: 'all' })
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' })

  const rows = load.data
  const options = useMemo(() => (rows ? crewOptions(rows) : []), [rows])
  const shown = useMemo(() => (rows ? applyFilters(rows, q, crew, sort) : []), [rows, q, crew, sort])

  if (load.status === 'loading') return <div data-testid="rooms-table"><Loading label="Loading your rooms…" /></div>
  if (load.status === 'error')
    return (
      <div data-testid="rooms-table" className="space-y-2">
        <ErrorLine error={load.error} testId="rooms-error" />
        {!isUnauthorized(load.error) && (
          <Button onClick={load.reload} data-testid="rooms-retry">
            Try again
          </Button>
        )}
      </div>
    )

  const all = rows ?? []
  if (!all.length)
    return (
      <div data-testid="rooms-table">
        <p data-testid="rooms-empty" className="rounded-[var(--radius-cozy)] bg-white/60 p-4 text-center text-sm text-ink-soft ring-1 ring-panel-edge">
          No rooms yet. Log your first escape room and it shows up here.
        </p>
      </div>
    )

  const s = summary(shown)
  const filterOptions: { value: string; label: string }[] = [{ value: 'all', label: 'Everyone' }]
  for (const o of options) {
    filterOptions.push({ value: encodeCrewFilter({ mode: 'with', value: o.value }), label: `With ${o.label}` })
    filterOptions.push({ value: encodeCrewFilter({ mode: 'without', value: o.value }), label: `Without ${o.label}` })
  }

  return (
    <div data-testid="rooms-table" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search my rooms"
          aria-label="Search your rooms by name, venue, city or crew"
          data-testid="rooms-search"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base ring-1 ring-panel-edge outline-none focus:ring-2 focus:ring-accent"
        />
        {options.length > 0 && (
          <select
            aria-label="Filter by crew"
            data-testid="rooms-crew-filter"
            value={encodeCrewFilter(crew)}
            onChange={(e) => setCrew(decodeCrewFilter(e.target.value))}
            className="min-h-11 max-w-[50%] rounded-full bg-white px-3 text-sm ring-1 ring-panel-edge"
          >
            {filterOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="text-xs text-ink-soft" data-testid="rooms-summary">
        {s.count} {s.count === 1 ? 'room' : 'rooms'}
        {s.rate !== null && ` · ${Math.round(s.rate * 100)}% escaped`}
      </p>

      {shown.length === 0 ? (
        <p data-testid="rooms-no-match" className="text-sm text-ink-soft">
          No rooms match.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-cozy)] bg-white/70 ring-1 ring-panel-edge">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                {(['name', 'date', 'score'] as SortKey[]).map((k) => (
                  <th
                    key={k}
                    scope="col"
                    className={k === 'name' ? 'w-[52%] px-3 py-2' : k === 'date' ? 'w-[28%] px-2 py-2' : 'w-[20%] px-2 py-2 text-right'}
                    aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" data-testid={`rooms-sort-${k}`} onClick={() => setSort((cur) => nextSort(cur, k))} className="font-bold uppercase">
                      {SORT_LABELS[k]}
                      {sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RoomRow key={r.visitId} row={r} onOpen={onOpen} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RoomRow({ row, onOpen }: { row: LogRow; onOpen(id: string): void }) {
  const score = overallScore(row)
  const open = () => onOpen(row.visitId)
  return (
    <tr
      data-testid="rooms-row"
      data-visit-id={row.visitId}
      tabIndex={0}
      role="button"
      aria-label={`${row.game.name}, ${formatDate(row.date)}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="cursor-pointer border-t border-panel-edge/60 align-top active:bg-paper"
    >
      <td className="px-3 py-2">
        <div className="truncate font-bold">{row.game.name}</div>
        <div className="truncate text-xs text-ink-soft">
          {row.venue.name} · {row.venue.city}
        </div>
        <div className="truncate text-xs text-ink-soft" data-testid="rooms-crew">
          {crewLabel(row)} · Escaped: {escapedLabel(row.escaped, row.escapeTimeMinutes)}
        </div>
      </td>
      <td className="px-2 py-2 text-xs">{formatDate(row.date)}</td>
      <td className="px-2 py-2 text-right font-display text-base" data-testid="rooms-score">
        {score ?? '–'}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// "N visits to confirm"
// ---------------------------------------------------------------------------

/**
 * Banner for the mobile home screen. `onOpen` gets called when tapped (the shell routes to the
 * inbox, for example `/m/inbox`); without it, it links to the settings inbox.
 */
export function VisitsToConfirm({ onOpen, refreshKey = 0 }: { onOpen?(): void; refreshKey?: number }) {
  const load = useLoad((signal) => loadInbox({ signal }), [refreshKey])
  if (load.status !== 'ready') return null
  const { tags, claims } = load.data
  const n = visitsToConfirm(tags.ok ? tags.data : [], claims.ok ? claims.data : [])
  if (!n) return null
  const label = `${n} ${n === 1 ? 'visit' : 'visits'} to confirm`
  const cls = 'flex min-h-12 w-full items-center justify-between rounded-[var(--radius-cozy)] bg-warn/25 px-4 py-3 text-left font-bold text-ink ring-1 ring-warn'
  const inner = (
    <>
      <span>{label}</span>
      <span aria-hidden>›</span>
    </>
  )
  return onOpen ? (
    <button type="button" data-testid="visits-to-confirm" onClick={onOpen} className={cls}>
      {inner}
    </button>
  ) : (
    <Link to="/settings#inbox" data-testid="visits-to-confirm" className={cls}>
      {inner}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Review detail
// ---------------------------------------------------------------------------

const RATING_LABELS: Record<(typeof RATING_KEYS)[number], string> = {
  overall: 'Overall',
  puzzles: 'Puzzles',
  setting: 'Setting',
  storyline: 'Story',
  difficulty: 'Difficulty',
}

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Public',
  friends: 'Friends only',
  private: 'Private (just me)',
}

const FEATURE_LABELS = [
  ['visibleTimer', 'Visible timer'],
  ['multiRoom', 'Multi-room'],
  ['flashlights', 'Flashlights'],
  ['liveActors', 'Live actors'],
] as const

/** Who am I on this visit? The participant whose user is the author of a review I may edit. */
function myReviewOf(v: VisitDetail, meId: string | null): ReviewV2 | null {
  if (!meId) return null
  return v.reviews.find((r) => r.author.id === meId) ?? null
}

/** The signed-in user's id, inferred from the visit (my participant row) when no session is passed. */
function myIdOn(v: VisitDetail, meId?: string | null): string | null {
  if (meId) return meId
  // My own review always comes back with its transcript field visible to me only when I'm the
  // author, so a review with a non-null transcript is mine.
  const byTranscript = v.reviews.find((r) => r.transcript !== null)
  if (byTranscript) return byTranscript.author.id
  if (v.myStatus === 'owner' && v.createdBy) return v.createdBy
  return null
}

export function ReviewDetail({ visitId, onBack, meId }: { visitId: string; onBack(): void; meId?: string | null }) {
  const load = useLoad((signal) => callApi(ROUTES.visit, { params: { id: visitId } }, { signal }), [visitId])
  const session = useSession()
  const sessionId = meId ?? (session.status === 'signed-in' ? session.user.id : null)
  return (
    <div data-testid="review-detail" className="space-y-4">
      <button type="button" onClick={onBack} data-testid="review-back" className="min-h-11 text-sm font-bold text-teal">
        ‹ Back to my rooms
      </button>
      {load.status === 'loading' && <Loading />}
      {load.status === 'error' && <ErrorLine error={load.error} testId="review-error" />}
      {load.status === 'ready' && <VisitView visit={load.data} meId={myIdOn(load.data, sessionId)} onChanged={load.reload} onGone={onBack} />}
    </div>
  )
}

function VisitView({ visit, meId, onChanged, onGone }: { visit: VisitDetail; meId: string | null; onChanged(): void; onGone(): void }) {
  const mine = myReviewOf(visit, meId)
  const others = visit.reviews.filter((r) => r !== mine)
  const f = visit.facts
  const crew = visit.participants.filter((p) => p.user?.id !== meId && p.status !== 'declined')
  const tagger = visit.participants.find((p) => p.status === 'owner')?.user ?? null

  return (
    <>
      <header>
        <h1 className="font-display text-2xl leading-tight" data-testid="review-title">
          {visit.game.name}
        </h1>
        <p className="text-sm text-ink-soft">
          {visit.venue.name} · {visit.venue.city} · {formatDate(f.date)}
        </p>
        <Link to={`/games/${visit.game.slug}`} className="mt-1 inline-block text-sm font-bold text-teal underline" data-testid="review-public-link">
          Public page
        </Link>
      </header>

      {visit.myStatus === 'pending' && <TagAnswer visitId={visit.id} taggerName={tagger?.displayName ?? 'A friend'} onDone={onChanged} onDeclined={onGone} />}

      <Card title="The visit" testId="review-facts">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-soft">Escaped</dt>
          <dd data-testid="review-escaped">{escapedLabel(f.escaped, f.escapeTimeMinutes)}</dd>
          <dt className="text-ink-soft">Crew</dt>
          <dd data-testid="review-crew">
            {crew.length
              ? crew.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ', '}
                    {participantName(p)}
                    {p.status === 'pending' && <span className="text-ink-soft"> (pending)</span>}
                  </span>
                ))
              : 'Solo'}
          </dd>
        </dl>
        {(FEATURE_LABELS.some(([k]) => f[k] !== null) || f.toolsUsed.length > 0) && (
          <ul className="mt-3 flex flex-wrap gap-1.5 text-xs" data-testid="review-features">
            {FEATURE_LABELS.filter(([k]) => f[k] !== null).map(([k, label]) => (
              <li key={k} className={`rounded-full px-2 py-1 ring-1 ${f[k] ? 'bg-good/15 ring-good/40' : 'bg-white ring-panel-edge line-through opacity-70'}`}>
                {label}
              </li>
            ))}
            {f.toolsUsed.map((t) => (
              <li key={t} className="rounded-full bg-paper px-2 py-1 ring-1 ring-panel-edge">
                {t}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {mine ? <MyReview review={mine} onChanged={onChanged} /> : visit.myStatus !== 'pending' && <p className="text-sm text-ink-soft">You haven't reviewed this visit yet.</p>}

      {others.map((r) => (
        <ReviewCard key={r.id} review={r} />
      ))}

      {visit.puzzles.length > 0 && (
        <Card title="Puzzles" testId="review-puzzles">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {[...visit.puzzles]
              .sort((a, b) => a.position - b.position)
              .map((p) => (
                <li key={p.id}>
                  {p.description} <span className="text-xs text-ink-soft">({PUZZLE_TYPE_LABELS[p.type]})</span>
                  {mine?.memorablePuzzleIds.includes(p.id) && <span className="ml-1" title="Memorable">★</span>}
                  {p.notes && <div className="text-xs text-ink-soft">{p.notes}</div>}
                </li>
              ))}
          </ol>
        </Card>
      )}

      {visit.photos.length > 0 && (
        <Card title="Photos" testId="review-photos">
          <div className="grid grid-cols-3 gap-2">
            {visit.photos.map((p) => (
              <img key={p.id} src={p.url} alt={p.caption || 'Photo'} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
            ))}
          </div>
        </Card>
      )}

      {visit.myStatus && visit.myStatus !== 'pending' && <VisitActions visit={visit} meId={meId} onGone={onGone} />}
    </>
  )
}

function Scores({ review }: { review: ReviewV2 }) {
  return (
    <ul className="space-y-2 text-sm">
      {RATING_KEYS.map((k) => (
        <li key={k}>
          <div className="flex items-baseline justify-between">
            <span className="font-bold">{RATING_LABELS[k]}</span>
            <span className="font-display text-lg" data-testid={`score-${k}`}>
              {review.ratings[k].score}
            </span>
          </div>
          {review.ratings[k].comment && <p className="text-ink-soft">{review.ratings[k].comment}</p>}
        </li>
      ))}
    </ul>
  )
}

function MyReview({ review, onChanged }: { review: ReviewV2; onChanged(): void }) {
  const act = useAction()
  const [showTranscript, setShowTranscript] = useState(false)
  const patch = (body: { visibility?: Visibility; containsSpoilers?: boolean }) =>
    act.run(async () => {
      await callApi(ROUTES.updateReview, { params: { id: review.id }, body })
      onChanged()
    })
  return (
    <Card title="My review" testId="review-mine">
      {review.scoresCopied && (
        <p className="mb-3 rounded-lg bg-warn/20 p-2 text-xs" data-testid="review-copied">
          These scores are a copy of a friend's review. Change any score to make them yours; until then they don't count in public averages.
        </p>
      )}
      {review.hidden && (
        <p className="mb-3 rounded-lg bg-bad/15 p-2 text-xs" data-testid="review-hidden">
          A moderator hid this review from public pages. Only you can see it.
        </p>
      )}
      <Scores review={review} />
      <div className="mt-4 space-y-2 border-t border-panel-edge/60 pt-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-bold">Who can see it</span>
          <select
            data-testid="review-visibility"
            value={review.visibility}
            disabled={act.busy}
            onChange={(e) => void patch({ visibility: e.target.value as Visibility })}
            className="min-h-11 rounded-full bg-white px-3 ring-1 ring-panel-edge"
          >
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-bold">Comments contain spoilers</span>
          <input
            type="checkbox"
            data-testid="review-spoilers"
            checked={review.containsSpoilers}
            disabled={act.busy}
            onChange={(e) => void patch({ containsSpoilers: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-accent)]"
          />
        </label>
        <ErrorLine error={act.error} />
        {review.transcript && (
          <div>
            <button type="button" className="text-sm font-bold text-teal" onClick={() => setShowTranscript((s) => !s)} data-testid="review-transcript-toggle">
              {showTranscript ? 'Hide my voice note transcript' : 'Show my voice note transcript'}
            </button>
            {showTranscript && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft" data-testid="review-transcript">
                {review.transcript}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-soft">Only you can see your transcript.</p>
          </div>
        )}
      </div>
    </Card>
  )
}

function ReviewCard({ review }: { review: ReviewV2 }) {
  const [reveal, setReveal] = useState(!review.containsSpoilers)
  return (
    <Card
      testId="review-other"
      title={
        <span className="flex items-center gap-2">
          <Avatar name={review.author.displayName} image={review.author.image} size={28} />
          <span className="text-base">{userLabel(review.author)}</span>
        </span>
      }
    >
      {review.scoresCopied && <p className="mb-2 text-xs text-ink-soft">Copied scores, not yet changed.</p>}
      {reveal ? (
        <Scores review={review} />
      ) : (
        <Button onClick={() => setReveal(true)} data-testid="review-reveal">
          Show review (contains spoilers)
        </Button>
      )}
    </Card>
  )
}

function TagAnswer({ visitId, taggerName, onDone, onDeclined }: { visitId: string; taggerName: string; onDone(): void; onDeclined(): void }) {
  const act = useAction()
  const answer = (accept: boolean) =>
    act.run(async () => {
      await callApi(ROUTES.respondToTag, { params: { id: visitId }, body: { accept } })
      if (accept) onDone()
      else onDeclined()
    })
  return (
    <div className="rounded-[var(--radius-cozy)] bg-warn/20 p-4 ring-1 ring-warn" data-testid="review-tag-answer">
      <p className="text-sm">
        <b>{taggerName}</b> says you played this together.
      </p>
      <div className="mt-3 flex gap-2">
        <Button tone="primary" disabled={act.busy} onClick={() => void answer(true)} data-testid="tag-accept">
          Add to my room
        </Button>
        <Button disabled={act.busy} onClick={() => void answer(false)} data-testid="tag-decline">
          That wasn't me
        </Button>
      </div>
      <ErrorLine error={act.error} />
    </div>
  )
}

function VisitActions({ visit, meId, onGone }: { visit: VisitDetail; meId: string | null; onGone(): void }) {
  const act = useAction()
  const [confirming, setConfirming] = useState(false)
  const othersAccepted = visit.participants.some((p) => p.user && p.user.id !== meId && (p.status === 'accepted' || p.status === 'owner'))
  const canDelete = visit.myStatus === 'owner' && !othersAccepted
  const label = canDelete ? 'Delete this visit' : 'Remove me from this visit'
  const go = () =>
    act.run(async () => {
      if (canDelete) await callApi(ROUTES.deleteVisit, { params: { id: visit.id } })
      else await callApi(ROUTES.leaveVisit, { params: { id: visit.id } })
      onGone()
    })
  return (
    <div className="space-y-2 pt-2" data-testid="review-actions">
      {!confirming ? (
        <Button onClick={() => setConfirming(true)} data-testid="visit-remove">
          {label}
        </Button>
      ) : (
        <div className="space-y-2 rounded-[var(--radius-cozy)] bg-bad/10 p-3">
          <p className="text-sm">
            {canDelete ? 'This deletes the visit and your review. It cannot be undone.' : 'Your review is removed. The visit stays in the others’ rooms.'}
          </p>
          <div className="flex gap-2">
            <Button tone="danger" disabled={act.busy} onClick={() => void go()} data-testid="visit-remove-confirm">
              {canDelete ? 'Delete' : 'Remove me'}
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <ErrorLine error={act.error} />
    </div>
  )
}
