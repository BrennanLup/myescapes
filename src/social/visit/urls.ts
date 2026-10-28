/**
 * Addresses of friends' rooms (Phase 3, workstream C). Tiny and dependency-free, so light pages
 * (settings) can link into a room without loading the room's store.
 */
const HOME_PREFIX = '/home/'

/** The @handle in a `/home/:handle` path, else null. */
export function visitHandleFromPath(pathname: string): string | null {
  if (!pathname.startsWith(HOME_PREFIX)) return null
  const rest = pathname.slice(HOME_PREFIX.length).replace(/\/+$/, '')
  if (!rest || rest.includes('/')) return null
  let handle: string
  try {
    handle = decodeURIComponent(rest)
  } catch {
    return null
  }
  handle = handle.replace(/^@/, '').trim().toLowerCase()
  return handle && handle.length <= 40 ? handle : null
}

/** Where a friend's room lives. `autostart` skips the room's "Enter" button. */
export function visitUrl(handle: string, opts: { autostart?: boolean } = {}): string {
  return `${HOME_PREFIX}${encodeURIComponent(handle)}${opts.autostart ? '?autostart=1' : ''}`
}

/** Back to your own room (phones land on /m as usual). */
export function homeUrl(): string {
  return '/?autostart=1'
}

/** Full page load (tests replace it). */
export const pageNav = {
  go(url: string) {
    window.location.assign(url)
  },
}
