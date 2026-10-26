/**
 * Client auth (workstream 3): session state, Google sign-in, sign-out, handle onboarding.
 *
 *   const session = useSession()            // loading | signed-out | signed-in (with Me)
 *   await signInWithGoogle('/')             // full-page redirect to Google
 *   await signOut()
 *   needsOnboarding(session)                // signed in without a display name + @handle
 *   <OnboardingGate>{app}</OnboardingGate>  // shows the name/handle step first when needed
 */
export { checkHandle, clearLocalAccountData, deleteAccount, EXPORT_URL, needsOnboarding, signInWithGoogle, signOut, updateProfile } from './api'
export { getSessionState, refreshSession, setSessionUser, useSession, type SessionState } from './session'
export { localHandleProblem, normaliseHandle, suggestHandle } from './handles'
export { Onboarding, OnboardingGate } from './Onboarding'
