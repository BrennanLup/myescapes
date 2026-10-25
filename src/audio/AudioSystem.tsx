import { useEffect } from 'react'
import { bus } from '@/contracts/events'
import { runtime } from '@/contracts/runtime'
import { useStore } from '@/state/store'
import { createCueDeduper, cueForEvent } from './cues'
import { AudioEngine } from './engine'
import { FootstepScheduler } from './footsteps'

const FOOTSTEP_POLL_MS = 40

/** Remember the first gesture even if AudioSystem (re)mounts after it fired. */
let gestureSeen = false
bus.on('user:gesture', () => {
  gestureSeen = true
})

/** Exposed for debugging/QA (`window.__ESCAPE_AUDIO__`). */
declare global {
  interface Window {
    __ESCAPE_AUDIO__?: AudioEngine
  }
}

/**
 * Invisible audio driver, mounted once in App. Stays silent until the first
 * user gesture, then plays the ambient bed, footsteps and event cues.
 */
export function AudioSystem() {
  useEffect(() => {
    const engine = new AudioEngine()
    if (typeof window !== 'undefined') window.__ESCAPE_AUDIO__ = engine
    const { volume, muted } = useStore.getState().settings
    engine.setVolume(volume, muted)

    const unlock = () => {
      gestureSeen = true
      engine.unlock()
    }
    if (gestureSeen) engine.unlock()

    const offGesture = bus.on('user:gesture', unlock)
    // Later gestures resume a context the browser suspended (iOS, tab switches).
    const resume = () => {
      if (engine.started) engine.unlock()
    }
    window.addEventListener('pointerdown', resume, true)
    window.addEventListener('keydown', resume, true)

    const unsubSettings = useStore.subscribe((s, prev) => {
      if (s.settings.volume !== prev.settings.volume || s.settings.muted !== prev.settings.muted) {
        engine.setVolume(s.settings.volume, s.settings.muted)
      }
    })

    const dedupe = createCueDeduper()
    const offAny = bus.onAny((event) => {
      const cue = cueForEvent(event)
      if (cue && dedupe(cue, performance.now())) engine.play(cue)
    })

    const steps = new FootstepScheduler()
    const timer = setInterval(() => {
      const p = runtime.player
      if (steps.tick(performance.now(), p.moving, p.speed)) engine.play('footstep')
    }, FOOTSTEP_POLL_MS)

    return () => {
      offGesture()
      offAny()
      unsubSettings()
      clearInterval(timer)
      window.removeEventListener('pointerdown', resume, true)
      window.removeEventListener('keydown', resume, true)
      if (window.__ESCAPE_AUDIO__ === engine) delete window.__ESCAPE_AUDIO__
      engine.dispose()
    }
  }, [])
  return null
}
