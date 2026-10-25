/** The daily gate overlay: a vintage safe door with today's puzzle variation. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { bus } from '@/contracts/events'
import { GENRE_COLORS, PUZZLE_TYPE_COLORS } from '@/contracts/style'
import { PUZZLE_TYPE_LABELS } from '@/contracts/types'
import { useStore } from '@/state/store'
import type { Challenge, CipherChallenge, LockChallenge, SequenceChallenge } from './generators'
import { canHint, canSkip } from './machine'
import { getDailyGate, useGateSession } from './session'
import { SearchScene } from './SearchScene'
import { ClockFace, ClueIcon, Padlock, SafeDial, ShapeIcon } from './icons'
import type { DailyGate } from './daily'

const GATE_CSS = `
@keyframes gate-shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-10px)} 30%{transform:translateX(9px)} 45%{transform:translateX(-7px)} 60%{transform:translateX(5px)} 75%{transform:translateX(-3px)} }
.gate-shake { animation: gate-shake 0.45s ease-in-out; }
@keyframes gate-pop { from { opacity: 0; transform: translateY(14px) scale(0.97) } to { opacity: 1; transform: none } }
.gate-pop { animation: gate-pop 0.35s ease-out both; }
.gate-reveal-in { animation: gate-pop 0.5s ease-out 0.75s both; }
@keyframes gate-shackle { 0%{transform:translateY(0) rotate(0)} 40%{transform:translateY(-12px) rotate(0)} 100%{transform:translateY(-12px) rotate(-38deg)} }
.gate-shackle-open { animation: gate-shackle 0.8s cubic-bezier(.3,1.4,.5,1) 0.15s both; }
@keyframes gate-dial { from{transform:rotate(0)} to{transform:rotate(540deg)} }
.gate-dial-spin { animation: gate-dial 0.9s cubic-bezier(.2,.8,.3,1) both; }
@keyframes gate-glow { 0%,100%{box-shadow:0 0 0 0 rgba(255,179,107,0)} 50%{box-shadow:0 0 40px 6px rgba(255,179,107,.55)} }
.gate-glow { animation: gate-glow 1.6s ease-in-out 0.3s 2; }
@media (prefers-reduced-motion: reduce) { .gate-shake,.gate-pop,.gate-reveal-in,.gate-shackle-open,.gate-dial-spin,.gate-glow { animation-duration: 0.01s; animation-delay: 0s; } }
`

const btn = 'min-h-12 rounded-full px-5 font-display text-base font-semibold transition active:scale-95 disabled:opacity-40'

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function Rivet({ className }: { className: string }) {
  return <span className={`absolute h-3 w-3 rounded-full bg-gradient-to-br from-[#f0c977] to-[#8a5a1e] shadow ${className}`} />
}

function SafeFrame({ children, shakeKey, glow }: { children: ReactNode; shakeKey: number; glow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !shakeKey) return
    el.classList.remove('gate-shake', 'gate-pop')
    void el.offsetWidth // restart the animation
    el.classList.add('gate-shake')
  }, [shakeKey])
  return (
    <div
      ref={ref}
      data-testid="gate-frame"
      className={`gate-pop relative w-full max-w-[620px] rounded-[26px] p-[10px] shadow-cozy ${glow ? 'gate-glow' : ''}`}
      style={{ background: 'linear-gradient(145deg, #e3b866 0%, #b9863a 45%, #8a5a1e 100%)' }}
    >
      <Rivet className="left-2 top-2" />
      <Rivet className="right-2 top-2" />
      <Rivet className="bottom-2 left-2" />
      <Rivet className="bottom-2 right-2" />
      <div className="max-h-[calc(100dvh-52px)] overflow-y-auto rounded-[18px] border-2 border-[#8a5a1e]/40 bg-panel px-4 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Puzzle views
// ---------------------------------------------------------------------------

function LockView({ c }: { c: LockChallenge }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {c.data.clues.map((clue, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl border border-panel-edge bg-paper px-3 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#3d4248] font-mono text-sm font-semibold text-[#f0c977]">{i + 1}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug text-ink">{clue.text}</div>
            {clue.type === 'count' && (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {Array.from({ length: clue.count }, (_, k) => (
                  <ClueIcon key={k} name={clue.icon} />
                ))}
              </div>
            )}
            {clue.type === 'clock' && (
              <div className="mt-1">
                <ClockFace hour={clue.hour} minute={clue.minute} size={56} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function CipherView({ c }: { c: CipherChallenge }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-chalk p-3 text-center">
        <div className="mb-1 font-hand text-lg text-[#e9f1ea]/80">Decode me</div>
        <div className="flex flex-wrap justify-center gap-2">
          {c.data.encoded.map((s, i) => (
            <span key={i} className="grid h-12 w-11 place-items-center rounded-lg border-2 border-[#e9f1ea]/40 text-2xl text-[#f7efe0]">
              {s}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-soft">Key</div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
          {c.data.key.map((k) => (
            <div key={k.symbol} className="flex items-center justify-center gap-1.5 rounded-lg border border-panel-edge bg-paper py-1.5">
              <span className="text-lg text-plum">{k.symbol}</span>
              <span className="text-ink-soft">=</span>
              <span className="font-mono font-semibold text-ink">{k.letter}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SequenceView({ c }: { c: SequenceChallenge }) {
  const d = c.data
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-panel-edge bg-paper p-3 sm:gap-2">
      {d.mode === 'number'
        ? d.items.map((n, i) => (
            <span key={i} className="grid h-11 min-w-10 place-items-center rounded-xl bg-[#3d4248] px-1.5 font-mono text-lg font-semibold text-[#f0c977] sm:h-12 sm:min-w-12 sm:px-2 sm:text-xl">
              {n}
            </span>
          ))
        : d.items.map((t, i) => (
            <span key={i} className="grid h-10 w-10 place-items-center rounded-xl bg-white/70 shadow-sm sm:h-12 sm:w-12">
              <ShapeIcon shape={t.shape} color={t.color} size={30} />
            </span>
          ))}
      <span className="grid h-11 w-10 place-items-center rounded-xl border-2 border-dashed border-accent font-display text-2xl text-accent sm:h-12 sm:w-12">?</span>
    </div>
  )
}

function ChallengeBody({ c, found, onFind, onMiss, done }: { c: Challenge; found: string[]; onFind(id: string): void; onMiss(): void; done: boolean }) {
  switch (c.kind) {
    case 'lock':
      return <LockView c={c} />
    case 'cipher':
      return <CipherView c={c} />
    case 'sequence':
      return <SequenceView c={c} />
    case 'search':
      return (
        <div>
          <SearchScene challenge={c} found={found} onFind={onFind} onMiss={onMiss} disabled={done} />
          <div className="mt-2 text-center text-sm font-semibold text-ink-soft" data-testid="gate-found-count">
            Found {found.length} / {c.data.targets.length}
          </div>
        </div>
      )
    case 'recall':
      return (
        <div className="rounded-2xl border border-panel-edge bg-paper p-3 font-hand text-2xl leading-tight text-ink">“{c.data.description}”</div>
      )
  }
}

// ---------------------------------------------------------------------------
// Answer area
// ---------------------------------------------------------------------------

function AnswerArea({ c, onSubmit }: { c: Challenge; onSubmit(v: string): void }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isLock = c.kind === 'lock'
  useEffect(() => {
    // Don't pop the keyboard on touch; on desktop focus helps.
    if (!window.matchMedia?.('(pointer: coarse)').matches) inputRef.current?.focus()
  }, [])

  if (c.input === 'choice') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {c.choices!.map((ch, i) => (
          <button
            key={ch.id}
            type="button"
            data-testid={`gate-choice-${i}`}
            data-choice-id={ch.id}
            onClick={() => onSubmit(ch.id)}
            className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-panel-edge bg-white/70 px-4 py-2 text-left font-semibold text-ink transition hover:border-accent active:scale-[0.98]"
          >
            {ch.token && <ShapeIcon shape={ch.token.shape} color={ch.token.color} size={32} />}
            <span className={ch.token ? 'capitalize' : ''}>{ch.label}</span>
          </button>
        ))}
      </div>
    )
  }
  if (c.input === 'targets') return null

  const maxLen = isLock ? (c as LockChallenge).data.digits : 24
  const submit = () => {
    if (!value.trim()) return
    onSubmit(value)
    setValue('')
  }
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          data-testid="gate-answer"
          value={value}
          onChange={(e) => setValue(isLock ? e.target.value.replace(/\D/g, '').slice(0, maxLen) : e.target.value.slice(0, maxLen))}
          inputMode={c.inputMode === 'numeric' ? 'numeric' : 'text'}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={isLock ? '•'.repeat(maxLen) : 'Your answer'}
          aria-label="Your answer"
          className={`min-h-12 min-w-0 flex-1 rounded-2xl border-2 border-panel-edge bg-white px-4 text-xl text-ink outline-none focus:border-accent ${isLock ? 'text-center font-mono tracking-[0.5em]' : 'font-display uppercase tracking-wider'}`}
        />
        <button type="submit" data-testid="gate-submit" className={`${btn} bg-accent text-accent-ink shadow-md`}>
          {isLock ? 'Open' : 'Try'}
        </button>
      </form>
      {isLock && (
        <div className="mx-auto grid max-w-[300px] grid-cols-6 gap-1.5 sm:grid-cols-6" aria-label="Keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setValue((v) => (v + d).slice(0, maxLen))}
              className="h-11 rounded-xl bg-[#3d4248] font-mono text-lg font-semibold text-[#f0c977] shadow-[inset_0_-3px_0_rgba(0,0,0,.35)] active:translate-y-px"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setValue((v) => v.slice(0, -1))}
            className="col-span-2 h-11 rounded-xl bg-[#7a6258] font-display text-sm font-semibold text-white active:translate-y-px"
          >
            ⌫ Back
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

function Reveal({ gate, skipped, revisit, onContinue, onReplay }: { gate: DailyGate; skipped: boolean; revisit: boolean; onContinue(): void; onReplay?(): void }) {
  const { room, review, puzzle, generic } = gate.source
  const photo = room?.photos[0]?.url ?? review?.photos[0]?.url
  const genreColor = room ? GENRE_COLORS[room.genre] ?? '#7a8a8a' : '#d4a24c'
  const comment = review?.ratings.puzzles.comment?.trim()
  return (
    <div className="text-center" data-testid="gate-reveal">
      <div className="mx-auto flex w-fit items-center gap-2">
        <Padlock open size={revisit ? 64 : 92} />
      </div>
      <h2 className="mt-1 font-display text-3xl font-semibold text-ink">{skipped ? 'Skipped for today' : revisit ? 'Solved today ✓' : 'Click! It opens.'}</h2>
      <p className="text-ink-soft">{skipped ? 'No worries, a fresh lock appears tomorrow.' : 'Today’s lock is cracked.'}</p>

      <div className="gate-reveal-in mt-4 grid items-center gap-4 text-left sm:grid-cols-[180px_1fr]">
        <div className="mx-auto w-[170px] rotate-[-3deg] bg-white p-2 pb-8 shadow-lg">
          {photo ? (
            <img src={photo} alt={room?.name ?? 'Room photo'} className="aspect-square w-full object-cover" />
          ) : (
            <div className="grid aspect-square w-full place-items-center" style={{ background: `linear-gradient(160deg, ${genreColor}, #3b2a26)` }}>
              <svg width="64" height="80" viewBox="0 0 64 80" aria-hidden>
                <rect x="8" y="6" width="48" height="74" rx="4" fill="#7a4a2b" />
                <rect x="14" y="12" width="36" height="64" rx="3" fill="#a96a3f" />
                <circle cx="42" cy="46" r="3.5" fill="#d4a24c" />
              </svg>
            </div>
          )}
          <div className="mt-1 truncate text-center font-hand text-xl text-ink">{room?.name ?? 'The Classic'}</div>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Inspired by</div>
          <div className="font-display text-xl font-semibold text-ink">
            {generic ? 'A puzzle from the escape-room classics' : room ? `${room.name}` : 'A past room'}
          </div>
          {room && (
            <div className="text-sm text-ink-soft">
              {room.company} · {room.city}
              {review ? ` · ${review.date}` : ''}
            </div>
          )}
          <div className="mt-2 rounded-xl border border-panel-edge bg-paper p-2.5 text-[15px] text-ink">
            <span className="mr-1 rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: PUZZLE_TYPE_COLORS[puzzle.type] ?? '#7a8a8a' }}>
              {PUZZLE_TYPE_LABELS[puzzle.type] ?? puzzle.type}
            </span>
            {puzzle.description}
          </div>
          {comment && <blockquote className="mt-2 border-l-4 border-accent pl-3 font-hand text-2xl leading-tight text-ink">“{comment}”</blockquote>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onReplay && (
          <button type="button" onClick={onReplay} className={`${btn} border-2 border-panel-edge bg-white text-ink`}>
            Play again
          </button>
        )}
        <button type="button" data-testid="gate-continue" onClick={onContinue} className={`${btn} min-w-48 bg-accent text-lg text-accent-ink shadow-md`}>
          Step inside →
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function GateOverlay() {
  // Subscribe so the gate is rebuilt once data arrives.
  useStore((s) => s.dataStatus)
  const gate = getDailyGate()
  const c = gate.challenge
  const attempt = useGateSession((s) => s.attempt)
  const solvedToday = useGateSession((s) => s.solvedToday)
  const playRequested = useGateSession((s) => s.playRequested)
  const [shakeKey, setShakeKey] = useState(0)

  const finished = useGateSession((s) => s.finished)
  const revisit = solvedToday && (finished || (attempt.status === 'playing' && !playRequested))
  const done = attempt.status !== 'playing'
  const locked = !revisit

  useEffect(() => {
    useGateSession.getState().setLocked(locked)
  }, [locked])

  // Esc: closes only when not locked. Blocks other Esc handlers while locked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!useGateSession.getState().locked) bus.emit('overlay:close')
      else if (useGateSession.getState().attempt.status === 'playing') setShakeKey((k) => k + 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const session = useGateSession.getState
  const miss = () => {
    session().dispatch({ type: 'miss' })
    setShakeKey((k) => k + 1)
    bus.emit('gate:miss', { misses: session().attempt.misses })
    bus.emit('sfx', { name: 'error' })
  }
  const solve = () => {
    session().dispatch({ type: 'solve' })
    session().markDone()
    bus.emit('sfx', { name: 'unlock' })
  }
  const submit = (v: string) => {
    if (done) return
    if (c.check(v)) solve()
    else miss()
  }
  const find = (id: string) => {
    session().dispatch({ type: 'find', id })
    bus.emit('sfx', { name: 'click' })
    if (c.check(session().attempt.found)) solve()
  }
  const skip = () => {
    session().dispatch({ type: 'skip' })
    if (session().attempt.status !== 'skipped') return
    session().finish()
    bus.emit('sfx', { name: 'whoosh' })
    bus.emit('gate:solved', { skipped: true, puzzleId: gate.source.puzzle.id })
  }
  const finish = () => {
    const skipped = session().attempt.status === 'skipped'
    session().finish()
    bus.emit('gate:solved', { skipped, puzzleId: gate.source.puzzle.id })
  }

  const total = c.hints.length
  const showSkip = canSkip(attempt, total)
  const showHintBtn = canHint(attempt, total)
  const { room } = gate.source

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-backdrop p-3 sm:p-6" data-testid="gate-overlay" data-gate-kind={c.kind} role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <style>{GATE_CSS}</style>
      <SafeFrame shakeKey={shakeKey} glow={attempt.status === 'solved'}>
        {done || revisit ? (
          <Reveal
            gate={gate}
            skipped={attempt.status === 'skipped'}
            revisit={revisit}
            onContinue={revisit ? () => bus.emit('overlay:close') : finish}
            onReplay={revisit ? () => session().requestPlay() : undefined}
          />
        ) : (
          <>
            <header className="flex items-center gap-3">
              <SafeDial size={48} />
              <div className="min-w-0 flex-1">
                <h2 id="gate-title" className="font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">
                  Daily lock
                </h2>
                <p className="text-sm text-ink-soft sm:text-base">Crack it to enter.</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#3d4248] px-3 py-1 text-xs font-bold text-[#f0c977]">{c.title}</span>
            </header>
            <p className="mt-2 rounded-xl bg-[#f6e6cf] px-3 py-1.5 text-sm text-ink-soft">
              {gate.source.generic ? (
                <>Inspired by a classic escape-room padlock.</>
              ) : (
                <>
                  Inspired by a puzzle from{' '}
                  <span className="rounded bg-ink/80 px-1.5 text-transparent select-none" aria-label="hidden room" title="Revealed when solved">
                    {room?.name ? room.name.replace(/./g, '•') : '••••••'}
                  </span>
                  … <em>(revealed when solved)</em>
                </>
              )}
            </p>
            <p className="mt-3 font-semibold text-ink">{c.prompt}</p>
            <div className="mt-3">
              <ChallengeBody c={c} found={attempt.found} onFind={find} onMiss={miss} done={done} />
            </div>
            <div className="mt-4">
              <AnswerArea key={c.kind} c={c} onSubmit={submit} />
            </div>

            {attempt.hintsShown > 0 && (
              <ul className="mt-4 space-y-1.5" data-testid="gate-hints">
                {c.hints.slice(0, attempt.hintsShown).map((h, i) => (
                  <li key={i} className="gate-pop flex gap-2 rounded-xl bg-[#fdf0d6] px-3 py-2 text-[15px] text-ink">
                    <span aria-hidden className="text-accent">✦</span>
                    <span>
                      <b>Hint {i + 1}:</b> {h}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink-soft" aria-live="polite">
                {attempt.misses > 0 ? `Misses: ${attempt.misses}` : 'Take your time.'}
              </span>
              <div className="flex flex-wrap gap-2">
                {showHintBtn && (
                  <button type="button" data-testid="gate-hint" onClick={() => session().dispatch({ type: 'hint' })} className={`${btn} border-2 border-panel-edge bg-white text-ink`}>
                    Hint ({total - attempt.hintsShown} left)
                  </button>
                )}
                {showSkip && (
                  <button type="button" data-testid="gate-skip" onClick={skip} className={`${btn} bg-ink-soft text-white`}>
                    Skip for today
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </SafeFrame>
    </div>
  )
}
