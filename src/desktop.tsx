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

/**
 * The room itself. The `/` gate (`Home` in src/public/landing, workstream 19) decides who gets here:
 * signed-out visitors only with `?demo=1`, signed-in users after the display name + @handle step
 * (which they may postpone with "Later"; the API keeps their reviews off public pages until then).
 */
export function DesktopApp() {
  return <App />
}
