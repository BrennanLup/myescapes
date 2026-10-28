/**
 * Full-size photo viewer (Phase 3, QA r2): tap a thumbnail to open it over everything.
 *
 *   <Lightbox photos={[{ src, alt }]} index={i} onIndex={setI} onClose={() => setI(null)} />
 *
 * Arrow keys or a swipe move between photos, Esc / the close button / a tap on the dark backdrop
 * closes it, and focus returns to what had it before. Rendered in a portal on `document.body`.
 * While it is open `isLightboxOpen()` is true, so overlays underneath (which listen for Esc and the
 * arrow keys on `window` in the capture phase, before this does) can leave those keys alone.
 * Light: no three.js.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface LightboxPhoto {
  src: string
  alt: string
  caption?: string | null
}

let openCount = 0
/** True while a lightbox is showing. */
export const isLightboxOpen = () => openCount > 0

const navBtn =
  'absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-lg transition hover:bg-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function Lightbox({ photos, index, onIndex, onClose }: { photos: readonly LightboxPhoto[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const n = photos.length
  const i = Math.min(Math.max(0, index), Math.max(0, n - 1))
  const photo = photos[i]
  const dialog = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const cb = useRef({ onIndex, onClose, i, n })
  cb.current = { onIndex, onClose, i, n }

  // Mark open, focus the close button, and give focus back on close.
  useEffect(() => {
    openCount++
    const previous = document.activeElement as HTMLElement | null
    closeBtn.current?.focus({ preventScroll: true })
    return () => {
      openCount--
      if (previous && document.contains(previous)) previous.focus?.({ preventScroll: true })
    }
  }, [])

  // Close if the photos went away (the last one was removed).
  useEffect(() => {
    if (n === 0) cb.current.onClose()
  }, [n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { onIndex: go, onClose: close, i: at, n: count } = cb.current
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' && count > 1) go((at + 1) % count)
      else if (e.key === 'ArrowLeft' && count > 1) go((at - 1 + count) % count)
      else if (e.key === 'Tab' && dialog.current) {
        // Keep focus inside.
        const f = [...dialog.current.querySelectorAll<HTMLElement>('button')]
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) last.focus()
        else if (!e.shiftKey && document.activeElement === last) first.focus()
        else return
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    // Bubble phase on window: the last stop, after any overlay's capture listener stood aside.
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!photo) return null
  const go = (d: number) => onIndex((i + d + n) % n)
  const loaded = loadedSrc === photo.src

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={n > 1 ? `Photo ${i + 1} of ${n}` : 'Photo'}
      data-testid="photo-lightbox"
      className="fixed inset-0 z-[100] flex flex-col bg-[#140e16]/95 text-white select-none"
    >
      <div className="flex shrink-0 items-center gap-3 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-2 sm:px-5">
        {n > 1 && (
          <span className="font-bold tabular-nums text-white/85" aria-live="polite" data-testid="photo-lightbox-count">
            {i + 1} / {n}
          </span>
        )}
        <span className="hidden text-xs font-bold text-white/60 sm:inline">{n > 1 ? 'Esc to close · ← → for more' : 'Esc to close'}</span>
        <button
          ref={closeBtn}
          type="button"
          aria-label="Close photo"
          data-testid="photo-lightbox-close"
          onClick={onClose}
          className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl leading-none transition hover:bg-white/20 focus-visible:outline-3 focus-visible:outline-accent"
        >
          ×
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1 touch-pan-y"
        data-testid="photo-lightbox-stage"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (n > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          // A plain tap on the dark area (not the photo) closes.
          else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.target === e.currentTarget) onClose()
        }}
        onPointerCancel={() => (start.current = null)}
      >
        <img
          key={photo.src}
          src={photo.src}
          alt={photo.alt}
          draggable={false}
          onLoad={() => setLoadedSrc(photo.src)}
          onError={() => setLoadedSrc(photo.src)}
          data-testid="photo-lightbox-image"
          className={'pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain p-2 transition-opacity duration-200 sm:p-6 ' + (loaded ? 'opacity-100' : 'opacity-0')}
        />
        {!loaded && (
          <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-bold text-white/60">
            Loading…
          </span>
        )}
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous photo" data-testid="photo-lightbox-prev" onClick={() => go(-1)} className={navBtn + ' left-2 sm:left-5'}>
              <Chevron dir="left" />
            </button>
            <button type="button" aria-label="Next photo" data-testid="photo-lightbox-next" onClick={() => go(1)} className={navBtn + ' right-2 sm:right-5'}>
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>
      {photo.caption ? (
        <p className="shrink-0 px-4 pt-1 pb-[max(14px,env(safe-area-inset-bottom))] text-center font-hand text-2xl leading-tight text-white/90">{photo.caption}</p>
      ) : (
        <span className="block shrink-0 pb-[max(14px,env(safe-area-inset-bottom))]" />
      )}
    </div>,
    document.body,
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

/**
 * A read-only grid of thumbnails that open in the lightbox (for people who can see a visit's
 * photos but not add or remove any).
 */
export function PhotoThumbs({ photos, className = 'grid grid-cols-3 gap-2', testId = 'photo-thumbs' }: { photos: readonly LightboxPhoto[]; className?: string; testId?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <ul className={className} data-testid={testId}>
        {photos.map((p, i) => (
          <li key={p.src}>
            <button
              type="button"
              aria-label={`Open ${p.alt}`}
              data-testid="photo-open"
              onClick={() => setOpen(i)}
              className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <img src={p.src} alt={p.alt} loading="lazy" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}
