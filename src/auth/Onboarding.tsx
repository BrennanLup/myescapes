/**
 * The "choose your public name" step (workstream 3). After the first Google sign-in it asks for a
 * display name and a unique @handle, prefilled from Google and editable. Public pages show these,
 * never the email. Until it is done, no review is shown publicly.
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { ApiCallError } from '../contracts/errors'
import type { Me } from '../contracts/models'
import { localHandleProblem, normaliseHandle, suggestHandle } from './handles'
import { checkHandle, needsOnboarding, updateProfile } from './api'
import { useSession } from './session'

type Availability = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string }

export function Onboarding({ user, onDone }: { user: Me; onDone?: (me: Me) => void }) {
  const ids = { name: useId(), handle: useId(), hint: useId() }
  const [displayName, setDisplayName] = useState(user.displayName || '')
  const [handle, setHandle] = useState(user.handle || suggestHandle(user.displayName, user.email))
  const [avail, setAvail] = useState<Availability>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check the handle as you type (debounced). The server decides on save anyway.
  useEffect(() => {
    const problem = localHandleProblem(handle)
    let cancelled = false
    const timer = setTimeout(
      () => {
        if (problem) {
          setAvail({ state: 'bad', message: problem })
          return
        }
        setAvail({ state: 'checking' })
        checkHandle(normaliseHandle(handle))
          .then((r) => {
            if (cancelled) return
            if (r.available) setAvail({ state: 'ok' })
            else setAvail({ state: 'bad', message: r.reason === 'reserved' ? `@${r.handle} is reserved.` : r.reason === 'invalid' ? 'Letters, digits and _ only.' : `@${r.handle} is taken.` })
          })
          .catch(() => !cancelled && setAvail({ state: 'idle' }))
      },
      problem ? 0 : 300,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [handle])

  const nameProblem = displayName.trim() ? (displayName.trim().length > 60 ? 'At most 60 characters.' : null) : 'Pick a display name.'
  const canSave = !saving && !nameProblem && avail.state !== 'bad' && avail.state !== 'checking'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const me = await updateProfile({ displayName: displayName.trim(), handle: normaliseHandle(handle) })
      onDone?.(me)
    } catch (err) {
      if (err instanceof ApiCallError && err.code === 'handle_taken') setAvail({ state: 'bad', message: err.message })
      else setError(err instanceof ApiCallError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main data-testid="onboarding" className="min-h-screen bg-panel px-4 py-10 text-ink">
      <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-5 rounded-[var(--radius-cozy)] border border-panel-edge bg-paper p-6 shadow-[var(--shadow-cozy)]">
        <header>
          <h1 className="font-display text-2xl">Choose your public name</h1>
          <p className="mt-1 text-sm text-ink-soft">This is how you appear on public reviews and to friends. Your email is never shown.</p>
        </header>
        <label htmlFor={ids.name} className="flex flex-col gap-1">
          <span className="font-semibold">Display name</span>
          <input
            id={ids.name}
            data-testid="onboarding-name"
            className="rounded-lg border border-panel-edge bg-white px-3 py-2 text-base"
            value={displayName}
            maxLength={60}
            autoComplete="nickname"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          {nameProblem && displayName !== '' && <span className="text-sm text-bad">{nameProblem}</span>}
        </label>
        <label htmlFor={ids.handle} className="flex flex-col gap-1">
          <span className="font-semibold">Handle</span>
          <span className="flex items-center rounded-lg border border-panel-edge bg-white px-3">
            <span aria-hidden className="text-ink-soft">@</span>
            <input
              id={ids.handle}
              data-testid="onboarding-handle"
              aria-describedby={ids.hint}
              className="w-full bg-transparent py-2 pl-1 text-base outline-none"
              value={handle}
              maxLength={25}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value.replace(/\s+/g, ''))}
            />
          </span>
          <span id={ids.hint} data-testid="onboarding-handle-status" aria-live="polite" className={`text-sm ${avail.state === 'bad' ? 'text-bad' : avail.state === 'ok' ? 'text-good' : 'text-ink-soft'}`}>
            {avail.state === 'bad' ? avail.message : avail.state === 'ok' ? `@${normaliseHandle(handle)} is free.` : avail.state === 'checking' ? 'Checking...' : '3-24 letters, digits or _. Friends can find you by it.'}
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <button type="submit" data-testid="onboarding-save" disabled={!canSave} className="rounded-full bg-accent px-5 py-3 font-display text-lg text-accent-ink disabled:opacity-50">
          {saving ? 'Saving...' : 'Continue'}
        </button>
        <p className="text-center text-xs text-ink-soft">
          You can change these later in settings. <a className="underline" href="/privacy">Privacy</a>
        </p>
      </form>
    </main>
  )
}

/** Renders the onboarding step instead of `children` while a signed-in user has no public name. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const session = useSession()
  if (needsOnboarding(session) && session.status === 'signed-in') return <Onboarding user={session.user} />
  return <>{children}</>
}
