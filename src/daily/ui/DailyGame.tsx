/**
 * Escape of the Day game (workstream 22): loads today's puzzle, plays it, saves the result for
 * signed-in players, and shows the share grid, streak and friends leaderboard. Used by the /daily
 * page (phone and desktop) and the door overlay in the 3D room. Never blocks anything: it is
 * always optional, and network failures leave the puzzle playable.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ApiCallError } from '../../contracts/errors'
import type { DailyToday, LeaderboardEntry, Streak } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import { Link } from '../../router'
import { browserTimeZone, formatDuration, generateDaily, SCORE, shareText, type DailyChallenge } from '../engine'
import { isFinished, loadProgress, newProgress, playReducer, saveProgress, toResultInput, type PlayAction, type Progress } from './state'
import { AnswerReveal, btnGhost, btnPrimary, GuessHistory, GuessInput, PuzzleClues } from './views'

declare global {
  interface Window {
    /** QA hook: today's Escape of the Day kind and answer (one entry per slot). */
    __ESCAPE_DAILY__?: { kind: DailyChallenge['kind']; mode: 'number' | 'shape' | null; answer: () => string[] }
  }
}

export const KIND_LABEL: Record<DailyChallenge['kind'], string> = {
  combination: 'Combination lock',
  cipher: 'Symbol cipher',
  sequence: 'Sequence',
  search: 'Search the room',
}

/** Re-render every `ms` (for the timer and the countdown). */
export function useTick(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms, active])
  return now
}

export function countdown(toIso: string, now: number): string {
  const ms = Math.max(0, Date.parse(toIso) - now)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}

/** Progress for a loaded day: the server's finished result wins over the local copy. */
function initialProgress(today: DailyToday): Progress {
  const { puzzle, result } = today
  if (result?.finishedAt) {
    return {
      ...newProgress(puzzle.day, puzzle.number),
      status: result.solved ? 'solved' : 'failed',
      startedAt: Date.parse(result.startedAt),
      finishedAt: Date.parse(result.startedAt) + result.timeMs,
      // The server keeps the marks, not the guesses themselves.
      guesses: (() => {
        const local = loadProgress(puzzle.day, puzzle.number)
        const n = result.grid.filter((r) => !r.every((m) => m === 'hint')).length
        return local.guesses.length === n ? local.guesses : Array.from({ length: n }, () => [])
      })(),
      grid: result.grid,
      hintsUsed: result.hintsUsed,
      submitted: true,
    }
  }
  const local = loadProgress(puzzle.day, puzzle.number)
  if (result && local.startedAt === null) return { ...local, startedAt: Math.min(Date.now(), Date.parse(result.startedAt)) }
  return local
}

export type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; today: DailyToday }

/** GET /api/daily/today for this browser's time zone. */
export function useDailyToday(): [LoadState, (t: DailyToday) => void, () => void] {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    callApi(ROUTES.dailyToday, { query: { tz: browserTimeZone() } }, { signal: ac.signal })
      .then((today) => setState({ status: 'ready', today }))
      .catch((err: unknown) => {
        if (ac.signal.aborted) return
        setState({ status: 'error', message: err instanceof ApiCallError ? err.message : 'Could not load today\'s escape.' })
      })
    return () => ac.abort()
  }, [nonce])
  const set = useCallback((today: DailyToday) => setState({ status: 'ready', today }), [])
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setNonce((n) => n + 1)
  }, [])
  return [state, set, reload]
}

export interface DailyGameProps {
  /** Called once when today's puzzle is solved: `fresh` is false when it was already solved on load. */
  onSolved?(fresh: boolean): void
  /** Tighter spacing for the in-room overlay. */
  compact?: boolean
}

export function DailyGame({ onSolved, compact }: DailyGameProps) {
  const [load, setToday, reload] = useDailyToday()
  if (load.status === 'loading') {
    return (
      <div data-testid="daily-loading" className="py-10 text-center text-ink-soft">
        Unlocking today's escape…
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <div data-testid="daily-error" className="py-8 text-center">
        <p className="text-ink-soft">{load.message}</p>
        <button type="button" className={`${btnGhost} mt-4`} onClick={reload}>
          Try again
        </button>
      </div>
    )
  }
  return <DailyPlay key={load.today.puzzle.day} today={load.today} setToday={setToday} reload={reload} onSolved={onSolved} compact={compact} />
}

