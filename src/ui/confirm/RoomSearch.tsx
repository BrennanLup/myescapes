/**
 * Room search for the review forms (Phase 3, workstream A): the shared directory picker
 * (`src/ui/roompicker`) plus an opt-in "Near me" toggle that sorts results nearest first, and an
 * "Add “…”" row for rooms the directory doesn't have. Light: no three.js, used by the phone too.
 */
import { forwardRef, useCallback, useEffect, useId, useState } from 'react'
import type { GameSummary } from '@/contracts/models'
import { callApi, ROUTES } from '@/contracts/routes'
import { RoomPicker, type DirectoryQuery, type RoomPick, type RoomPickerProps } from '@/ui/roompicker'
import { keyboardInset } from './keyboard'
import { nearLabel, useNearMe } from './near'

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * The directory game that a draft's room name (and city, when given) names exactly, if any.
 * Picks a same-city match first; otherwise only an unambiguous name match.
 */
export function exactGameMatch(games: readonly GameSummary[], name: string, city?: string | null): GameSummary | null {
  const named = games.filter((g) => norm(g.name) === norm(name))
  if (!named.length) return null
  if (city && norm(city)) {
    const local = named.find((g) => norm(g.city) === norm(city))
    if (local) return local
  }
  return named.length === 1 ? named[0] : null
}

type SearchFn = NonNullable<RoomPickerProps['search']>
type CityQuery = DirectoryQuery & { city?: string }

/** The directory search, with the optional soft city bias (same-city results first). */
const searchWithCity = (query: CityQuery, signal?: AbortSignal) => callApi(ROUTES.directorySearch, { query }, { signal })

export interface RoomSearchProps {
  onPick(pick: RoomPick): void
  onCreate(text: string): void
  initialQuery?: string
  label?: string
  hint?: string
  inputProps?: RoomPickerProps['inputProps']
  /** data-testid for the text input. */
  inputTestId?: string
  /**
   * The draft's city: while Near me is off, rooms and venues there rank first (others still
   * show). Near me, when on, sorts by distance instead.
   */
  city?: string | null
  /** Look this room up once and offer "Is it …?" when the directory has it exactly. */
  suggestFor?: { name: string; city?: string | null } | null
  /** Tests: swap the search and the geolocation. */
  search?: RoomPickerProps['search']
  geolocation?: Geolocation
  debounceMs?: number
}

export const RoomSearch = forwardRef<HTMLInputElement, RoomSearchProps>(function RoomSearch(
  { onPick, onCreate, initialQuery = '', inputTestId = 'room-search-input', label = 'Find the room', hint = 'Type the room or venue name. Pick it from the list, or add it if it’s new.', inputProps, city = null, suggestFor = null, search, geolocation, debounceMs },
  ref,
) {
  const near = useNearMe(geolocation)
  const labelId = useId()
  const hintId = useId()
  const on = near.status === 'on'
  const [suggestion, setSuggestion] = useState<GameSummary | null>(null)
  const sName = suggestFor?.name?.trim() ?? ''
  const sCity = suggestFor?.city ?? null
  // Near me off: bias by the draft's city. The picker re-searches when this function changes.
  const bias = on ? '' : (city ?? '').trim().slice(0, 120)
  const run = useCallback<SearchFn>((q, signal) => (search ?? searchWithCity)(bias ? ({ ...q, city: bias } as CityQuery) : q, signal), [search, bias])
  useEffect(() => {
    setSuggestion(null)
    if (sName.length < 2) return
    const ctl = new AbortController()
    ;(search ?? searchWithCity)({ q: sName, limit: 8, ...(sCity?.trim() ? { city: sCity.trim().slice(0, 120) } : {}) } as CityQuery, ctl.signal)
      .then((r) => setSuggestion(exactGameMatch(r.games, sName, sCity)))
      .catch(() => {})
    return () => ctl.abort()
  }, [sName, sCity, search])
  return (
    <div className="flex flex-col gap-1.5" data-testid="room-search">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label id={labelId} htmlFor={inputProps?.id} className="text-sm font-bold text-ink-soft">
          {label}
        </label>
        {near.supported && (
          <button
            type="button"
            aria-pressed={on}
            data-testid="room-search-near"
            onClick={near.toggle}
            title={on ? 'Sorting by distance from you. Press to turn off.' : 'Sort rooms by distance from where you are'}
            className={
              'inline-flex min-h-9 items-center gap-1.5 rounded-full border-2 px-3 text-sm font-bold transition ' +
              (on ? 'border-teal bg-teal text-white' : 'border-panel-edge bg-white/70 text-ink-soft hover:border-teal hover:text-teal')
            }
          >
            <PinIcon />
            {nearLabel(near.status)}
          </button>
        )}
      </div>
      {/* The shared picker opens its list upwards on narrow screens (good for a field low on the
          page). This field sits near the top of the form, so its list always opens below, capped
          so it fits above a phone keyboard. */}
      <div className="[&_[role=listbox]]:top-full [&_[role=listbox]]:bottom-auto [&_[role=listbox]]:mt-1 [&_[role=listbox]]:mb-0 [&_[role=listbox]]:max-h-[min(18rem,42svh)]">
        <RoomPicker
          ref={ref}
          allowCreate
          initialQuery={initialQuery}
          near={near.near}
          limit={8}
          search={run}
          debounceMs={debounceMs}
          onPick={onPick}
          onCreate={onCreate}
          inputProps={{
            placeholder: 'e.g. The Lost Observatory',
            'aria-labelledby': labelId,
            'aria-describedby': hintId,
            ...({ 'data-testid': inputTestId } as Record<string, string>),
            ...inputProps,
            style: { scrollMarginTop: 16, ...inputProps?.style },
            onFocus: (e) => {
              inputProps?.onFocus?.(e)
              // With a phone keyboard up, bring the field to the top so the results fit under it.
              const el = e.currentTarget
              setTimeout(() => {
                // Read the element's own document/window: the page may be gone when the timer fires.
                const win = el.ownerDocument?.defaultView
                if (win && el.ownerDocument.activeElement === el && keyboardInset(win) > 0) el.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
              }, 420)
            },
          }}
        />
      </div>
      {suggestion && (
        <button
          type="button"
          data-testid="room-search-suggestion"
          onClick={() => onPick({ kind: 'game', game: suggestion })}
          className="flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-dashed border-teal/50 bg-teal/5 px-3 py-2 text-left transition hover:border-teal hover:bg-teal/10"
        >
          <span aria-hidden className="text-lg">✨</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">
              Is it <b>{suggestion.name}</b>?
            </span>
            <span className="block truncate text-xs text-ink-soft">{[suggestion.venueName, suggestion.city].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="shrink-0 rounded-full bg-teal px-3 py-1 text-sm font-bold text-white">Use it</span>
        </button>
      )}
      <p id={hintId} className="text-xs text-ink-soft">
        {near.status === 'denied' ? 'Location is blocked for this site, so results are sorted by name.' : hint}
      </p>
    </div>
  )
})

function PinIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  )
}
