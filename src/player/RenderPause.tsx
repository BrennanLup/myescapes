/**
 * Stops the room's render loop while a full-screen overlay covers it (QA r4): the review form,
 * the wardrobe and the other sheets sit on a dimmed backdrop over the room, and drawing 50-85
 * draws a frame behind them only heats the phone and makes typing lag. The canvas switches to
 * `frameloop="demand"`: the last frame stays on screen (still redrawn on a resize), and the loop
 * comes back as soon as the overlay closes. Mounted inside the room's Canvas by World.tsx.
 *
 * The canvas carries `data-render="paused" | "live"` for tests and the `?debug=1` readout.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useStore, type AppState, type Overlay } from '@/state/store'

/**
 * Overlays that cover the room: everything but Settings, which is a small sheet whose quality
 * and brightness changes you want to see applied behind it.
 */
export const PAUSING_OVERLAYS: ReadonlySet<Overlay['kind']> = new Set(['review', 'record', 'confirm', 'gate', 'wardrobe', 'wishlist', 'wrap'])

/** Whether the room should stop drawing: the world is up and a covering overlay is open. */
export function shouldPauseRender(s: Pick<AppState, 'overlay' | 'worldReady'>): boolean {
  return s.worldReady && !!s.overlay && PAUSING_OVERLAYS.has(s.overlay.kind)
}

export function RenderPause() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    const apply = (paused: boolean) => {
      const st = get()
      const want = paused ? 'demand' : 'always'
      st.gl.domElement.dataset.render = paused ? 'paused' : 'live'
      if (st.frameloop === want) return
      // setFrameloop restarts the clock from zero; keep the elapsed time, so anything animated
      // from it carries on where it stopped (the paused time is simply skipped).
      const elapsed = st.clock.elapsedTime
      st.setFrameloop(want)
      st.clock.elapsedTime = elapsed
      const readout = document.querySelector<HTMLElement>('[data-testid="perf-readout"]')
      if (readout && paused) readout.textContent = `${readout.textContent ?? ''}\npaused behind overlay`
    }
    apply(shouldPauseRender(useStore.getState()))
    const unsub = useStore.subscribe((s, prev) => {
      const now = shouldPauseRender(s)
      if (now !== shouldPauseRender(prev)) apply(now)
    })
    return () => {
      unsub()
      apply(false)
    }
  }, [get])
  return null
}
