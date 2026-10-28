/**
 * The confirm step of the mobile log flow: the room, shared facts, puzzles, scores, photos, crew,
 * visibility. Flagged fields (the extractor wasn't sure) carry a "Check this" chip.
 *
 * Every question is on one scrolling page. While the phone keyboard is up the Save bar drops back
 * into the page flow (so it doesn't ride on top of the keyboard and cover the field), and the
 * focused field is scrolled into the middle of what is still visible.
 */
import { useRef, useState, type ReactNode } from 'react'
import type { CrewSuggestion, CrewTag, GameSummary, VenueSummary, Visibility } from '../../contracts/models'
import { PUZZLE_TYPES, PUZZLE_TYPE_LABELS, RATING_KEYS, type PuzzleType } from '../../contracts/types'
import { useKeyboardOpen, useRevealFocusedField } from '../../ui/confirm/keyboard'
import { RoomSearch } from '../../ui/confirm/RoomSearch'
import { PhotoAttach } from '../../ui/photos'
import type { RoomPick } from '../../ui/roompicker'
import { CrewPicker } from './crew'
import { BOOL_FACTS, FACT_LABELS, numOrNull, puzzleKey, RATING_LABELS, todayISO, type FormErrors, type LogForm } from './form'

export interface ConfirmProps {
  form: LogForm
  onChange(form: LogForm): void
  flags: string[]
  errors: FormErrors
  venue: VenueSummary
  game: GameSummary
  crew: CrewTag[]
  onCrewChange(crew: CrewTag[]): void
  crewSuggestions: CrewSuggestion[]
  notice: string | null
  saving: boolean
  saveError: string | null
  /** Opens the full matcher (venue lists, add a venue). */
  onChangeGame(): void
  /** A pick from the inline room search: a game, a venue, or "add a new room" with the typed text. */
  onChangeRoom?(pick: RoomPick | { kind: 'create'; text: string }): void
  /** Photo queue key for this draft (src/ui/photos/queue.ts). */
  photoTarget?: string
  onSave(): void
}

/**
 * After a blocked save: bring the first field with an error into view and focus its input. The
 * save button sits in a sticky footer, so without this the error can be a long scroll away.
 */
export function revealFirstError(root: ParentNode = document): HTMLElement | null {
  const err = root.querySelector<HTMLElement>('[data-field-error]')
  if (!err) return null
  const box = err.parentElement ?? err
  // A control marked invalid wins (a puzzle's type select sits after its description textarea).
  const target =
    box.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    box.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]), select, textarea') ??
    err
  box.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  target.focus?.({ preventScroll: true })
  return target
}

const input = 'w-full rounded-xl border border-panel-edge bg-white px-3 py-2 text-base text-ink outline-none focus:border-accent'

function Field({ label, flag, error, children }: { label: string; flag?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="block">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span>{label}</span>
        {flag && <span className="rounded-full bg-warn/20 px-2 py-0.5 text-xs font-bold text-ink">Check this</span>}
      </div>
      {children}
      {error && <p data-field-error className="mt-1 text-sm text-bad">{error}</p>}
    </div>
  )
}

