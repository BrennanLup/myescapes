/**
 * Pure mapping from bus events to sound cues. No Web Audio here, so it is
 * trivially unit-testable.
 */
import type { AppEvent, SfxName } from '@/contracts/events'

/** Every sound the audio engine knows how to make. */
export type CueName = SfxName

/** Overlay-opening events that get a soft whoosh. */
const WHOOSH_EVENTS = new Set<AppEvent['type']>(['record:open', 'gate:open', 'wishlist:open', 'wrap:open', 'settings:open'])

/** Which cue (if any) an app event should play. */
export function cueForEvent(event: AppEvent): CueName | null {
  switch (event.type) {
    case 'sfx':
      return event.payload.name
    case 'entry:saved':
      return 'pin'
    case 'review:open':
      return 'paper'
    case 'sort:changed':
      return 'string'
    case 'gate:solved':
      return event.payload.skipped ? null : 'unlock'
    case 'gate:miss':
      return 'error'
    case 'interact':
      return 'click'
    default:
      return WHOOSH_EVENTS.has(event.type) ? 'whoosh' : null
  }
}

/**
 * Suppresses the same cue fired twice in quick succession (e.g. a workstream
 * emitting both `entry:saved` and `sfx: pin`). Footsteps are never deduped.
 */
export function createCueDeduper(windowMs = 70) {
  const last = new Map<CueName, number>()
  return (cue: CueName, now: number): boolean => {
    if (cue === 'footstep') return true
    const prev = last.get(cue)
    if (prev !== undefined && now - prev < windowMs) return false
    last.set(cue, now)
    return true
  }
}
