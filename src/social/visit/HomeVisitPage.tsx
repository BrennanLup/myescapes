/**
 * `/home/:handle`: a friend's room (Phase 3, workstream C). Checks you may come in first (signed
 * in, friends), with a friendly page when not, then opens the 3D room with their data, read-only.
 * Your own handle goes to your own room.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { setSessionUser, useSession } from '@/auth'
import type { HomeView } from '@/contracts/realtime'
import type { RouteProps } from '@/router'
import { useDocumentTitle } from '@/public/shared/useApi'
import { OnboardingScreen, SignInScreen } from '@/public/landing'
import { homeUrl, pageNav, preloadHome, visitHandleFromPath, visitProblem, type VisitProblem } from './state'

const DesktopApp = lazy(async () => ({ default: (await import('../../desktop')).DesktopApp }))

function Blank({ label }: { label?: string }) {
  return (
    <div data-testid="page-loading" className="fixed inset-0 flex items-end justify-center bg-[var(--color-night)] pb-16">
      {label ? (
        <p aria-live="polite" className="m-0 font-display text-lg text-panel/80">
          {label}
        </p>
      ) : null}
    </div>
  )
}

type Load = { state: 'loading' } | { state: 'ok'; view: HomeView } | { state: 'error'; problem: VisitProblem }

export function HomeVisitPage({ params }: Partial<RouteProps>) {
  const session = useSession()
  const handle = visitHandleFromPath(`/home/${encodeURIComponent(params?.handle ?? '')}`) ?? ''
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useDocumentTitle(load.state === 'ok' ? `${load.view.owner.displayName}'s room · My Escapes` : 'A friend’s room · My Escapes')

  const signedIn = session.status === 'signed-in'
  useEffect(() => {
    if (!signedIn || !handle) return
    let live = true
    setLoad({ state: 'loading' })
    preloadHome(handle).then(
      (view) => {
        if (!live) return
        // Your own @handle: that's just your room.
        if (view.isOwner) pageNav.go(homeUrl())
        else setLoad({ state: 'ok', view })
      },
      (err) => {
        if (live) setLoad({ state: 'error', problem: visitProblem(err) })
      },
    )
    return () => {
      live = false
    }
  }, [signedIn, handle, attempt])

  if (session.status === 'loading') return <Blank />
  if (session.status === 'signed-out') {
    return <SignInScreen next={typeof window === 'undefined' ? '/' : window.location.pathname} title={`Visit @${handle}'s room`} reason="Sign in to visit your friends' rooms." />
  }
  // Friends see you by name and @handle in their room, so choose them first.
  if (!session.user.onboarded) return <OnboardingScreen user={session.user} onDone={(me) => setSessionUser(me)} />
  if (!handle) return <VisitError problem="not_found" handle={params?.handle ?? ''} onRetry={() => setAttempt((n) => n + 1)} />
  if (load.state === 'loading') return <Blank label={`Opening @${handle}'s room…`} />
  if (load.state === 'error') return <VisitError problem={load.problem} handle={handle} onRetry={() => setAttempt((n) => n + 1)} />
  return (
    <Suspense fallback={<Blank label={`Opening ${load.view.owner.displayName}'s room…`} />}>
      <DesktopApp />
    </Suspense>
  )
}

const COPY: Record<VisitProblem, { title: (h: string) => string; body: string }> = {
  forbidden: {
    title: (h) => `Only @${h}'s friends can come in`,
    body: 'Rooms are for friends. Send them an invite link, or ask them to add you, then come back.',
  },
  not_found: {
    title: (h) => (h ? `There's no room called @${h}` : "That room doesn't exist"),
    body: 'Check the @handle, or pick a friend from your friends list.',
  },
  signed_out: {
    title: () => 'Your session ended',
    body: 'Sign in again to visit your friends.',
  },
  unavailable: {
    title: () => "Couldn't open that room",
    body: 'Check your connection and try again.',
  },
}

export function VisitError({ problem, handle, onRetry }: { problem: VisitProblem; handle: string; onRetry(): void }) {
  const copy = COPY[problem]
  return (
    <main data-testid="visit-error" data-problem={problem} className="flex min-h-full items-center justify-center bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_420px)] bg-no-repeat px-4 py-10">
      <div className="w-full max-w-md rounded-[var(--radius-cozy)] bg-panel p-6 text-center text-ink shadow-[var(--shadow-cozy)]">
        <DoorIcon />
        <h1 className="m-0 mt-3 font-display text-2xl font-semibold [overflow-wrap:anywhere] [text-wrap:balance]">{copy.title(handle)}</h1>
        <p className="m-0 mt-2 text-ink-soft">{copy.body}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <a href={homeUrl()} data-testid="visit-back" className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 font-display text-base font-semibold text-accent-ink shadow-sm">
            Back to my room
          </a>
          {problem === 'unavailable' ? (
            <button type="button" onClick={onRetry} className="min-h-11 rounded-full bg-white/70 px-5 text-sm font-bold ring-1 ring-panel-edge">
              Try again
            </button>
          ) : (
            <a href="/settings#friends" className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-5 text-sm font-bold ring-1 ring-panel-edge">
              Friends and invites
            </a>
          )}
        </div>
      </div>
    </main>
  )
}

function DoorIcon() {
  return (
    <svg aria-hidden viewBox="0 0 64 64" width={64} height={64} className="mx-auto">
      <rect x="14" y="6" width="36" height="52" rx="4" fill="#c69a63" stroke="#7a4f2a" strokeWidth="3" />
      <rect x="20" y="12" width="24" height="18" rx="2" fill="#e8c9a4" />
      <rect x="20" y="34" width="24" height="18" rx="2" fill="#e8c9a4" />
      <circle cx="42" cy="34" r="3" fill="#e0a93a" stroke="#7a4f2a" strokeWidth="1.5" />
      <rect x="6" y="56" width="52" height="4" rx="2" fill="#7a4f2a" />
    </svg>
  )
}
