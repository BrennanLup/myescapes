/**
 * Mobile app shell (workstream 13): routing inside /m, sign-in and onboarding gates, the home
 * screen (big "Log an escape room" button, friends online with Visit, visits to confirm, recordings waiting to upload,
 * Escape of the Day card, the rooms table), "View on desktop" and add-to-home-screen.
 *
 * Must never import three.js or anything under src/world (src/mobile/shell/bundle.test.ts checks).
 *
 * Sub-routes: /m (home), /m/log (log flow; ?resume=<recording id>), /m/rooms/:visitId (review
 * detail), /m/inbox (tags to confirm).
 */
import { useEffect, useMemo, useState } from 'react'
import { setSessionUser, signInWithGoogle, signOut, useSession } from '../../auth'
import { signInErrorMessage } from '../../auth/errors'
import type { Me } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import { DailyCard } from '../../daily/ui'
import { MobileDailyWelcome } from '../../daily/ui/MobileWelcome'
import { matchPath, navigate, type RouteProps } from '../../router'
import { Inbox, NotificationsBadge, visitsToConfirm } from '../../social'
import { FriendsOnline } from '../../social/visit/FriendsOnline'
import { ReviewDetail, RoomsTable } from '../list'
import { LogFlow } from '../log'
import { readyLabel, waitingLabel } from '../log/queue'
import { useUploadQueue } from '../log/useQueue'
import { applyMobileManifest, DESKTOP_URL, setDesktopPreference } from './device'
import { Onboarding } from './onboarding'

export interface MobileAppProps extends Partial<RouteProps> {
  /** Tests: swap the transport. */
  fetch?: typeof fetch
}

/** Which mobile screen a sub-path shows. */
export type MobileScreen = { name: 'home' } | { name: 'log'; resume: string | null } | { name: 'room'; visitId: string } | { name: 'inbox' } | { name: 'unknown' }

export function mobileScreen(rest: string, search = ''): MobileScreen {
  if (rest === '/' || rest === '') return { name: 'home' }
  if (matchPath('/log', rest)) return { name: 'log', resume: new URLSearchParams(search).get('resume') }
  const room = matchPath('/rooms/:visitId', rest)
  if (room) return { name: 'room', visitId: room.params.visitId }
  if (matchPath('/inbox', rest)) return { name: 'inbox' }
  return { name: 'unknown' }
}

export function viewOnDesktop() {
  setDesktopPreference(true)
  window.location.assign(DESKTOP_URL)
}

