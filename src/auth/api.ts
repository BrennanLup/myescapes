/**
 * Client auth calls (workstream 3). Re-exported from `src/auth/index.ts`.
 */
import type { Me } from '../contracts/models'
import { callApi, ROUTES } from '../contracts/routes'
import { clearRecordingQueue } from '../mobile/log/queue'
import { setSessionUser, type SessionState } from './session'

/**
 * Remove what this account left on the device: the phone's recording queue (audio and
 * transcripts in IndexedDB). Never throws; IndexedDB may be unavailable (old private mode).
 */
export async function clearLocalAccountData(): Promise<void> {
  try {
    await clearRecordingQueue()
  } catch {
    /* nothing stored on this device */
  }
}

/** Signed in, but no public name yet: show onboarding before anything can be public. */
export function needsOnboarding(s: SessionState): boolean {
  return s.status === 'signed-in' && !s.user.onboarded
}

/** Starts Google sign-in (Better Auth `/api/auth/sign-in/social`), returning to `callbackURL`. */
export async function signInWithGoogle(callbackURL = '/', fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ provider: 'google', callbackURL, errorCallbackURL: '/welcome?signin=failed' }),
  })
  if (!res.ok) throw new Error(res.status === 404 ? 'Sign-in is not set up on this server yet.' : 'Could not start sign-in. Please try again.')
  const body = (await res.json()) as { url?: string }
  if (!body.url) throw new Error('Could not start sign-in. Please try again.')
  window.location.assign(body.url)
}

/** Ends the session and clears this account's data from the device (the recording queue). */
export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: '{}' })
  } finally {
    await clearLocalAccountData()
    setSessionUser(null)
  }
}

/** Save display name and/or handle; updates the session. Throws ApiCallError (409 handle_taken...). */
export async function updateProfile(input: { displayName?: string; handle?: string }, fetchImpl?: typeof fetch): Promise<Me> {
  const me = await callApi(ROUTES.updateMe, { body: input }, { fetch: fetchImpl })
  setSessionUser(me)
  return me
}

export async function checkHandle(handle: string, fetchImpl?: typeof fetch) {
  return callApi(ROUTES.handleAvailable, { params: { handle } }, { fetch: fetchImpl })
}

/** Delete my account (the privacy policy's promise). Signs out locally too. */
export async function deleteAccount(fetchImpl?: typeof fetch): Promise<void> {
  await callApi(ROUTES.deleteMe, { body: { confirm: 'DELETE' } }, { fetch: fetchImpl })
  await clearLocalAccountData()
  setSessionUser(null)
}

/** URL of the JSON export (a plain link downloads it, cookies included). */
export const EXPORT_URL = ROUTES.exportMe.path
