/** Placeholder page for routes whose workstream hasn't landed yet. Owned by foundation. Light, no three.js. */
import type { ReactNode } from 'react'

export function Placeholder({ title, ws, children }: { title: string; ws: number; children?: ReactNode }) {
  return (
    <main data-testid="placeholder-page" data-workstream={ws} className="min-h-screen bg-panel px-4 py-10 text-ink">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-2xl">{title}</h1>
        <p className="mt-2 opacity-80">Coming soon.</p>
        {children}
        <nav className="mt-8 flex gap-4 text-sm underline opacity-80">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </div>
    </main>
  )
}