export function MobileApp({ rest = '/', fetch: fetchImpl }: MobileAppProps) {
  const session = useSession()
  const [onboarded, setOnboarded] = useState<Me | null>(null)
  useEffect(() => applyMobileManifest(), [])

  const user = session.status === 'signed-in' ? (onboarded ?? session.user) : null
  const search = typeof window !== 'undefined' ? window.location.search : ''
  const screen = mobileScreen(rest, search)

  let body
  if (session.status === 'loading') {
    body = (
      <p data-testid="mobile-loading" className="py-20 text-center text-ink-soft">
        Loading...
      </p>
    )
  } else if (!user) {
    body = <MobileSignIn />
  } else if (!user.onboarded) {
    body = <Onboarding
        me={user}
        fetch={fetchImpl}
        onDone={(me) => {
          setOnboarded(me)
          // Share the onboarded user with every other useSession() reader (settings, desktop gate).
          setSessionUser(me)
        }}
      />
  } else if (screen.name === 'log') {
    body = <LogFlow me={user} resumeRecordingId={screen.resume} fetch={fetchImpl} onDone={(id) => navigate(id ? `/m/rooms/${encodeURIComponent(id)}` : '/m')} />
  } else if (screen.name === 'room') {
    body = <ReviewDetail visitId={screen.visitId} meId={user.id} onBack={() => navigate('/m')} />
  } else if (screen.name === 'inbox') {
    body = (
      <section className="space-y-3">
        <button type="button" className="text-sm text-ink-soft underline" onClick={() => navigate('/m')}>
          ‹ My rooms
        </button>
        <h2 className="font-display text-2xl">Visits to confirm</h2>
        <Inbox onOpenVisit={(id) => navigate(`/m/rooms/${encodeURIComponent(id)}`)} />
      </section>
    )
  } else if (screen.name === 'unknown') {
    body = (
      <section className="space-y-3 py-10 text-center">
        <p className="font-display text-2xl">Nothing here</p>
        <button type="button" className="text-teal underline" onClick={() => navigate('/m')}>
          Go to my rooms
        </button>
      </section>
    )
  } else {
    body = <Home fetch={fetchImpl} meId={user.id} />
  }

  return (
    <div data-testid="mobile-app" className="min-h-full bg-panel text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-panel-edge bg-panel/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <a
          href="/m"
          className="flex items-center gap-2"
          onClick={(e) => {
            e.preventDefault()
            navigate('/m')
          }}
        >
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-display text-xl">My Escapes</span>
        </a>
        {user?.onboarded && (
          <div className="flex items-center gap-3">
            <NotificationsBadge href="/m/inbox" onOpen={() => navigate('/m/inbox')} />
            <a href="/settings" data-testid="mobile-settings" className="text-sm font-semibold text-teal">
              Settings
            </a>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-xl px-4 py-5">
        {/* Arrived from the Escape of the Day room's exit door (/m?from=daily): a short celebration. */}
        {session.status !== 'loading' && <MobileDailyWelcome signedIn={!!user} />}
        {body}
      </main>
      <MobileFooter signedIn={!!user} />
    </div>
  )
}

function Home({ fetch: fetchImpl, meId }: { fetch?: typeof fetch; meId: string }) {
  const opts = useMemo(() => (fetchImpl ? { fetch: fetchImpl } : {}), [fetchImpl])
  const queue = useUploadQueue({ fetch: fetchImpl, ownerId: meId })
  const [pending, setPending] = useState(0)
  useEffect(() => {
    let live = true
    // Pending tags plus guest-name claims, counted per visit (same rule as the settings inbox).
    // A failed claims call (or a server without it yet) still shows the tag count.
    const claims = callApi(ROUTES.claims, {}, opts)
      .then((r) => r.claims)
      .catch(() => [])
    callApi(ROUTES.pendingTags, {}, opts)
      .then(async (r) => {
        const n = visitsToConfirm(r.tags, await claims)
        if (live) setPending(n)
      })
      .catch(() => {
        /* the banner just doesn't show */
      })
    return () => {
      live = false
    }
  }, [opts])
  const ready = queue.items.find((i) => i.status === 'transcribed')

  return (
    <div data-testid="mobile-home" className="space-y-4">
      {pending > 0 && (
        <button type="button" data-testid="pending-tags" className="flex w-full items-center justify-between rounded-2xl bg-plum px-4 py-3 text-left font-semibold text-white" onClick={() => navigate('/m/inbox')}>
          <span>
            {pending} visit{pending === 1 ? '' : 's'} to confirm
          </span>
          <span aria-hidden>›</span>
        </button>
      )}
      {queue.summary.waiting > 0 && (
        <div data-testid="upload-queue" className="flex items-center justify-between gap-3 rounded-2xl bg-warn/20 px-4 py-3">
          <span className="text-sm font-semibold">{waitingLabel(queue.summary.waiting)}</span>
          <button type="button" data-testid="upload-queue-retry" disabled={queue.uploading} className="shrink-0 rounded-xl bg-teal px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void queue.retry()}>
            {queue.uploading ? 'Uploading...' : 'Retry now'}
          </button>
        </div>
      )}
      {ready && (
        <button type="button" data-testid="upload-ready" className="flex w-full items-center justify-between rounded-2xl bg-good/15 px-4 py-3 text-left text-sm font-semibold" onClick={() => navigate(`/m/log?resume=${encodeURIComponent(ready.id)}`)}>
          <span>{readyLabel(queue.summary.ready)}</span>
          <span aria-hidden>›</span>
        </button>
      )}
      <button type="button" data-testid="log-room" className="w-full rounded-3xl bg-accent px-6 py-8 font-display text-2xl text-accent-ink shadow-[var(--shadow-cozy)] active:scale-[0.99]" onClick={() => navigate('/m/log')}>
        Log an escape room
      </button>
      <FriendsOnline onJoinMine={viewOnDesktop} />
      <DailyCard />
      <section className="space-y-2">
        <h2 className="font-display text-xl">My rooms</h2>
        <RoomsTable onOpen={(id) => navigate(`/m/rooms/${encodeURIComponent(id)}`)} />
      </section>
    </div>
  )
}

/** `?signin=failed&error=...` after a failed Google sign-in (Better Auth's error redirect). */
function signInFailure(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  if (!q.has('error') && q.get('signin') !== 'failed') return null
  return signInErrorMessage(q.get('error') ?? 'default')
}

function MobileSignIn() {
  const [error, setError] = useState<string | null>(signInFailure)
  return (
    <section data-testid="mobile-signin" className="space-y-5 py-8 text-center">
      <img src="/icons/icon-512.png" alt="" className="mx-auto h-24 w-24 rounded-3xl" />
      <h1 className="font-display text-3xl">Every escape room you've played</h1>
      <p className="text-ink-soft">Log a room in a minute with a voice note, right after you walk out.</p>
      <button
        type="button"
        data-testid="mobile-signin-google"
        className="w-full rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-accent-ink"
        onClick={() => signInWithGoogle('/m').catch((e: Error) => setError(e.message))}
      >
        Continue with Google
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <a href="/daily" className="block text-teal underline">
        Play today's Escape of the Day
      </a>
    </section>
  )
}

/** Footer links: at least 44 px tall and wide (phone tap targets), padded instead of bare text. */
const FOOTER_LINK = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 active:bg-white/60'

function MobileFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="mx-auto max-w-xl space-y-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-sm text-ink-soft">
      <button type="button" data-testid="view-on-desktop" className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-teal underline active:bg-white/60" onClick={viewOnDesktop}>
        View on desktop (3D room)
      </button>
      <nav className="-ml-2 flex flex-wrap gap-x-2 underline">
        <a href="/about" className={FOOTER_LINK}>
          About
        </a>
        <a href="/privacy" className={FOOTER_LINK}>
          Privacy
        </a>
        <a href="/terms" className={FOOTER_LINK}>
          Terms
        </a>
        {signedIn && (
          <button type="button" data-testid="mobile-signout" className={`${FOOTER_LINK} underline`} onClick={() => void signOut().then(() => window.location.assign('/m'))}>
            Sign out
          </button>
        )}
      </nav>
    </footer>
  )
}
