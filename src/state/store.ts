/**
 * The single Zustand store. Reactive app state lives here.
 * Owned by the orchestrator; workstreams read it and call its actions.
 */
import { create } from 'zustand'
import { apiClient, apiErrorStatus } from '@/contracts/api'
import { bus } from '@/contracts/events'
import type { LogRow, PublicUser } from '@/contracts/models'
import { callApi, ROUTES } from '@/contracts/routes'
import type { CrewMember, Dataset, Entry, ReviewDraft, Room, Review, SortKey, WishlistItem } from '@/contracts/types'
import { buildCrewIndex, type BoardSortKey, type CrewIndex } from './crew'
import { MAX_ARRIVALS, newArrivals, readLastSeen, writeLastSeen } from './arrivals'

export { BOARD_SORT_KEYS, BOARD_SORT_LABELS, type BoardSortKey } from './crew'

export type Overlay =
  | { kind: 'review'; roomId: string }
  | { kind: 'record' }
  | { kind: 'confirm'; draft: ReviewDraft }
  | { kind: 'gate' }
  | { kind: 'wishlist' }
  | { kind: 'wrap' }
  | { kind: 'settings' }
  | { kind: 'wardrobe' }

/**
 * A friend's room shown read-only at `/home/:handle` (Phase 3, workstream C; set by
 * src/social/visit). `owner` is filled in once their room has loaded.
 */
export interface Visiting {
  handle: string
  owner: PublicUser | null
}

/** Overlays that would change the room: closed to visitors (logging a room, the wish list). */
export const VISITOR_BLOCKED_OVERLAYS: ReadonlySet<Overlay['kind']> = new Set(['record', 'confirm', 'wishlist'])

/** Where the room's data comes from: your own room, or a friend's while visiting. */
let dataLoader: () => Promise<Dataset> = () => apiClient.getData()

/** Load the room from somewhere else (a friend's home). `null` restores your own room. */
export function setDataLoader(load: (() => Promise<Dataset>) | null) {
  dataLoader = load ?? (() => apiClient.getData())
}

export type QualityPreset = 'low' | 'medium' | 'high'

export interface Settings {
  /** Mouse/touch look sensitivity multiplier, 0.2 - 3. */
  sensitivity: number
  invertY: boolean
  quality: QualityPreset
  headBob: boolean
  /** Master volume 0..1. */
  volume: number
  muted: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  quality: 'medium',
  headBob: false,
  volume: 0.6,
  muted: false,
}

/** One pinned photo's layout slot, published by the board for the string and others. */
export interface BoardPin {
  roomId: string
  /** Group key under the active sort (e.g. city name, genre, "2024", "80-89"). */
  group: string
  /** Order within the whole sorted sequence. */
  order: number
  /** Target pin-head position (world space) after the current layout settles. */
  target: [number, number, number]
}

export interface AppState {
  // data
  rooms: Room[]
  reviews: Review[]
  wishlist: WishlistItem[]
  crew: CrewMember[]
  dataSource: Dataset['source'] | null
  dataStatus: 'idle' | 'loading' | 'ready' | 'error'
  dataError: string | null
  /** roomId of the most recently added entry (board animates it in). */
  lastAddedRoomId: string | null
  /** My rooms from `GET /api/logs` (signed in only; null until loaded or when unavailable). */
  logRows: LogRow[] | null
  /** Crew stickers per review id (= visit id). */
  crewIndex: CrewIndex
  /** Rooms that arrived since the last visit (or from another device) and should fly onto the board. */
  pendingArrivals: string[]
  /** Set while this page shows a friend's room: read-only (no logging, no wish list edits). */
  visiting: Visiting | null

  // world / ui
  /** Last Phase 1 sort key (the HUD chips). The board shows `boardSort`. */
  sort: SortKey
  /** What the board is grouped by: `sort`, or 'crew'. */
  boardSort: BoardSortKey
  overlay: Overlay | null
  hoveredId: string | null
  boardPins: BoardPin[]
  worldReady: boolean
  pointerLocked: boolean
  isTouch: boolean
  settings: Settings

  // actions
  loadData(): Promise<void>
  /** Re-fetch quietly (no loading screen). New rooms fly onto the board. */
  refreshData(): Promise<void>
  /**
   * Fetch `/api/logs` for crew avatars (signed in only). Never throws. With `arrivals`, rooms
   * logged since this browser last opened the room are queued to fly in (initial load only).
   */
  loadCrew(opts?: { arrivals?: boolean }): Promise<void>
  setDataset(d: Dataset): void
  /** Mark rooms as played on the board (consumes them from `pendingArrivals`). */
  takeArrival(): string | null
  addEntry(entry: Entry): Promise<Entry>
  setWishlist(items: WishlistItem[]): Promise<void>
  setSort(sort: SortKey): void
  setBoardSort(sort: BoardSortKey): void
  openOverlay(o: Overlay): void
  closeOverlay(): void
  setHovered(id: string | null): void
  setBoardPins(pins: BoardPin[]): void
  setWorldReady(v: boolean): void
  setPointerLocked(v: boolean): void
  setTouch(v: boolean): void
  updateSettings(patch: Partial<Settings>): void
}

const SETTINGS_KEY = 'myescapes.settings.v1'

function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS }
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window
}

