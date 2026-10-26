/**
 * Layout for the public pages: a light, scrollable page with a header and a footer that links the
 * static pages (/about, /privacy, /terms). No three.js.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from '../../router'

export function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4">
      <Link to="/" className="flex items-center gap-2 font-display text-xl font-semibold text-[#fff7ec] no-underline">
        <img src="/favicon.svg" alt="" width={32} height={32} />
        My Escapes
      </Link>
      <nav aria-label="Site" className="ml-auto flex gap-4 text-sm font-semibold">
        <Link to="/daily" className="text-[#fbeedd] no-underline hover:text-[#ffb067]">
          Escape of the Day
        </Link>
        <a href="/about" className="text-[#fbeedd] no-underline hover:text-[#ffb067]">
          About
        </a>
      </nav>
    </header>
  )
}

export function PublicFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mx-auto max-w-4xl px-4 pt-2 pb-10 text-sm text-[#c9b3a3]">
      {children}
      <nav aria-label="Legal" className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <span>© 2026 My Escapes</span>
        <a href="/about" className="text-[#fbeedd]">
          About
        </a>
        <a href="/privacy" className="text-[#fbeedd]">
          Privacy policy
        </a>
        <a href="/terms" className="text-[#fbeedd]">
          Terms of service
        </a>
      </nav>
    </footer>
  )
}

/** A full public page: plum-to-night backdrop, header, a cream card for the content, footer. */
export function PublicPage({ children, footer, testId }: { children: ReactNode; footer?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="min-h-full overflow-x-hidden bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_420px)] bg-no-repeat">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 pb-8">{children}</main>
      <PublicFooter>{footer}</PublicFooter>
    </div>
  )
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`rounded-[var(--radius-cozy)] bg-panel p-5 text-ink shadow-[var(--shadow-cozy)] sm:p-7 ${className}`} {...rest}>
      {children}
    </section>
  )
}

/** Loading, not-found and error states, shared by the game, venue and city pages. */
export function PageStatus({ kind, what, message, onRetry }: { kind: 'loading' | 'not-found' | 'error'; what: string; message?: string; onRetry?: () => void }) {
  if (kind === 'loading') {
    return (
      <Card aria-busy="true" data-testid="public-loading">
        <div className="h-7 w-2/3 animate-pulse rounded bg-[var(--color-panel-edge)]" />
        <div className="mt-4 h-4 w-1/2 animate-pulse rounded bg-[var(--color-panel-edge)]" />
        <span className="sr-only">Loading {what}…</span>
      </Card>
    )
  }
  if (kind === 'not-found') {
    return (
      <Card data-testid="public-not-found">
        <h1 className="font-display text-2xl font-semibold">We couldn't find that {what}</h1>
        <p className="mt-2 text-ink-soft">It may have moved, closed, or been hidden. Try the search in the app, or head back home.</p>
        <p className="mt-4">
          <Link to="/" className="font-semibold text-[#b9561f]">
            Go to My Escapes
          </Link>
        </p>
      </Card>
    )
  }
  return (
    <Card role="alert" data-testid="public-error">
      <h1 className="font-display text-2xl font-semibold">This {what} didn't load</h1>
      <p className="mt-2 text-ink-soft">{message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-full bg-accent px-5 py-2 font-display font-semibold text-accent-ink">
          Try again
        </button>
      )}
    </Card>
  )
}
