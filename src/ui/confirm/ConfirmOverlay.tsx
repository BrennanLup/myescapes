import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bus } from '@/contracts/events'
import { callApi, ROUTES } from '@/contracts/routes'
import { COMMON_TOOLS, GENRES, PUZZLE_TYPES, RATING_KEYS, type ReviewDraft } from '@/contracts/types'
import { PUZZLE_TYPE_COLORS } from '@/contracts/style'
import { useStore } from '@/state/store'
import { PhotoAttach, newDraftTarget, summarize, usePhotoQueue } from '@/ui/photos'
import type { RoomPick } from '@/ui/roompicker'
import { ensureRoomPhotoSync } from '@/ui/review/photoSync'
import { useKeyboardInset, useRevealFocusedField } from './keyboard'
import { followUploads } from './photosAfterSave'
import { RoomSearch } from './RoomSearch'
import {
  BOOL_FEATURES,
  FEATURE_LABELS,
  RATING_LABELS,
  draftToEntry,
  draftToForm,
  findExistingRoom,
  labelFor,
  linkGame,
  linkMatches,
  linkVenue,
  newRoomNamed,
  puzzleKey,
  shiftPuzzleFlags,
  validateForm,
  type FormState,
} from './form'
import { showToast } from './toast'

const anchorId = (path: string) => `cf-${path}`
const inputId = (path: string) => `cf-input-${path}`
const clone = (f: FormState): FormState => JSON.parse(JSON.stringify(f)) as FormState

const INPUT_BASE =
  'min-h-12 rounded-xl border-2 border-panel-edge bg-white/80 px-3 py-2 text-base text-ink placeholder:text-ink-soft/60 outline-none transition focus:border-accent focus:bg-white'
const INPUT = INPUT_BASE + ' w-full'

/** Stable per-draft key so a new draft resets the form state. */
const draftKeys = new WeakMap<object, number>()
let draftSeq = 0
const keyForDraft = (d: ReviewDraft) => {
  let k = draftKeys.get(d)
  if (k === undefined) draftKeys.set(d, (k = ++draftSeq))
  return k
}

export function ConfirmOverlay({ draft }: { draft: ReviewDraft }) {
  return <ConfirmForm key={keyForDraft(draft)} draft={draft} />
}

