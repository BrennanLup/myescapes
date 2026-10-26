/**
 * Escape of the Day in the 3D room (workstream 22): the south-wall door opens this overlay
 * (overlay kind `gate`, event `gate:open`). Unlike the Phase 1 gate it never blocks entry: it
 * never opens on its own, and Esc, the close button or a click outside closes it at any time.
 * Solving today's puzzle swings the door open (the Phase 1 door reads `useGateSession`).
 */
import { useCallback, useEffect } from 'react'
import { bus } from '../../contracts/events'
import { todayKey, writeLastSolved } from '../../gate/daily'
import { useGateSession } from '../../gate/session'
import { useStore } from '../../state/store'
import { DailyGame } from './DailyGame'

/** Marks today's door as solved, so it swings open in the room. */
export function markDoorSolved(now: Date = new Date()) {
  writeLastSolved(todayKey(now))
  useGateSession.setState({ solvedToday: true, locked: false })
}

export function DailyOverlay() {
  const close = useCallback(() => {
    if (useStore.getState().overlay?.kind === 'gate') useStore.getState().closeOverlay()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const onSolved = useCallback((fresh: boolean) => {
    markDoorSolved()
    if (fresh) bus.emit('sfx', { name: 'unlock' })
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-backdrop font-body text-ink sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        data-testid="daily-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Escape of the Day"
        className="relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-cozy bg-panel shadow-cozy ring-1 ring-panel-edge sm:rounded-cozy"
      >
        <button
          type="button"
          aria-label="Close Escape of the Day"
          data-testid="daily-close"
          onClick={close}
          className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-ink-soft transition hover:bg-[rgba(224,123,57,.12)] hover:text-ink"
        >
          ×
        </button>
        <div className="overflow-y-auto px-4 py-5 sm:px-7" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
          <DailyGame compact onSolved={onSolved} />
        </div>
      </div>
    </div>
  )
}
