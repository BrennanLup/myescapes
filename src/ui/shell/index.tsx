// PLACEHOLDER (orchestrator). Owned by workstream 19: Loading and Onboarding.
import { useEffect } from 'react'
import { useStore } from '@/state/store'

export function LoadingScreen() {
  const setWorldReady = useStore((s) => s.setWorldReady)
  useEffect(() => setWorldReady(true), [setWorldReady])
  return null
}

/** HUD: controls hint, sort selector, settings + volume buttons. */
export function Hud() {
  return null
}

export function SettingsOverlay() {
  return null
}

/** In-canvas FPS sampler writing runtime.fps. */
export function PerfMonitor() {
  return null
}
