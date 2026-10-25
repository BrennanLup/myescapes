/**
 * Wires bus events to store changes. Installed once from main.tsx.
 * Owned by the orchestrator.
 */
import { bus } from '@/contracts/events'
import { useStore } from './store'

export function installBridge(): () => void {
  const s = () => useStore.getState()
  const offs = [
    bus.on('review:open', ({ roomId }) => s().openOverlay({ kind: 'review', roomId })),
    bus.on('record:open', () => s().openOverlay({ kind: 'record' })),
    bus.on('draft:ready', ({ draft }) => s().openOverlay({ kind: 'confirm', draft })),
    bus.on('gate:open', () => s().openOverlay({ kind: 'gate' })),
    bus.on('wishlist:open', () => s().openOverlay({ kind: 'wishlist' })),
    bus.on('wrap:open', () => s().openOverlay({ kind: 'wrap' })),
    bus.on('settings:open', () => s().openOverlay({ kind: 'settings' })),
    bus.on('overlay:close', () => s().closeOverlay()),
    bus.on('entry:saved', () => {
      if (s().overlay?.kind === 'confirm') s().closeOverlay()
    }),
    bus.on('gate:solved', () => {
      if (s().overlay?.kind === 'gate') s().closeOverlay()
    }),
  ]
  // Release pointer lock whenever an overlay opens so the cursor is usable.
  const unsub = useStore.subscribe((st, prev) => {
    if (st.overlay && !prev.overlay && typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock?.()
    }
  })
  return () => {
    offs.forEach((o) => o())
    unsub()
  }
}
