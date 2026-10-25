import { useRef, useState } from 'react'
import type { Photo, Room } from '@/contracts/types'
import { ChevronLeft, ChevronRight, GenreGlyph } from './icons'
import { genreColor, genreLabel } from './helpers'

/** Strip of washi tape stuck across the top of a polaroid. */
export function Tape({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute h-6 w-24 opacity-80 ${className}`}
      style={{
        background: `repeating-linear-gradient(45deg, ${color}cc 0 6px, ${color}99 6px 12px)`,
        boxShadow: '0 1px 2px rgba(60,30,20,.2)',
      }}
    />
  )
}

/** Placeholder card shown when a room has no photos. */
function GenrePlaceholder({ room }: { room: Room }) {
  const c = genreColor(room.genre)
  return (
    <div
      data-testid="photo-placeholder"
      className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden text-white"
      style={{
        background: `radial-gradient(circle at 30% 25%, ${c}cc, ${c} 55%), ${c}`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.9) 1.2px, transparent 1.4px)', backgroundSize: '14px 14px' }}
      />
      <span className="relative drop-shadow-[0_2px_0_rgba(0,0,0,.15)]">
        <GenreGlyph genre={room.genre} size={88} />
      </span>
      <span className="relative font-display text-lg font-semibold tracking-wide uppercase opacity-90">{genreLabel(room.genre)}</span>
      <span className="relative font-hand text-xl opacity-90">no photos yet</span>
    </div>
  )
}

/** Photo polaroid with swipe + arrow buttons. Key it by room id so it resets per room. */
export function Gallery({ room, photos }: { room: Room; photos: Photo[] }) {
  const [index, setIndex] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const n = photos.length

  const go = (d: number) => setIndex((i) => (n ? (i + d + n) % n : 0))
  const current = photos[Math.min(index, Math.max(0, n - 1))]

  return (
    <figure className="relative mx-auto w-full max-w-[380px] -rotate-[1.5deg] bg-white p-3 pb-2 shadow-[0_10px_24px_rgba(60,30,20,.28)] transition-transform motion-safe:hover:rotate-0">
      <Tape color={genreColor(room.genre)} className="-top-3 left-1/2 -translate-x-1/2 rotate-[-4deg]" />
      {n === 0 ? (
        <GenrePlaceholder room={room} />
      ) : (
        <div
          className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden bg-[#2a1f2d]"
          data-testid="gallery"
          onPointerDown={(e) => {
            start.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerUp={(e) => {
            const s = start.current
            start.current = null
            if (!s) return
            const dx = e.clientX - s.x
            const dy = e.clientY - s.y
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          }}
          onPointerCancel={() => (start.current = null)}
        >
          <img
            key={current.url}
            src={current.url}
            alt={current.caption || `${room.name} photo ${index + 1}`}
            draggable={false}
            className="h-full w-full object-cover select-none motion-safe:animate-[review-fade_.3s_ease-out]"
          />
          {n > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => go(-1)}
                className="absolute top-1/2 left-2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink shadow hover:bg-white focus-visible:outline-3 focus-visible:outline-accent"
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => go(1)}
                className="absolute top-1/2 right-2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink shadow hover:bg-white focus-visible:outline-3 focus-visible:outline-accent"
              >
                <ChevronRight />
              </button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden="true">
                {photos.map((p, i) => (
                  <span key={p.url} className={`h-2 w-2 rounded-full ${i === index ? 'bg-white' : 'bg-white/45'}`} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <figcaption className="flex min-h-9 items-center justify-between gap-2 px-1 pt-2 font-hand text-xl leading-tight text-ink">
        <span className="truncate">{current?.caption || room.name}</span>
        {n > 1 && (
          <span className="shrink-0 font-body text-xs font-bold text-ink-soft" aria-live="polite">
            {index + 1} / {n}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
