/**
 * The boot splash: the door logo, "My Escapes" and a CSS-only shimmer on the night gradient.
 *
 * `index.html` paints the same markup inside `#root` before any JavaScript runs, so a full page
 * load (visiting a friend, Back to my room, walking home from the puzzle room) never shows a
 * blank screen. React replaces it on its first render with this component, used by every
 * "page is still loading" fallback, until the room's own `LoadingScreen` takes over.
 *
 * The styles (`.boot-*`) live in the inline `<style>` of `index.html`, so they apply before the
 * bundle loads; keep the two in sync. No imports: the router imports this file directly.
 */

/** One shimmer pass, in ms (`.boot-shimmer` in index.html). */
export const BOOT_SHIMMER_MS = 1400

/** Negative delay that keeps the shimmer in step with the one index.html started at page load. */
export function shimmerDelay(now: number): string {
  return `-${Math.round(((now % BOOT_SHIMMER_MS) + BOOT_SHIMMER_MS) % BOOT_SHIMMER_MS)}ms`
}

/** "Heading to Vera's room…": first name of a display name, or the @handle when the name is unknown. */
export function headingToRoom(owner: { displayName?: string | null; handle?: string | null } | null | undefined): string | null {
  const first = owner?.displayName?.trim().split(/\s+/)[0]
  if (first) return `Heading to ${first}'s room…`
  const handle = owner?.handle?.trim()
  return handle ? `Heading to @${handle}'s room…` : null
}

export function BootSplash({ label, testId = 'page-loading' }: { label?: string; testId?: string }) {
  const delay = shimmerDelay(typeof performance === 'undefined' ? 0 : performance.now())
  return (
    <div className="boot-splash" data-testid={testId} role="status" aria-label={label ?? 'Loading My Escapes'}>
      <BootLogo />
      <p className="boot-name" aria-hidden="true">
        My Escapes
      </p>
      <div className="boot-track" aria-hidden="true">
        <span className="boot-shimmer" style={{ animationDelay: delay }} />
      </div>
      <p className="boot-label" aria-hidden="true">
        {label ?? ''}
      </p>
    </div>
  )
}

/** The app icon's door (public/favicon.svg), inline so it needs no request. */
function BootLogo() {
  return (
    <svg className="boot-logo" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#4a2f48" />
      <path d="M132 432V214a124 124 0 0 1 248 0v218z" fill="#c69a63" />
      <path d="M158 432V214a98 98 0 0 1 196 0v218z" fill="#e8843f" />
      <circle cx="256" cy="268" r="30" fill="#2a1f2d" />
      <path d="M243 286h26l13 70h-52z" fill="#2a1f2d" />
      <rect x="112" y="428" width="288" height="18" rx="9" fill="#e8c9a4" />
      <circle cx="256" cy="72" r="14" fill="#2de2d0" />
    </svg>
  )
}
