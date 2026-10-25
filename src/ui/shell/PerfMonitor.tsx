import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { runtime } from '@/contracts/runtime'
import { LOAD_BUDGET_BYTES, totalAssetBytes } from '@/contracts/assets'
import { useStore } from '@/state/store'
import { initialGovernor, loadBudgetWarnings, readFlags, smoothFps, stepGovernor, sumTransferBytes } from './logic'
import { useShell } from './shellStore'
import { QUALITY_INFO } from './SettingsOverlay'

/**
 * In-canvas perf monitor: writes smoothed `runtime.fps`, steps quality down once
 * when the frame rate stays low, checks the load budget, and shows a debug
 * readout with `?debug=1`.
 */
export function PerfMonitor() {
  const flags = useMemo(readFlags, [])
  const gl = useThree((s) => s.gl)
  const governor = useRef(initialGovernor())
  const readout = useRef<HTMLDivElement | null>(null)
  const lastReadout = useRef(0)
  const frameTotals = useRef({ calls: 0, triangles: 0 })

  // Post-processing renders several passes per frame, and `gl.info` resets on every
  // render call by default. With the readout on, count across the whole frame instead.
  useEffect(() => {
    if (!flags.debug) return
    const prev = gl.info.autoReset
    gl.info.autoReset = false
    gl.info.reset()
    return () => {
      gl.info.autoReset = prev
    }
  }, [flags.debug, gl])

  // Runs first each frame (negative priority does not take over rendering): keep the
  // previous frame's totals, then start counting the new frame from zero.
  useFrame(() => {
    if (!flags.debug) return
    frameTotals.current.calls = gl.info.render.calls
    frameTotals.current.triangles = gl.info.render.triangles
    gl.info.reset()
  }, -1000)

  // Load budget check, once the page has finished loading.
  useEffect(() => {
    const check = () => {
      const entries = [
        ...(performance.getEntriesByType?.('navigation') ?? []),
        ...(performance.getEntriesByType?.('resource') ?? []),
      ] as PerformanceResourceTiming[]
      for (const w of loadBudgetWarnings(totalAssetBytes(), sumTransferBytes(entries), LOAD_BUDGET_BYTES)) console.warn(w)
    }
    if (document.readyState === 'complete') {
      const t = setTimeout(check, 1500)
      return () => clearTimeout(t)
    }
    const onLoad = () => setTimeout(check, 1500)
    window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  // Debug readout lives in the DOM, outside the canvas.
  useEffect(() => {
    if (!flags.debug) return
    const el = document.createElement('div')
    el.dataset.testid = 'perf-readout'
    el.style.cssText =
      'position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:70;padding:6px 10px;border-radius:10px;background:rgba(42,31,45,.85);color:#2de2d0;font:600 12px/1.45 "JetBrains Mono",ui-monospace,monospace;white-space:pre;pointer-events:none'
    document.body.appendChild(el)
    readout.current = el
    return () => {
      el.remove()
      readout.current = null
    }
  }, [flags.debug])

  useFrame((state, dt) => {
    runtime.fps = smoothFps(runtime.fps, dt)

    const st = useStore.getState()
    const enabled = !flags.webdriver && st.worldReady && document.visibilityState === 'visible'
    const { state: next, switchTo } = stepGovernor(governor.current, { dt, fps: runtime.fps, quality: st.settings.quality, enabled })
    governor.current = next
    if (switchTo) {
      st.updateSettings({ quality: switchTo })
      useShell.getState().showToast(`Switched to ${QUALITY_INFO[switchTo].label} quality for smoother play`)
    }

    if (readout.current && state.clock.elapsedTime - lastReadout.current > 0.5) {
      lastReadout.current = state.clock.elapsedTime
      const info = frameTotals.current
      readout.current.textContent = `${runtime.fps.toFixed(runtime.fps < 10 ? 1 : 0)} fps  ${st.settings.quality}\n${info.calls} draws  ${(info.triangles / 1000).toFixed(1)}k tris`
    }
  })

  return null
}
