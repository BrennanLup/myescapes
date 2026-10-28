/**
 * The puzzle room's DOM layer: the entry card, the HUD (number, timer, guesses left, hints), the
 * close-up panels opened from props (lock, clues, hints, result, menu), toasts, the solve confetti
 * and the warm fade when you walk out. Everything here works with keyboard, touch and screen readers;
 * the 3D props are the way in, these panels are where you read and answer.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraMode } from '@/player/view'
import { useStore } from '@/state/store'
import { IconEye, IconPerson } from '@/ui/wardrobe/icons'
import { Link } from '../../router'
import { formatDuration } from '../engine'
import { Finished, KIND_LABEL, useTick, type DailyPlayApi } from '../ui/DailyGame'
import { btnGhost, btnPrimary, focusRing, GuessHistory, GuessInput, PuzzleClues } from '../ui/views'
import { exitsToPhoneApp } from './exit'
import { useRoomPlay } from './playStore'
import { foundNow, looksLeft } from './search'
import { useRoomUi, type RoomPanel } from './uiStore'

const LOCK_TITLE: Record<DailyPlayApi['challenge']['kind'], string> = {
  combination: 'The padlock',
  cipher: 'The letter lock',
  sequence: 'The number dials',
  search: 'The lock box',
}

/** The challenge's prompt, in the room's words (search: looks under things, not taps on a picture). */
export function roomPrompt(c: DailyPlayApi['challenge']): string {
  if (c.kind !== 'search') return c.prompt
  return `Find all ${c.data.count} little brass ${c.data.symbol}s hidden under things in this room. Each round you get one look per ${c.data.symbol} still missing; the ones you find stay found.`
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------

export function EntryCard({ play, onEnter }: { play: DailyPlayApi; onEnter(): void }) {
  const { today, challenge, progress } = play
  const theme = today.puzzle.theme
  const cta = progress.status === 'idle' ? 'Step inside' : progress.status === 'playing' ? 'Continue' : 'Look around'
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => btn.current?.focus(), [])
  return (
    <div
      data-testid="daily-room-entry"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-room-title"
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto px-4 py-6 font-body text-paper"
      style={{
        background:
          'radial-gradient(120% 80% at 50% 110%, rgba(184,80,63,.92) 0%, rgba(184,80,63,0) 55%), linear-gradient(180deg, rgba(42,31,45,.94) 0%, rgba(61,38,56,.92) 55%, rgba(91,47,61,.9) 100%)',
      }}
    >
      <div className="dr-pop flex w-full max-w-md flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-[#f0c977] text-3xl shadow-[0_8px_24px_rgba(240,201,119,.35)]" aria-hidden>
          🔐
        </span>
        <div className="mt-4 text-xs font-bold uppercase tracking-widest text-[#f7b98a]">Escape of the Day</div>
        <h1 id="daily-room-title" className="font-display text-4xl font-semibold text-[#ffe9d2] sm:text-5xl" data-testid="daily-number">
          Escape #{today.puzzle.number}
        </h1>
        {theme && (
          <p className="mt-1 text-sm text-[rgba(255,233,210,.8)]">
            Inspired by <span className="font-semibold text-[#ffe9d2]">{theme.gameName}</span>, {theme.venueName}, {theme.city}
          </p>
        )}
        <div className="mt-3 inline-flex rounded-full bg-[rgba(255,247,236,.12)] px-3 py-1 text-xs font-semibold text-[#ffe9d2] ring-1 ring-[rgba(255,247,236,.2)]">
          {KIND_LABEL[challenge.kind]} · {today.puzzle.maxGuesses} guesses
        </div>
        <p className="mt-4 max-w-sm text-[15px] text-[rgba(255,233,210,.92)]">{entryLine(play)}</p>
        <button
          ref={btn}
          type="button"
          data-testid="daily-room-enter"
          onClick={onEnter}
          className="mt-6 flex min-h-14 items-center gap-3 rounded-full bg-accent px-9 font-display text-xl font-semibold text-accent-ink shadow-[0_10px_30px_rgba(224,123,57,.55)] ring-4 ring-[rgba(255,217,176,.25)] transition hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-[rgba(45,226,208,.7)] active:scale-95"
        >
          {cta}
        </button>
        <p className="mt-3 text-sm text-[rgba(255,233,210,.7)]">
          {progress.status === 'idle' ? 'The clock starts when you step inside.' : 'Your progress is saved.'}{' '}
          <Link to="/daily" className="underline" data-testid="daily-room-2d">
            Play in 2D instead
          </Link>
        </p>
        <ControlsLine className="mt-5 text-xs text-[rgba(255,233,210,.6)]" />
      </div>
    </div>
  )
}

