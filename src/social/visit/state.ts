/**
 * Visiting a friend's room (Phase 3, workstream C): `/home/:handle` shows their room, read-only,
 * with the data from `GET /api/homes/:handle`. No three.js: the route checks access with it before
 * the 3D room loads.
 *
 * Moving between rooms is a full page load (`visitUrl`, `homeUrl`), so the 3D room boots once
 * per page with the right data, socket home and read-only rules (see src/desktop.tsx).
 */
import { create } from 'zustand'
import { ApiCallError } from '@/contracts/errors'
import type { HomeView } from '@/contracts/realtime'
import { callApi, ROUTES } from '@/contracts/routes'
import { runtime } from '@/contracts/runtime'
import { ANCHORS } from '@/contracts/scene'
import { setDataLoader, useStore } from '@/state/store'

export { homeUrl, pageNav, visitHandleFromPath, visitUrl } from './urls'

export type VisitProblem = 'not_found' | 'forbidden' | 'signed_out' | 'unavailable' | 'removed' | 'kicked'

/** What went wrong opening someone's room, in words for the visitor. */
export function visitProblem(err: unknown): VisitProblem {
  if (err instanceof ApiCallError) {
    if (err.status === 404) return 'not_found'
    if (err.status === 403) return 'forbidden'
    if (err.status === 401) return 'signed_out'
  }
  return 'unavailable'
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

let spoilers = false
let preloaded: { handle: string; promise: Promise<HomeView> } | null = null

export function loadHome(handle: string, opts: { spoilers?: boolean } = {}): Promise<HomeView> {
  return callApi(ROUTES.home, { params: { handle }, query: opts.spoilers ? { spoilers: '1' } : {} })
}

/** Fetch a room ahead (the route checks access first); the 3D room's first load reuses it. */
export function preloadHome(handle: string): Promise<HomeView> {
  if (preloaded?.handle !== handle) {
    const entry = { handle, promise: loadHome(handle) }
    preloaded = entry
    // Don't keep a failure: "Try again" must reach the network.
    entry.promise.catch(() => {
      if (preloaded === entry) preloaded = null
    })
  }
  return preloaded.promise
}

/** Where a visitor starts: 1.3 m left of and a little behind the usual spawn, clear of furniture. */
export const VISITOR_SPAWN: [number, number, number] = [ANCHORS.spawn.position[0] - 1.3, ANCHORS.spawn.position[1], ANCHORS.spawn.position[2] + 0.5]

/** The handle the 3D room was booted with on this page (null: your own room). Set once. */
let booted: { handle: string | null } | null = null

export function bootedVisit(): { handle: string | null } | null {
  return booted
}

/** Remembers that the 3D room booted for `handle` (or your own room). */
export function markBooted(handle: string | null): void {
  booted = { handle }
}

/**
 * Turn the 3D room into `handle`'s room, read-only: its data comes from their home, and the
 * store refuses edits (src/state/store.ts `visiting`). Called once by src/desktop.tsx.
 */
export function installVisit(handle: string): void {
  useStore.setState({ visiting: { handle, owner: null } })
  // Not on the owner's usual spot (they are often standing there): a step to the side, facing the board.
  runtime.player.position = [...VISITOR_SPAWN]
  runtime.player.yaw = ANCHORS.spawn.rotationY
  setDataLoader(async () => {
    let view: HomeView
    if (preloaded?.handle === handle && !spoilers) {
      const p = preloaded.promise
      preloaded = null
      view = await p.catch(() => loadHome(handle, { spoilers }))
    } else {
      view = await loadHome(handle, { spoilers })
    }
    useStore.setState({ visiting: { handle: view.owner.handle ?? handle, owner: view.owner } })
    return view.dataset
  })
}

// ---------------------------------------------------------------------------
// The visit ending while you are inside (unfriended, blocked, asked to leave)
// ---------------------------------------------------------------------------

/** Why this page's visit ended while the room was open; `/home/:handle` then shows the error page. */
export interface VisitEnded {
  problem: Extract<VisitProblem, 'removed' | 'kicked'>
  /** Whose room it was (their display name), when known. */
  ownerName: string | null
  /** How long until you may come back in (asked to leave), when the server said. */
  retryAfterMs: number | null
}

export const useVisitEnded = create<{ ended: VisitEnded | null }>(() => ({ ended: null }))

/**
 * The friend's room is closed to you now: show the error page instead of the room and forget
 * their data, so nothing of it stays explorable or is fetched again. Only while visiting.
 */
export function endVisit(ended: VisitEnded): void {
  const st = useStore.getState()
  if (!st.visiting || useVisitEnded.getState().ended) return
  // First the page (HomeVisitPage swaps the 3D room out), then the data it showed.
  useVisitEnded.setState({ ended })
  preloaded = null
  setDataLoader(() => Promise.reject(new Error("This room isn't open to you any more.")))
  useStore.setState({
    rooms: [],
    reviews: [],
    wishlist: [],
    crew: [],
    logRows: null,
    crewIndex: {},
    pendingArrivals: [],
    boardPins: [],
    overlay: null,
    hoveredId: null,
    dataStatus: 'idle',
  })
  try {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock()
  } catch {
    /* not locked */
  }
}

export function spoilersShown(): boolean {
  return spoilers
}

/** Show or hide spoiler text in the friend's room (reloads their data quietly). */
export async function setSpoilersShown(on: boolean): Promise<void> {
  if (spoilers === on) return
  spoilers = on
  await useStore.getState().refreshData()
}

/** Tests. */
export function resetVisitForTests(): void {
  spoilers = false
  preloaded = null
  booted = null
  setDataLoader(null)
  useVisitEnded.setState({ ended: null })
}
