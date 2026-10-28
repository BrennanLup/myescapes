/**
 * "Welcome home" after walking out of the Escape of the Day puzzle room (/daily/room). The room
 * leaves a note here before it navigates to `/`; the 3D room (App) mounts `DailyWelcome`, which shows
 * a short celebration toast once the room is entered and, for signed-out players (who land in the
 * demo room), a sign-in prompt so the result can count next time. Ships with the 3D room bundle.
 */
import { useEffect, useState } from 'react'
import { signInWithGoogle } from '../../auth'
import { useStore } from '../../state/store'
import { formatDuration } from '../engine'

export interface WelcomeNote {
  number: number
  solved: boolean
  guesses: number
  maxGuesses: number
  timeMs: number
  signedIn: boolean
  at: number
}

const KEY = 'myescapes.daily.welcome.v1'
/** A note older than this is stale (a reload much later should not celebrate again). */
const MAX_AGE_MS = 2 * 60_000

let pending: WelcomeNote | null = null

export function leaveWelcomeNote(note: WelcomeNote): void {
  pending = note
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(note))
  } catch {
    /* storage blocked: the in-memory note still works for a client-side navigation */
  }
}

/** The note left by the puzzle room, if it is fresh. Does not clear it (see `clearWelcomeNote`). */
export function readWelcomeNote(now = Date.now()): WelcomeNote | null {
  let note = pending
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!note && raw) note = JSON.parse(raw) as WelcomeNote
  } catch {
    /* ignore */
  }
  if (!note || typeof note.number !== 'number' || typeof note.at !== 'number' || now - note.at > MAX_AGE_MS) return null
  return note
}

export function clearWelcomeNote(): void {
  pending = null
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Reads and clears the note. */
export function takeWelcomeNote(now = Date.now()): WelcomeNote | null {
  const note = readWelcomeNote(now)
  clearWelcomeNote()
  return note
}

export function welcomeLine(n: WelcomeNote): string {
  return n.solved ? `You escaped #${n.number} in ${n.guesses}/${n.maxGuesses} · ${formatDuration(n.timeMs)}` : `Escape #${n.number} stayed locked today. A new one opens tomorrow.`
}

const CONFETTI = ['#e07b39', '#2de2d0', '#f0c977', '#6d3b5c', '#4f9d5a', '#e8433a']

/** Celebration toast in the 3D room after the daily room. Renders nothing without a fresh note. */
export function DailyWelcome() {
  const [note] = useState<WelcomeNote | null>(() => (typeof window === 'undefined' ? null : readWelcomeNote()))
  const [open, setOpen] = useState(true)
  // Shown once: a reload of the room does not celebrate again.
  useEffect(() => clearWelcomeNote(), [])
  // Wait for the loading screen to fade, so the toast is seen.
  const ready = useStore((s) => s.worldReady)
  useEffect(() => {
    if (!note || !ready || !note.signedIn) return
    const t = window.setTimeout(() => setOpen(false), 8000)
    return () => window.clearTimeout(t)
  }, [note, ready])
  if (!note || !open || !ready) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
      <style>{WELCOME_CSS}</style>
      {note.solved && (
        <div className="dw-confetti absolute inset-x-0 top-0 h-0" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                background: CONFETTI[i % CONFETTI.length],
                animationDelay: `${(i % 7) * 0.12}s`,
                transform: `rotate(${i * 29}deg)`,
              }}
            />
          ))}
        </div>
      )}
      <div
        role="status"
        data-testid="daily-welcome"
        className="dw-pop pointer-events-auto relative flex max-w-md items-start gap-3 rounded-cozy bg-panel px-4 py-3 font-body text-ink shadow-cozy ring-1 ring-panel-edge"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f0c977] text-xl" aria-hidden>
          {note.solved ? '🔓' : '🏠'}
        </span>
        <div className="min-w-0">
          <p className="m-0 font-display text-lg font-semibold leading-tight">Welcome home!</p>
          <p className="m-0 text-sm text-ink-soft" data-testid="daily-welcome-line">
            {welcomeLine(note)}
          </p>
          {!note.signedIn && (
            <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="daily-welcome-signin">
              <span className="text-sm text-ink">Sign in to keep a streak and your own room.</span>
              <button
                type="button"
                className="min-h-10 rounded-full bg-accent px-4 font-display text-sm font-semibold text-accent-ink"
                onClick={() => void signInWithGoogle('/daily/room')}
              >
                Continue with Google
              </button>
            </div>
          )}
        </div>
        <button type="button" aria-label="Dismiss" onClick={() => setOpen(false)} className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-ink-soft hover:bg-[rgba(224,123,57,.12)]">
          ×
        </button>
      </div>
    </div>
  )
}

const WELCOME_CSS = `
@keyframes dw-pop { from { opacity: 0; transform: translateY(-10px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes dw-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1 } 100% { transform: translateY(70vh) rotate(540deg); opacity: 0 } }
.dw-pop { animation: dw-pop .4s ease-out both }
.dw-confetti span { position: absolute; top: 0; width: 8px; height: 12px; border-radius: 2px; animation: dw-fall 2.6s ease-in forwards }
@media (prefers-reduced-motion: reduce) { .dw-pop, .dw-confetti span { animation: none } .dw-confetti { display: none } }
`
