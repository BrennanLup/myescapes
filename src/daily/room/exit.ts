/**
 * Leaving the puzzle room: where to go and how you arrive. Walking out of the exit door takes a
 * signed-in player to their own room (`/`) and a signed-out player to the demo room (`/?demo=1`, with
 * a sign-in prompt). Either way you appear a few steps inside your room's own Escape of the Day door,
 * facing the board, and the main room skips its "Enter the room" button (`autostart=1`) and its
 * first "How to play" card.
 *
 * Phones never get the 3D room at `/` (it always sends them to `/m`), so after a finished day they
 * go straight to `/m?from=daily`, where the phone shell shows the same "Welcome home" card.
 */
import { runtime } from '@/contracts/runtime'
import { ANCHORS, PLAYER, type Vec3 } from '@/contracts/scene'
import { useStore } from '@/state/store'
import { shouldRedirectToMobile } from '@/mobile/shell/device'
import { navigate } from '../../router'
import { isFinished, toResultInput, type Progress } from '../ui/state'
import { leaveWelcomeNote, markArrivingFromDaily, MOBILE_FROM_DAILY_URL } from '../ui/welcomeNote'

/** The URL the exit door leads to. */
export function exitTarget(signedIn: boolean, phone = false): string {
  if (phone) return MOBILE_FROM_DAILY_URL
  return signedIn ? '/?autostart=1' : '/?demo=1&autostart=1'
}

/** Would `/` send this browser to the phone app? (The router's redirect rule.) */
export function exitsToPhoneApp(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return shouldRedirectToMobile({ pathname: '/', search: '' }, navigator, window.matchMedia?.bind(window))
}

/**
 * How far inside the daily door you arrive. Far enough that the third-person camera (3.1 m behind
 * you) keeps its full distance instead of being pulled in against the south wall, where the door
 * frame would fill a third of the first "welcome home" frame.
 */
export const ARRIVAL_STEP_IN = 3.3

/** Arrival pose in the main room: a few steps inside the south (daily) door, looking north at the board. */
export function homeArrivalPose(): { position: Vec3; yaw: number; pitch: number } {
  const door = ANCHORS.gateDoor.position
  return { position: [door[0], PLAYER.eyeHeight, door[2] - ARRIVAL_STEP_IN], yaw: 0, pitch: 0 }
}

/** Hand the player over to the main room (or the phone app) and navigate there. */
export function walkHome(opts: { progress: Progress; maxGuesses: number; signedIn: boolean; phone?: boolean }): string {
  const r = toResultInput(opts.progress)
  const finished = isFinished(opts.progress)
  // Leaving before finishing is just going home: no celebration.
  if (finished) {
    leaveWelcomeNote({
      number: opts.progress.number,
      solved: r.solved,
      guesses: r.guesses,
      maxGuesses: opts.maxGuesses,
      timeMs: r.timeMs,
      signedIn: opts.signedIn,
      at: Date.now(),
    })
  }
  const pose = homeArrivalPose()
  runtime.player.position = pose.position
  runtime.player.yaw = pose.yaw
  runtime.player.pitch = pose.pitch
  runtime.pendingTeleport = null
  // The main room shows its own loading screen; it must start from a clean shell.
  const st = useStore.getState()
  if (st.overlay) st.closeOverlay()
  st.setWorldReady(false)
  const phone = opts.phone ?? exitsToPhoneApp()
  // You know how to walk by now: the main room skips its first "How to play" card.
  if (!phone) markArrivingFromDaily()
  // Only a finished day has anything to celebrate on /m; leaving early is just going home.
  const to = phone && !finished ? '/m' : exitTarget(opts.signedIn, phone)
  navigate(to)
  return to
}
