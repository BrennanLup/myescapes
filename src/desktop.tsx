/**
 * The Phase 1 3D room as a lazily loaded page (so /m and public pages never pull in three.js).
 * Boot side effects run once, when this module first loads. Owned by foundation; the room itself
 * belongs to workstream 20 (src/world, src/state).
 */
import { App } from './App'
import { OnboardingGate } from './auth'
import { installBridge } from './state/bridge'
import { installTestHooks } from './contracts/testing'
import { useStore } from './state/store'
import { bus } from './contracts/events'

installBridge()
installTestHooks()
void useStore.getState().loadData()

// First user gesture unlocks audio etc.
const gesture = () => {
  bus.emit('user:gesture')
  window.removeEventListener('pointerdown', gesture)
  window.removeEventListener('keydown', gesture)
}
window.addEventListener('pointerdown', gesture)
window.addEventListener('keydown', gesture)

/** Signed-in users without a display name and @handle see the onboarding step first (workstream 3). */
export function DesktopApp() {
  return (
    <OnboardingGate>
      <App />
    </OnboardingGate>
  )
}
