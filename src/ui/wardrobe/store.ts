/**
 * Your look, the items you own and your keys, as the 3D room sees them (a small Zustand store).
 *
 * Signed in: loaded from and saved to `GET/PUT /api/me/avatar`; purchases go through
 * `POST /api/me/avatar/purchases`. Signed out (the demo room): free items only, kept on this device
 * in localStorage, and no keys.
 */
import { create } from 'zustand'
import { AVATAR_ROUTES, type AvatarState } from '@/contracts/avatar'
import { bus } from '@/contracts/events'
import { ApiCallError } from '@/contracts/errors'
import { callApi } from '@/contracts/routes'
import { useStore } from '@/state/store'
import { normalizeOutfit, starterOutfit, unownedItems, type ItemId, type Outfit } from '@/world/avatars/catalog'

export const LOCAL_OUTFIT_KEY = 'myescapes.outfit.v1'

type Keys = NonNullable<AvatarState['keys']>

export interface WardrobeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  signedIn: boolean
  /** What you wear (saved). */
  outfit: Outfit
  owned: ItemId[]
  keys: Keys | null
  /** Pending save or purchase. */
  busy: boolean
  load(opts?: { quiet?: boolean }): Promise<void>
  /** Wear `outfit` (saved to your account, or this device when signed out). Throws a user-facing Error. */
  save(outfit: Outfit): Promise<void>
  /** Buy an item with keys, optionally wearing `wear` in the same step. Throws a user-facing Error. */
  buy(itemId: ItemId, wear?: Outfit): Promise<void>
}

function readLocal(): Outfit | null {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_OUTFIT_KEY)
    if (raw) return normalizeOutfit(JSON.parse(raw), starterOutfit('guest'))
  } catch {
    /* blocked or corrupt */
  }
  return null
}

function writeLocal(outfit: Outfit) {
  try {
    globalThis.localStorage?.setItem(LOCAL_OUTFIT_KEY, JSON.stringify(outfit))
  } catch {
    /* blocked: lasts for this page */
  }
}

/** A message safe to show for a failed call. */
export function errorMessage(err: unknown, fallback = "Couldn't reach the wardrobe. Check your connection and try again."): string {
  if (err instanceof ApiCallError) {
    if (err.status === 401) return 'Your session ended. Sign in again to save your look.'
    if (err.body?.error && err.status < 500) return err.body.error
  }
  return fallback
}

let loadPromise: Promise<void> | null = null

export const useWardrobe = create<WardrobeState>()((set, get) => {
  const apply = (s: AvatarState) => {
    if (!s.signedIn) {
      set({ status: 'ready', signedIn: false, outfit: readLocal() ?? s.outfit, owned: [], keys: null })
      return
    }
    set({ status: 'ready', signedIn: true, outfit: s.outfit, owned: s.owned, keys: s.keys })
  }
  return {
    status: 'idle',
    signedIn: false,
    outfit: readLocal() ?? starterOutfit('guest'),
    owned: [],
    keys: null,
    busy: false,

    load(opts = {}) {
      if (loadPromise) return loadPromise
      if (!opts.quiet) set({ status: get().status === 'ready' ? 'ready' : 'loading' })
      loadPromise = (async () => {
        try {
          apply(await callApi(AVATAR_ROUTES.getAvatar))
        } catch (err) {
          console.warn('[wardrobe] could not load your look', err instanceof Error ? err.message : err)
          if (get().status !== 'ready') set({ status: 'error' })
        } finally {
          loadPromise = null
        }
      })()
      return loadPromise
    },

    async save(outfit) {
      const s = get()
      if (!s.signedIn) {
        if (unownedItems(outfit, []).length) throw new Error('Sign in to unlock items with keys.')
        writeLocal(outfit)
        set({ outfit })
        return
      }
      set({ busy: true })
      try {
        apply(await callApi(AVATAR_ROUTES.putAvatar, { body: { outfit } }))
      } catch (err) {
        throw new Error(errorMessage(err))
      } finally {
        set({ busy: false })
      }
    },

    async buy(itemId, wear) {
      if (!get().signedIn) throw new Error('Sign in to earn keys and unlock items.')
      set({ busy: true })
      try {
        apply(await callApi(AVATAR_ROUTES.buyItem, { body: wear ? { itemId, wear } : { itemId } }))
      } catch (err) {
        throw new Error(errorMessage(err))
      } finally {
        set({ busy: false })
      }
    },
  }
})

/**
 * Loads your look once, and refreshes your keys after you log a room or finish Escape of the Day,
 * calling `notify` with how many keys you just earned. Returns an unsubscribe.
 */
export function installWardrobeSync(notify: (earned: number) => void): () => void {
  const w = () => useWardrobe.getState()
  if (w().status === 'idle') void w().load()
  let timer: ReturnType<typeof setTimeout> | null = null
  const refresh = () => {
    if (!w().signedIn) return
    if (timer) clearTimeout(timer)
    // Give the server a moment to record the result first.
    timer = setTimeout(async () => {
      timer = null
      const before = w().keys?.earned ?? null
      await w().load({ quiet: true })
      const after = w().keys?.earned ?? null
      if (before !== null && after !== null && after > before) notify(after - before)
    }, 800)
  }
  const offs = [
    bus.on('entry:saved', refresh),
    bus.on('gate:solved', refresh),
    // Escape of the Day records its result from its own overlay: check when it closes.
    useStore.subscribe((st, prev) => {
      if (prev.overlay?.kind === 'gate' && st.overlay?.kind !== 'gate') refresh()
    }),
  ]
  return () => {
    offs.forEach((o) => o())
    if (timer) clearTimeout(timer)
  }
}
