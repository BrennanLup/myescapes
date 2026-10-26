/**
 * Tiny data-loading hook for the public pages: loading, ready, not found, or error.
 */
import { useEffect, useState } from 'react'
import { ApiCallError } from '../../contracts/errors'

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

export function toLoadableError(err: unknown): Loadable<never> {
  if (err instanceof ApiCallError && err.status === 404) return { status: 'not-found' }
  if (err instanceof ApiCallError && err.status === 503) return { status: 'error', message: 'The directory is waking up. Try again in a moment.' }
  if (err instanceof ApiCallError && err.body?.error) return { status: 'error', message: err.body.error }
  return { status: 'error', message: 'Something went wrong loading this page.' }
}

/** Runs `load` whenever `key` changes. Results of a stale load are dropped. */
export function useApi<T>(key: string, load: (signal: AbortSignal) => Promise<T>): [Loadable<T>, () => void] {
  const [state, setState] = useState<{ key: string; value: Loadable<T> }>({ key, value: { status: 'loading' } })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let live = true
    load(ctrl.signal).then(
      (data) => live && setState({ key, value: { status: 'ready', data } }),
      (err: unknown) => live && !ctrl.signal.aborted && setState({ key, value: toLoadableError(err) }),
    )
    return () => {
      live = false
      ctrl.abort()
    }
    // `load` is recreated every render; `key` and `attempt` say when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const value: Loadable<T> = state.key === key ? state.value : { status: 'loading' }
  const retry = () => {
    setState({ key, value: { status: 'loading' } })
    setAttempt((n) => n + 1)
  }
  return [value, retry]
}

/** Sets document.title while mounted. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const prev = document.title
    document.title = title
    return () => {
      document.title = prev
    }
  }, [title])
}