function ConfirmForm({ draft }: { draft: ReviewDraft }) {
  const rooms = useStore((s) => s.rooms)
  const crewMembers = useStore((s) => s.crew)
  const [initial] = useState(() => draftToForm(draft))
  const [form, setForm] = useState<FormState>(initial.form)
  const [flags, setFlags] = useState<string[]>(initial.flags)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dataSource = useStore((s) => s.dataSource)
  const signedIn = dataSource === 'postgres'
  // Photos picked before the visit exists wait under this key, then upload right after save.
  const [photoTarget] = useState(newDraftTarget)
  const pendingPhotos = usePhotoQueue((s) => s.items.filter((i) => i.target === photoTarget).length)
  const savedRef = useRef(false)
  const keyboard = useKeyboardInset()
  useRevealFocusedField(scrollRef)

  useEffect(() => {
    ensureRoomPhotoSync()
    // Closing without saving drops the queued photos.
    return () => {
      if (!savedRef.current) usePhotoQueue.getState().clear(photoTarget)
    }
  }, [photoTarget])

  const errors = useMemo(() => validateForm(form), [form])
  const errorKeys = Object.keys(errors)
  const valid = errorKeys.length === 0
  const revisit = useMemo(() => findExistingRoom(form.room, rooms), [form.room, rooms])

  const companies = useMemo(() => uniqSorted(rooms.map((r) => r.company)), [rooms])
  const cities = useMemo(() => uniqSorted(rooms.map((r) => r.city)), [rooms])
  const crewNames = useMemo(() => uniqSorted(crewMembers.map((c) => c.name)), [crewMembers])

  const isFlagged = (path: string) => flags.includes(path)
  const clearFlag = (path: string) => setFlags((fl) => (fl.includes(path) ? fl.filter((x) => x !== path) : fl))
  const edit = (path: string, mut: (f: FormState) => void) => {
    setForm((f) => {
      const n = clone(f)
      mut(n)
      // Renaming the room (or its company or city) means it is no longer the directory game.
      if (n.link && !linkMatches(n)) n.link = null
      return n
    })
    clearFlag(path)
    setSaveError(null)
  }

  const focusField = (path: string) => {
    // After React has rendered the new values.
    setTimeout(() => document.getElementById(inputId(path))?.focus(), 0)
  }

  const clearFlags = (paths: string[]) => setFlags((fl) => fl.filter((x) => !paths.includes(x)))

  const pickRoom = (pick: RoomPick) => {
    setSaveError(null)
    if (pick.kind === 'game') {
      const game = pick.game
      setForm((f) => linkGame(f, game))
      clearFlags(['room.name', 'room.company', 'room.city', ...(game.genre ? ['room.genre'] : [])])
      // The game summary has no address: fill it in from the venue when we can (best effort).
      callApi(ROUTES.venuePage, { params: { slug: game.venueSlug } })
        .then((page) => setForm((f) => (f.link?.gameId === game.id && linkMatches(f) ? linkGame(f, game, { ...page.venue, address: f.room.address || page.venue.address }) : f)))
        .catch(() => {})
      if (!game.genre) focusField('room.genre')
    } else {
      setForm((f) => linkVenue(f, pick.venue))
      clearFlags(['room.company', 'room.city'])
      focusField('room.name')
    }
  }

  const newRoom = (text: string) => {
    setForm((f) => newRoomNamed(f, text))
    clearFlags(['room.name'])
    focusField(form.room.company.trim() ? 'room.city' : 'room.company')
  }

  // Esc asks to discard (capture phase so nothing else closes the overlay first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // An open room-search list closes itself first.
      const t = e.target as HTMLElement | null
      if (t?.getAttribute?.('role') === 'combobox' && t.getAttribute('aria-expanded') === 'true') return
      e.preventDefault()
      e.stopPropagation()
      if (saving) return
      setDiscarding((d) => !d)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [saving])

  const jumpTo = (path: string) => {
    let el: HTMLElement | null = null
    const parts = path.split('.')
    for (let i = parts.length; i > 0 && !el; i--) el = document.getElementById(anchorId(parts.slice(0, i).join('.')))
    if (!el) return
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const focusable = el.querySelector<HTMLElement>('input, select, textarea, button')
    focusable?.focus({ preventScroll: true })
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const entry = draftToEntry(form, useStore.getState().rooms)
      const saved = await useStore.getState().addEntry(entry)
      savedRef.current = true
      const queue = usePhotoQueue.getState()
      const photos = summarize(queue.items.filter((i) => i.target === photoTarget))
      if (signedIn && photos.total > 0) {
        // In the 3D room a review id is the visit id.
        queue.attachToVisit(photoTarget, saved.review.id)
        showToast(`Pinned to the board! Uploading ${photos.total} photo${photos.total === 1 ? '' : 's'}…`)
        followUploads(saved.review.id, saved.room.name)
      } else {
        queue.clear(photoTarget)
        showToast('Pinned to the board!')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const saveReason = valid
    ? null
    : `Still needed: ${errorKeys.slice(0, 3).map(labelFor).join(', ')}${errorKeys.length > 3 ? ` +${errorKeys.length - 3} more` : ''}`

  const f = form
  const r = form.review
  const fieldProps = (path: string) => ({ path, flagged: isFlagged(path), error: errors[path] })

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-backdrop select-text sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      data-testid="confirm-overlay"
    >
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-panel text-ink shadow-cozy sm:h-auto sm:max-h-full sm:rounded-cozy sm:border-2 sm:border-panel-edge">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 border-b-2 border-panel-edge/70 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="confirm-title" className="font-display text-2xl font-semibold sm:text-3xl">
              Check your review
            </h2>
            <span
              data-testid="confirm-mode"
              className={
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ' +
                (draft.mode === 'claude' ? 'bg-teal/15 text-teal' : 'bg-ink-soft/15 text-ink-soft')
              }
            >
              <span aria-hidden className={'h-2 w-2 rounded-full ' + (draft.mode === 'claude' ? 'bg-teal' : 'bg-ink-soft')} />
              {draft.mode === 'claude' ? 'Extracted by Claude' : 'Mock extractor (no API key)'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setDiscarding(true)}
            className="grid h-12 w-12 place-items-center rounded-full text-2xl text-ink-soft transition hover:bg-ink/5 hover:text-ink"
          >
            ×
          </button>
        </header>

        {/* Body */}
        <div
          ref={scrollRef}
          data-testid="confirm-scroll"
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5"
          // While a phone keyboard is up, leave room to scroll the last fields above it.
          style={keyboard ? { paddingBottom: keyboard + 24, scrollPaddingBottom: keyboard + 24 } : undefined}
        >
          {initial.notes.length > 0 && (
            <div data-testid="confirm-draft-note" role="note" className="mb-4 rounded-2xl border-2 border-teal/40 bg-teal/10 p-3 text-sm text-ink sm:p-4">
              {initial.notes.map((n) => (
                <p key={n}>
                  <span aria-hidden className="mr-1.5">ℹ</span>
                  {n}
                </p>
              ))}
            </div>
          )}
          {flags.length > 0 && (
            <div data-testid="confirm-flag-summary" className="mb-5 rounded-2xl border-2 border-warn bg-warn/15 p-3 sm:p-4">
              <p className="font-display text-lg font-semibold">
                <span aria-hidden className="mr-1.5">⚠</span>
                {flags.length} {flags.length === 1 ? 'field needs' : 'fields need'} a look
              </p>
              <p className="mb-2 text-sm text-ink-soft">The extractor wasn't sure about these. Edit them, or tick them off if they're right.</p>
              <ul className="flex flex-wrap gap-2">
                {flags.map((p) => (
                  <li key={p} className="flex items-stretch overflow-hidden rounded-full border-2 border-warn bg-panel">
                    <button type="button" onClick={() => jumpTo(p)} className="min-h-10 px-3 text-sm font-bold underline-offset-2 hover:underline">
                      {labelFor(p)}
                    </button>
                    <button
                      type="button"
                      aria-label={`${labelFor(p)} looks fine`}
                      title="Looks fine"
                      onClick={() => clearFlag(p)}
                      className="min-h-10 border-l-2 border-warn/60 px-3 text-sm text-good hover:bg-good/10"
                    >
                      ✓
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              <Section title="Room" icon="🗝">
                {form.link && linkMatches(form) ? (
                  <div data-testid="confirm-room-linked" className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-teal/40 bg-teal/10 px-3 py-2">
                    <span aria-hidden className="text-xl">🗝️</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold tracking-wide text-teal uppercase">From the room directory</span>
                      <span className="block truncate font-bold">{form.link.name}</span>
                      <span className="block truncate text-sm text-ink-soft">
                        {[form.link.venueName, form.link.city].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid="confirm-room-unlink"
                      onClick={() => {
                        setForm((f) => ({ ...f, link: null }))
                        setTimeout(() => document.getElementById('cf-room-search')?.focus(), 0)
                      }}
                      className="min-h-10 rounded-full px-3 text-sm font-bold text-teal underline underline-offset-2 hover:bg-teal/10"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <RoomSearch
                    key={form.link ? 'linked' : 'search'}
                    initialQuery={form.room.name}
                    label="Find it in the room directory"
                    onPick={pickRoom}
                    onCreate={newRoom}
                    inputTestId="confirm-room-search"
                    suggestFor={{ name: initial.form.room.name, city: initial.form.room.city }}
                    inputProps={{ id: 'cf-room-search', className: INPUT }}
                  />
                )}
                {revisit && (
                  <p data-testid="confirm-revisit" className="rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">
                    <b>Revisit!</b> {revisit.name} is already on the board, so this review joins it.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Room name" {...fieldProps('room.name')} className="sm:col-span-2">
                    <input id={inputId('room.name')} data-testid="field-room.name" className={INPUT} value={f.room.name} placeholder="Name of the room"
                      onChange={(e) => edit('room.name', (n) => void (n.room.name = e.target.value))} />
                  </Field>
                  <Field label="Company" {...fieldProps('room.company')}>
                    <input id={inputId('room.company')} data-testid="field-room.company" className={INPUT} list="cf-companies" value={f.room.company} placeholder="Who runs it?"
                      onChange={(e) => edit('room.company', (n) => void (n.room.company = e.target.value))} />
                  </Field>
                  <Field label="City" {...fieldProps('room.city')}>
                    <input id={inputId('room.city')} data-testid="field-room.city" className={INPUT} list="cf-cities" value={f.room.city} placeholder="Which city?"
                      onChange={(e) => edit('room.city', (n) => void (n.room.city = e.target.value))} />
                  </Field>
                  <Field label="Genre" {...fieldProps('room.genre')}>
                    <select id={inputId('room.genre')} data-testid="field-room.genre" className={INPUT + ' capitalize'} value={f.room.genre}
                      onChange={(e) => edit('room.genre', (n) => void (n.room.genre = e.target.value as FormState['room']['genre']))}>
                      <option value="">Choose…</option>
                      {GENRES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Website" {...fieldProps('room.website')}>
                    <input id={inputId('room.website')} data-testid="field-room.website" className={INPUT} type="url" inputMode="url" value={f.room.website} placeholder="https://…"
                      onChange={(e) => edit('room.website', (n) => void (n.room.website = e.target.value))} />
                  </Field>
                  <Field label="Address" {...fieldProps('room.address')} className="sm:col-span-2">
                    <input id={inputId('room.address')} data-testid="field-room.address" className={INPUT} value={f.room.address} placeholder="Street, number"
                      onChange={(e) => edit('room.address', (n) => void (n.room.address = e.target.value))} />
                  </Field>
                </div>
                <datalist id="cf-companies">{companies.map((c) => <option key={c} value={c} />)}</datalist>
                <datalist id="cf-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
              </Section>

              <Section title="Visit" icon="📅">
                <Field label="Date played" {...fieldProps('review.date')}>
                  <input id={inputId('review.date')} data-testid="field-review.date" type="date" className={INPUT} value={r.date}
                    onChange={(e) => edit('review.date', (n) => void (n.review.date = e.target.value))} />
                </Field>
                <Field label="Crew" {...fieldProps('review.crew')}>
                  <ChipInput
                    path="review.crew"
                    values={r.crew}
                    suggestions={crewNames}
                    placeholder="Add a name"
                    onChange={(vals) => edit('review.crew', (n) => void (n.review.crew = vals))}
                  />
                </Field>
              </Section>

              <Section title="Outcome & features" icon="🏁">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Did you escape?" {...fieldProps('review.escaped')}>
                    <YesNo path="review.escaped" value={r.escaped} yes="Escaped!" no="Nope"
                      onChange={(v) => edit('review.escaped', (n) => void (n.review.escaped = v))} />
                  </Field>
                  <Field label={r.escaped === false ? 'Minutes used' : 'Escape time (minutes)'} {...fieldProps('review.escapeTimeMinutes')}>
                    <input id={inputId('review.escapeTimeMinutes')} data-testid="field-review.escapeTimeMinutes" type="number" inputMode="numeric" min={0} max={600}
                      className={INPUT} value={r.escapeTimeMinutes ?? ''} placeholder="e.g. 52"
                      onChange={(e) => edit('review.escapeTimeMinutes', (n) => void (n.review.escapeTimeMinutes = e.target.value === '' ? null : Number(e.target.value)))} />
                  </Field>
                  {BOOL_FEATURES.map((k) => (
                    <Field key={k} label={FEATURE_LABELS[k]} {...fieldProps(`review.${k}`)}>
                      <YesNo path={`review.${k}`} value={r[k]} onChange={(v) => edit(`review.${k}`, (n) => void (n.review[k] = v))} />
                    </Field>
                  ))}
                </div>
              </Section>

              <Section title="Tools" icon="🔦">
                <Field label="Tools & gadgets" {...fieldProps('review.toolsUsed')}>
                  <ChipInput
                    path="review.toolsUsed"
                    values={r.toolsUsed}
                    suggestions={[...COMMON_TOOLS]}
                    placeholder="Add a tool"
                    onChange={(vals) => edit('review.toolsUsed', (n) => void (n.review.toolsUsed = vals))}
                  />
                </Field>
              </Section>
            </div>

            <div className="flex flex-col gap-5">
              <Section title="Ratings" icon="⭐">
                {RATING_KEYS.map((k) => {
                  const sp = `review.ratings.${k}.score`
                  const cp = `review.ratings.${k}.comment`
                  const score = r.ratings[k].score
                  return (
                    <div key={k} className="grid gap-4">
                      <Field label={RATING_LABELS[k]} path={sp} flagged={isFlagged(sp)} error={errors[sp]} labelFor={inputId(sp)}>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={1}
                            max={100}
                            aria-label={`${RATING_LABELS[k]} slider`}
                            data-testid={`field-${sp}-slider`}
                            value={score ?? 50}
                            className={'h-10 flex-1 cursor-pointer accent-accent ' + (score === null ? 'opacity-40' : '')}
                            onChange={(e) => edit(sp, (n) => void (n.review.ratings[k].score = Number(e.target.value)))}
                            onPointerUp={(e) => {
                              const v = Number(e.currentTarget.value)
                              if (score === null) edit(sp, (n) => void (n.review.ratings[k].score = v))
                            }}
                          />
                          <input
                            id={inputId(sp)}
                            data-testid={`field-${sp}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={100}
                            placeholder="–"
                            className={INPUT_BASE + ' w-20 shrink-0 text-center font-display text-lg font-semibold'}
                            value={score ?? ''}
                            onChange={(e) => edit(sp, (n) => void (n.review.ratings[k].score = e.target.value === '' ? null : Math.round(Number(e.target.value))))}
                          />
                        </div>
                      </Field>
                      <Field label={`${RATING_LABELS[k]} comment`} hideLabel path={cp} flagged={isFlagged(cp)} error={errors[cp]}>
                        <input id={inputId(cp)} data-testid={`field-${cp}`} className={INPUT + ' text-sm'} value={r.ratings[k].comment} placeholder={`Notes on ${RATING_LABELS[k].toLowerCase()}…`}
                          onChange={(e) => edit(cp, (n) => void (n.review.ratings[k].comment = e.target.value))} />
                      </Field>
                    </div>
                  )
                })}
              </Section>

              <Section title="Puzzles" icon="🧩">
                {r.puzzles.length === 0 && <p className="text-sm text-ink-soft">No puzzles noted yet. Add the ones you remember.</p>}
                <ol className="flex flex-col gap-3">
                  {r.puzzles.map((p, i) => {
                    const base = `review.puzzles.${i}`
                    const dp = `${base}.description`
                    const tp = `${base}.type`
                    const mp = `${base}.memorable`
                    return (
                      <li key={p.key} id={anchorId(base)} className="rounded-2xl border-2 border-panel-edge/70 bg-paper p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-display font-semibold text-ink-soft">Puzzle {i + 1}</span>
                          <button
                            type="button"
                            data-testid={`puzzle-remove-${i}`}
                            onClick={() => {
                              setForm((fm) => {
                                const n = clone(fm)
                                n.review.puzzles.splice(i, 1)
                                return n
                              })
                              setFlags((fl) => shiftPuzzleFlags(fl, i))
                            }}
                            className="min-h-10 rounded-full px-3 text-sm font-bold text-bad hover:bg-bad/10"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid gap-4">
                          <Field label="Description" hideLabel {...fieldProps(dp)}>
                            <textarea id={inputId(dp)} data-testid={`field-${dp}`} rows={2} className={INPUT + ' resize-y'} value={p.description} placeholder="What was the puzzle?"
                              onChange={(e) => edit(dp, (n) => void (n.review.puzzles[i].description = e.target.value))} />
                          </Field>
                          <div className="flex flex-wrap items-start gap-4">
                            <Field label="Type" hideLabel {...fieldProps(tp)} className="min-w-40 flex-1">
                              <select id={inputId(tp)} data-testid={`field-${tp}`} className={INPUT} value={p.type}
                                style={p.type ? { borderColor: PUZZLE_TYPE_COLORS[p.type] } : undefined}
                                onChange={(e) => edit(tp, (n) => void (n.review.puzzles[i].type = e.target.value as FormState['review']['puzzles'][number]['type']))}>
                                <option value="">Type…</option>
                                {PUZZLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </Field>
                            <Field label="Memorable" hideLabel {...fieldProps(mp)}>
                              <button
                                type="button"
                                data-testid={`field-${mp}`}
                                aria-pressed={p.memorable}
                                onClick={() => edit(mp, (n) => void (n.review.puzzles[i].memorable = !p.memorable))}
                                className={
                                  'min-h-12 rounded-xl border-2 px-4 font-bold transition ' +
                                  (p.memorable ? 'border-accent bg-accent text-accent-ink' : 'border-panel-edge bg-white/70 text-ink-soft hover:border-accent')
                                }
                              >
                                {p.memorable ? '★ Memorable' : '☆ Memorable?'}
                              </button>
                            </Field>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                <button
                  type="button"
                  data-testid="puzzle-add"
                  onClick={() => edit('review.puzzles', (n) => void n.review.puzzles.push({ key: puzzleKey(), description: '', type: '', memorable: false }))}
                  className="min-h-12 rounded-xl border-2 border-dashed border-panel-edge font-bold text-ink-soft transition hover:border-accent hover:text-accent"
                >
                  + Add a puzzle
                </button>
              </Section>

              <Section title="Photos" icon="📷">
                <PhotoAttach
                  target={photoTarget}
                  testId="confirm-photos"
                  disabledReason={signedIn ? null : 'Sign in to add photos to your reviews.'}
                />
              </Section>

              <Section title="Transcript" icon="🎙">
                <details data-testid="field-review.voiceTranscript" id={anchorId('review.voiceTranscript')} className="rounded-xl bg-paper px-3 py-2">
                  <summary className="min-h-10 cursor-pointer py-2 font-bold text-ink-soft">
                    {r.voiceTranscript.trim() ? 'Show what you said' : 'No transcript recorded'}
                  </summary>
                  <p className="whitespace-pre-wrap pb-2 font-hand text-xl leading-snug text-ink">{r.voiceTranscript || '—'}</p>
                </details>
              </Section>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col gap-2 border-t-2 border-panel-edge/70 bg-panel px-4 py-3 sm:flex-row sm:items-center sm:px-6">
          <div className="min-w-0 flex-1 text-sm">
            {saveError ? (
              <p role="alert" data-testid="confirm-error" className="font-bold text-bad">Couldn't save: {saveError}</p>
            ) : saveReason ? (
              <p data-testid="confirm-save-reason" className="text-ink-soft">
                {saveReason}{' '}
                <button
                  type="button"
                  data-testid="confirm-next-missing"
                  onClick={() => jumpTo(errorKeys[0])}
                  className="min-h-10 rounded-full px-2 font-bold text-accent underline underline-offset-2 hover:bg-accent/10"
                >
                  Show me
                </button>
              </p>
            ) : (
              <p className="text-good font-bold">
                All set. Ready to pin it!
                {signedIn && pendingPhotos > 0 && <span className="font-normal text-ink-soft"> Your {pendingPhotos === 1 ? 'photo uploads' : `${pendingPhotos} photos upload`} right after.</span>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="confirm-cancel"
              disabled={saving}
              onClick={() => setDiscarding(true)}
              className="min-h-12 flex-1 rounded-xl border-2 border-panel-edge px-5 font-bold text-ink-soft transition hover:bg-ink/5 disabled:opacity-50 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-save"
              disabled={!valid || saving}
              title={saveReason ?? undefined}
              onClick={() => void save()}
              className="min-h-12 flex-[2] rounded-xl bg-accent px-6 font-display text-lg font-semibold text-accent-ink shadow-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-ink-soft/40 disabled:shadow-none sm:flex-none"
            >
              {saving ? 'Saving…' : 'Save & pin'}
            </button>
          </div>
        </footer>

        {discarding && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-backdrop p-4" role="alertdialog" aria-modal="true" aria-labelledby="cf-discard-title">
            <div className="w-full max-w-sm rounded-cozy border-2 border-panel-edge bg-panel p-5 text-center shadow-cozy">
              <h3 id="cf-discard-title" className="font-display text-2xl font-semibold">Discard this review?</h3>
              <p className="mt-1 text-ink-soft">Nothing has been saved yet.</p>
              <div className="mt-4 flex gap-2">
                <button type="button" data-testid="confirm-discard-no" autoFocus onClick={() => setDiscarding(false)}
                  className="min-h-12 flex-1 rounded-xl border-2 border-panel-edge font-bold hover:bg-ink/5">
                  Keep editing
                </button>
                <button type="button" data-testid="confirm-discard-yes" onClick={() => bus.emit('overlay:close')}
                  className="min-h-12 flex-1 rounded-xl bg-bad font-bold text-white hover:brightness-110">
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function uniqSorted(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-cozy border-2 border-panel-edge/60 bg-white/40 p-4">
      <h3 className="flex items-center gap-2 font-display text-xl font-semibold">
        <span aria-hidden>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field(props: {
  path: string
  label: string
  flagged: boolean
  error?: string
  hideLabel?: boolean
  labelFor?: string
  className?: string
  children: ReactNode
}) {
  const { path, label, flagged, error, hideLabel, className = '', children } = props
  return (
    <div
      id={anchorId(path)}
      data-flagged={flagged ? 'true' : 'false'}
      className={
        '-m-2 flex min-w-0 flex-col gap-1 rounded-2xl p-2 transition ' +
        (flagged ? 'bg-warn/15 ring-2 ring-warn ' : '') +
        className
      }
    >
      {(!hideLabel || flagged) && (
        <div className="flex items-center gap-2">
          <label htmlFor={props.labelFor ?? inputId(path)} className={'text-sm font-bold text-ink-soft ' + (hideLabel ? 'sr-only' : '')}>
            {label}
          </label>
          {flagged && (
            <span data-testid={`flag-${path}`} className="rounded-full bg-warn px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-ink">
              Check this
            </span>
          )}
        </div>
      )}
      {hideLabel && !flagged && (
        <label htmlFor={props.labelFor ?? inputId(path)} className="sr-only">
          {label}
        </label>
      )}
      {children}
      {error && (
        <p data-testid={`error-${path}`} className="text-sm font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  )
}

function YesNo(props: { path: string; value: boolean | null; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  const { path, value, onChange, yes = 'Yes', no = 'No' } = props
  const btn = (v: boolean, text: string) => {
    const on = value === v
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        data-testid={`field-${path}-${v ? 'yes' : 'no'}`}
        id={v ? inputId(path) : undefined}
        onClick={() => onChange(v)}
        className={
          'min-h-12 flex-1 rounded-xl border-2 px-3 font-bold transition ' +
          (on
            ? v
              ? 'border-good bg-good text-white'
              : 'border-bad bg-bad text-white'
            : 'border-panel-edge bg-white/70 text-ink-soft hover:border-accent')
        }
      >
        {text}
      </button>
    )
  }
  return (
    <div role="radiogroup" data-testid={`field-${path}`} data-value={value === null ? 'unset' : String(value)} className="flex gap-2">
      {btn(true, yes)}
      {btn(false, no)}
    </div>
  )
}

function ChipInput(props: { path: string; values: string[]; suggestions: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const { path, values, suggestions, placeholder, onChange } = props
  const [text, setText] = useState('')
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.toLowerCase())
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !has(v)) onChange([...values, v])
    setText('')
  }
  const remaining = suggestions.filter((s) => !has(s))
  const listId = `cf-list-${path}`
  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v} className="flex items-center rounded-full bg-teal pl-3 text-white">
              <span className="font-bold">{v}</span>
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}
                className="grid h-10 w-10 place-items-center rounded-full text-lg hover:bg-white/20">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={inputId(path)}
          data-testid={`field-${path}`}
          className={INPUT}
          list={listId}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
        />
        <button type="button" onClick={() => add(text)} disabled={!text.trim()}
          className="min-h-12 shrink-0 rounded-xl bg-teal px-4 font-bold text-white disabled:opacity-40">
          Add
        </button>
      </div>
      <datalist id={listId}>{remaining.map((s) => <option key={s} value={s} />)}</datalist>
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="min-h-9 rounded-full border-2 border-dashed border-teal/50 px-3 text-sm font-semibold text-teal transition hover:border-teal hover:bg-teal/10">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
