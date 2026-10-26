/**
 * Crew tagging in the log flow (workstream 36): friend chips ordered by how often you play
 * together (ROUTES.crewSuggestions), recent guest names, and a box to add anyone else by name.
 * Only accepted friends can be tagged as users; everyone else is a guest name.
 */
import { useEffect, useState } from 'react'
import type { CrewSuggestion, CrewTag } from '../../../contracts/models'
import { callApi, ROUTES } from '../../../contracts/routes'
import { friendName, hasTag, sortSuggestions, tagForName, tagKey, tagLabel, toggleTag } from './logic'

export interface CrewPickerProps {
  value: CrewTag[]
  onChange(value: CrewTag[]): void
  /** Preloaded suggestions (the log flow loads them once). When omitted the picker loads them. */
  suggestions?: CrewSuggestion[] | null
  fetch?: typeof fetch
}

/** Load crew chips. Failures leave an empty list: guests can still be typed. */
export function useCrewSuggestions(enabled = true, fetchImpl?: typeof fetch): { suggestions: CrewSuggestion[]; loading: boolean } {
  const [suggestions, setSuggestions] = useState<CrewSuggestion[]>([])
  const [loading, setLoading] = useState(enabled)
  useEffect(() => {
    if (!enabled) return
    let live = true
    callApi(ROUTES.crewSuggestions, {}, fetchImpl ? { fetch: fetchImpl } : {})
      .then((r) => live && setSuggestions(sortSuggestions(r.suggestions)))
      .catch(() => {
        /* offline or not built yet: typing names still works */
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [enabled, fetchImpl])
  return { suggestions, loading }
}

const chip = (on: boolean) =>
  `inline-flex items-center gap-1 rounded-full border px-3 py-2 text-sm font-semibold ${on ? 'border-teal bg-teal text-white' : 'border-panel-edge bg-white text-ink'}`

export function CrewPicker({ value, onChange, suggestions: given, fetch: fetchImpl }: CrewPickerProps) {
  const loaded = useCrewSuggestions(given === undefined, fetchImpl)
  const suggestions = sortSuggestions(given ?? loaded.suggestions)
  const [name, setName] = useState('')

  // Not a <form>: the picker sits inside the confirm form, and forms can't nest.
  const add = () => {
    const t = tagForName(name, suggestions)
    if (t && !hasTag(value, t)) onChange([...value, t])
    setName('')
  }

  // Chips: every suggestion, then any tagged guest that isn't a suggestion.
  const suggestedKeys = new Set(suggestions.map((s) => tagKey(s.kind === 'friend' ? { userId: s.user.id } : { guestName: s.guestName })))
  const extra = value.filter((t) => !suggestedKeys.has(tagKey(t)))

  return (
    <div data-testid="crew-picker" className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Who played">
        {suggestions.map((s) => {
          const t: CrewTag = s.kind === 'friend' ? { userId: s.user.id } : { guestName: s.guestName }
          const on = hasTag(value, t)
          const label = s.kind === 'friend' ? friendName(s.user) : s.guestName
          return (
            <button
              key={tagKey(t)}
              type="button"
              aria-pressed={on}
              data-testid={s.kind === 'friend' ? `crew-friend-${s.user.id}` : `crew-guest-${s.guestName}`}
              className={chip(on)}
              onClick={() => onChange(toggleTag(value, t))}
            >
              {s.kind === 'friend' && s.user.image ? <img src={s.user.image} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" /> : null}
              {label}
              {s.kind === 'guest' && <span className="text-xs font-normal opacity-70">guest</span>}
            </button>
          )
        })}
        {extra.map((t) => (
          <button key={tagKey(t)} type="button" aria-pressed data-testid={`crew-tag-${tagLabel(t, suggestions)}`} className={chip(true)} onClick={() => onChange(toggleTag(value, t))}>
            {tagLabel(t, suggestions)}
            {'guestName' in t && <span className="text-xs font-normal opacity-80">guest</span>}
            <span aria-hidden>×</span>
          </button>
        ))}
        {suggestions.length === 0 && extra.length === 0 && <p className="text-sm text-ink-soft">{loaded.loading && given === undefined ? 'Loading your crew...' : 'Add who you played with.'}</p>}
      </div>
      <div className="flex gap-2">
        <input
          data-testid="crew-guest-input"
          aria-label="Add someone by name"
          className="w-full rounded-xl border border-panel-edge bg-white px-3 py-2 text-base outline-none focus:border-accent"
          placeholder="Add someone by name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="words"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" data-testid="crew-guest-add" className="rounded-xl bg-teal px-4 font-semibold text-white disabled:opacity-50" disabled={!name.trim()} onClick={add}>
          Add
        </button>
      </div>
      <p className="text-xs text-ink-soft">Friends you tag get asked to add it to their room. Anyone else is saved as a guest name they can claim later.</p>
    </div>
  )
}
