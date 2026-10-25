/**
 * Pure helpers for the shell (loading progress, hotkeys, perf governor, flags).
 * Kept free of React/three so they are easy to unit test.
 */
import { SORT_KEYS, type SortKey } from '@/contracts/types'
import type { AppState, QualityPreset } from '@/state/store'

// ---------------------------------------------------------------------------
// Loading progress
// ---------------------------------------------------------------------------

export const MIN_LOADING_MS = 600

export interface ProgressInput {
  /** drei useProgress().progress, 0..100. */
  assetProgress: number
  /** drei useProgress().active (a loader is still running). */
  assetActive: boolean
  /** drei useProgress().total (items the loading manager has seen). 0 = nothing to load. */
  assetTotal?: number
  dataStatus: AppState['dataStatus']
  /** ms since the loading screen mounted. */
  elapsedMs: number
  minMs?: number
}

export interface ProgressResult {
  /** 0..100, what the bar shows. */
  percent: number
  /** Everything loaded and the minimum display time has passed. */
  ready: boolean
  error: boolean
}

const DATA_WEIGHT: Record<AppState['dataStatus'], number> = { idle: 0.05, loading: 0.4, ready: 1, error: 0 }

export function computeProgress({ assetProgress, assetActive, assetTotal, dataStatus, elapsedMs, minMs = MIN_LOADING_MS }: ProgressInput): ProgressResult {
  // Most assets are procedural: when the loading manager never saw a file, count assets as done.
  const assets = assetTotal === 0 && !assetActive ? 1 : clamp01(assetProgress / 100)
  const data = DATA_WEIGHT[dataStatus]
  const raw = 0.5 * assets + 0.5 * data
  // The time fraction caps the bar so it glides up over the minimum display time
  // instead of jumping straight to 100%.
  const time = minMs <= 0 ? 1 : clamp01(elapsedMs / minMs)
  const percent = Math.round(Math.min(raw, time) * 100)
  const loaded = assets >= 1 && !assetActive && dataStatus === 'ready'
  return { percent, ready: loaded && elapsedMs >= minMs, error: dataStatus === 'error' }
}

/** Friendly status line for the bar. */
export function loadingMessage(percent: number, dataStatus: AppState['dataStatus']): string {
  if (dataStatus === 'error') return 'The room records got stuck.'
  if (percent >= 100) return 'The room is ready.'
  if (percent >= 70) return 'Tying the red string...'
  if (percent >= 35) return 'Pinning up the polaroids...'
  return 'Switching on the lamps...'
}

// ---------------------------------------------------------------------------
// URL / environment flags
// ---------------------------------------------------------------------------

export interface ShellFlags {
  /** Skip the "Enter the room" button. */
  autostart: boolean
  /** Show the fps / draw-call readout. */
  debug: boolean
  /** Running under automation (navigator.webdriver). */
  webdriver: boolean
}

export function parseFlags(search: string, webdriver: boolean): ShellFlags {
  const p = new URLSearchParams(search)
  const auto = p.get('autostart')
  return {
    // ?autostart=1 forces it on, ?autostart=0 forces it off (even under webdriver).
    autostart: auto === null ? webdriver : auto === '1' || auto === 'true',
    debug: p.get('debug') === '1' || p.get('debug') === 'true',
    webdriver,
  }
}

export function readFlags(): ShellFlags {
  if (typeof window === 'undefined') return { autostart: false, debug: false, webdriver: false }
  return parseFlags(window.location.search, !!navigator.webdriver)
}

// ---------------------------------------------------------------------------
// Sort hotkeys
// ---------------------------------------------------------------------------

/** Keys 1-6 (top row or numpad) map to SORT_KEYS in order. */
export function sortForKey(key: string, code?: string): SortKey | null {
  let digit = /^[1-9]$/.test(key) ? Number(key) : NaN
  if (Number.isNaN(digit) && code) {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code)
    if (m) digit = Number(m[1])
  }
  if (Number.isNaN(digit) || digit < 1 || digit > SORT_KEYS.length) return null
  return SORT_KEYS[digit - 1]
}

/** True when a key event should be ignored because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

// ---------------------------------------------------------------------------
// Perf governor
// ---------------------------------------------------------------------------

export const PERF = {
  /** Below this smoothed fps counts as "slow". */
  minFps: 40,
  /** Seconds of continuous slowness before stepping down. */
  sustainSec: 6,
  /** Ignore the first seconds (shader compile, asset upload). */
  warmupSec: 3,
  /** EMA smoothing time constant (seconds). */
  smoothingSec: 0.5,
} as const

export interface GovernorState {
  elapsed: number
  slowFor: number
  /** Already stepped down once this session. */
  downgraded: boolean
}

export const initialGovernor = (): GovernorState => ({ elapsed: 0, slowFor: 0, downgraded: false })

export interface GovernorInput {
  /** Frame delta in seconds. */
  dt: number
  /** Smoothed fps. */
  fps: number
  quality: QualityPreset
  /** False when auto-downgrade must not run (webdriver, hidden tab, overlay...). */
  enabled: boolean
}

/** Advance the governor one frame. Returns the preset to switch to, if any. */
export function stepGovernor(s: GovernorState, { dt, fps, quality, enabled }: GovernorInput): { state: GovernorState; switchTo: QualityPreset | null } {
  // Clamp huge deltas (tab switch, breakpoint) so they don't count as slow time.
  const d = Math.min(Math.max(dt, 0), 0.25)
  const elapsed = s.elapsed + d
  if (!enabled || s.downgraded || quality === 'low' || elapsed < PERF.warmupSec) {
    return { state: { ...s, elapsed, slowFor: 0 }, switchTo: null }
  }
  const slowFor = fps > 0 && fps < PERF.minFps ? s.slowFor + d : 0
  if (slowFor >= PERF.sustainSec) {
    return { state: { elapsed, slowFor: 0, downgraded: true }, switchTo: 'low' }
  }
  return { state: { ...s, elapsed, slowFor }, switchTo: null }
}

/** Exponential moving average of fps from a frame delta. */
export function smoothFps(prev: number, dt: number, tau: number = PERF.smoothingSec): number {
  if (dt <= 0) return prev
  const inst = 1 / dt
  if (prev <= 0) return inst
  const a = 1 - Math.exp(-dt / tau)
  return prev + (inst - prev) * a
}

// ---------------------------------------------------------------------------
// Load budget
// ---------------------------------------------------------------------------

export function sumTransferBytes(entries: ReadonlyArray<{ transferSize?: number }>): number {
  let n = 0
  for (const e of entries) n += e.transferSize ?? 0
  return n
}

export function loadBudgetWarnings(manifestBytes: number, transferredBytes: number, budget: number): string[] {
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`
  const out: string[] = []
  if (manifestBytes > budget) out.push(`[perf] asset manifest is ${mb(manifestBytes)}, over the ${mb(budget)} load budget`)
  if (transferredBytes > budget) out.push(`[perf] transferred ${mb(transferredBytes)} on load, over the ${mb(budget)} load budget`)
  return out
}

function clamp01(v: number) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}
