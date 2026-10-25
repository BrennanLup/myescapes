/**
 * "Spotify Wrapped"-style story sequence of the crew's escape-room year.
 * Navigation: prev/next buttons, arrow keys, swipe, or tap the left/right half.
 * Esc / close emits `overlay:close`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from 'react'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { availableYears, computeWrap, defaultWrapYear, type WrapYear } from './computeWrap'
import { buildCards } from './cards'
import './wrap.css'

const CONFETTI_COLORS = ['#ffe08a', '#2de2d0', '#fff7ec', '#e8433a', '#e8b93a', '#efe0c8', '#9b6bc4']

/** Deterministic pseudo-random in [0, 1). */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function Confetti({ count, seed }: { count: number; seed: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const w = 6 + rand(i, seed + 1) * 7
        return {
          left: `${rand(i, seed) * 100}%`,
          width: w,
          height: rand(i, seed + 2) > 0.5 ? w * 1.8 : w,
          color: CONFETTI_COLORS[Math.floor(rand(i, seed + 3) * CONFETTI_COLORS.length)],
          dur: 4.5 + rand(i, seed + 4) * 4,
          delay: -rand(i, seed + 5) * 8,
          drift: (rand(i, seed + 6) - 0.5) * 120,
          spin: 360 + rand(i, seed + 7) * 540,
          round: rand(i, seed + 8) > 0.7,
        }
      }),
    [count, seed],
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="wrap-confetti"
          style={
            {
              left: b.left,
              width: b.width,
              height: b.height,
              background: b.color,
              borderRadius: b.round ? '50%' : 2,
              '--wrap-dur': `${b.dur}s`,
              '--wrap-delay': `${b.delay}s`,
              '--wrap-drift': `${b.drift}px`,
              '--wrap-spin': `${b.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

function Sparkles({ seed }: { seed: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => {
        const size = 10 + rand(i, seed + 20) * 18
        return (
          <span
            key={i}
            className="wrap-sparkle"
            style={
              {
                left: `${6 + rand(i, seed + 21) * 88}%`,
                top: `${10 + rand(i, seed + 22) * 78}%`,
                width: size,
                height: size,
                background: i % 2 ? '#fff7ec' : '#ffe08a',
                '--wrap-dur': `${1.8 + rand(i, seed + 23) * 2}s`,
                '--wrap-delay': `${-rand(i, seed + 24) * 3}s`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}

const close = () => bus.emit('overlay:close')

export function WrapOverlay() {
  const rooms = useStore((s) => s.rooms)
  const reviews = useStore((s) => s.reviews)
  const years = useMemo(() => availableYears(reviews), [reviews])
  const [chosenYear, setChosenYear] = useState<WrapYear | null>(null)
  const year: WrapYear = chosenYear ?? defaultWrapYear(reviews)
  const stats = useMemo(() => computeWrap(rooms, reviews, year), [rooms, reviews, year])
  const cards = useMemo(() => buildCards(stats), [stats])
  const [rawIndex, setIndex] = useState(0)
  const index = Math.min(rawIndex, cards.length - 1)
  const card = cards[index]

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const cur = Math.min(i, cards.length - 1)
        const next = Math.max(0, Math.min(cards.length - 1, cur + delta))
        if (next !== cur) bus.emit('sfx', { name: 'whoosh' })
        return next
      })
    },
    [cards.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  // Touch: swipe left/right; a swipe suppresses the click that may follow it.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current
    touch.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      suppressClick.current = true
      window.setTimeout(() => (suppressClick.current = false), 400)
      go(dx < 0 ? 1 : -1)
    }
  }
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    go(x < rect.width * 0.5 ? -1 : 1)
  }

  const textColor = card.dark ? 'text-white' : 'text-ink'
  const chrome = card.dark ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-ink/15 text-ink hover:bg-ink/25'

  return (
    <div
      data-testid="wrap-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Your year in escape rooms"
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop sm:p-6"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden shadow-cozy transition-[background] duration-500 sm:h-[min(90vh,780px)] sm:w-[min(440px,100%)] sm:rounded-[28px] ${textColor}`}
        style={{ background: card.bg }}
      >
        {/* soft blobs for depth */}
        <div className="wrap-blob pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-2xl" aria-hidden />
        <div
          className="wrap-blob pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-black/15 blur-2xl"
          style={{ animationDelay: '-4s' }}
          aria-hidden
        />
        <Sparkles key={`s-${card.key}`} seed={index + 1} />
        {card.confetti > 0 && <Confetti key={`c-${card.key}`} count={card.confetti} seed={index * 7 + 3} />}

        {/* progress segments */}
        <div className="relative z-10 flex gap-1.5 px-4 pt-[max(1rem,env(safe-area-inset-top))]" aria-hidden>
          {cards.map((c, i) => (
            <div key={c.key} className={`h-1.5 flex-1 overflow-hidden rounded-full ${card.dark ? 'bg-white/30' : 'bg-ink/20'}`}>
              {i <= index && (
                <div
                  key={i === index ? `cur-${c.key}-${year}` : c.key}
                  className={`h-full rounded-full ${card.dark ? 'bg-white' : 'bg-ink'} ${i === index ? 'wrap-fill' : ''}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* header */}
        <div className="relative z-10 flex items-center gap-2 px-4 pt-3">
          <label className="sr-only" htmlFor="wrap-year">
            Year
          </label>
          <select
            id="wrap-year"
            data-testid="wrap-year"
            value={String(year)}
            onChange={(e) => {
              const v = e.target.value
              setChosenYear(v === 'all' ? 'all' : Number(v))
              setIndex(0)
              bus.emit('sfx', { name: 'click' })
            }}
            className={`h-11 cursor-pointer appearance-none rounded-full px-4 pr-9 font-display text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white ${chrome}`}
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='${card.dark ? '%23fff' : '%233b2a26'}' stroke-width='2'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 14px center',
              backgroundSize: '12px 8px',
            }}
          >
            {years.map((y) => (
              <option key={y} value={y} className="text-ink">
                {y}
              </option>
            ))}
            <option value="all" className="text-ink">
              All time
            </option>
          </select>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="wrap-close"
            aria-label="Close"
            onClick={close}
            className={`grid h-11 w-11 place-items-center rounded-full text-2xl font-bold ${chrome}`}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* stage: tap left / right like stories */}
        <div
          data-testid="wrap-stage"
          data-card={card.key}
          className="relative z-10 flex min-h-0 flex-1 cursor-pointer flex-col overflow-y-auto px-6 py-4 sm:px-8"
          onClick={onStageClick}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div key={`${card.key}-${year}`} className="my-auto w-full">
            {card.render()}
          </div>
        </div>

        {/* footer */}
        <div className="relative z-10 flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            data-testid="wrap-prev"
            aria-label="Previous card"
            disabled={index === 0}
            onClick={() => go(-1)}
            className={`grid h-14 w-14 place-items-center rounded-full transition disabled:opacity-30 ${chrome}`}
          >
            <svg viewBox="0 0 20 20" className="h-6 w-6" aria-hidden>
              <path d="M12.5 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="font-display text-base font-semibold opacity-80" data-testid="wrap-counter">
            {index + 1} / {cards.length}
          </span>
          {index < cards.length - 1 ? (
            <button
              type="button"
              data-testid="wrap-next"
              aria-label="Next card"
              onClick={() => go(1)}
              className={`grid h-14 w-14 place-items-center rounded-full transition ${card.dark ? 'bg-white text-plum hover:bg-paper' : 'bg-ink text-paper hover:bg-ink/90'}`}
            >
              <svg viewBox="0 0 20 20" className="h-6 w-6" aria-hidden>
                <path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              data-testid="wrap-next"
              onClick={() => {
                setIndex(0)
                bus.emit('sfx', { name: 'whoosh' })
              }}
              className="h-14 rounded-full bg-white px-5 font-display text-lg font-semibold text-plum hover:bg-paper"
            >
              Replay
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
