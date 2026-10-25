import { useEffect } from 'react'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { parseGateUrl, readLastSolved, shouldAutoOpen, todayKey } from './daily'
import { installGateTestHook, useGateSession } from './session'

/** Module-level guard so React StrictMode's double effects never open the gate twice. */
let autoOpenFired = false

/** Test helper. */
export function resetAutoOpenGuard() {
  autoOpenFired = false
}

/**
 * Decides once per page load whether to open the daily gate, given the URL and storage.
 * Returns true when it emitted `gate:open`.
 */
export function maybeAutoOpenGate(search: string, now: Date = new Date()): boolean {
  if (autoOpenFired) return false
  autoOpenFired = true
  const { mode } = parseGateUrl(search)
  if (!shouldAutoOpen({ mode, lastSolved: readLastSolved(), today: todayKey(now) })) return false
  useGateSession.getState().requestPlay()
  bus.emit('gate:open')
  return true
}

/** Opens the gate overlay once per day on first visit. Called from App. */
export function useGateAutoOpen() {
  const dataStatus = useStore((s) => s.dataStatus)
  const worldReady = useStore((s) => s.worldReady)

  useEffect(() => {
    installGateTestHook()
  }, [])

  useEffect(() => {
    if (dataStatus !== 'ready' || !worldReady) return
    maybeAutoOpenGate(typeof window !== 'undefined' ? window.location.search : '')
  }, [dataStatus, worldReady])

  // The gate can't be dismissed before it is solved/skipped: if something else
  // closes or replaces the overlay while the gate is locked, reopen it.
  useEffect(
    () =>
      useStore.subscribe((st, prev) => {
        if (prev.overlay?.kind === 'gate' && st.overlay?.kind !== 'gate' && useGateSession.getState().locked) {
          setTimeout(() => {
            if (useGateSession.getState().locked && useStore.getState().overlay?.kind !== 'gate') bus.emit('gate:open')
          }, 0)
        }
      }),
    [],
  )
}
