/**
 * Spoiler reveal. Hidden content is not rendered at all until revealed (not just blurred), so it
 * can't be read by selecting text, by a screen reader, or by a search engine snapshot.
 */
import { useId, useState, type ReactNode } from 'react'

export function SpoilerReveal({
  children,
  label = 'Show spoilers',
  hint = 'Contains spoilers',
  testId,
  defaultRevealed = false,
}: {
  children: ReactNode
  label?: string
  hint?: string
  testId?: string
  defaultRevealed?: boolean
}) {
  const [revealed, setRevealed] = useState(defaultRevealed)
  const id = useId()
  if (revealed) {
    return (
      <div data-testid={testId} data-revealed="true" id={id}>
        {children}
        <button type="button" onClick={() => setRevealed(false)} className="mt-2 text-xs font-semibold text-ink-soft underline">
          Hide spoilers
        </button>
      </div>
    )
  }
  return (
    <div data-testid={testId} data-revealed="false" className="relative overflow-hidden rounded-xl border border-dashed border-panel-edge bg-paper px-4 py-3">
      <div aria-hidden="true" className="pointer-events-none select-none space-y-2 blur-[3px]">
        <div className="h-3 w-11/12 rounded bg-[var(--color-panel-edge)]" />
        <div className="h-3 w-3/4 rounded bg-[var(--color-panel-edge)]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-3 bg-paper/60">
        <span className="text-sm text-ink-soft">{hint}</span>
        <button
          type="button"
          aria-controls={id}
          aria-expanded="false"
          onClick={() => setRevealed(true)}
          className="rounded-full bg-plum px-3 py-1 text-sm font-semibold text-white"
        >
          {label}
        </button>
      </div>
    </div>
  )
}
