/**
 * Client auth (workstream 3): session state, Google sign-in, sign-out, handle onboarding.
 * STUB: always signed out. Keep these export names.
 */
import type { Me } from '../contracts/models'

export type SessionState = { status: 'loading'; user: null } | { status: 'signed-out'; user: null } | { status: 'signed-in'; user: Me }

export function useSession(): SessionState {
  return { status: 'signed-out', user: null }
}

/** Starts Google sign-in (Better Auth `/api/auth/sign-in/social`), returning to `callbackURL`. */
export async function signInWithGoogle(_callbackURL = '/'): Promise<void> {
  throw new Error('Sign-in is not built yet (workstream 3).')
}

export async function signOut(): Promise<void> {
  /* stub */
}
