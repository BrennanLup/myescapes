/**
 * Landing page and sign-in screen (workstream 19). Links /about, /privacy, /terms.
 *
 *   Home            the `/` route: signed-out visitors get the landing page with "Continue with
 *                   Google"; signed-in users get the onboarding step (display name + @handle) once,
 *                   then their 3D room. `/?demo=1` opens the read-only demo room while signed out.
 *   Landing         the landing page itself (also at /welcome, which honours `?next=`).
 *   SignInScreen    the "Continue with Google" card, reusable by other screens (mobile shell).
 *   OnboardingScreen  choose a public name before any review can be public.
 */
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import type { RouteProps } from '../../router'
import { navigate } from '../../router'
import { setSessionUser, signInWithGoogle, useSession } from '../../auth'
import { signInErrorMessage } from '../../auth/errors'
import { ROUTES, callApi } from '../../contracts/routes'
import { ApiCallError } from '../../contracts/errors'
import { DisplayNameSchema, HandleSchema, RESERVED_HANDLES, type Me } from '../../contracts/models'
import { PublicFooter } from '../shared/Layout'
import { useDocumentTitle } from '../shared/useApi'

const DesktopApp = lazy(async () => ({ default: (await import('../../desktop')).DesktopApp }))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A same-origin path to return to after sign-in. Anything else (other hosts, `//x`, `\x`) becomes `/`. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || [...raw].some((c) => c.charCodeAt(0) < 0x20)) return '/'
  return raw
}

function searchParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
}

/** `?demo` on `/` shows the read-only demo room to a signed-out visitor. */
export function wantsDemo(search: string): boolean {
  return new URLSearchParams(search).has('demo')
}

export { signInErrorMessage }

const ONBOARD_SKIP_KEY = 'myescapes:onboarding-skipped'

function readSkip(): boolean {
  try {
    return sessionStorage.getItem(ONBOARD_SKIP_KEY) === '1'
  } catch {
    return false
  }
}
function writeSkip() {
  try {
    sessionStorage.setItem(ONBOARD_SKIP_KEY, '1')
  } catch {
    /* private mode: skipping lasts for this render only */
  }
}

// ---------------------------------------------------------------------------
// "Continue with Google"
// ---------------------------------------------------------------------------

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function GoogleButton({ next = '/', signIn = signInWithGoogle }: { next?: string; signIn?: (callbackURL: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn(safeNext(next))
      // Better Auth redirects the page to Google; if it hasn't after a while, let the user retry.
      setTimeout(() => setBusy(false), 8000)
    } catch {
      setBusy(false)
      setError("Sign-in isn't available right now. Please try again in a minute.")
    }
  }
  return (
    <div>
      <button
        type="button"
        data-testid="google-sign-in"
        onClick={go}
        disabled={busy}
        className="inline-flex items-center gap-3 rounded-full border border-[#dadce0] bg-white px-6 py-3 font-body text-base font-bold text-[#3c4043] shadow-md transition hover:shadow-lg disabled:opacity-70"
      >
        <GoogleMark />
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error && (
        <p role="alert" className="m-0 mt-3 text-sm text-[#ffb4a4]">
          {error}
        </p>
      )}
    </div>
  )
}

function ConsentLine({ dark = true }: { dark?: boolean }) {
  const link = dark ? 'text-[#fbeedd] underline' : 'text-[#b9561f] underline'
  return (
    <p className={`m-0 mt-3 text-xs ${dark ? 'text-[#c9b3a3]' : 'text-ink-soft'}`}>
      We only get your name, email and profile picture from Google. Your email is never shown publicly. By continuing you agree to the{' '}
      <a href="/terms" className={link}>
        Terms
      </a>{' '}
      and{' '}
      <a href="/privacy" className={link}>
        Privacy policy
      </a>
      .
    </p>
  )
}

