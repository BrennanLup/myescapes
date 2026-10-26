/**
 * Voice capture overlay (workstream 11). Opened from the desk terminal via
 * `record:open`. Records a crew voice note with a live transcript, or falls back
 * to typing / pasting / uploading a transcript, then sends it to the extractor.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { bus } from '@/contracts/events'
import { apiClient } from '@/contracts/api'
import { useVoiceCapture } from './useVoiceCapture'
import { RECORD_PROMPTS, SAMPLE_TRANSCRIPT, formatElapsed, nextPromptIndex } from './prompts'

export { SAMPLE_TRANSCRIPT, RECORD_PROMPTS } from './prompts'

const MAX_TRANSCRIPT = 50_000

export function RecordOverlay() {
  const cap = useVoiceCapture()
  const [transcript, setTranscript] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const liveRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const extractSeq = useRef(0)

  const recording = cap.status === 'recording'
  const requesting = cap.status === 'requesting'
  const fallback = !cap.micAvailable || !cap.speechAvailable
  const live = recording ? [cap.finalText, cap.interimText].filter(Boolean).join(' ') : ''
  const highlight = recording ? nextPromptIndex(cap.elapsed, ticked) : -1
  const hasText = transcript.trim().length > 0
  const showTextFirst = !recording && (hasText || fallback)

  const stopRecording = useCallback(() => {
    const text = cap.stop()
    setTranscript(text)
    bus.emit('record:stop', { transcript: text })
    return text
  }, [cap])

  const toggleRecord = async () => {
    bus.emit('sfx', { name: 'click' })
    if (recording) {
      stopRecording()
      return
    }
    if (requesting) return
    setError(null)
    const ok = await cap.start(transcript)
    if (ok) bus.emit('record:start')
  }

  const close = useCallback(() => {
    extractSeq.current++
    bus.emit('overlay:close')
  }, [])

  const requestClose = useCallback(() => {
    let text = transcript
    if (cap.status === 'recording') text = stopRecording()
    if (text.trim()) setConfirmClose(true)
    else close()
  }, [cap.status, close, stopRecording, transcript])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (confirmClose) setConfirmClose(false)
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmClose, requestClose])

  useEffect(() => {
    const el = liveRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [live])

  const loadSample = () => {
    if (recording) cap.stop()
    setTranscript(SAMPLE_TRANSCRIPT)
    setTicked(new Set(RECORD_PROMPTS.map((p) => p.id)))
    setError(null)
    setFileNote('Sample transcript loaded. Edit it as you like.')
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.startsWith('text/')) {
      setFileNote('Please choose a plain .txt file.')
      return
    }
    try {
      const text = (await file.text()).slice(0, MAX_TRANSCRIPT)
      setTranscript(text)
      setError(null)
      setFileNote(`Loaded ${file.name}.`)
    } catch {
      setFileNote('That file could not be read.')
    }
  }

  const submit = async () => {
    const text = (recording ? stopRecording() : transcript).trim()
    if (!text || extracting) return
    const seq = ++extractSeq.current
    setExtracting(true)
    setError(null)
    try {
      const draft = await apiClient.extract(text)
      if (seq !== extractSeq.current) return
      bus.emit('draft:ready', { draft })
    } catch (err) {
      if (seq !== extractSeq.current) return
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong.')
    } finally {
      if (seq === extractSeq.current) setExtracting(false)
    }
  }

  const toggleTick = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-backdrop p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-title"
      data-testid="record-overlay"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-cozy border-2 border-panel-edge bg-panel text-ink shadow-cozy">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-panel-edge/70 px-4 pt-4 pb-3 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <h2 id="record-title" className="font-display text-2xl font-semibold leading-tight sm:text-3xl">
              Log a new escape
            </h2>
            <p className="mt-1 text-sm text-ink-soft sm:text-base">
              Talk it through as a crew. We&apos;ll turn your notes into a review you can check.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            data-testid="record-close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper text-2xl leading-none text-ink-soft ring-1 ring-panel-edge transition hover:bg-white hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-4 sm:px-7 sm:py-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-[auto_1fr] md:gap-x-7 md:gap-y-4">
          {/* Recorder */}
          <section className="order-1 md:col-start-1 md:row-start-1" aria-label="Recorder">
            <div className="flex items-center gap-4 rounded-cozy bg-paper p-4 ring-1 ring-panel-edge sm:gap-5">
              {cap.micAvailable ? (
                <button
                  type="button"
                  onClick={toggleRecord}
                  disabled={requesting || extracting}
                  data-testid="record-toggle"
                  aria-pressed={recording}
                  aria-label={recording ? 'Stop recording' : 'Start recording'}
                  className={`relative grid h-24 w-24 shrink-0 place-items-center rounded-full text-white shadow-cozy transition active:scale-95 disabled:opacity-60 sm:h-28 sm:w-28 ${
                    recording ? 'bg-bad' : 'bg-accent hover:brightness-105'
                  }`}
                >
                  {recording && <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" aria-hidden />}
                  <span className="absolute inset-1.5 rounded-full ring-4 ring-white/35" aria-hidden />
                  {recording ? <StopIcon /> : <MicIcon />}
                </button>
              ) : (
                <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-ink-soft/20 text-ink-soft sm:h-28 sm:w-28" aria-hidden>
                  <MicIcon muted />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-semibold leading-tight">
                  {!cap.micAvailable
                    ? 'Microphone unavailable'
                    : recording
                      ? 'Recording... tap to stop'
                      : requesting
                        ? 'Asking for the mic...'
                        : cap.status === 'stopped'
                          ? 'Tap to keep talking'
                          : 'Tap to start talking'}
                </div>
                <div className="mt-1 font-mono text-3xl tabular-nums text-ink" data-testid="record-elapsed">
                  {formatElapsed(cap.elapsed)}
                </div>
                <div
                  ref={cap.meterRef}
                  className="mt-2 h-3 w-full overflow-hidden rounded-full bg-ink/10"
                  role="meter"
                  aria-label="Input level"
                  aria-valuemin={0}
                  aria-valuemax={1}
                  style={{ ['--level' as string]: 0 }}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal to-led transition-[width] duration-75"
                    style={{ width: 'calc(var(--level) * 100%)' }}
                  />
                </div>
                {cap.micError && <p className="mt-2 text-sm text-bad">{cap.micError}</p>}
              </div>
            </div>
          </section>

          {/* Prompt checklist. On phones it sits under the transcript once there is text to edit. */}
          <section className={`md:order-none md:col-start-1 md:row-start-2 ${showTextFirst ? 'order-3' : 'order-2'}`} aria-label="Prompts">
            <div>
              <h3 className="mb-2 font-display text-lg font-semibold">
                Talk through these <span className="text-sm font-normal text-ink-soft">(tap to tick)</span>
              </h3>
              <ol className="flex flex-col gap-1.5" data-testid="record-prompts">
                {RECORD_PROMPTS.map((p, i) => {
                  const done = ticked.has(p.id)
                  const now = i === highlight
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggleTick(p.id)}
                        aria-pressed={done}
                        data-testid={`prompt-${p.id}`}
                        className={`flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition ${
                          now ? 'bg-accent/15 ring-2 ring-accent' : 'hover:bg-paper'
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                            done ? 'bg-good text-white' : now ? 'bg-accent text-white' : 'bg-paper text-ink-soft ring-1 ring-panel-edge'
                          }`}
                        >
                          {done ? '✓' : i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className={`block font-semibold leading-snug ${done ? 'text-ink-soft line-through decoration-good/60' : ''}`}>
                            {p.title}
                            {now && (
                              <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-bold text-white">now</span>
                            )}
                          </span>
                          <span className="block text-sm text-ink-soft">{p.hint}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          </section>

          {/* Right: transcript */}
          <section className={`flex min-w-0 flex-col gap-3 md:order-none md:col-start-2 md:row-span-2 md:row-start-1 ${showTextFirst ? 'order-2' : 'order-3'}`} aria-label="Transcript">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">Transcript</h3>
              {recording && cap.speechAvailable && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-teal">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-led" /> listening
                </span>
              )}
            </div>

            {fallback && (
              <div className="rounded-2xl bg-warn/15 px-3 py-2 text-sm text-ink ring-1 ring-warn/50" data-testid="record-fallback">
                {!cap.micAvailable
                  ? 'No microphone here, so type or paste your notes below, or upload a .txt transcript.'
                  : "This browser can record, but it can't turn speech into text. Type or paste your notes, or upload a .txt transcript."}{' '}
                Audio-only transcription needs a browser with speech recognition (like Chrome, Edge or Safari).
              </div>
            )}
            {cap.speechError && !fallback && <p className="text-sm text-bad">{cap.speechError}</p>}
            {!fallback && !recording && (
              <p className="text-xs text-ink-soft" data-testid="speech-notice">
                The live transcript uses your browser's speech recognition (Google in Chrome, Apple in Safari, Microsoft in Edge), which may process your voice. Prefer not to? Type or paste your notes instead.
              </p>
            )}

            {recording ? (
              <div
                ref={liveRef}
                aria-live="polite"
                data-testid="record-live"
                className="h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-paper p-3 leading-relaxed ring-1 ring-panel-edge sm:h-72"
              >
                {cap.finalText}
                {cap.interimText && <span className="text-ink-soft italic"> {cap.interimText}</span>}
                {!live && (
                  <span className="text-ink-soft">
                    {cap.speechAvailable ? 'Start talking, your words appear here...' : 'Recording audio. Type your notes after you stop.'}
                  </span>
                )}
              </div>
            ) : (
              <textarea
                data-testid="transcript-input"
                aria-label="Transcript"
                value={transcript}
                maxLength={MAX_TRANSCRIPT}
                onChange={(e) => {
                  setTranscript(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={
                  fallback
                    ? 'Type or paste your notes: room name, company, city, puzzles, setting, story, score out of 100, escape time, tools...'
                    : 'Tap record and talk. Your words show up here, and you can edit them after.'
                }
                className="h-56 w-full resize-y rounded-2xl bg-white p-3 leading-relaxed text-ink ring-1 ring-panel-edge outline-none placeholder:text-ink-soft/70 focus:ring-2 focus:ring-teal sm:h-72 md:h-auto md:min-h-72 md:flex-1"
              />
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadSample}
                data-testid="sample-transcript"
                disabled={extracting}
                className="min-h-11 rounded-full bg-paper px-4 text-sm font-semibold text-ink ring-1 ring-panel-edge transition hover:bg-white disabled:opacity-60"
              >
                Use a sample transcript
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={extracting || recording}
                className="min-h-11 rounded-full bg-paper px-4 text-sm font-semibold text-ink ring-1 ring-panel-edge transition hover:bg-white disabled:opacity-60"
              >
                Upload a .txt transcript
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                data-testid="transcript-file"
                onChange={onFile}
              />
            </div>
            {fileNote && <p className="text-sm text-ink-soft">{fileNote}</p>}

            {cap.audioUrl && !recording && (
              <div className="rounded-2xl bg-paper p-2 ring-1 ring-panel-edge">
                <div className="px-1 pb-1 text-xs font-semibold text-ink-soft">Your recording (stays on this device)</div>
                <audio controls src={cap.audioUrl} className="w-full" data-testid="record-playback" />
              </div>
            )}

            {error && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bad/10 px-3 py-2 text-sm text-bad ring-1 ring-bad/40" role="alert">
                <span className="min-w-0 flex-1">Couldn&apos;t read your notes: {error}</span>
                <button type="button" onClick={submit} className="min-h-9 rounded-full bg-bad px-3 font-semibold text-white">
                  Retry
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={extracting || (!hasText && !(recording && live))}
              data-testid="extract-submit"
              className="mt-auto flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 font-display text-lg font-semibold text-accent-ink shadow-cozy transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {extracting ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" aria-hidden />
                  Reading your notes...
                </>
              ) : (
                'Turn it into a review'
              )}
            </button>
          </section>
        </div>

        {confirmClose && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-backdrop p-4" role="alertdialog" aria-labelledby="record-discard">
            <div className="w-full max-w-sm rounded-cozy bg-panel p-5 text-center shadow-cozy ring-2 ring-panel-edge">
              <h3 id="record-discard" className="font-display text-xl font-semibold">
                Throw away these notes?
              </h3>
              <p className="mt-1 text-sm text-ink-soft">Your transcript hasn&apos;t been turned into a review yet.</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClose(false)}
                  className="min-h-12 flex-1 rounded-full bg-paper font-semibold ring-1 ring-panel-edge"
                  autoFocus
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={close}
                  data-testid="record-discard"
                  className="min-h-12 flex-1 rounded-full bg-bad font-semibold text-white"
                >
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

function MicIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="relative h-11 w-11" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="relative h-10 w-10" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  )
}
