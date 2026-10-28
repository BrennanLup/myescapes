/**
 * Mobile log flow (workstream 14): record a voice note -> save it on the phone (IndexedDB) ->
 * upload and transcribe -> edit the transcript -> extract a draft -> match the venue and game
 * (12) -> confirm, with crew tags (36) -> save via ROUTES.createVisit.
 *
 * If the upload or transcription fails, the recording stays queued for a later retry and the
 * flow carries on with the browser's live captions, or typing.
 */
import { useEffect, useMemo, useState } from 'react'
import { ApiCallError } from '../../contracts/errors'
import type { CrewTag, GameSummary, Me, VenueSummary } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import type { ReviewDraft } from '../../contracts/types'
import { formatElapsed, RECORD_PROMPTS, SAMPLE_TRANSCRIPT } from '../../ui/record/prompts'
import { newDraftTarget, usePhotoQueue, PhotoAttach } from '../../ui/photos'
import type { RoomPick } from '../../ui/roompicker'
import { VenueGameMatcher, type MatcherMode } from '../match'
import { venueToSummary, type MatchHints } from '../match/logic'
import { createVisit, extract, transcribe, type ExtractResult } from './api'
import { ConfirmStep, revealFirstError } from './confirm'
import { tagsFromNames } from './crew/logic'
import { useCrewSuggestions } from './crew'
import { draftToForm, hintsFrom, memorableIds, reviewOf, toCreateVisitBody, validateLogForm, type FormErrors, type LogForm } from './form'
import { enqueueRecording, errorMessage, getRecording, removeRecording, uploadRecording, waitingLabel } from './queue'
import { usePhoneRecorder } from './recorder'

export interface LogFlowProps {
  onDone(visitId: string | null): void
  /** Continue a queued recording whose transcript arrived later (from the home banner). */
  resumeRecordingId?: string | null
  /** The signed-in user, to leave yourself out of the crew. */
  me?: Me | null
  fetch?: typeof fetch
}

type Step =
  | { kind: 'record' }
  | { kind: 'uploading' }
  | { kind: 'transcript' }
  | { kind: 'drafting' }
  | { kind: 'match'; mode?: MatcherMode }
  | { kind: 'confirm' }
  | { kind: 'done'; visitId: string; game: GameSummary; visibility: string }

/** A draft with nothing filled in, for "fill it in by hand" when extraction is unavailable. */
export function blankDraft(transcript = ''): ExtractResult {
  const r = { score: null, comment: '' }
  const draft: ReviewDraft = {
    room: { name: null, company: null, city: null, genre: null, address: null, website: null },
    review: {
      date: null,
      crew: [],
      ratings: { overall: r, puzzles: r, setting: r, storyline: r, difficulty: r },
      puzzles: [],
      escaped: null,
      escapeTimeMinutes: null,
      visibleTimer: null,
      multiRoom: null,
      flashlights: null,
      liveActors: null,
      toolsUsed: [],
      voiceTranscript: transcript,
    },
    flags: [],
    mode: 'mock',
  }
  return { ...draft, hints: { venue: null, game: null, city: null, country: null }, notice: null }
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.code === 'onboarding_required') return 'Public reviews need a display name and @handle first. Pick "Friends" or "Only me", or set your name in Settings.'
    if (err.code === 'unauthorized') return 'You were signed out. Sign in again, then save.'
    if (err.code === 'forbidden') return err.message || "You can only tag people who are your friends. Tag them as guests instead."
    if (err.code === 'not_implemented') return 'Saving is not available on the server yet.'
    return err.message
  }
  return "Couldn't save. Check your connection and try again; nothing you entered is lost."
}

const btnPrimary = 'w-full rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-accent-ink disabled:opacity-60'
const btnSecondary = 'w-full rounded-2xl border border-panel-edge bg-white px-4 py-3 text-base font-semibold'

