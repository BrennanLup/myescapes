/**
 * "Welcome home" on phones. The puzzle room's exit door sends phones to `/m?from=daily` (they never
 * get the 3D room at `/`), so the phone shell mounts this card at the top of the page: the same
 * result line and confetti as the 3D room's `DailyWelcome`, plus a nudge to sign in for signed-out
 * players (the sign-in button is right below it on /m). Shown once: the note is cleared and the
 * flag dropped from the address bar, so a reload doesn't celebrate again.
 *
 * Store-free and three-free (the phone bundle test checks the import graph).
 */
import { useEffect, useState } from 'react'
import { WELCOME_CSS, WelcomeCard, WelcomeConfetti } from './WelcomeCard'
import { clearWelcomeNote, isFromDaily, readWelcomeNote, type WelcomeNote } from './welcomeNote'

export function MobileDailyWelcome({ signedIn }: { signedIn: boolean }) {
  const [note] = useState<WelcomeNote | null>(() => (typeof window !== 'undefined' && isFromDaily(window.location.search) ? readWelcomeNote() : null))
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !isFromDaily(window.location.search)) return
    clearWelcomeNote()
    const url = new URL(window.location.href)
    url.searchParams.delete('from')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [])

  if (!note || !open) return null
  return (
    <div className="mb-4 flex justify-center">
      <style>{WELCOME_CSS}</style>
      {note.solved && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
          <WelcomeConfetti pieces={22} />
        </div>
      )}
      <WelcomeCard note={note} onDismiss={() => setOpen(false)} className="w-full">
        {!signedIn && (
          <p className="m-0 mt-1.5 text-sm font-semibold text-ink" data-testid="daily-welcome-signin">
            {note.solved ? 'Sign in to keep your streak.' : 'Sign in to start a streak tomorrow.'}
          </p>
        )}
      </WelcomeCard>
    </div>
  )
}
