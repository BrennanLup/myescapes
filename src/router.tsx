/**
 * A small client router. Owned by foundation. Every page except the 3D room is lazy-loaded, and
 * the 3D room itself is lazy too, so /m and the public pages never download three.js.
 *
 * Routes (see `ROUTE_TABLE`):
 *   /                 3D room (desktop). Phones are sent to /m by `shouldRedirectToMobile` (13).
 *   /m, /m/*          mobile app (13; subroutes handled inside the shell)
 *   /games/:slug      public game page (16)
 *   /venues/:slug     public venue page (17)
 *   /cities/:slug     public city page (17)
 *   /daily            Escape of the Day (22)
 *   /settings         account settings: name, handle, export, delete (35)
 *   /invite/:code     invite landing (35)
 *   /welcome          landing + sign-in (19)
 * Static pages /about, /privacy, /terms are served by the server (public/*.html), not here.
 *
 * Navigation: `navigate('/games/x')`, `<Link to="/daily">`, `useRoute()`.
 */
import { lazy, Suspense, useSyncExternalStore, type AnchorHTMLAttributes, type ComponentType, type LazyExoticComponent, type MouseEvent, type ReactNode } from 'react'
import { shouldRedirectToMobile } from './mobile/shell/device'

export interface RouteProps {
  params: Record<string, string>
  /** For prefix routes (`/m/*`): the rest of the path after the prefix, e.g. `/log`. */
  rest: string
}

type Page = LazyExoticComponent<ComponentType<RouteProps>>

const page = <M,>(load: () => Promise<M>, pick: (m: M) => ComponentType<RouteProps>): Page =>
  lazy(async () => ({ default: pick(await load()) }))

export interface RouteEntry {
  pattern: string
  /** Match `pattern` and anything under it (`/m` matches `/m/log`). */
  prefix?: boolean
  page: Page
}

export const ROUTE_TABLE: RouteEntry[] = [
  { pattern: '/', page: page(() => import('./desktop'), (m) => m.DesktopApp) },
  { pattern: '/m', prefix: true, page: page(() => import('./mobile/shell'), (m) => m.MobileApp) },
  { pattern: '/games/:slug', page: page(() => import('./public/game'), (m) => m.GamePage) },
  { pattern: '/venues/:slug', page: page(() => import('./public/venue'), (m) => m.VenuePage) },
  { pattern: '/cities/:slug', page: page(() => import('./public/city'), (m) => m.CityPage) },
  { pattern: '/daily', page: page(() => import('./daily/ui'), (m) => m.DailyPage) },
  { pattern: '/settings', page: page(() => import('./social/settings'), (m) => m.SettingsPage) },
  { pattern: '/invite/:code', page: page(() => import('./social'), (m) => m.InvitePage) },
  { pattern: '/welcome', page: page(() => import('./public/landing'), (m) => m.Landing) },
]

const NotFound: Page = page(() => import('./pages/NotFound'), (m) => m.NotFound)

/** Match a path against a pattern. Returns params, or null. */
export function matchPath(pattern: string, pathname: string, prefix = false): RouteProps | null {
  const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  const pp = clean(pattern).split('/')
  const ps = clean(pathname).split('/')
  if (prefix ? ps.length < pp.length : ps.length !== pp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      if (!ps[i]) return null
      try {
        params[pp[i].slice(1)] = decodeURIComponent(ps[i])
      } catch {
        return null
      }
    } else if (pp[i] !== ps[i]) return null
  }
  const rest = prefix ? '/' + ps.slice(pp.length).join('/') : '/'
  return { params, rest: rest === '/' ? '/' : rest.replace(/\/+$/, '') }
}

export function resolveRoute(pathname: string): { entry: RouteEntry | null; props: RouteProps } {
  for (const entry of ROUTE_TABLE) {
    const m = matchPath(entry.pattern, pathname, entry.prefix)
    if (m) return { entry, props: m }
  }
  return { entry: null, props: { params: {}, rest: '/' } }
}

// --- location store -------------------------------------------------------

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getPath = () => (typeof window === 'undefined' ? '/' : window.location.pathname)

/** Client-side navigation. Full page loads still work for every route (the server serves index.html). */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  emit()
  window.scrollTo?.(0, 0)
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/')
}

export function useRoute(): RouteProps & { pathname: string } {
  const pathname = usePathname()
  return { ...resolveRoute(pathname).props, pathname }
}

/** An <a> that navigates client-side for same-origin, unmodified left clicks. */
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} {...rest} onClick={onClick}>
      {children}
    </a>
  )
}

function PageFallback() {
  return <div data-testid="page-loading" className="fixed inset-0 bg-[var(--color-night)]" />
}

export function Router() {
  const pathname = usePathname()
  if (pathname === '/' && typeof window !== 'undefined' && shouldRedirectToMobile(window.location, window.navigator)) {
    queueMicrotask(() => navigate('/m', { replace: true }))
    return <PageFallback />
  }
  const { entry, props } = resolveRoute(pathname)
  const Page = entry?.page ?? NotFound
  return (
    <Suspense fallback={<PageFallback />}>
      <Page {...props} />
    </Suspense>
  )
}
