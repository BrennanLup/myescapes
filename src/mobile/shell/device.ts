/**
 * Device redirect (workstream 13). Kept tiny and dependency-free: the router imports it eagerly
 * on every page.
 *
 * Phones opening `/` go to `/m`, unless the person chose "View on desktop" (remembered in
 * localStorage). A phone is a mobile user agent (iPhone, Android phone, "Mobi"), or a coarse
 * pointer on a small screen. iPads and Android tablets keep the 3D room.
 *
 * Overrides in the URL: `/?desktop=1` remembers "View on desktop" and stays; `/?mobile=1` forgets it.
 */

export const VIEW_PREF_KEY = 'myescapes:view'

const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobi/i

type MatchMediaFn = (query: string) => { matches: boolean }

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Remember (or forget) that this browser prefers the desktop 3D room. */
export function setDesktopPreference(on: boolean): void {
  try {
    const s = storage()
    if (!s) return
    if (on) s.setItem(VIEW_PREF_KEY, 'desktop')
    else s.removeItem(VIEW_PREF_KEY)
  } catch {
    /* private mode or blocked storage: the choice just isn't remembered */
  }
}

export function prefersDesktop(): boolean {
  try {
    return storage()?.getItem(VIEW_PREF_KEY) === 'desktop'
  } catch {
    return false
  }
}

/** True for phones (not tablets or desktops). */
export function isPhone(nav: Pick<Navigator, 'userAgent'>, matchMedia: MatchMediaFn | undefined = typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined): boolean {
  if (PHONE_UA.test(nav.userAgent ?? '')) return true
  if (!matchMedia) return false
  try {
    return matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 600px), (max-height: 500px)').matches
  } catch {
    return false
  }
}

export function shouldRedirectToMobile(
  location: Pick<Location, 'pathname' | 'search'>,
  navigator: Pick<Navigator, 'userAgent'>,
  matchMedia?: MatchMediaFn,
): boolean {
  const q = new URLSearchParams(location.search ?? '')
  if (q.get('desktop') === '1') {
    setDesktopPreference(true)
    return false
  }
  if (q.get('mobile') === '1') setDesktopPreference(false)
  if (location.pathname !== '/' && location.pathname !== '') return false
  if (prefersDesktop()) return false
  return matchMedia ? isPhone(navigator, matchMedia) : isPhone(navigator)
}

/** Where "View on desktop" goes: the 3D room, remembering the choice. */
export const DESKTOP_URL = '/?desktop=1'

/** The manifest the browser should install on this page: phones get one that starts at /m. */
export const MOBILE_MANIFEST = '/manifest-mobile.webmanifest'
export const DEFAULT_MANIFEST = '/manifest.webmanifest'

/** Point `<link rel="manifest">` at the mobile manifest (start_url /m) while the mobile app is shown. */
export function applyMobileManifest(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): () => void {
  if (!doc) return () => {}
  let link = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const created = !link
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'manifest'
    doc.head.appendChild(link)
  }
  const before = link.getAttribute('href')
  link.setAttribute('href', MOBILE_MANIFEST)
  const el = link
  return () => {
    if (created) el.remove()
    else el.setAttribute('href', before ?? DEFAULT_MANIFEST)
  }
}
