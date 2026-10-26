/**
 * Small shared React pieces for the friends UI, settings and the mobile rooms table:
 * a loader hook, buttons, cards and status lines. Light: no three.js, no heavy deps.
 */
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { errorText } from './client'

export type Load<T> = { status: 'loading'; data: null; error: null } | { status: 'ready'; data: T; error: null } | { status: 'error'; data: null; error: unknown }

/** Run `loader` on mount and when `deps` change; `reload()` runs it again without a loading flash. */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Load<T> & { reload(): void } {
  const [state, setState] = useState<Load<T>>({ status: 'loading', data: null, error: null })
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  useEffect(() => {
    const ac = new AbortController()
    loaderRef
      .current(ac.signal)
      .then((data) => !ac.signal.aborted && setState({ status: 'ready', data, error: null }))
      .catch((error) => !ac.signal.aborted && setState({ status: 'error', data: null, error }))
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

/** Run an action with a busy flag and an error line. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(errorText(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, run, setError }
}

type Tone = 'primary' | 'quiet' | 'danger'
const TONES: Record<Tone, string> = {
  primary: 'bg-accent text-accent-ink shadow-sm active:brightness-95',
  quiet: 'bg-white/70 text-ink ring-1 ring-panel-edge active:bg-white',
  danger: 'bg-bad text-white active:brightness-95',
}

export function Button({ tone = 'quiet', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${TONES[tone]} ${className}`}
    />
  )
}

export function Card({ title, children, testId, id, action }: { title?: ReactNode; children: ReactNode; testId?: string; id?: string; action?: ReactNode }) {
  return (
    <section id={id} data-testid={testId} className="rounded-[var(--radius-cozy)] bg-white/60 p-4 ring-1 ring-panel-edge">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function ErrorLine({ error, testId }: { error: unknown; testId?: string }) {
  if (!error) return null
  return (
    <p role="alert" data-testid={testId ?? 'error-line'} className="text-sm text-bad">
      {typeof error === 'string' ? error : errorText(error)}
    </p>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p data-testid="loading" className="text-sm text-ink-soft" aria-live="polite">
      {label}
    </p>
  )
}

export function Avatar({ name, image, size = 32 }: { name: string; image: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  if (image) return <img src={image} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-teal font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials || '?'}
    </span>
  )
}

/** "Mia (@mia)" style label. Never an email. */
export function userLabel(u: { displayName: string; handle: string | null }): string {
  return u.handle ? `${u.displayName} (@${u.handle})` : u.displayName
}

/** Oct 12, 2026. Parses YYYY-MM-DD as a calendar date (no time-zone shift). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
