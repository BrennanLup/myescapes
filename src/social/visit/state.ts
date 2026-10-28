/**
 * Visiting a friend's room (Phase 3, workstream C): `/home/:handle` shows their room, read-only,
 * with the data from `GET /api/homes/:handle`. No three.js: the route checks access with it before
 * the 3D room loads.
 *
 * Moving between rooms is a full page load (`visitUrl`, `homeUrl`), so the 3D room boots once
 * per page with the right data, socket home and read-only rules (see src/desktop.tsx).
 */
import { ApiCallError } from '@/contracts/errors'
import type { HomeView } from '@/contracts/realtime'
import { callApi, ROUTES } from '@/contracts/routes'
import { setDataLoader, useStore } from '@/state/store'

export { homeUrl, pageNav, visitHandleFromPath, visitUrl } from './urls'

export type VisitProblem = 'not_found' | 'forbidden' | 'signed_out' | 'unavailable'

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
}
