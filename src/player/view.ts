/**
 * Camera mode (first / third person) and the per-frame state of your own character.
 *
 * - `useCameraMode`: reactive, remembered per device in localStorage. Toggle with `V`, the HUD
 *   button or the phone button (`src/ui/wardrobe/CharacterHud.tsx`).
 * - `playerView`: mutable, non-reactive, written by the player controller every frame. The
 *   interaction system reads `rayStart`, your character (`src/world/avatars/LocalAvatar.tsx`)
 *   reads the rest. Realtime presence can read `mode`, `bodyYaw` and `speed` to broadcast.
 */
import { create } from 'zustand'
import type { CameraMode } from './camera'

export type { CameraMode } from './camera'

export const CAMERA_MODE_KEY = 'myescapes.camera.v1'

function loadMode(): CameraMode {
  try {
    const v = globalThis.localStorage?.getItem(CAMERA_MODE_KEY)
    if (v === 'first' || v === 'third') return v
  } catch {
    /* storage blocked */
  }
  return 'first'
}

export interface CameraModeState {
  mode: CameraMode
  setMode(mode: CameraMode): void
  toggle(): void
}

export const useCameraMode = create<CameraModeState>()((set, get) => ({
  mode: loadMode(),
  setMode(mode) {
    if (get().mode === mode) return
    set({ mode })
    try {
      globalThis.localStorage?.setItem(CAMERA_MODE_KEY, mode)
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  },
  toggle() {
    get().setMode(get().mode === 'first' ? 'third' : 'first')
  },
}))

declare global {
  interface Window {
    /** Read-mostly test hook (Playwright): the camera mode store and the per-frame view state. */
    __ESCAPE_VIEW__?: { playerView: typeof playerView; cameraMode: typeof useCameraMode }
  }
}

export const playerView = {
  /** The mode the controller is rendering (follows useCameraMode). */
  mode: 'first' as CameraMode,
  /** 0 = first person, 1 = third person; animates between them. */
  blend: 0,
  /** Current camera distance from the head pivot (0 in first person). */
  cameraDistance: 0,
  /** Where the interaction ray starts along the view ray (metres from the camera). */
  rayStart: 0,
  /** Feet position of your character, world space. */
  feet: [0, 0, 0] as [number, number, number],
  /** The way the body faces (yaw convention of runtime.player). */
  bodyYaw: 0,
  /** Head pitch, follows the look pitch (clamped by the character). */
  lookPitch: 0,
  /** Horizontal speed, m/s (drives the walk animation). */
  speed: 0,
  /** Your character's opacity: below 1 while it is in the way (written by LocalAvatar). */
  avatarOpacity: 1,
}

if (typeof window !== 'undefined') window.__ESCAPE_VIEW__ = { playerView, cameraMode: useCameraMode }
