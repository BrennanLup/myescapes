import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import { bus } from '@/contracts/events'
import { latestReviewFor, type Review, type Room } from '@/contracts/types'
import { useStore } from '@/state/store'
import { Gallery } from './Gallery'
import { CalendarIcon, ChevronLeft, ChevronRight, CloseIcon, GlobeIcon, PinIcon } from './icons'
import {
  avatarColor,
  boardOrder,
  formatAddress,
  formatDate,
  galleryPhotos,
  genreColor,
  genreLabel,
  initials,
  mapsUrl,
  neighbours,
  prettyHost,
  safeUrl,
  scoreWord,
} from './helpers'
import { Badges, EscapeStamp, PaperCard, Puzzles, Ratings, Tools, VoiceNote } from './sections'

const KEYFRAMES = `
@keyframes review-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes review-in { from { opacity: 0; transform: translateY(24px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes review-sheet { from { transform: translateY(40px); opacity: .4 } to { transform: none; opacity: 1 } }
.review-panel { animation: review-sheet .32s cubic-bezier(.2,.8,.3,1) both }
@media (min-width: 640px) { .review-panel { animation-name: review-in } }
@media (prefers-reduced-motion: reduce) { .review-panel { animation: none } }
`

const close = () => bus.emit('overlay:close')

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

function GenreChip({ genre }: { genre: string }) {
  const c = genreColor(genre)
  return (
    <span
      data-testid="genre-chip"
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-white shadow-[0_2px_0_rgba(0,0,0,.12)]"
      style={{ background: c }}
    >
      <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden="true" />
      {genreLabel(genre)}
    </span>
  )
}

function Crew({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-2" aria-label="Crew">
      {names.map((n) => (
        <li key={n} className="flex items-center gap-1.5" data-testid="crew-member">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-full border-2 border-white font-display text-sm font-semibold text-white shadow-[0_2px_4px_rgba(60,30,20,.25)]"
            style={{ background: avatarColor(n) }}
          >
            {initials(n)}
          </span>
          <span className="text-sm font-bold text-ink">{n}</span>
        </li>
      ))}
    </ul>
  )
}

