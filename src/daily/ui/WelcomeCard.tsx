/**
 * The "Welcome home!" card shown after walking out of the Escape of the Day puzzle room: a lock or
 * house badge, the result line, optional extra content (a sign-in prompt) and a dismiss button,
 * with a short burst of confetti on a solve. Store-free and three-free, so both the 3D room
 * (`DailyWelcome`) and the phone shell (`MobileDailyWelcome`) use it.
 */
import type { ReactNode } from 'react'
import { welcomeLine, type WelcomeNote } from './welcomeNote'

const CONFETTI = ['#e07b39', '#2de2d0', '#f0c977', '#6d3b5c', '#4f9d5a', '#e8433a']

export function WelcomeConfetti({ pieces = 28 }: { pieces?: number }) {
  return (
    <div className="dw-confetti pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden data-testid="daily-welcome-confetti">
      {Array.from({ length: pieces }, (_, i) => (
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
  )
}

export function WelcomeCard({ note, onDismiss, children, className = '' }: { note: WelcomeNote; onDismiss(): void; children?: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      data-testid="daily-welcome"
      className={`dw-pop pointer-events-auto relative flex max-w-md items-start gap-3 rounded-cozy bg-panel px-4 py-3 font-body text-ink shadow-cozy ring-1 ring-panel-edge ${className}`}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f0c977] text-xl" aria-hidden>
        {note.solved ? '🔓' : '🏠'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-display text-lg font-semibold leading-tight">Welcome home!</p>
        <p className="m-0 text-sm text-ink-soft" data-testid="daily-welcome-line">
          {welcomeLine(note)}
        </p>
        {children}
      </div>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-ink-soft hover:bg-[rgba(224,123,57,.12)]">
        ×
      </button>
    </div>
  )
}

export const WELCOME_CSS = `
@keyframes dw-pop { from { opacity: 0; transform: translateY(-10px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes dw-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1 } 100% { transform: translateY(70vh) rotate(540deg); opacity: 0 } }
.dw-pop { animation: dw-pop .4s ease-out both }
.dw-confetti span { position: absolute; top: 0; width: 8px; height: 12px; border-radius: 2px; animation: dw-fall 2.6s ease-in forwards }
@media (prefers-reduced-motion: reduce) { .dw-pop, .dw-confetti span { animation: none } .dw-confetti { display: none } }
`
