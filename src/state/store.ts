/**
 * The single Zustand store. Reactive app state lives here.
 * Owned by the orchestrator; workstreams read it and call its actions.
 */
import { create } from 'zustand'
import { apiClient } from '@/contracts/api'
import { bus } from '@/contracts/events'
import type { CrewMember, Dataset, Entry, ReviewDraft, Room, Review, SortKey, WishlistItem } from '@/contracts/types'

export type Overlay =
  | { kind: 'review'; roomId: string }
  | { kind: 'record' }
  | { kind: 'confirm'; draft: ReviewDraft }
  | { kind: 'gate' }
  | { kind: 'wishlist' }
  | { kind: 'wrap' }
  | { kind: 'settings' }

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

  // world / ui
  sort: SortKey
  overlay: Overlay | null
  hoveredId: string | null
  boardPins: BoardPin[]
  worldReady: boolean
  pointerLocked: boolean
  isTouch: boolean
  settings: Settings

  // actions
  loadData(): Promise<void>
  setDataset(d: Dataset): void
  addEntry(entry: Entry): Promise<Entry>
  setWishlist(items: WishlistItem[]): Promise<void>
  setSort(sort: SortKey): void
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

  sort: 'city',
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
      get().setDataset(await apiClient.getData())
    } catch (err) {
      set({ dataStatus: 'error', dataError: err instanceof Error ? err.message : String(err) })
    }
  },
  setDataset(d) {
    set({ rooms: d.rooms, reviews: d.reviews, wishlist: d.wishlist, crew: d.crew, dataSource: d.source, dataStatus: 'ready' })
  },
  async addEntry(entry) {
    const saved = await apiClient.saveEntry(entry)
    set((s) => ({
      rooms: [...s.rooms.filter((r) => r.id !== saved.room.id), saved.room],
      reviews: [...s.reviews.filter((r) => r.id !== saved.review.id), saved.review],
      lastAddedRoomId: saved.room.id,
    }))
    bus.emit('entry:saved', { entry: saved })
    return saved
  },
  async setWishlist(items) {
    const prev = get().wishlist
    set({ wishlist: items })
    try {
      set({ wishlist: await apiClient.putWishlist(items) })
    } catch (err) {
      console.error('[store] wishlist save failed', err)
      set({ wishlist: prev })
      throw err
    }
  },
  setSort(sort) {
    const previous = get().sort
    if (previous === sort) return
    set({ sort })
    bus.emit('sort:changed', { sort, previous })
  },
  openOverlay(o) {
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
