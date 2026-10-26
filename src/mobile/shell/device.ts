/**
 * Device redirect for workstream 13. Kept tiny: the router imports it eagerly on every page.
 * STUB: never redirects. Implement: phones opening `/` go to `/m` (coarse pointer + small screen,
 * or a mobile UA), unless the user chose "View on desktop" (remember it in localStorage).
 */
export function shouldRedirectToMobile(_location: Pick<Location, 'pathname' | 'search'>, _navigator: Pick<Navigator, 'userAgent'>): boolean {
  return false
}
