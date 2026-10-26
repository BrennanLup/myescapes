/**
 * Keeps the 3D room in step with the signed-in user's data (workstream 20).
 *
 * - Loads the room's data once (the loading screen shows progress and errors).
 * - Signed in: re-fetches quietly when the tab comes back into view (for example after
 *   logging a room on the phone), at most every `REFRESH_MIN_MS`.
 * - Rooms that arrived since the last visit fly onto the board one by one, once the player
 *   is in the room and no overlay covers it.
 *
 * Installed once by src/desktop.tsx. Returns an uninstall function (tests).
 */
import { useStore } from './store'

export const REFRESH_MIN_MS = 15_000
/** Wait after the world opens before the first arrival, and between arrivals. */
export const ARRIVAL_DELAY_MS = 900
export const ARRIVAL_GAP_MS = 2200

export interface RoomSyncOptions {
  /** Skip the initial load (tests). */
  load?: boolean
  now?: () => number
}

export function installRoomSync(opts: RoomSyncOptions = {}): () => void {
  const now = opts.now ?? (() => Date.now())
  const s = () => useStore.getState()
  if (opts.load !== false) void s().loadData()

  let lastRefresh = now()
  const maybeRefresh = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const st = s()
    if (st.dataSource !== 'postgres' || st.dataStatus !== 'ready') return
    if (now() - lastRefresh < REFRESH_MIN_MS) return
    lastRefresh = now()
    void st.refreshData()
  }
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) {
    window.addEventListener('focus', maybeRefresh)
    document.addEventListener('visibilitychange', maybeRefresh)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const canPlay = () => {
    const st = s()
    return st.worldReady && st.overlay === null && st.pendingArrivals.length > 0
  }
  const schedule = (delay: number) => {
    if (timer || !canPlay()) return
    timer = setTimeout(() => {
      timer = null
      if (!canPlay()) return
      s().takeArrival()
      schedule(ARRIVAL_GAP_MS)
    }, delay)
  }
  const unsub = useStore.subscribe((st, prev) => {
    if (st.worldReady !== prev.worldReady || st.overlay !== prev.overlay || st.pendingArrivals !== prev.pendingArrivals) {
      schedule(ARRIVAL_DELAY_MS)
    }
  })
  schedule(ARRIVAL_DELAY_MS)

  return () => {
    unsub()
    if (timer) clearTimeout(timer)
    if (hasWindow) {
      window.removeEventListener('focus', maybeRefresh)
      document.removeEventListener('visibilitychange', maybeRefresh)
    }
  }
}
