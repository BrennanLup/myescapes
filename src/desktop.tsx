/**
 * The Phase 1 3D room as a lazily loaded page (so /m and public pages never pull in three.js).
 * Boot side effects run once, when this module first loads. Owned by foundation; the room itself
 * belongs to workstream 20 (src/world, src/state).
 */
import { App } from './App'
import { installBridge } from './state/bridge'
import { installTestHooks } from './contracts/testing'
import { installRoomSync } from './state/sync'
import { bus } from './contracts/events'

installBridge()
installTestHooks()
// Loads the room (the signed-in user's data, or the seed demo) and keeps it fresh.
installRoomSync()

// First user gesture unlocks audio etc.
const gesture = () => {
  bus.emit('user:gesture')
  window.removeEventListener('pointerdown', gesture)
  window.removeEventListener('keydown', gesture)
}
window.addEventListener('pointerdown', gesture)
window.addEventListener('keydown', gesture)

export function DesktopApp() {
  return <App />
}
