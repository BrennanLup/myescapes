/**
 * Test hooks exposed on `window.__ESCAPE__` (dev and prod; harmless, read-mostly).
 * Playwright QA uses them to teleport, inspect state and skip pointer lock.
 * Owned by the orchestrator.
 */
import { bus } from './events'
import { colliders } from './colliders'
import { runtime, requestTeleport } from './runtime'
import { ANCHORS } from './scene'
import { useStore } from '@/state/store'

export const testHooks = { bus, colliders, runtime, requestTeleport, ANCHORS, store: useStore }

declare global {
  interface Window {
    __ESCAPE__?: typeof testHooks
  }
}

export function installTestHooks() {
  if (typeof window !== 'undefined') window.__ESCAPE__ = testHooks
}