function Header({ room, review, titleId }: { room: Room; review?: Review; titleId: string }) {
  const site = safeUrl(room.website)
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GenreChip genre={room.genre} />
        {review && (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-soft">
            <CalendarIcon size={16} />
            <time dateTime={review.date}>{formatDate(review.date)}</time>
          </span>
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-[30px] leading-[1.05] font-bold text-ink sm:text-[38px]">
            {room.name}
          </h2>
          <p className="mt-1 text-base font-semibold text-ink-soft">
            by <span className="text-ink">{room.company}</span> · {room.city}
          </p>
        </div>
        {review && (
          <div className="shrink-0 pt-1">
            <EscapeStamp review={review} />
          </div>
        )}
      </div>
      {review && <Crew names={review.crew} />}
      <div className="flex flex-wrap gap-2">
        {site && (
          <a
            href={site}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-panel-edge bg-white/70 px-3 text-sm font-bold text-teal hover:bg-white focus-visible:outline-3 focus-visible:outline-accent"
          >
            <GlobeIcon size={16} />
            {prettyHost(site)}
          </a>
        )}
        {(room.address || room.city) && (
          <a
            href={mapsUrl(room.address, room.city)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-panel-edge bg-white/70 px-3 text-sm font-bold text-teal hover:bg-white focus-visible:outline-3 focus-visible:outline-accent"
          >
            <PinIcon size={16} />
            <span className="truncate">{formatAddress(room.address, room.city)}</span>
          </a>
        )}
      </div>
      {review && <Verdict review={review} />}
    </header>
  )
}

/** Sticky note with the overall score and the crew's one-line verdict. */
function Verdict({ review }: { review: Review }) {
  const { score, comment } = review.ratings.overall
  return (
    <div
      data-testid="verdict"
      className="mt-1 flex rotate-[0.8deg] items-center gap-4 rounded-[6px] bg-[#fde9a8] px-4 py-3 shadow-[0_6px_14px_rgba(60,30,20,.16)]"
    >
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-[3px] border-accent bg-white/70 text-accent">
        <span className="font-display text-2xl leading-none font-bold tabular-nums">{score}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-extrabold tracking-wider text-ink-soft uppercase">Crew verdict</p>
        <p className="font-hand text-2xl leading-tight text-ink">{comment || scoreWord(score) + '!'}</p>
      </div>
    </div>
  )
}

function NoReview({ room }: { room: Room }) {
  return (
    <PaperCard label="No review yet" className="text-center" tilt={-0.5}>
      <div data-testid="no-review" className="flex flex-col items-center gap-2 py-4">
        <span className="font-hand text-4xl text-accent">No review yet</span>
        <p className="max-w-sm text-ink-soft">
          Nobody has written up <span className="font-bold text-ink">{room.name}</span> so far. Head to the desk terminal and leave a voice note to log it.
        </p>
      </div>
    </PaperCard>
  )
}

const iconBtn =
  'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-panel-edge bg-white/80 text-ink shadow-[0_2px_0_rgba(60,30,20,.1)] hover:bg-white active:translate-y-px disabled:opacity-35 focus-visible:outline-3 focus-visible:outline-accent'

/** Review viewer overlay for one room (its latest review). */
export function ReviewOverlay({ roomId }: { roomId: string }) {
  const rooms = useStore((s) => s.rooms)
  const reviews = useStore((s) => s.reviews)
  const pins = useStore((s) => s.boardPins)
  const room = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId])
  const review = useMemo(() => latestReviewFor(roomId, reviews), [roomId, reviews])
  const order = useMemo(() => boardOrder(pins, rooms), [pins, rooms])
  const { prev, next } = neighbours(order, roomId)
  const photos = useMemo(() => galleryPhotos(room, review), [room, review])
  const position = order.indexOf(roomId)

  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastSfxFor = useRef<string | null>(null)

  const goTo = useCallback((id: string | null) => {
    if (id) bus.emit('review:open', { roomId: id })
  }, [])

  // Paper rustle on open and on each page turn (guarded against StrictMode double effects).
  useEffect(() => {
    if (lastSfxFor.current === roomId) return
    lastSfxFor.current = roomId
    bus.emit('sfx', { name: 'paper' })
  }, [roomId])

  // Move focus into the dialog on open; restore it afterwards.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) previous.focus?.({ preventScroll: true })
    }
  }, [])

  // New room: scroll back to the top and keep focus inside.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 })
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true })
  }, [roomId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault()
        goTo(prev)
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault()
        goTo(next)
      } else if (e.key === 'Tab' && dialogRef.current) {
        // Simple focus trap.
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === dialogRef.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [prev, next, goTo])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" data-testid="review-overlay">
      <style>{KEYFRAMES}</style>
      <div className="absolute inset-0 bg-backdrop" onClick={close} aria-hidden="true" data-testid="review-backdrop" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="review-panel relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-[26px] bg-panel shadow-cozy outline-none sm:h-auto sm:max-h-[min(88vh,860px)] sm:max-w-[900px] sm:rounded-cozy"
        style={{
          backgroundImage:
            'radial-gradient(circle at 12% 8%, rgba(224,123,57,.10), transparent 40%), radial-gradient(circle at 90% 95%, rgba(47,143,138,.08), transparent 45%), radial-gradient(rgba(122,98,88,.07) 1px, transparent 1.2px)',
          backgroundSize: 'auto, auto, 18px 18px',
        }}
      >
        {/* Toolbar: grab handle on mobile, room nav, close. */}
        <div className="relative flex shrink-0 items-center gap-2 border-b border-dashed border-panel-edge px-3 pt-2 pb-2 sm:px-4 sm:pt-3">
          <span aria-hidden="true" className="absolute top-1.5 left-1/2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-panel-edge sm:hidden" />
          <button type="button" className={iconBtn} aria-label="Previous room" disabled={!prev} onClick={() => goTo(prev)}>
            <ChevronLeft />
          </button>
          <button type="button" className={iconBtn} aria-label="Next room" disabled={!next} onClick={() => goTo(next)}>
            <ChevronRight />
          </button>
          <span className="ml-1 font-hand text-xl text-ink-soft">
            {position >= 0 && order.length > 0 ? `page ${position + 1} of ${order.length}` : 'review'}
          </span>
          <span className="ml-auto hidden text-xs font-bold text-ink-soft sm:inline">Esc to close · ← → to flip</span>
          <button type="button" className={`${iconBtn} ml-auto sm:ml-2`} aria-label="Close review" onClick={close}>
            <CloseIcon />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-7 sm:pt-6">
          {!room ? (
            <div className="py-10 text-center">
              <h2 id={titleId} className="font-display text-2xl font-bold text-ink">
                Room not found
              </h2>
              <p className="mt-2 text-ink-soft">This photo seems to have fallen off the board.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <div className="pt-2">
                  <Gallery key={room.id} room={room} photos={photos} />
                </div>
                <Header room={room} review={review} titleId={titleId} />
              </div>
              {review ? (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Ratings review={review} />
                  <div className="flex flex-col gap-5">
                    <Badges review={review} />
                    <Tools tools={review.toolsUsed} />
                  </div>
                  <div className="md:col-span-2">
                    <Puzzles puzzles={review.puzzles} />
                  </div>
                  <div className="md:col-span-2">
                    <VoiceNote transcript={review.voiceTranscript} />
                  </div>
                </div>
              ) : (
                <NoReview room={room} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