/** The sign-in card on its own (for the mobile shell or any screen that needs a session). */
export function SignInScreen({ next, title = 'Sign in to My Escapes', reason }: { next?: string; title?: string; reason?: string } = {}) {
  const params = searchParams()
  const target = safeNext(next ?? params.get('next'))
  const error = signInErrorMessage(params.get('error'))
  return (
    <div data-testid="sign-in-screen" className="flex min-h-full items-center justify-center bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_420px)] bg-no-repeat px-4 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-cozy)] bg-panel p-6 text-center text-ink shadow-[var(--shadow-cozy)]">
        <img src="/favicon.svg" alt="" width={64} height={64} className="mx-auto" />
        <h1 className="m-0 mt-2 font-display text-2xl font-semibold">{title}</h1>
        {reason && <p className="m-0 mt-1 text-ink-soft">{reason}</p>}
        {error && (
          <p role="alert" className="m-0 mt-3 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="mt-5">
          <GoogleButton next={target} />
        </div>
        <ConsentLine dark={false} />
        <nav aria-label="Legal" className="mt-4 flex justify-center gap-4 text-sm">
          <a href="/about" className="text-ink-soft">
            About
          </a>
          <a href="/privacy" className="text-ink-soft">
            Privacy
          </a>
          <a href="/terms" className="text-ink-soft">
            Terms
          </a>
        </nav>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

const FEATURES: { title: string; text: string }[] = [
  { title: 'Your own room', text: 'Every escape room you log becomes a polaroid on the board of your own cozy 3D room, with your scores and notes.' },
  { title: 'Log by voice', text: 'After a game, record a quick voice note on your phone. It becomes a draft review that you check before saving.' },
  { title: 'Find rooms', text: 'A public directory of escape room venues and games, with reviews from players. Spoilers stay hidden until you ask.' },
  { title: 'Play with friends', text: 'Tag the people you played with. A shared visit is logged once, and everyone keeps their own review.' },
  { title: 'Escape of the Day', text: 'A small daily puzzle, the same for everyone, with a share grid and a streak.' },
]

export function Landing(_props: Partial<RouteProps>) {
  const params = searchParams()
  const next = safeNext(params.get('next'))
  const error = signInErrorMessage(params.get('error'))
  const session = useSession()
  useDocumentTitle('My Escapes: every escape room you have played')

  // /welcome?next=... after signing in elsewhere: go where the visitor was heading.
  const onWelcome = typeof window !== 'undefined' && window.location.pathname === '/welcome'
  useEffect(() => {
    if (onWelcome && session.status === 'signed-in') navigate(next, { replace: true })
  }, [onWelcome, session.status, next])

  return (
    <div data-testid="landing-page" className="min-h-full overflow-x-hidden bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_520px)] bg-no-repeat text-[#fff7ec]">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4">
        <span className="flex items-center gap-2 font-display text-xl font-semibold">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          My Escapes
        </span>
        <nav aria-label="Site" className="ml-auto flex gap-4 text-sm font-semibold">
          <a href="/about" className="text-[#fbeedd] no-underline hover:text-[#ffb067]">
            About
          </a>
          <a href="/privacy" className="text-[#fbeedd] no-underline hover:text-[#ffb067]">
            Privacy
          </a>
          <a href="/terms" className="text-[#fbeedd] no-underline hover:text-[#ffb067]">
            Terms
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-8">
        <section className="py-8 text-center">
          <img src="/favicon.svg" alt="My Escapes logo: an arched door with a keyhole" width={112} height={112} className="mx-auto" />
          <h1 className="m-0 mt-3 font-display text-5xl font-semibold text-[#ffb067] sm:text-6xl">My Escapes</h1>
          <p className="mx-auto mt-3 mb-7 max-w-xl text-lg text-[#fbeedd]">Every escape room you've played, pinned up as a polaroid in your own cozy 3D room.</p>
          {error && (
            <p role="alert" className="mx-auto mb-4 max-w-md rounded-xl bg-[#5a2b2b] px-4 py-2 text-sm">
              {error}
            </p>
          )}
          {session.status === 'signed-in' ? (
            <a href={next} className="inline-block rounded-full bg-accent px-7 py-3 font-display text-lg font-semibold text-white no-underline">
              Open my room
            </a>
          ) : (
            <div className="flex flex-col items-center">
              <GoogleButton next={next} />
              <div className="max-w-md">
                <ConsentLine />
              </div>
            </div>
          )}
          <p className="m-0 mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
            <a href="/?demo=1" data-testid="demo-link" className="text-[#fbeedd]">
              Peek at the demo room
            </a>
            <a href="/daily" className="text-[#fbeedd]">
              Play today's Escape of the Day
            </a>
          </p>
        </section>

        <section className="rounded-[var(--radius-cozy)] bg-panel p-6 text-ink shadow-[var(--shadow-cozy)] sm:p-8">
          <h2 className="m-0 font-display text-2xl font-semibold">What it does</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-panel-edge bg-paper px-4 py-3">
                <h3 className="m-0 font-display text-lg font-semibold">{f.title}</h3>
                <p className="m-0 mt-1">{f.text}</p>
              </div>
            ))}
          </div>
          <p className="mb-0 text-sm text-ink-soft">
            New here? Read <a href="/about">about My Escapes</a>, the <a href="/privacy">privacy policy</a> and the <a href="/terms">terms of service</a>.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Onboarding: choose a display name and @handle
// ---------------------------------------------------------------------------

/** A starting @handle from a Google name or email: lowercase letters, digits and `_`. */
export function suggestHandle(source: string): string {
  const base = source
    .split('@')[0]
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/_$/, '')
    .slice(0, 24)
  const padded = base.length >= 3 ? base : base ? `${base}_escapes` : 'player'
  return (RESERVED_HANDLES as readonly string[]).includes(padded) ? `${padded}_1`.slice(0, 24) : padded
}

export type HandleCheck = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string }

/** Client-side handle check (format and reserved names). The server has the final say. */
export function localHandleProblem(raw: string): string | null {
  const parsed = HandleSchema.safeParse(raw)
  if (!parsed.success) return 'Use 3-24 letters, digits or _, starting with a letter.'
  if ((RESERVED_HANDLES as readonly string[]).includes(parsed.data)) return 'That handle is reserved. Try another.'
  return null
}

export function OnboardingScreen({ user, onDone, onSkip }: { user: Me; onDone: (me: Me) => void; onSkip?: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName || '')
  const [handle, setHandle] = useState(user.handle ?? suggestHandle(user.displayName || user.email))
  const [check, setCheck] = useState<HandleCheck>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced availability check.
  useEffect(() => {
    const problem = localHandleProblem(handle)
    if (problem) {
      setCheck({ state: 'bad', message: problem })
      return
    }
    const normalized = HandleSchema.parse(handle)
    if (user.handle && normalized === user.handle) {
      setCheck({ state: 'ok' })
      return
    }
    setCheck({ state: 'checking' })
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      callApi(ROUTES.handleAvailable, { params: { handle: normalized } }, { signal: ctrl.signal }).then(
        (r) => setCheck(r.available ? { state: 'ok' } : { state: 'bad', message: r.reason === 'reserved' ? 'That handle is reserved. Try another.' : 'That handle is taken. Try another.' }),
        () => !ctrl.signal.aborted && setCheck({ state: 'idle' }),
      )
    }, 350)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [handle, user.handle])

  const nameOk = DisplayNameSchema.safeParse(displayName).success
  const canSave = nameOk && check.state !== 'bad' && !saving

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const me = await callApi(ROUTES.updateMe, { body: { displayName: displayName.trim(), handle } })
      onDone(me)
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiCallError && err.code === 'handle_taken') setCheck({ state: 'bad', message: 'That handle is taken. Try another.' })
      else setError(err instanceof ApiCallError && err.body?.error ? err.body.error : "Couldn't save. Please try again.")
    }
  }

  return (
    <div data-testid="onboarding-screen" className="flex min-h-full items-center justify-center bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_420px)] bg-no-repeat px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-[var(--radius-cozy)] bg-panel p-6 text-ink shadow-[var(--shadow-cozy)]">
        <h1 className="m-0 font-display text-2xl font-semibold">Choose your public name</h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">This is what other players see next to your public reviews. Your email is never shown.</p>

        <label className="mt-4 block">
          <span className="text-sm font-semibold">Display name</span>
          <input
            name="displayName"
            value={displayName}
            maxLength={60}
            autoComplete="nickname"
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-panel-edge bg-white px-3 py-2"
          />
        </label>
        {!nameOk && <p className="m-0 mt-1 text-xs text-bad">Enter a name (up to 60 characters).</p>}

        <label className="mt-4 block">
          <span className="text-sm font-semibold">Handle</span>
          <span className="mt-1 flex items-center rounded-lg border border-panel-edge bg-white px-3">
            <span aria-hidden="true" className="text-ink-soft">@</span>
            <input
              name="handle"
              aria-label="Handle"
              aria-describedby="handle-status"
              value={handle}
              maxLength={25}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
              className="block w-full border-0 bg-transparent px-1 py-2 outline-none"
            />
          </span>
        </label>
        <p id="handle-status" data-testid="handle-status" aria-live="polite" className={`m-0 mt-1 min-h-4 text-xs ${check.state === 'bad' ? 'text-bad' : 'text-ink-soft'}`}>
          {check.state === 'bad' ? check.message : check.state === 'checking' ? 'Checking…' : check.state === 'ok' ? 'Available' : ''}
        </p>

        {error && (
          <p role="alert" className="m-0 mt-2 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center gap-4">
          <button type="submit" disabled={!canSave} className="rounded-full bg-accent px-6 py-2 font-display text-lg font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving…' : 'Continue'}
          </button>
          {onSkip && (
            <button type="button" onClick={onSkip} className="text-sm text-ink-soft underline">
              Later
            </button>
          )}
        </div>
        <p className="m-0 mt-3 text-xs text-ink-soft">Until you choose a name, your reviews stay off public pages.</p>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The `/` route
// ---------------------------------------------------------------------------

function Blank() {
  return <div data-testid="page-loading" className="fixed inset-0 bg-[var(--color-night)]" />
}

function Room() {
  return (
    <Suspense fallback={<Blank />}>
      <DesktopApp />
    </Suspense>
  )
}

export function Home(_props: Partial<RouteProps>) {
  const session = useSession()
  const [onboarded, setOnboarded] = useState<Me | null>(null)
  const [skipped, setSkipped] = useState(readSkip)
  const demo = typeof window !== 'undefined' && wantsDemo(window.location.search)

  if (session.status === 'loading') return <Blank />
  if (session.status === 'signed-out') return demo ? <Room /> : <Landing />
  const me = onboarded ?? session.user
  if (!me.onboarded && !skipped) {
    return (
      <OnboardingScreen
        user={me}
        onDone={(next) => {
          setOnboarded(next)
          // Share the saved name with every other screen (settings, mobile, the room's own checks).
          setSessionUser(next)
        }}
        onSkip={() => {
          writeSkip()
          setSkipped(true)
        }}
      />
    )
  }
  return <Room />
}
