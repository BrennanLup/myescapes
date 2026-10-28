/**
 * Search-as-you-type picker over the public room directory (ROUTES.directorySearch): rooms first,
 * then venues. Used by the "Rooms to try" wish list and the review form.
 *
 * - Controlled (`query` + `onQueryChange`) or uncontrolled (`initialQuery`).
 * - ARIA combobox: no row is highlighted until ↑/↓ (so the first ↓ lands on the first result),
 *   Enter picks the highlighted row (on the "Add" row it calls `onCreate`, as a click does; with no
 *   row highlighted the surrounding form gets the Enter), Escape closes the list (and does not
 *   bubble, so it doesn't also close the overlay around it).
 * - `allowCreate` adds a last row "Add “<text>”" that calls `onCreate(text)` for rooms not listed.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import type { GameSummary, VenueSummary } from '@/contracts/models'
import { searchDirectory } from './search'

export type RoomPick = { kind: 'game'; game: GameSummary } | { kind: 'venue'; venue: VenueSummary }

export interface RoomPickerProps {
  onPick: (pick: RoomPick) => void
  /** Offer "Add “<text>”" for rooms the directory doesn't have. */
  allowCreate?: boolean
  onCreate?: (text: string) => void
  /** Include venues in the results (default true). */
  includeVenues?: boolean
  query?: string
  onQueryChange?: (q: string) => void
  initialQuery?: string
  /** Bias results towards a point. */
  near?: { lat: number; lng: number } | null
  country?: string
  limit?: number
  /** Extra props for the text input (placeholder, data-testid, aria-invalid, className…). */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onKeyDown' | 'role'>
  /** Search function; tests pass a fake. */
  search?: typeof searchDirectory
  debounceMs?: number
}

type Row = { key: string; kind: 'game'; game: GameSummary } | { key: string; kind: 'venue'; venue: VenueSummary } | { key: string; kind: 'create'; text: string }

const MIN_CHARS = 2

const inputClass = 'h-12 w-full rounded-xl border border-panel-edge bg-white px-3 text-base outline-none focus:border-teal'

function place(city: string, country: string) {
  return [city, country].filter(Boolean).join(', ')
}

export const RoomPicker = forwardRef<HTMLInputElement, RoomPickerProps>(function RoomPicker(
  { onPick, allowCreate = false, onCreate, includeVenues = true, query, onQueryChange, initialQuery = '', near, country, limit = 8, inputProps, search = searchDirectory, debounceMs = 200 },
  ref,
) {
  const [own, setOwn] = useState(initialQuery)
  const text = query ?? own
  const setText = (q: string) => {
    if (query === undefined) setOwn(q)
    onQueryChange?.(q)
  }
  const [games, setGames] = useState<GameSummary[]>([])
  const [venues, setVenues] = useState<VenueSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)
  const listId = useId()
  const lat = near?.lat
  const lng = near?.lng

  useEffect(() => {
    const q = text.trim()
    if (q.length < MIN_CHARS) {
      setGames([])
      setVenues([])
      setLoading(false)
      setError(false)
      return
    }
    const ctl = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      search({ q, lat, lng, country, limit }, ctl.signal)
        .then((r) => {
          setGames(r.games)
          setVenues(includeVenues ? r.venues : [])
          setError(false)
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name !== 'AbortError') setError(true)
        })
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false)
        })
    }, debounceMs)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [text, lat, lng, country, limit, includeVenues, search, debounceMs])

  const trimmed = text.trim()
  const rows: Row[] = [
    ...games.map((game) => ({ key: `g:${game.id}`, kind: 'game' as const, game })),
    ...venues.map((venue) => ({ key: `v:${venue.id}`, kind: 'venue' as const, venue })),
  ]
  if (allowCreate && trimmed.length >= MIN_CHARS && !loading) rows.push({ key: 'create', kind: 'create', text: trimmed })
  const showList = open && trimmed.length >= MIN_CHARS
  const activeIndex = active < 0 || !rows.length ? -1 : Math.min(active, rows.length - 1)

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  const choose = (row: Row) => {
    close()
    if (row.kind === 'game') onPick({ kind: 'game', game: row.game })
    else if (row.kind === 'venue') onPick({ kind: 'venue', venue: row.venue })
    else onCreate?.(row.text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return
      e.preventDefault()
      setOpen(true)
      // From no highlighted row, ↓ goes to the first row and ↑ to the last.
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive(activeIndex < 0 ? (d > 0 ? 0 : rows.length - 1) : (activeIndex + d + rows.length) % rows.length)
    } else if (e.key === 'Enter' && showList && activeIndex >= 0 && rows[activeIndex]) {
      // Enter on a highlighted row picks it ("Add" calls onCreate); with none highlighted the surrounding form gets it.
      e.preventDefault()
      choose(rows[activeIndex])
    } else if (e.key === 'Escape' && showList) {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation?.()
      close()
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        {...inputProps}
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={(e) => {
          setOpen(true)
          inputProps?.onFocus?.(e)
        }}
        onBlur={(e) => {
          // Let a click on a row land first.
          setTimeout(close, 150)
          inputProps?.onBlur?.(e)
        }}
        onKeyDown={onKeyDown}
        className={inputProps?.className ?? inputClass}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          data-testid="roompicker-list"
          className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-72 overflow-y-auto rounded-xl border border-panel-edge bg-white py-1 text-ink shadow-cozy sm:top-full sm:bottom-auto sm:mt-1 sm:mb-0"
        >
          {loading && !rows.length && <li className="px-3 py-2 text-sm text-ink-soft">Searching…</li>}
          {error && <li className="px-3 py-2 text-sm text-bad">Couldn't search the room directory.</li>}
          {!loading && !error && !rows.length && <li className="px-3 py-2 text-sm text-ink-soft">No rooms found.</li>}
          {rows.map((row, i) => (
            <li
              key={row.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-testid={`roompicker-option-${row.kind}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(row)}
              onPointerEnter={() => setActive(i)}
              // The highlighted row: a clear tint plus a bar on the left (a faint tint alone read as unselected).
              className={`flex cursor-pointer items-center gap-2 border-l-4 py-2 pr-3 pl-2 ${i === activeIndex ? 'border-teal bg-teal/20' : 'border-transparent'}`}
            >
              {row.kind === 'game' && (
                <>
                  <span aria-hidden className="text-lg">🗝️</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.game.name}</span>
                    <span className="block truncate text-sm text-ink-soft">
                      {row.game.venueName} · {place(row.game.city, row.game.country)}
                    </span>
                  </span>
                  {row.game.avgOverall != null && <span className="shrink-0 text-sm text-ink-soft">★ {row.game.avgOverall.toFixed(1)}</span>}
                </>
              )}
              {row.kind === 'venue' && (
                <>
                  <span aria-hidden className="text-lg">🏢</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.venue.name}</span>
                    <span className="block truncate text-sm text-ink-soft">
                      {place(row.venue.city, row.venue.country)}
                      {row.venue.gameCount > 0 ? ` · ${row.venue.gameCount} room${row.venue.gameCount === 1 ? '' : 's'}` : ' · venue'}
                    </span>
                  </span>
                  {row.venue.distanceKm != null && <span className="shrink-0 text-sm text-ink-soft">{Math.round(row.venue.distanceKm)} km</span>}
                </>
              )}
              {row.kind === 'create' && (
                <>
                  <span aria-hidden className="text-lg">＋</span>
                  <span className="min-w-0 flex-1 truncate">
                    Add “<span className="font-semibold">{row.text}</span>” (not in the directory)
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