export interface DailyPlayApi {
  today: DailyToday
  challenge: DailyChallenge
  progress: Progress
  dispatch(a: PlayAction): void
  signedIn: boolean
  streak: Streak | null
  saving: boolean
  saveError: string | null
  maxHints: number
  finished: boolean
  /** Starts the clock (and fixes the time zone on the server). */
  start(): void
  /** Sends a guess (marks it with the challenge). */
  guess(g: string[]): void
  /** Sends the result again after a failure. */
  retrySave(): void
}

/**
 * The play logic for one day, shared by the 2D game and the 3D puzzle room: progress (kept in
 * localStorage), starting the clock on the server, and saving the finished result through the
 * daily API so streaks and leaderboards keep working.
 */
export function useDailyPlay({ today, setToday, reload, onSolved }: { today: DailyToday; setToday(t: DailyToday): void; reload(): void; onSolved?: DailyGameProps['onSolved'] }): DailyPlayApi {
  const { puzzle } = today
  const signedIn = today.streak !== null
  const challenge = useMemo(() => generateDaily(puzzle), [puzzle])
  const [progress, dispatch] = useReducer(playReducer, today, initialProgress)
  const [streak, setStreak] = useState<Streak | null>(today.streak)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const solvedOnce = useRef(false)
  const solvedOnLoad = useRef(progress.status === 'solved')
  const inFlight = useRef(false)
  const maxHints = Math.min(3, challenge.hints.length)
  const finished = isFinished(progress)

  useEffect(() => saveProgress(progress), [progress])

  // QA hook for Playwright (the puzzle is generated in the browser anyway, so this reveals nothing new).
  useEffect(() => {
    window.__ESCAPE_DAILY__ = { kind: challenge.kind, mode: challenge.kind === 'sequence' ? challenge.data.mode : null, answer: () => [...challenge.answer] }
    return () => {
      delete window.__ESCAPE_DAILY__
    }
  }, [challenge])

  useEffect(() => {
    if (progress.status === 'solved' && !solvedOnce.current) {
      solvedOnce.current = true
      onSolved?.(!solvedOnLoad.current)
    }
  }, [progress.status, onSolved])

  const ensureStarted = useCallback(async () => {
    if (!signedIn || today.result) return today
    const started = await callApi(ROUTES.dailyStart, { body: { tz: browserTimeZone() } })
    setToday(started)
    return started
  }, [signedIn, today, setToday])

  const start = useCallback(() => {
    dispatch({ type: 'start', at: Date.now() })
    // Fixes the time zone on the server. A failure is retried before the result is sent.
    ensureStarted().catch(() => undefined)
  }, [ensureStarted])

  const save = useCallback(async () => {
    if (!signedIn || progress.submitted || !isFinished(progress) || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const started = await ensureStarted()
      if (started.serverDay !== progress.day) {
        setSaveError('Your day has already moved on, so this result can\'t count. A new escape is ready.')
        return
      }
      const res = await callApi(ROUTES.dailySubmit, { body: toResultInput(progress) })
      dispatch({ type: 'submitted' })
      setStreak(res.streak)
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 409 && /already finished/i.test(err.message)) {
        // Finished on another device or tab: show the stored result.
        dispatch({ type: 'submitted' })
        reload()
        return
      }
      setSaveError(err instanceof ApiCallError && err.body?.error ? err.body.error : 'Could not save your result. Check your connection and try again.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [signedIn, progress, ensureStarted, reload])

  useEffect(() => {
    if (finished && signedIn && !progress.submitted && !saving && !saveError) void save()
  }, [finished, signedIn, progress.submitted, saving, saveError, save])

  const guess = useCallback(
    (g: string[]) => dispatch({ type: 'guess', guess: g, marks: challenge.check(g), maxGuesses: puzzle.maxGuesses, at: Date.now() }),
    [challenge, puzzle.maxGuesses],
  )
  const retrySave = useCallback(() => void save(), [save])

  return { today, challenge, progress, dispatch, signedIn, streak, saving, saveError, maxHints, finished, start, guess, retrySave }
}

function DailyPlay({ today, setToday, reload, onSolved, compact }: { today: DailyToday; setToday(t: DailyToday): void; reload(): void } & DailyGameProps) {
  const { puzzle } = today
  const { challenge, progress, dispatch, signedIn, streak, saving, saveError, maxHints, finished, start, retrySave } = useDailyPlay({ today, setToday, reload, onSolved })
  const theme = puzzle.theme
  return (
    <div data-testid="daily-game" data-kind={challenge.kind} data-status={progress.status} className={compact ? 'space-y-4' : 'space-y-5'}>
      <header className="text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-accent">Escape of the Day</div>
        <h2 className="font-display text-3xl font-semibold text-ink" data-testid="daily-number">
          Escape #{puzzle.number}
        </h2>
        {theme && (
          <p className="mt-1 text-sm text-ink-soft" data-testid="daily-theme">
            Inspired by{' '}
            {theme.gameSlug ? (
              <Link to={`/games/${theme.gameSlug}`} className="font-semibold text-ink underline decoration-accent/60 underline-offset-2">
                {theme.gameName}
              </Link>
            ) : (
              <span className="font-semibold text-ink">{theme.gameName}</span>
            )}
            , {theme.venueName}, {theme.city}
          </p>
        )}
        <div className="mt-2 inline-flex rounded-full bg-paper px-3 py-1 text-xs font-semibold text-ink-soft ring-1 ring-panel-edge">
          {KIND_LABEL[challenge.kind]} · {puzzle.maxGuesses} guesses
        </div>
      </header>

      {progress.status === 'idle' ? (
        <Intro challenge={challenge} onStart={start} maxGuesses={puzzle.maxGuesses} maxHints={maxHints} rules={!compact} />
      ) : finished ? (
        <Finished
          challenge={challenge}
          progress={progress}
          maxGuesses={puzzle.maxGuesses}
          signedIn={signedIn}
          streak={streak}
          nextAt={today.nextAt}
          saving={saving}
          saveError={saveError}
          onRetry={retrySave}
        />
      ) : (
        <Playing challenge={challenge} progress={progress} maxGuesses={puzzle.maxGuesses} maxHints={maxHints} dispatch={dispatch} />
      )}
    </div>
  )
}

function Intro({ challenge, onStart, maxGuesses, maxHints, rules }: { challenge: DailyChallenge; onStart(): void; maxGuesses: number; maxHints: number; rules: boolean }) {
  return (
    <div className="space-y-4 text-center">
      <p className="mx-auto max-w-md text-ink">{challenge.prompt}</p>
      <p className="mx-auto max-w-md text-sm text-ink-soft">The same puzzle for everyone today. The clock starts when you do; hints cost points.</p>
      <button type="button" data-testid="daily-start" className={btnPrimary} onClick={onStart}>
        Start today's escape
      </button>
      {rules && <HowItWorks maxGuesses={maxGuesses} maxHints={maxHints} />}
    </div>
  )
}

/** The rules under the start button on the /daily page (the 3D door overlay is compact and skips them). */
function HowItWorks({ maxGuesses, maxHints }: { maxGuesses: number; maxHints: number }) {
  const items: { icon: string; text: string }[] = [
    { icon: '🔢', text: `You get ${maxGuesses} guesses. After each one, every slot turns green when it's right and gold when it's close.` },
    {
      icon: '💡',
      text: maxHints > 0 ? `Stuck? Take up to ${maxHints} hint${maxHints === 1 ? '' : 's'}, at ${SCORE.perHint} points each.` : 'No hints today: this one is all yours.',
    },
    { icon: '⏱️', text: `A first-guess solve scores ${SCORE.base.toLocaleString('en')}. Extra guesses, hints and a slow clock take points off.` },
    { icon: '🔥', text: 'Escape on days in a row to build your streak, and compare scores with friends.' },
  ]
  return (
    <section data-testid="daily-rules" aria-labelledby="daily-rules-title" className="mx-auto max-w-md rounded-2xl bg-paper p-4 text-left ring-1 ring-panel-edge">
      <h3 id="daily-rules-title" className="m-0 font-display text-lg font-semibold text-ink">
        How it works
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.icon} className="flex gap-2.5 text-sm text-ink">
            <span aria-hidden className="shrink-0">
              {it.icon}
            </span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Playing({
  challenge,
  progress,
  maxGuesses,
  maxHints,
  dispatch,
}: {
  challenge: DailyChallenge
  progress: Progress
  maxGuesses: number
  maxHints: number
  dispatch(a: Parameters<typeof playReducer>[1]): void
}) {
  const now = useTick(1000)
  const elapsed = progress.startedAt ? now - progress.startedAt : 0
  const left = maxGuesses - progress.guesses.length
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-ink">{challenge.prompt}</p>
      <PuzzleClues c={challenge} />
      <GuessHistory c={challenge} guesses={progress.guesses} grid={progress.grid} />
      <GuessInput
        c={challenge}
        guesses={progress.guesses}
        onGuess={(guess) => dispatch({ type: 'guess', guess, marks: challenge.check(guess), maxGuesses, at: Date.now() })}
      />
      {progress.hintsUsed > 0 && (
        <ul className="space-y-1" data-testid="daily-hints">
          {challenge.hints.slice(0, progress.hintsUsed).map((h, i) => (
            <li key={i} className="rounded-xl bg-paper px-3 py-2 text-sm text-ink ring-1 ring-panel-edge">
              💡 {h}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="rounded-full bg-paper px-3 py-1 font-mono text-ink-soft ring-1 ring-panel-edge" data-testid="daily-timer">
          ⏱ {formatDuration(elapsed)}
        </span>
        <span className="rounded-full bg-paper px-3 py-1 text-ink-soft ring-1 ring-panel-edge" data-testid="daily-left">
          {left} guess{left === 1 ? '' : 'es'} left
        </span>
        <button type="button" data-testid="daily-hint" className={`${btnGhost} min-h-10 px-4 text-sm`} disabled={progress.hintsUsed >= maxHints} onClick={() => dispatch({ type: 'hint', maxHints })}>
          Hint (−150)
        </button>
        {progress.guesses.length > 0 && (
          <button type="button" data-testid="daily-give-up" className="min-h-10 px-3 text-sm text-ink-soft underline" onClick={() => dispatch({ type: 'giveUp', at: Date.now() })}>
            Give up
          </button>
        )}
      </div>
    </div>
  )
}

export async function shareResult(text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const nav = window.navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    if (touch && typeof nav.share === 'function') {
      await nav.share({ text })
      return 'shared'
    }
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text)
      return 'copied'
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
  }
  return 'failed'
}

export function Finished({
  challenge,
  progress,
  maxGuesses,
  signedIn,
  streak,
  nextAt,
  saving,
  saveError,
  onRetry,
}: {
  challenge: DailyChallenge
  progress: Progress
  maxGuesses: number
  signedIn: boolean
  streak: Streak | null
  nextAt: string
  saving: boolean
  saveError: string | null
  onRetry(): void
}) {
  const now = useTick(30_000)
  const input = toResultInput(progress)
  const text = shareText({ ...input, maxGuesses }, typeof window !== 'undefined' ? `${window.location.origin}/daily` : undefined)
  const [shared, setShared] = useState<'shared' | 'copied' | 'failed' | null>(null)
  const solved = progress.status === 'solved'
  return (
    <div className="space-y-5" data-testid="daily-finished">
      <div className="text-center">
        <div className="text-4xl" aria-hidden>
          {solved ? '🔓' : '🔒'}
        </div>
        <p className="font-display text-2xl font-semibold text-ink" data-testid="daily-outcome">
          {solved ? `Escaped in ${input.guesses}/${maxGuesses}` : 'Still locked today'}
        </p>
        <p className="text-sm text-ink-soft">
          {formatDuration(input.timeMs)}
          {input.hintsUsed ? ` · ${input.hintsUsed} hint${input.hintsUsed > 1 ? 's' : ''}` : ''}
        </p>
      </div>

      {!solved && <AnswerReveal c={challenge} />}
      <GuessHistory c={challenge} guesses={progress.guesses} grid={progress.grid} />

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="daily-share"
          className={btnPrimary}
          onClick={() => {
            void shareResult(text).then(setShared)
          }}
        >
          Share result
        </button>
        {shared === 'copied' && <p className="text-sm text-good">Copied! Paste it in your group chat.</p>}
        {shared === 'failed' && (
          <textarea readOnly aria-label="Your result to copy" className="h-32 w-full max-w-xs rounded-xl border border-panel-edge bg-white p-2 font-mono text-sm" value={text} onFocus={(e) => e.currentTarget.select()} />
        )}
        <pre className="sr-only" data-testid="daily-share-text">
          {text}
        </pre>
      </div>

      {signedIn ? (
        <>
          {saving && <p className="text-center text-sm text-ink-soft">Saving your result…</p>}
          {saveError && (
            <div className="text-center text-sm text-bad" data-testid="daily-save-error">
              {saveError}{' '}
              <button type="button" className="underline" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}
          {streak && <StreakStats streak={streak} />}
          {(progress.submitted || !saving) && <Leaderboard day={progress.day} refreshKey={progress.submitted ? 1 : 0} />}
        </>
      ) : (
        <p className="text-center text-sm text-ink-soft" data-testid="daily-signin-nudge">
          <Link to="/welcome" className="font-semibold text-accent underline">
            Sign in
          </Link>{' '}
          to keep a streak and see how your friends did.
        </p>
      )}

      <p className="text-center text-sm text-ink-soft" data-testid="daily-next">
        Next escape in {countdown(nextAt, now)}
      </p>
    </div>
  )
}

export function StreakStats({ streak }: { streak: Streak }) {
  const items = [
    { label: 'Streak', value: String(streak.current) },
    { label: 'Best', value: String(streak.best) },
    { label: 'Played', value: String(streak.played) },
    { label: 'Solved', value: streak.played ? `${Math.round((streak.solved / streak.played) * 100)}%` : '–' },
    { label: 'Best time', value: streak.bestTimeMs === null ? '–' : formatDuration(streak.bestTimeMs) },
  ]
  return (
    <dl className="grid grid-cols-5 gap-1 rounded-2xl bg-paper p-3 text-center ring-1 ring-panel-edge" data-testid="daily-streak">
      {items.map((it) => (
        <div key={it.label}>
          <dd className="font-display text-xl font-semibold text-ink">{it.value}</dd>
          <dt className="text-[11px] uppercase tracking-wide text-ink-soft">{it.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export function Leaderboard({ day, refreshKey }: { day: string; refreshKey: number }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    callApi(ROUTES.dailyLeaderboard, { query: { day } }, { signal: ac.signal })
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries((old) => old ?? []))
    return () => ac.abort()
  }, [day, refreshKey])
  if (!entries) return null
  return (
    <section data-testid="daily-leaderboard" className="rounded-2xl bg-paper p-3 ring-1 ring-panel-edge">
      <h3 className="mb-2 font-display text-lg font-semibold text-ink">Friends today</h3>
      {entries.length <= 1 && <p className="mb-2 text-sm text-ink-soft">None of your friends have played yet. Invite someone from your profile to compare scores.</p>}
      <ol className="space-y-1">
        {entries.map((e, i) => (
          <li key={e.user.id} className="flex items-center gap-2 text-sm" data-testid="daily-leaderboard-row">
            <span className="w-5 text-right font-mono text-ink-soft">{i + 1}</span>
            {e.user.image ? (
              <img src={e.user.image} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-white">{e.user.displayName.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-ink">
              {e.user.displayName}
              {e.user.handle && <span className="text-ink-soft"> @{e.user.handle}</span>}
            </span>
            <span className="text-ink-soft">{e.solved ? `${e.guesses} · ${formatDuration(e.timeMs)}` : 'locked'}</span>
            <span className="w-12 text-right font-mono font-semibold text-ink">{e.score}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