export function LogFlow({ onDone, resumeRecordingId = null, me = null, fetch: fetchImpl }: LogFlowProps) {
  const opts = useMemo(() => (fetchImpl ? { fetch: fetchImpl } : {}), [fetchImpl])
  const rec = usePhoneRecorder()
  const [step, setStep] = useState<Step>({ kind: resumeRecordingId ? 'transcript' : 'record' })
  const [recordingId, setRecordingId] = useState<string | null>(resumeRecordingId)
  // Bumped by a save that validation blocked; the effect runs after the errors have rendered.
  const [revealTick, setRevealTick] = useState(0)
  useEffect(() => {
    if (revealTick) revealFirstError()
  }, [revealTick])
  const [transcript, setTranscript] = useState('')
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExtractResult | null>(null)
  const [hints, setHints] = useState<MatchHints>({ venue: null, game: null, city: null, country: null })
  const [choice, setChoice] = useState<{ venue: VenueSummary; game: GameSummary } | null>(null)
  const [form, setForm] = useState<LogForm | null>(null)
  const [flags, setFlags] = useState<string[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [crew, setCrew] = useState<CrewTag[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const { suggestions } = useCrewSuggestions(true, fetchImpl)
  // Photos picked on the form wait here until the visit exists, then upload (src/ui/photos/queue.ts).
  const [photoTarget] = useState(newDraftTarget)
  useEffect(
    () => () => {
      // Leaving the flow without saving drops photos that were only queued for this draft.
      usePhotoQueue.getState().clear(photoTarget)
    },
    [photoTarget],
  )

  // The account the queued recordings belong to: only its own can be resumed or uploaded.
  const ownerId = me?.id ?? null

  // Resuming a queued recording: its transcript (or live captions) is the starting text.
  useEffect(() => {
    if (!resumeRecordingId) return
    void getRecording(resumeRecordingId, ownerId).then((item) => {
      if (!item) return
      setTranscript(item.transcript ?? item.liveTranscript)
      if (item.status !== 'transcribed') setUploadNote(`Still waiting to upload. ${item.lastError ?? ''}`.trim())
    })
  }, [resumeRecordingId, ownerId])

  const upload = async (id: string, fallbackText: string) => {
    setStep({ kind: 'uploading' })
    setUploadNote(null)
    try {
      const item = await uploadRecording(id, (it) => transcribe(it, opts), ownerId)
      setTranscript(item.transcript ?? fallbackText)
    } catch (err) {
      setTranscript((t) => t || fallbackText)
      setUploadNote(`Saved on your phone: ${waitingLabel(1)}. ${errorMessage(err)}${fallbackText ? ' Your live captions are below.' : ' You can type your notes below.'}`)
    }
    setStep({ kind: 'transcript' })
  }

  const stopRecording = async () => {
    const take = await rec.stop()
    if (!take) {
      setError('Nothing was recorded. Try again, or type your notes.')
      return
    }
    let id: string
    try {
      id = (await enqueueRecording({ ownerId, audio: take.blob, mimeType: take.mimeType, durationSeconds: take.durationSeconds, liveTranscript: take.liveTranscript })).id
    } catch {
      // No IndexedDB (old private mode): upload straight from memory, without the retry queue.
      setStep({ kind: 'uploading' })
      try {
        const res = await callApi(ROUTES.transcribe, { body: directForm(take.blob, take.mimeType, take.durationSeconds) }, opts)
        setTranscript(res.transcript)
      } catch (err) {
        setTranscript(take.liveTranscript)
        setUploadNote(`${errorMessage(err)} This phone can't keep the recording for later, so check the text below.`)
      }
      setStep({ kind: 'transcript' })
      return
    }
    setRecordingId(id)
    await upload(id, take.liveTranscript)
  }

  const toDraft = async () => {
    const text = transcript.trim()
    if (!text) {
      setError('Say or type something about the room first.')
      return
    }
    setError(null)
    setStep({ kind: 'drafting' })
    try {
      const d = await extract(text, opts)
      applyDraft(d, text)
    } catch (err) {
      setError(err instanceof ApiCallError && err.status < 500 && err.code !== 'not_implemented' ? err.message : "Couldn't turn that into a review right now.")
      setStep({ kind: 'transcript' })
    }
  }

  const applyDraft = (d: ExtractResult, text: string) => {
    setDraft(d)
    setHints(hintsFrom(d))
    const { form: f, flags: fl } = draftToForm(d, { transcript: text })
    setForm(f)
    setFlags(fl)
    setCrew(tagsFromNames(d.review.crew ?? [], suggestions, me))
    setStep({ kind: 'match' })
  }

  const save = async () => {
    if (!form || !choice) return
    const errs = validateLogForm(form)
    setErrors(errs)
    if (Object.keys(errs).length) {
      setRevealTick((n) => n + 1)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const visit = await createVisit(toCreateVisitBody(form, choice.game.id, crew), opts)
      const memorable = memorableIds(form, visit.puzzles)
      if (memorable.length) {
        // Puzzle ids only exist once the visit does. Not fatal if it fails.
        await callApi(ROUTES.putMyReview, { params: { id: visit.id }, body: reviewOf(form, memorable) }, opts).catch(() => {})
      }
      usePhotoQueue.getState().attachToVisit(photoTarget, visit.id)
      if (recordingId) await removeRecording(recordingId).catch(() => {})
      setStep({ kind: 'done', visitId: visit.id, game: visit.game ?? choice.game, visibility: form.visibility })
    } catch (err) {
      setSaveError(saveErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /** The room search on the form: a game is the answer; a venue or a new room opens the matcher there. */
  const changeRoom = async (pick: RoomPick | { kind: 'create'; text: string }) => {
    if (pick.kind === 'game') {
      const g = pick.game
      let venue = choice?.venue.id === g.venueId ? choice.venue : null
      if (!venue) {
        try {
          venue = venueToSummary((await callApi(ROUTES.venuePage, { params: { slug: g.venueSlug } }, opts)).venue)
        } catch {
          venue = { id: g.venueId, slug: g.venueSlug, name: g.venueName, brand: null, address: '', city: g.city, citySlug: '', region: '', country: g.country, lat: null, lng: null, status: 'active', gameCount: 1 }
        }
      }
      setChoice({ venue, game: g })
    } else if (pick.kind === 'venue') {
      setStep({ kind: 'match', mode: { kind: 'venue', venue: pick.venue } })
    } else {
      setHints((h) => ({ ...h, game: pick.text }))
      setStep({ kind: 'match', mode: { kind: 'newVenue' } })
    }
  }

  const discard = async () => {
    rec.cancel()
    if (recordingId) await removeRecording(recordingId).catch(() => {})
    onDone(null)
  }

  return (
    <div data-testid="log-flow" data-step={step.kind} className="space-y-4">
      {error && (
        <p role="alert" data-testid="log-error" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {step.kind === 'record' && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl">Tell us about the room</h2>
          <ul data-testid="record-prompts" className="space-y-2">
            {RECORD_PROMPTS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={ticked.has(p.id)}
                  onClick={() => setTicked((s) => {
                    const n = new Set(s)
                    if (n.has(p.id)) n.delete(p.id)
                    else n.add(p.id)
                    return n
                  })}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${ticked.has(p.id) ? 'border-good bg-good/10' : 'border-panel-edge bg-white'}`}
                >
                  <span className="block font-semibold">
                    {ticked.has(p.id) ? '✓ ' : ''}
                    {p.title}
                  </span>
                  <span className="block text-xs text-ink-soft">{p.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          {rec.status === 'recording' ? (
            <div className="space-y-3">
              <p data-testid="record-elapsed" className="text-center font-mono text-3xl">
                {formatElapsed(rec.elapsed)}
              </p>
              {rec.liveText && (
                <p data-testid="record-live" className="max-h-40 overflow-y-auto rounded-xl bg-white px-3 py-2 text-sm text-ink-soft">
                  {rec.liveText}
                </p>
              )}
              <button type="button" data-testid="record-stop" className={`${btnPrimary} bg-bad`} onClick={() => void stopRecording()}>
                ■ Stop and upload
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {rec.error && (
                <p data-testid="record-mic-error" className="text-sm text-bad">
                  {rec.error}
                </p>
              )}
              {rec.supported && rec.captionsAvailable && (
                <label className="flex items-start gap-2 text-sm text-ink-soft">
                  <input type="checkbox" data-testid="record-captions" className="mt-1" checked={rec.captions} onChange={(e) => rec.setCaptions(e.target.checked)} />
                  <span>
                    Show live captions while I talk. Your browser's speech service (Google in Chrome, Apple in Safari) may process the audio to make them. Off means the recording is only sent to our transcription service.
                  </span>
                </label>
              )}
              {rec.supported && (
                <button type="button" data-testid="record-start" disabled={rec.status === 'requesting'} className={btnPrimary} onClick={() => void rec.start()}>
                  {rec.status === 'requesting' ? 'Starting the microphone...' : '● Record a voice note'}
                </button>
              )}
              <button type="button" data-testid="record-type-instead" className={btnSecondary} onClick={() => setStep({ kind: 'transcript' })}>
                Type it instead
              </button>
              <button
                type="button"
                data-testid="record-sample"
                className="w-full py-2 text-sm text-ink-soft underline"
                onClick={() => {
                  setTranscript(SAMPLE_TRANSCRIPT)
                  setStep({ kind: 'transcript' })
                }}
              >
                Try it with a sample note
              </button>
            </div>
          )}
        </section>
      )}

      {step.kind === 'uploading' && (
        <p data-testid="log-uploading" className="py-10 text-center text-lg">
          Uploading and transcribing...
        </p>
      )}

      {step.kind === 'transcript' && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Your notes</h2>
          {uploadNote && (
            <div data-testid="upload-note" className="space-y-2 rounded-xl bg-warn/15 px-3 py-2 text-sm">
              <p>{uploadNote}</p>
              {recordingId && (
                <button type="button" data-testid="upload-retry" className="font-semibold text-teal underline" onClick={() => void upload(recordingId, transcript)}>
                  Try the upload again
                </button>
              )}
            </div>
          )}
          <textarea
            data-testid="transcript-input"
            aria-label="Transcript"
            className="min-h-60 w-full rounded-xl border border-panel-edge bg-white px-3 py-2 text-base outline-none focus:border-accent"
            placeholder="Room name, company and city, the puzzles, the setting, the story, did you escape and your time, scores out of 100..."
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <button type="button" data-testid="transcript-submit" className={btnPrimary} disabled={!transcript.trim()} onClick={() => void toDraft()}>
            Turn it into a review
          </button>
          <button type="button" data-testid="draft-by-hand" className={btnSecondary} onClick={() => applyDraft(blankDraft(transcript), transcript)}>
            Fill it in by hand
          </button>
        </section>
      )}

      {step.kind === 'drafting' && (
        <p data-testid="log-drafting" className="py-10 text-center text-lg">
          Reading your notes...
        </p>
      )}

      {step.kind === 'match' && (
        <VenueGameMatcher
          hints={hints}
          initialMode={step.mode}
          fetch={fetchImpl}
          onPick={(c) => {
            setChoice(c)
            setStep({ kind: 'confirm' })
          }}
          onCancel={() => setStep({ kind: 'transcript' })}
        />
      )}

      {step.kind === 'confirm' && form && choice && (
        <ConfirmStep
          form={form}
          onChange={(f) => {
            setForm(f)
            if (Object.keys(errors).length) setErrors(validateLogForm(f))
          }}
          flags={flags}
          errors={errors}
          venue={choice.venue}
          game={choice.game}
          crew={crew}
          onCrewChange={setCrew}
          crewSuggestions={suggestions}
          notice={draft?.notice ?? null}
          saving={saving}
          saveError={saveError}
          onChangeGame={() => setStep({ kind: 'match' })}
          onChangeRoom={(pick) => void changeRoom(pick)}
          photoTarget={photoTarget}
          onSave={() => void save()}
        />
      )}

      {step.kind === 'done' && (
        <section data-testid="log-done" className="space-y-4 py-6 text-center">
          <p className="font-display text-3xl">Saved!</p>
          <p>
            <strong>{step.game.name}</strong> is pinned to your board.
            {step.visibility === 'public' ? ' Your review shows on its public page.' : ''}
          </p>
          {step.visibility === 'public' && step.game.slug && (
            <a data-testid="log-done-public" href={`/games/${step.game.slug}`} className="block text-teal underline">
              See the public page
            </a>
          )}
          <PhotoDone target={photoTarget} visitId={step.visitId} />
          <button type="button" data-testid="log-done-home" className={btnPrimary} onClick={() => onDone(step.visitId)}>
            Back to my rooms
          </button>
        </section>
      )}

      {step.kind !== 'done' && step.kind !== 'uploading' && step.kind !== 'drafting' && (
        <div className="flex justify-between gap-4 py-2 text-sm text-ink-soft">
          <button
            type="button"
            data-testid="log-cancel"
            className="underline"
            onClick={() => {
              rec.cancel()
              onDone(null)
            }}
          >
            {recordingId ? 'Finish later' : 'Cancel'}
          </button>
          {recordingId && (
            <button type="button" data-testid="log-discard" className="text-bad underline" onClick={() => void discard()}>
              Delete this recording
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function directForm(blob: Blob, mimeType: string, durationSeconds: number): FormData {
  const fd = new FormData()
  fd.append('durationSeconds', String(Math.round(durationSeconds * 10) / 10))
  fd.append('audio', blob, `recording.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`)
  return fd
}

/** On the "Saved!" screen: how the photos are getting on, with Retry, and room for more. */
function PhotoDone({ target, visitId }: { target: string; visitId: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-left shadow-sm" data-testid="log-done-photos">
      <p className="mb-2 text-sm font-bold">Photos</p>
      <PhotoAttach target={target} visitId={visitId} compact testId="log-done-photo-attach" />
    </div>
  )
}
