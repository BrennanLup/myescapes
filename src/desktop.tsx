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
import { installRealtime } from './net/session'
import { bootedVisit, installVisit, markBooted, visitHandleFromPath } from './social/visit/state'
import { installVisitNotices } from './social/visit/notices'

installBridge()
installTestHooks()
// `/home/:handle` (Phase 3 C): a friend's room, read-only. Otherwise your own room (or the demo).
const visit = typeof window === 'undefined' ? null : visitHandleFromPath(window.location.pathname)
if (visit) {
  installVisit(visit)
  installVisitNotices()
}
markBooted(visit)
// Loads the room (the signed-in user's data, a friend's, or the seed demo) and keeps it fresh.
installRoomSync()
// Friends in the same room, chat, emotes and presence (signed-in and onboarded only).
void installRealtime()

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
  // The room boots once per page for one home; moving to another one needs a fresh page.
  const want = typeof window === 'undefined' ? null : visitHandleFromPath(window.location.pathname)
  if (bootedVisit()?.handle !== want) {
    window.location.reload()
    return null
  }
  return <App />
}