function YesNo({ value, onChange, testId }: { value: boolean | null; onChange(v: boolean | null): void; testId: string }) {
  const opt = (v: boolean | null, label: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      data-testid={`${testId}-${v === null ? 'unknown' : v ? 'yes' : 'no'}`}
      onClick={() => onChange(v)}
      className={`flex-1 rounded-xl border px-2 py-2 text-sm font-semibold ${value === v ? 'border-teal bg-teal text-white' : 'border-panel-edge bg-white'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex gap-2">
      {opt(true, 'Yes')}
      {opt(false, 'No')}
      {opt(null, 'Not sure')}
    </div>
  )
}

const VIS_OPTIONS: { v: Visibility; label: string; hint: string }[] = [
  { v: 'public', label: 'Public', hint: 'Shows on the game page with your @handle' },
  { v: 'friends', label: 'Friends', hint: 'Only your friends see it' },
  { v: 'private', label: 'Only me', hint: 'Kept private' },
]

export function ConfirmStep(p: ConfirmProps) {
  const { form, onChange, flags, errors } = p
  const set = <K extends keyof LogForm>(k: K, v: LogForm[K]) => onChange({ ...form, [k]: v })
  const flagged = (path: string) => flags.includes(path)
  const [tool, setTool] = useState('')
  const [changingRoom, setChangingRoom] = useState(false)
  const flagCount = flags.length
  const root = useRef<HTMLDivElement>(null)
  const keyboardOpen = useKeyboardOpen()
  useRevealFocusedField(root)

  return (
    <div ref={root} data-testid="log-confirm" data-keyboard={keyboardOpen ? 'open' : 'closed'} className={`space-y-5 ${keyboardOpen ? 'pb-6' : 'pb-28'}`}>
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">You played</p>
        <p data-testid="confirm-game" className="font-display text-xl">
          {p.game.name}
        </p>
        <p className="text-sm text-ink-soft">
          {p.venue.name}
          {p.venue.city ? `, ${p.venue.city}` : ''}
        </p>
        {changingRoom && p.onChangeRoom ? (
          <div className="mt-3 space-y-2 border-t border-panel-edge/60 pt-3">
            <RoomSearch
              label="Search the room directory"
              inputTestId="confirm-room-search"
              inputProps={{ id: 'm-room-search', autoFocus: true }}
              onPick={(pick) => {
                setChangingRoom(false)
                p.onChangeRoom?.(pick)
              }}
              onCreate={(text) => {
                setChangingRoom(false)
                p.onChangeRoom?.({ kind: 'create', text })
              }}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" className="min-h-10 text-ink-soft underline" onClick={() => setChangingRoom(false)}>
                Keep {p.game.name}
              </button>
              <button type="button" data-testid="confirm-browse-directory" className="min-h-10 text-teal underline" onClick={p.onChangeGame}>
                Browse venues instead
              </button>
            </div>
          </div>
        ) : (
          <button type="button" data-testid="confirm-change-game" className="mt-1 min-h-10 text-sm text-teal underline" onClick={() => (p.onChangeRoom ? setChangingRoom(true) : p.onChangeGame())}>
            Not right? Change it
          </button>
        )}
      </div>

      {p.notice && (
        <p data-testid="confirm-notice" className="rounded-xl bg-warn/15 px-3 py-2 text-sm">
          {p.notice}
        </p>
      )}
      {flagCount > 0 && <p className="text-sm text-ink-soft">{flagCount === 1 ? 'One field needs' : `${flagCount} fields need`} a quick check.</p>}

      <Field label="Date played" flag={flagged('date')} error={errors.date}>
        <input type="date" data-testid="confirm-date" className={input} value={form.date} max={todayISO()} onChange={(e) => set('date', e.target.value)} />
      </Field>

      <Field label="Did you escape?" flag={flagged('escaped')}>
        <YesNo testId="confirm-escaped" value={form.escaped} onChange={(v) => set('escaped', v)} />
      </Field>

      <Field label="Escape time (minutes)" flag={flagged('escapeTimeMinutes')} error={errors.escapeTimeMinutes}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          data-testid="confirm-time"
          className={input}
          value={form.escapeTimeMinutes ?? ''}
          onChange={(e) => set('escapeTimeMinutes', numOrNull(e.target.value))}
        />
      </Field>

      <section className="space-y-3">
        <h3 className="font-display text-lg">Scores</h3>
        {RATING_KEYS.map((k) => {
          const r = form.ratings[k]
          const path = `ratings.${k}.score`
          return (
            <Field key={k} label={`${RATING_LABELS[k]} (1-100)`} flag={flagged(path)} error={errors[path]}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={100}
                  aria-label={`${RATING_LABELS[k]} slider`}
                  className="flex-1 accent-[var(--color-accent)]"
                  value={r.score ?? 50}
                  onChange={(e) => set('ratings', { ...form.ratings, [k]: { ...r, score: Number(e.target.value) } })}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  data-testid={`confirm-score-${k}`}
                  className="w-20 rounded-xl border border-panel-edge bg-white px-2 py-2 text-center text-base"
                  value={r.score ?? ''}
                  placeholder="?"
                  onChange={(e) => set('ratings', { ...form.ratings, [k]: { ...r, score: numOrNull(e.target.value) } })}
                />
              </div>
              <input
                className={`${input} mt-2 text-sm`}
                placeholder="A few words (optional)"
                data-testid={`confirm-comment-${k}`}
                value={r.comment}
                onChange={(e) => set('ratings', { ...form.ratings, [k]: { ...r, comment: e.target.value } })}
              />
            </Field>
          )
        })}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg">Puzzles</h3>
        {form.puzzles.length === 0 && <p className="text-sm text-ink-soft">No puzzles mentioned. Add any you remember.</p>}
        {form.puzzles.map((pz, i) => (
          <div key={pz.key} className="space-y-2 rounded-xl border border-panel-edge bg-white p-3">
            <textarea
              className={`${input} min-h-16`}
              aria-label={`Puzzle ${i + 1}`}
              data-testid={`confirm-puzzle-${i}`}
              value={pz.description}
              onChange={(e) => set('puzzles', form.puzzles.map((q, j) => (j === i ? { ...q, description: e.target.value } : q)))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`rounded-xl border bg-white px-2 py-2 text-sm ${errors[`puzzles.${i}.type`] ? 'border-bad' : 'border-panel-edge'}`}
                aria-label={`Puzzle ${i + 1} type`}
                aria-invalid={errors[`puzzles.${i}.type`] ? true : undefined}
                data-testid={`confirm-puzzle-type-${i}`}
                value={pz.type}
                onChange={(e) => set('puzzles', form.puzzles.map((q, j) => (j === i ? { ...q, type: e.target.value as PuzzleType | '' } : q)))}
              >
                <option value="">Type?</option>
                {PUZZLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PUZZLE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={pz.memorable} onChange={(e) => set('puzzles', form.puzzles.map((q, j) => (j === i ? { ...q, memorable: e.target.checked } : q)))} />
                Memorable
              </label>
              <button type="button" className="ml-auto text-sm text-bad underline" onClick={() => set('puzzles', form.puzzles.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            {errors[`puzzles.${i}.type`] && <p data-field-error className="text-sm text-bad">{errors[`puzzles.${i}.type`]}</p>}
          </div>
        ))}
        <button type="button" data-testid="confirm-add-puzzle" className="text-sm font-semibold text-teal underline" onClick={() => set('puzzles', [...form.puzzles, { key: puzzleKey(), description: '', type: '', memorable: false }])}>
          + Add a puzzle
        </button>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg">Features</h3>
        {BOOL_FACTS.map((f) => (
          <Field key={f} label={FACT_LABELS[f]} flag={flagged(f)}>
            <YesNo testId={`confirm-${f}`} value={form[f]} onChange={(v) => set(f, v)} />
          </Field>
        ))}
        <Field label="Tools used" flag={flagged('toolsUsed')}>
          <div className="flex flex-wrap gap-2">
            {form.toolsUsed.map((t) => (
              <button key={t} type="button" className="rounded-full border border-panel-edge bg-white px-3 py-1 text-sm" onClick={() => set('toolsUsed', form.toolsUsed.filter((x) => x !== t))}>
                {t} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className={input}
              placeholder="Add a tool (UV light, magnets...)"
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tool.trim()) {
                  e.preventDefault()
                  set('toolsUsed', [...form.toolsUsed, tool.trim()])
                  setTool('')
                }
              }}
            />
            <button
              type="button"
              className="rounded-xl bg-teal px-3 text-sm font-semibold text-white"
              onClick={() => {
                if (!tool.trim()) return
                set('toolsUsed', [...form.toolsUsed, tool.trim()])
                setTool('')
              }}
            >
              Add
            </button>
          </div>
        </Field>
      </section>

      {p.photoTarget && (
        <section className="space-y-2" data-testid="confirm-photos-section">
          <h3 className="font-display text-lg">Photos</h3>
          <PhotoAttach target={p.photoTarget} testId="confirm-photos" />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-display text-lg">Who played</h3>
        <CrewPicker value={p.crew} onChange={p.onCrewChange} suggestions={p.crewSuggestions} />
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-lg">Who can see your review</h3>
        <div className="space-y-2" role="radiogroup" aria-label="Visibility">
          {VIS_OPTIONS.map((o) => (
            <label key={o.v} className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${form.visibility === o.v ? 'border-teal bg-teal/10' : 'border-panel-edge bg-white'}`}>
              <input type="radio" name="visibility" data-testid={`confirm-visibility-${o.v}`} className="mt-1" checked={form.visibility === o.v} onChange={() => set('visibility', o.v)} />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-xs text-ink-soft">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="confirm-spoilers" checked={form.containsSpoilers} onChange={(e) => set('containsSpoilers', e.target.checked)} />
          My comments contain spoilers (blur them on the public page)
        </label>
      </section>

      <div
        data-testid="confirm-footer"
        className={
          keyboardOpen
            ? 'rounded-2xl border border-panel-edge bg-panel px-4 pt-3 pb-4'
            : 'fixed inset-x-0 bottom-0 border-t border-panel-edge bg-panel/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur'
        }
      >
        {p.saveError && (
          <p role="alert" data-testid="confirm-save-error" className="mb-2 text-sm text-bad">
            {p.saveError}
          </p>
        )}
        {Object.keys(errors).length > 0 && !p.saveError && <p className="mb-2 text-sm text-bad">Fix the highlighted fields first.</p>}
        <button type="button" data-testid="confirm-save" disabled={p.saving} onClick={p.onSave} className="w-full rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-accent-ink disabled:opacity-60">
          {p.saving ? 'Saving...' : 'Save to my room'}
        </button>
      </div>
    </div>
  )
}
