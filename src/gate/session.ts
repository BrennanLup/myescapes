/** Gate session state (shared by the overlay, the door and the auto-open hook). */
import { create } from 'zustand'
import { useStore } from '@/state/store'
import { buildDailyGate, isSolvedToday, parseGateUrl, todayKey, writeLastSolved, type DailyGate } from './daily'
import { gateReducer, initialGateState, type GateAction, type GateState } from './machine'

export interface GateSessionState {
  /** localStorage says today's gate is done (solved or skipped). */
  solvedToday: boolean
  /** The player asked to play (auto-open or replay), even if already solved today. */
  playRequested: boolean
  /** True while the overlay must not be dismissed (puzzle or reveal pending "Step inside"). */
  locked: boolean
  /** "Step inside" / skip already handed control back to the world this session. */
  finished: boolean
  attempt: GateState
  dispatch(action: GateAction): void
  setLocked(v: boolean): void
  finish(): void
  requestPlay(): void
  /** Persist today as done. */
  markDone(): void
}

export const useGateSession = create<GateSessionState>()((set, get) => ({
  solvedToday: isSolvedToday(),
  playRequested: false,
  locked: false,
  finished: false,
  attempt: initialGateState,
  dispatch(action) {
    const total = getDailyGate().challenge.hints.length
    set({ attempt: gateReducer(get().attempt, action, total) })
  },
  setLocked(v) {
    if (get().locked !== v) set({ locked: v })
  },
  finish() {
    get().markDone()
    set({ finished: true, locked: false })
  },
  requestPlay() {
    set({ playRequested: true, finished: false, attempt: initialGateState })
  },
  markDone() {
    const day = getDailyGate().day
    writeLastSolved(day)
    set({ solvedToday: true })
  },
}))

/** Today's gate, built once per day from the current data (so a mid-session entry doesn't swap it). */
let cachedGate: DailyGate | null = null

export function getDailyGate(now: Date = new Date()): DailyGate {
  const day = todayKey(now)
  if (cachedGate && cachedGate.day === day) return cachedGate
  const { rooms, reviews, dataStatus } = useStore.getState()
  const forceKind = typeof window !== 'undefined' ? parseGateUrl(window.location.search).forceKind : null
  const gate = buildDailyGate(rooms, reviews, day, forceKind)
  const hadPrevious = cachedGate !== null
  // Only freeze the gate once real data is in.
  if (dataStatus === 'ready') cachedGate = gate
  if (hadPrevious) queueMicrotask(() => useGateSession.setState({ attempt: initialGateState, solvedToday: isSolvedToday(now) }))
  return gate
}

/** Test helper: forget the cached gate. */
export function resetGateSession() {
  cachedGate = null
  useGateSession.setState({ attempt: initialGateState, playRequested: false, locked: false, finished: false, solvedToday: isSolvedToday() })
}

declare global {
  interface Window {
    /** QA hook: the correct answer for the current gate puzzle. */
    __ESCAPE_GATE__?: { answer: () => string | string[] }
  }
}

export function installGateTestHook() {
  if (typeof window === 'undefined') return
  window.__ESCAPE_GATE__ = { answer: () => getDailyGate().challenge.answer }
}