function entryLine(play: DailyPlayApi): string {
  const c = play.challenge
  if (play.finished) return play.progress.status === 'solved' ? 'You already escaped today. The door is open: walk through it to go home.' : 'Today stayed locked. The door is open: walk through it to go home.'
  switch (c.kind) {
    case 'combination':
      return `Find the ${c.slots} clues on the walls, then dial the code on the lock by the door.`
    case 'cipher':
      return 'A word is painted above the door in symbols. Find the key, work out the missing letters and spell it on the lock.'
    case 'sequence':
      return 'A sequence glows on the wall. Work out the next three and set them on the lock by the door.'
    case 'search':
      return `${c.data.count} little brass ${c.data.symbol}s are hidden under things in this room. Find them all to open the door.`
  }
}

export function ControlsLine({ className }: { className?: string }) {
  return (
    <p className={className} data-testid="daily-room-controls">
      <span className="hidden sm:inline">WASD to walk · mouse to look · E or click to use things · V to switch view</span>
      <span className="sm:hidden">Left stick to walk · drag to look · Tap to use things</span>
    </p>
  )
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function RoomHud({ play }: { play: DailyPlayApi }) {
  const panel = useRoomUi((s) => s.panel)
  const open = useRoomUi((s) => s.open)
  const round = useRoomPlay((s) => s.round)
  const assignment = useRoomPlay((s) => s.assignment)
  const { progress, challenge, today, maxHints, finished } = play
  const now = useTick(1000, progress.status === 'playing')
  if (panel) return null
  const elapsed = progress.startedAt ? (progress.finishedAt ?? now) - progress.startedAt : 0
  const left = today.puzzle.maxGuesses - progress.guesses.length
  const chip = 'rounded-full bg-panel/95 px-3 py-1.5 text-sm font-semibold text-ink shadow-[0_6px_18px_rgba(40,20,20,0.3)] ring-1 ring-panel-edge focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 font-body" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
      <button type="button" data-testid="daily-room-menu" aria-label="Menu" onClick={() => open({ kind: 'menu' })} className={`${chip} pointer-events-auto grid h-11 w-11 place-items-center p-0 text-lg`}>
        ☰
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <span className={`${chip} flex items-center gap-2 whitespace-nowrap`}>
          <span>#{today.puzzle.number}</span>
          <span aria-hidden className="text-ink-soft/50">·</span>
          <span className="font-mono" data-testid="daily-timer" aria-label={`Time ${formatDuration(elapsed)}`}>
            ⏱ {formatDuration(elapsed)}
          </span>
          <span aria-hidden className="text-ink-soft/50">·</span>
          <span data-testid="daily-left" aria-live="polite">
            {progress.status === 'solved' ? 'Escaped ✓' : progress.status === 'failed' ? 'Locked' : `${left} left`}
          </span>
        </span>
        {challenge.kind === 'search' && !finished && (
          <span className={`${chip} whitespace-nowrap text-xs sm:text-sm`} data-testid="daily-room-looks" aria-live="polite">
            Found {foundNow(round, assignment).length}/{challenge.slots} · {looksLeft(challenge, round)} look{looksLeft(challenge, round) === 1 ? '' : 's'} left
          </span>
        )}
      </div>
      {!finished ? (
        <button type="button" data-testid="daily-room-hint" onClick={() => open({ kind: 'hint' })} className={`${chip} pointer-events-auto min-h-11`} aria-label={`Hints: ${progress.hintsUsed} of ${maxHints} used`}>
          💡 {progress.hintsUsed}/{maxHints}
        </button>
      ) : (
        <button type="button" data-testid="daily-room-result" onClick={() => open({ kind: 'result' })} className={`${chip} pointer-events-auto min-h-11`}>
          Result
        </button>
      )}
    </div>
  )
}

const SAFE_RIGHT = 'max(14px, env(safe-area-inset-right))'
const SAFE_BOTTOM = 'max(16px, env(safe-area-inset-bottom))'

