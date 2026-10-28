/**
 * Leaving the puzzle room: where to go and how you arrive. Walking out of the exit door takes a
 * signed-in player to their own room (`/`) and a signed-out player to the demo room (`/?demo=1`, with
 * a sign-in prompt). Either way you appear just inside your room's own Escape of the Day door,
 * facing the board, and the main room skips its "Enter the room" button (`autostart=1`).
 */
import { runtime } from '@/contracts/runtime'
import { ANCHORS, PLAYER, type Vec3 } from '@/contracts/scene'
import { useStore } from '@/state/store'
import { navigate } from '../../router'
import { isFinished, toResultInput, type Progress } from '../ui/state'
import { leaveWelcomeNote } from '../ui/welcome'

/** The URL the exit door leads to. */
export function exitTarget(signedIn: boolean): string {
  return signedIn ? '/?autostart=1' : '/?demo=1&autostart=1'
}

/** Arrival pose in the main room: a step inside the south (daily) door, looking north at the board. */
export function homeArrivalPose(): { position: Vec3; yaw: number; pitch: number } {
  const door = ANCHORS.gateDoor.position
  return { position: [door[0], PLAYER.eyeHeight, door[2] - 1.5], yaw: 0, pitch: 0 }
}

/** Hand the player over to the main room and navigate there. */
export function walkHome(opts: { progress: Progress; maxGuesses: number; signedIn: boolean }): string {
  const r = toResultInput(opts.progress)
  // Leaving before finishing is just going home: no celebration.
  if (isFinished(opts.progress)) {
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
  const to = exitTarget(opts.signedIn)
  navigate(to)
  return to
}
