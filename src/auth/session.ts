/**
 * Client session store (workstream 3). One shared store for the whole app: `GET /api/me` decides
 * signed in or out; components subscribe with `useSession()`.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { ApiCallError } from '../contracts/errors'
import type { Me } from '../contracts/models'
import { callApi, ROUTES } from '../contracts/routes'

export type SessionState = { status: 'loading'; user: null } | { status: 'signed-out'; user: null } | { status: 'signed-in'; user: Me }

let state: SessionState = { status: 'loading', user: null }
let inflight: Promise<SessionState> | null = null
let loadedOnce = false
const listeners = new Set<() => void>()

function set(next: SessionState) {
  state = next
  listeners.forEach((l) => l())
}

export function getSessionState(): SessionState {
  return state
}

/** Set the signed-in user directly (after onboarding saves, for example). */
export function setSessionUser(user: Me | null) {
  loadedOnce = true
  set(user ? { status: 'signed-in', user } : { status: 'signed-out', user: null })
}

/** (Re)load the session from the server. Network errors leave you signed out. */
export function refreshSession(fetchImpl?: typeof fetch): Promise<SessionState> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const user = await callApi(ROUTES.me, {}, { fetch: fetchImpl })
      setSessionUser(user)
    } catch (err) {
      if (!(err instanceof ApiCallError) || err.status !== 401) console.warn('[auth] could not load the session', err)
      setSessionUser(null)
    } finally {
      inflight = null
    }
    return state
  })()
  return inflight
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The current session. Loads it on first use. */
export function useSession(): SessionState {
  const s = useSyncExternalStore(subscribe, getSessionState, getSessionState)
  useEffect(() => {
    if (!loadedOnce && !inflight) void refreshSession()
  }, [])
  return s
}

/** For tests: forget everything. */
export function resetSessionForTests() {
  state = { status: 'loading', user: null }
  inflight = null
  loadedOnce = false
  listeners.clear()
}
