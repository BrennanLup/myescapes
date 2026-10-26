/**
 * Account settings /settings (workstream 35): display name and @handle, friends and auto-accept,
 * download my data (ROUTES.exportMe), delete my account (ROUTES.deleteMe), links to /about,
 * /privacy, /terms. STUB.
 */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function SettingsPage(_props: Partial<RouteProps>) {
  return <Placeholder title="Settings" ws={35} />
}
