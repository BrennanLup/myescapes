/**
 * First sign-in on the phone: choose a display name and a unique @handle (prefilled from Google,
 * editable) before any review can be public. Public pages show these, never the email.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiCallError } from '../../contracts/errors'
import { HANDLE_RE, RESERVED_HANDLES, type Me } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'

/** A handle suggestion from a name or email: "Brennan Lup" -> "brennan_lup". */
export function suggestHandle(me: Pick<Me, 'displayName' | 'email' | 'handle'>): string {
  if (me.handle) return me.handle
  const base = (me.displayName || me.email.split('@')[0] || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24)
  const h = base.replace(/_+$/, '')
  if (h.length >= 3) return h
  return h ? `${h}_escaper` : 'escaper'
}

export function handleProblem(raw: string): string | null {
  const h = raw.trim().replace(/^@/, '').toLowerCase()
  if (!HANDLE_RE.test(h)) return '3-24 letters, digits or _, starting with a letter'
  if ((RESERVED_HANDLES as readonly string[]).includes(h)) return 'That handle is reserved'
  return null
}

export function Onboarding({ me, onDone, fetch: fetchImpl }: { me: Me; onDone(me: Me): void; fetch?: typeof fetch }) {
  const opts = useMemo(() => (fetchImpl ? { fetch: fetchImpl } : {}), [fetchImpl])
  const [displayName, setDisplayName] = useState(me.displayName)
  const [handle, setHandle] = useState(() => suggestHandle(me))
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const local = handleProblem(handle)

  useEffect(() => {
    if (local) {
      setAvailable(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      callApi(ROUTES.handleAvailable, { params: { handle: handle.trim().replace(/^@/, '').toLowerCase() } }, opts)
        .then((r) => live && setAvailable(r.available || r.handle === me.handle))
        .catch(() => live && setAvailable(null))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [handle, local, opts, me.handle])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) return setError('Pick a display name')
    if (local) return setError(local)
    setBusy(true)
    setError(null)
    try {
      onDone(await callApi(ROUTES.updateMe, { body: { displayName: displayName.trim(), handle: handle.trim() } }, opts))
    } catch (err) {
      setError(err instanceof ApiCallError && err.code === 'handle_taken' ? 'That handle is taken. Try another.' : err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form data-testid="mobile-onboarding" onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="font-display text-2xl">Pick your public name</h1>
      <p className="text-sm text-ink-soft">Reviews you make public show this name and @handle. Your email is never shown.</p>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Display name</span>
        <input data-testid="onboarding-name" className="w-full rounded-xl border border-panel-edge bg-white px-3 py-3 text-base" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">@handle</span>
        <input
          data-testid="onboarding-handle"
          className="w-full rounded-xl border border-panel-edge bg-white px-3 py-3 text-base"
          value={handle}
          maxLength={25}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setHandle(e.target.value)}
        />
        <span className="mt-1 block text-sm" data-testid="onboarding-handle-status">
          {local ? <span className="text-bad">{local}</span> : available === false ? <span className="text-bad">Taken</span> : available ? <span className="text-good">Available</span> : null}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button type="submit" data-testid="onboarding-submit" disabled={busy || available === false} className="w-full rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-accent-ink disabled:opacity-60">
        {busy ? 'Saving...' : 'Continue'}
      </button>
    </form>
  )
}
