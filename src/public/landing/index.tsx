/**
 * Landing page and sign-in screen (workstream 19). Links /about, /privacy, /terms. STUB.
 */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function Landing(_props: Partial<RouteProps>) {
  return <Placeholder title="My Escapes" ws={19} />
}

export function SignInScreen() {
  return <Placeholder title="Sign in" ws={19} />
}