/**
 * First / third person toggle (also `V`), bottom right: the camera half of the main room's
 * character HUD (src/ui/wardrobe/CharacterHud.tsx), same looks. No wardrobe in here: the puzzle
 * room is a short visit, and the wardrobe lives in your own room.
 */
export function CameraToggle() {
  const panel = useRoomUi((s) => s.panel)
  const leaving = useRoomUi((s) => s.leaving)
  const isTouch = useStore((s) => s.isTouch)
  const mode = useCameraMode((s) => s.mode)
  const toggle = useCameraMode((s) => s.toggle)
  if (panel || leaving) return null
  const third = mode === 'third'
  const label = third ? 'Switch to first person (V)' : 'Switch to third person (V)'

  if (isTouch) {
    return (
      <div className="pointer-events-none fixed z-30 font-body" style={{ right: SAFE_RIGHT, bottom: `calc(${SAFE_BOTTOM} + 18px)` }}>
        <button
          type="button"
          data-testid="camera-toggle"
          aria-label={label}
          aria-pressed={third}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_20px_rgba(40,20,20,.35)] ring-2 transition active:scale-95 ${
            third ? 'bg-teal text-white ring-[rgba(255,255,255,.6)]' : 'bg-panel/95 text-ink ring-panel-edge'
          }`}
        >
          {third ? <IconPerson width={26} height={26} /> : <IconEye width={26} height={26} />}
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed z-30 font-body text-ink" style={{ right: SAFE_RIGHT, bottom: SAFE_BOTTOM }}>
      <button
        type="button"
        data-testid="camera-toggle"
        title={label}
        aria-label={label}
        aria-pressed={third}
        onClick={(e) => {
          toggle()
          // Keep V and the mouse working: don't leave focus on the button.
          e.currentTarget.blur()
        }}
        className={`pointer-events-auto flex h-11 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 backdrop-blur transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95 ${
          third ? 'bg-teal text-white ring-teal' : 'bg-panel/90 text-ink ring-panel-edge'
        }`}
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${third ? 'bg-white/15' : 'bg-[rgba(47,143,138,.12)] text-teal'}`}>
          {third ? <IconPerson width={20} height={20} /> : <IconEye width={20} height={20} />}
        </span>
        <span className="text-sm font-bold">{third ? 'Third person' : 'First person'}</span>
        <kbd className={`rounded-md border-b-2 px-1.5 font-mono text-[11px] font-semibold ${third ? 'border-white/40 bg-white/15' : 'border-panel-edge bg-paper text-ink-soft'}`}>V</kbd>
      </button>
    </div>
  )
}

export function Toast() {
  const toast = useRoomUi((s) => s.toast)
  const panel = useRoomUi((s) => s.panel)
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (!toast) return
    setShown(toast.id)
    const t = window.setTimeout(() => setShown(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])
  if (!toast || shown !== toast.id || panel) return null
  const tone = toast.tone === 'good' ? 'bg-good text-white' : toast.tone === 'bad' ? 'bg-bad text-white' : 'bg-panel text-ink'
  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: 'max(150px, calc(env(safe-area-inset-bottom) + 150px))' }}>
      <div role="status" data-testid="daily-room-toast" className={`dr-pop rounded-full px-4 py-2 font-display text-[15px] font-semibold shadow-cozy ring-1 ring-black/10 ${tone}`}>
        {toast.text}
      </div>
    </div>
  )
}

/** First-entry controls hint, a few seconds. */
export function ControlsHint() {
  const [show, setShow] = useState(true)
  const panel = useRoomUi((s) => s.panel)
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 7000)
    return () => window.clearTimeout(t)
  }, [])
  if (!show || panel) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-28 z-20 flex justify-center px-4 sm:top-24">
      <ControlsLine className="dr-pop rounded-2xl text-center bg-[rgba(42,31,45,.78)] px-4 py-2 text-sm font-semibold text-[#ffe9d2]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function Sheet({ title, children, testId, onClose }: { title: string; children: ReactNode; testId: string; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    // Focus the first field (or the close button) so keyboard players can answer straight away.
    const first = el?.querySelector<HTMLElement>('input, [data-autofocus]') ?? el?.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const a = items[0]
        const b = items[items.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-backdrop font-body text-ink sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dr-pop relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-cozy bg-panel shadow-cozy ring-1 ring-panel-edge sm:rounded-cozy"
      >
        <div className="flex items-center justify-between gap-3 border-b border-panel-edge/70 px-4 py-2 sm:px-6">
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="daily-room-close"
            onClick={onClose}
            className={`-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-ink-soft transition hover:bg-[rgba(224,123,57,.12)] hover:text-ink ${focusRing}`}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-6" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function RoomPanels({ play, onLeave }: { play: DailyPlayApi; onLeave(): void }) {
  const panel = useRoomUi((s) => s.panel)
  const close = useRoomUi((s) => s.close)
  if (!panel || panel.kind === 'intro') return null
  return <PanelBody panel={panel} play={play} close={close} onLeave={onLeave} />
}

