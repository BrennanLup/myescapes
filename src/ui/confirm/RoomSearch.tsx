/**
 * Room search for the review forms (Phase 3, workstream A): the shared directory picker
 * (`src/ui/roompicker`) plus an opt-in "Near me" toggle that sorts results nearest first, and an
 * "Add “…”" row for rooms the directory doesn't have. Light: no three.js, used by the phone too.
 */
import { forwardRef, useId } from 'react'
import { RoomPicker, type RoomPick, type RoomPickerProps } from '@/ui/roompicker'
import { nearLabel, useNearMe } from './near'

export interface RoomSearchProps {
  onPick(pick: RoomPick): void
  onCreate(text: string): void
  initialQuery?: string
  label?: string
  hint?: string
  inputProps?: RoomPickerProps['inputProps']
  /** Tests: swap the search and the geolocation. */
  search?: RoomPickerProps['search']
  geolocation?: Geolocation
  debounceMs?: number
}

export const RoomSearch = forwardRef<HTMLInputElement, RoomSearchProps>(function RoomSearch(
  { onPick, onCreate, initialQuery = '', label = 'Find the room', hint = 'Type the room or venue name. Pick it from the list, or add it if it’s new.', inputProps, search, geolocation, debounceMs },
  ref,
) {
  const near = useNearMe(geolocation)
  const labelId = useId()
  const hintId = useId()
  const on = near.status === 'on'
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
      <RoomPicker
        ref={ref}
        allowCreate
        initialQuery={initialQuery}
        near={near.near}
        limit={8}
        search={search}
        debounceMs={debounceMs}
        onPick={onPick}
        onCreate={onCreate}
        inputProps={{
          placeholder: 'e.g. The Lost Observatory',
          'aria-labelledby': labelId,
          'aria-describedby': hintId,
          ...inputProps,
        }}
      />
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