export const useStore = create<AppState>()((set, get) => ({
  rooms: [],
  reviews: [],
  wishlist: [],
  crew: [],
  dataSource: null,
  dataStatus: 'idle',
  dataError: null,
  lastAddedRoomId: null,
  logRows: null,
  crewIndex: {},
  pendingArrivals: [],
  visiting: null,

  sort: 'city',
  boardSort: 'city',
  overlay: null,
  hoveredId: null,
  boardPins: [],
  worldReady: false,
  pointerLocked: false,
  isTouch: detectTouch(),
  settings: loadSettings(),

  async loadData() {
    set({ dataStatus: 'loading', dataError: null })
    try {
      get().setDataset(await dataLoader())
    } catch (err) {
      set({ dataStatus: 'error', dataError: err instanceof Error ? err.message : String(err) })
      return
    }
    if (get().dataSource === 'postgres') void get().loadCrew({ arrivals: true })
  },
  async refreshData() {
    if (get().dataStatus !== 'ready') return
    let d: Dataset
    try {
      d = await dataLoader()
    } catch (err) {
      console.warn('[store] refresh failed', err)
      return
    }
    const before = new Set(get().reviews.map((r) => r.id))
    const fresh = d.reviews.filter((r) => !before.has(r.id))
    get().setDataset(d)
    if (fresh.length) {
      const ids = [...new Set(fresh.sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.roomId))].slice(-MAX_ARRIVALS)
      set((s) => ({ pendingArrivals: [...s.pendingArrivals.filter((x) => !ids.includes(x)), ...ids] }))
    }
    if (d.source === 'postgres') await get().loadCrew()
  },
  async loadCrew(opts = {}) {
    // Crew stickers and arrivals come from your own logs: not for a friend's room.
    if (get().dataSource !== 'postgres' || get().visiting) return
    let rows: LogRow[]
    try {
      rows = (await callApi(ROUTES.logs, { query: {} })).rows
    } catch (err) {
      // Not signed in any more, or the route is unavailable: keep the name stickers.
      console.warn('[store] crew (/api/logs) unavailable', err instanceof Error ? err.message : err)
      return
    }
    const s = get()
    set({ logRows: rows, crewIndex: buildCrewIndex(s.reviews, rows) })
    // Rooms that arrived since the last visit to the 3D room pin themselves once the world is open.
    const arrived = opts.arrivals ? newArrivals(rows, readLastSeen()).filter((id) => s.rooms.some((r) => r.id === id)) : []
    writeLastSeen(rows)
    if (arrived.length) set((st) => ({ pendingArrivals: [...st.pendingArrivals.filter((x) => !arrived.includes(x)), ...arrived] }))
  },
  setDataset(d) {
    const rows = d.source === 'postgres' ? get().logRows : null
    set({
      rooms: d.rooms,
      reviews: d.reviews,
      wishlist: d.wishlist,
      crew: d.crew,
      dataSource: d.source,
      dataStatus: 'ready',
      logRows: rows,
      crewIndex: buildCrewIndex(d.reviews, rows),
    })
  },
  takeArrival() {
    const [next, ...rest] = get().pendingArrivals
    if (next === undefined) return null
    set({ pendingArrivals: rest, lastAddedRoomId: next })
    return next
  },
  async addEntry(entry) {
    if (get().visiting) throw new Error("This is a friend's room: log rooms in your own.")
    const saved = await apiClient.saveEntry(entry).catch((err: unknown) => {
      // Signed-out demo in production is read-only on the server: keep the entry on this page.
      if (get().dataSource !== 'postgres' && apiErrorStatus(err) === 401) return entry
      throw err
    })
    set((s) => {
      const reviews = [...s.reviews.filter((r) => r.id !== saved.review.id), saved.review]
      return {
        rooms: [...s.rooms.filter((r) => r.id !== saved.room.id), saved.room],
        reviews,
        crewIndex: buildCrewIndex(reviews, s.logRows),
        lastAddedRoomId: saved.room.id,
        pendingArrivals: s.pendingArrivals.filter((x) => x !== saved.room.id),
      }
    })
    bus.emit('entry:saved', { entry: saved })
    if (get().dataSource === 'postgres') void get().loadCrew()
    return saved
  },
  async setWishlist(items) {
    if (get().visiting) throw new Error("This is a friend's room: change your wish list in your own.")
    const prev = get().wishlist
    set({ wishlist: items })
    try {
      set({ wishlist: await apiClient.putWishlist(items) })
    } catch (err) {
      // Signed-out demo in production: the list stays on this page only.
      if (get().dataSource !== 'postgres' && apiErrorStatus(err) === 401) return
      console.error('[store] wishlist save failed', err)
      set({ wishlist: prev })
      throw err
    }
  },
  setSort(sort) {
    const previous = get().sort
    if (previous === sort) {
      if (get().boardSort !== sort) set({ boardSort: sort })
      return
    }
    set({ sort, boardSort: sort })
    bus.emit('sort:changed', { sort, previous })
  },
  setBoardSort(sort) {
    if (sort !== 'crew') return get().setSort(sort)
    if (get().boardSort === 'crew') return
    set({ boardSort: 'crew' })
    bus.emit('sfx', { name: 'paper' })
  },
  openOverlay(o) {
    if (get().visiting && VISITOR_BLOCKED_OVERLAYS.has(o.kind)) return
    set({ overlay: o, hoveredId: null })
  },
  closeOverlay() {
    set({ overlay: null })
  },
  setHovered(id) {
    if (get().hoveredId !== id) set({ hoveredId: id })
  },
  setBoardPins(pins) {
    set({ boardPins: pins })
  },
  setWorldReady(v) {
    set({ worldReady: v })
  },
  setPointerLocked(v) {
    set({ pointerLocked: v })
  },
  setTouch(v) {
    set({ isTouch: v })
  },
  updateSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    try {
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
  },
}))

/** True when the player may move/look (no overlay open, world loaded). */
export const selectControlsEnabled = (s: AppState) => s.overlay === null && s.worldReady