function PanelBody({ panel, play, close, onLeave }: { panel: Exclude<RoomPanel, { kind: 'intro' }>; play: DailyPlayApi; close(): void; onLeave(): void }) {
  const { challenge: c, progress, today } = play
  switch (panel.kind) {
    case 'lock':
      return (
        <Sheet title={LOCK_TITLE[c.kind]} testId="daily-room-lock" onClose={close}>
          <div className="space-y-4">
            <p className="text-center text-sm text-ink">{roomPrompt(c)}</p>
            {c.kind !== 'search' && (
              <details className="rounded-2xl bg-paper px-3 py-2 ring-1 ring-panel-edge">
                <summary className={`cursor-pointer rounded-md text-sm font-semibold text-ink-soft ${focusRing}`}>Clues from the room</summary>
                <div className="mt-2">
                  <PuzzleClues c={c} />
                </div>
              </details>
            )}
            <GuessHistory c={c} guesses={progress.guesses} grid={progress.grid} />
            {progress.status === 'playing' && c.kind !== 'search' && <GuessInput c={c} guesses={progress.guesses} onGuess={play.guess} />}
            {c.kind === 'search' && <p className="text-center text-sm text-ink-soft">This lock opens by itself once every {c.data.symbol} is found. Look under things in the room.</p>}
            <GuessesLeft play={play} />
            <HintList play={play} />
          </div>
        </Sheet>
      )
    case 'clues':
      return (
        <Sheet title={c.kind === 'search' ? 'A note on the wall' : 'Clues'} testId="daily-room-clues" onClose={close}>
          <div className="space-y-4">
            <p className="text-center text-sm text-ink">{roomPrompt(c)}</p>
            <PuzzleClues c={c} />
            {today.puzzle.theme && (
              <p className="text-center text-xs text-ink-soft">
                Inspired by {today.puzzle.theme.gameName}, {today.puzzle.theme.venueName}, {today.puzzle.theme.city}
              </p>
            )}
            <HintList play={play} />
            <div className="flex justify-center">
              <button type="button" className={btnGhost} onClick={close} data-autofocus>
                Back to the room
              </button>
            </div>
          </div>
        </Sheet>
      )
    case 'hint':
      return (
        <Sheet title="Hints" testId="daily-room-hints" onClose={close}>
          <HintPanel play={play} />
        </Sheet>
      )
    case 'result':
      return (
        <Sheet title={progress.status === 'solved' ? 'You escaped!' : 'Locked for today'} testId="daily-room-result-panel" onClose={close}>
          <div className="space-y-5">
            <Finished
              challenge={c}
              progress={progress}
              maxGuesses={today.puzzle.maxGuesses}
              signedIn={play.signedIn}
              streak={play.streak}
              nextAt={today.nextAt}
              saving={play.saving}
              saveError={play.saveError}
              onRetry={play.retrySave}
            />
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <button type="button" data-testid="daily-room-walk" className={btnPrimary} onClick={close} data-autofocus>
                Walk out through the door
              </button>
              <button type="button" data-testid="daily-room-home" className={btnGhost} onClick={onLeave}>
                {play.signedIn ? 'Straight to my room' : exitsToPhoneApp() ? 'Leave the room' : 'Go to the demo room'}
              </button>
            </div>
          </div>
        </Sheet>
      )
    case 'menu':
      return (
        <Sheet title="Escape of the Day" testId="daily-room-menu-panel" onClose={close}>
          <div className="flex flex-col items-center gap-3 text-center">
            <button type="button" className={`${btnPrimary} w-full max-w-xs`} onClick={close} data-autofocus>
              Back to the puzzle
            </button>
            <Link to="/daily" className={`${btnGhost} inline-flex w-full max-w-xs items-center justify-center`} data-testid="daily-room-menu-2d">
              Play in 2D instead
            </Link>
            <button type="button" className={`${btnGhost} w-full max-w-xs`} onClick={onLeave} data-testid="daily-room-menu-home">
              {play.signedIn ? 'Back to my room' : 'Leave the room'}
            </button>
            {!play.finished && <p className="text-xs text-ink-soft">Your guesses are saved; the clock keeps running while you are away.</p>}
            <ControlsLine className="text-xs text-ink-soft" />
          </div>
        </Sheet>
      )
  }
}

