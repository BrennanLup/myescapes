/**
 * Typed app-wide event bus. Use it for one-shot "something happened" signals
 * (open this, play that sound). Persistent state lives in the Zustand store
 * (`src/state/store.ts`); `src/state/bridge.ts` turns UI events into store changes.
 *
 * Owned by the orchestrator.
 */
import type { Entry, ReviewDraft, SortKey } from './types'

export type AppEventMap = {
  /** Open the review overlay for a room (its latest review). */
  'review:open': { roomId: string }
  /** Close whatever overlay is open. */
  'overlay:close': Record<string, never>
  /** Open the voice-capture overlay (from the desk terminal). */
  'record:open': Record<string, never>
  /** MediaRecorder actually started. */
  'record:start': Record<string, never>
  /** Recording stopped; transcript (possibly empty) is available. */
  'record:stop': { transcript: string }
  /** Extraction finished; open the confirm screen. */
  'draft:ready': { draft: ReviewDraft }
  /** User confirmed and the entry was saved. Board pins the new photo. */
  'entry:saved': { entry: Entry }
  /** The daily gate overlay should open (from the in-world door/safe or on load). */
  'gate:open': Record<string, never>
  /** Gate solved (or skipped). */
  'gate:solved': { skipped: boolean; puzzleId?: string }
  /** A wrong gate answer. */
  'gate:miss': { misses: number }
  /** Board sort changed. */
  'sort:changed': { sort: SortKey; previous: SortKey }
  'wishlist:open': Record<string, never>
  'wrap:open': Record<string, never>
  'settings:open': Record<string, never>
  /** The interaction system interacted with something (generic; carries the target id). */
  'interact': { id: string; kind: string }
  /** Hover target changed (null = nothing). */
  'hover:changed': { id: string | null; kind: string | null }
  /** Audio cues that are not implied by other events. */
  'sfx': { name: SfxName }
  /** First user gesture (click/tap/key) — audio may unlock now. */
  'user:gesture': Record<string, never>
}

export type SfxName = 'footstep' | 'pin' | 'paper' | 'string' | 'unlock' | 'click' | 'error' | 'chalk' | 'whoosh'

export type AppEventName = keyof AppEventMap
export type AppEvent = { [K in AppEventName]: { type: K; payload: AppEventMap[K] } }[AppEventName]

type Handler<K extends AppEventName> = (payload: AppEventMap[K]) => void

export interface EventBus {
  emit<K extends AppEventName>(type: K, ...payload: AppEventMap[K] extends Record<string, never> ? [] | [AppEventMap[K]] : [AppEventMap[K]]): void
  on<K extends AppEventName>(type: K, handler: Handler<K>): () => void
  off<K extends AppEventName>(type: K, handler: Handler<K>): void
  /** Listen to every event (debugging, audio, tests). */
  onAny(handler: (event: AppEvent) => void): () => void
}

export function createEventBus(): EventBus {
  const handlers = new Map<AppEventName, Set<Handler<AppEventName>>>()
  const anyHandlers = new Set<(event: AppEvent) => void>()
  const bus: EventBus = {
    emit(type, ...rest) {
      const payload = (rest[0] ?? {}) as AppEventMap[typeof type]
      handlers.get(type)?.forEach((h) => {
        try {
          ;(h as Handler<typeof type>)(payload)
        } catch (err) {
          console.error(`[bus] handler for ${type} threw`, err)
        }
      })
      anyHandlers.forEach((h) => h({ type, payload } as AppEvent))
    },
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) handlers.set(type, (set = new Set()))
      set.add(handler as Handler<AppEventName>)
      return () => bus.off(type, handler)
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler as Handler<AppEventName>)
    },
    onAny(handler) {
      anyHandlers.add(handler)
      return () => anyHandlers.delete(handler)
    },
  }
  return bus
}

/** The single app bus. */
export const bus: EventBus = createEventBus()
