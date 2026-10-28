/**
 * "Welcome home" after walking out of the Escape of the Day puzzle room (/daily/room). The room
 * leaves a note (welcomeNote.ts) before it navigates to `/`; the 3D room (App) mounts `DailyWelcome`,
 * which shows a short celebration toast once the room is entered and, for signed-out players (who
 * land in the demo room), a sign-in prompt so the result can count next time. Ships with the 3D
 * room bundle. Phones land on `/m?from=daily` instead and see `MobileDailyWelcome` (MobileWelcome.tsx).
 */
import { useEffect, useState } from 'react'
import { signInWithGoogle } from '../../auth'
import { useStore } from '../../state/store'
import { WELCOME_CSS, WelcomeCard, WelcomeConfetti } from './WelcomeCard'
import { clearWelcomeNote, readWelcomeNote, type WelcomeNote } from './welcomeNote'

export { clearWelcomeNote, leaveWelcomeNote, readWelcomeNote, takeWelcomeNote, welcomeLine, type WelcomeNote } from './welcomeNote'

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
      {note.solved && <WelcomeConfetti />}
      <WelcomeCard note={note} onDismiss={() => setOpen(false)}>
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
      </WelcomeCard>
    </div>
  )
}