function GuessesLeft({ play }: { play: DailyPlayApi }) {
  const left = play.today.puzzle.maxGuesses - play.progress.guesses.length
  if (play.finished) return null
  return (
    <p className="text-center text-sm text-ink-soft" data-testid="daily-room-left">
      {left} guess{left === 1 ? '' : 'es'} left
    </p>
  )
}

function HintList({ play }: { play: DailyPlayApi }) {
  const { progress, challenge } = play
  if (!progress.hintsUsed) return null
  return (
    <ul className="space-y-1" data-testid="daily-hints">
      {challenge.hints.slice(0, progress.hintsUsed).map((h, i) => (
        <li key={i} className="rounded-xl bg-paper px-3 py-2 text-sm text-ink ring-1 ring-panel-edge">
          💡 {h}
        </li>
      ))}
    </ul>
  )
}

function HintPanel({ play }: { play: DailyPlayApi }) {
  const { progress, maxHints } = play
  const left = maxHints - progress.hintsUsed
  return (
    <div className="space-y-4">
      <HintList play={play} />
      {progress.hintsUsed === 0 && <p className="text-center text-sm text-ink-soft">Stuck? Ring the bell for a nudge. Each hint costs 150 points and shows as 💡 on your share grid.</p>}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="daily-hint"
          className={btnPrimary}
          disabled={left <= 0 || progress.status !== 'playing'}
          onClick={() => play.dispatch({ type: 'hint', maxHints })}
        >
          {left > 0 ? `Take a hint (−150) · ${left} left` : 'No hints left'}
        </button>
        {progress.guesses.length > 0 && progress.status === 'playing' && (
          <button type="button" data-testid="daily-give-up" className={`min-h-10 rounded-full px-3 text-sm text-ink-soft underline ${focusRing}`} onClick={() => play.dispatch({ type: 'giveUp', at: Date.now() })}>
            Give up for today
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Celebration and leaving
// ---------------------------------------------------------------------------

const CONFETTI = ['#e07b39', '#2de2d0', '#f0c977', '#6d3b5c', '#4f9d5a', '#e8433a']

export function Confetti() {
  const n = useRoomPlay((s) => s.celebrate)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!n) return
    setOn(true)
    const t = window.setTimeout(() => setOn(false), 3200)
    return () => window.clearTimeout(t)
  }, [n])
  if (!on) return null
  return (
    <div className="dr-confetti pointer-events-none fixed inset-0 z-[35] overflow-hidden" aria-hidden data-testid="daily-room-confetti">
      {Array.from({ length: 40 }, (_, i) => (
        <span key={i} style={{ left: `${(i * 41) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 8) * 0.09}s` }} />
      ))}
    </div>
  )
}

export function LeavingFade() {
  const leaving = useRoomUi((s) => s.leaving)
  if (!leaving) return null
  return (
    <div
      data-testid="daily-room-leaving"
      className="dr-fade fixed inset-0 z-[90] flex items-center justify-center font-display text-3xl font-semibold text-[#5b2f3d]"
      style={{ background: 'radial-gradient(circle at 50% 45%, #fff3d6 0%, #ffd9b0 55%, #f7b98a 100%)' }}
    >
      <span className="dr-pop">Welcome home…</span>
    </div>
  )
}

export const ROOM_CSS = `
@keyframes dr-pop { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes dr-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes dr-fall { 0% { transform: translateY(-30px) rotate(0deg); opacity: 1 } 100% { transform: translateY(105vh) rotate(620deg); opacity: .8 } }
.dr-pop { animation: dr-pop .35s ease-out both }
.dr-fade { animation: dr-fade .8s ease-out both }
.dr-confetti span { position: absolute; top: 0; width: 9px; height: 14px; border-radius: 2px; animation: dr-fall 2.8s cubic-bezier(.3,.6,.5,1) forwards }
@media (prefers-reduced-motion: reduce) { .dr-pop, .dr-fade { animation: none } .dr-confetti { display: none } }
`
