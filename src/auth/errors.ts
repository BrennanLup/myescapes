/**
 * Google sign-in failures. A separate module (no imports) so the landing page and the phone app
 * can show the message without pulling in the rest of the auth client.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again whenever you like.',
  default: "Sign-in didn't work. Please try again.",
}

/** Friendly text for the `?error=` code Better Auth appends when Google sign-in fails. */
export function signInErrorMessage(code: string | null): string | null {
  if (!code) return null
  return SIGN_IN_ERRORS[code] ?? SIGN_IN_ERRORS.default
}

/**
 * Where a failed sign-in lands: the phone app's own sign-in screen for /m, otherwise /welcome,
 * which shows the error and keeps where the visitor was heading (`next`) for the retry.
 */
export function signInErrorURL(callbackURL: string): string {
  if (callbackURL === '/m' || callbackURL.startsWith('/m/') || callbackURL.startsWith('/m?')) return '/m?signin=failed'
  return callbackURL === '/' ? '/welcome?signin=failed' : `/welcome?signin=failed&next=${encodeURIComponent(callbackURL)}`
}
