/**
 * State of the puzzle room's DOM layer: which close-up panel is open. While a panel is open the
 * shared store's overlay is set to `{ kind: 'gate' }` (the Escape of the Day overlay kind), which is
 * what freezes the player controller, hides the reticle and the touch controls, and releases
 * pointer lock. This page renders its own panels for it; the room's DailyOverlay is not mounted here.
 */
import { create } from 'zustand'
import { useStore } from '@/state/store'

export type RoomPanel =
  | { kind: 'intro' }
  | { kind: 'lock' }
  | { kind: 'clues'; focus?: number }
  | { kind: 'hint' }
  | { kind: 'result' }
  | { kind: 'menu' }

export interface RoomUiState {
  panel: RoomPanel | null
  /** Short line at the bottom of the screen ("Nothing under the cushion."). */
  toast: { id: number; text: string; tone: 'info' | 'good' | 'bad' } | null
  /** The walk-out sequence has started (fade, then navigation). */
  leaving: boolean
  open(p: RoomPanel): void
  close(): void
  say(text: string, tone?: 'info' | 'good' | 'bad'): void
  setLeaving(v: boolean): void
  reset(): void
}

let toastId = 0

export const useRoomUi = create<RoomUiState>()((set, get) => ({
  panel: null,
  toast: null,
  leaving: false,
  open(p) {
    set({ panel: p })
    const st = useStore.getState()
    if (st.overlay?.kind !== 'gate') st.openOverlay({ kind: 'gate' })
  },
  close() {
    if (!get().panel) return
    set({ panel: null })
    if (useStore.getState().overlay?.kind === 'gate') useStore.getState().closeOverlay()
  },
  say(text, tone = 'info') {
    set({ toast: { id: ++toastId, text, tone } })
  },
  setLeaving(v) {
    set({ leaving: v })
  },
  reset() {
    set({ panel: null, toast: null, leaving: false })
  },
}))
