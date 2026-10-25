/** Hint / skip / solve state machine for one gate attempt. Pure reducer. */

export type GateStatus = 'playing' | 'solved' | 'skipped'

export interface GateState {
  status: GateStatus
  misses: number
  hintsShown: number
  /** Found target ids (search-the-image). */
  found: string[]
}

export type GateAction =
  | { type: 'miss' }
  | { type: 'hint' }
  | { type: 'find'; id: string }
  | { type: 'solve' }
  | { type: 'skip' }
  | { type: 'reset' }

/** Hints start appearing automatically after this many misses. */
export const AUTO_HINT_AFTER = 2
/** Skip becomes available after this many misses (or once all hints are shown). */
export const SKIP_AFTER_MISSES = 3

export const initialGateState: GateState = { status: 'playing', misses: 0, hintsShown: 0, found: [] }

export function gateReducer(state: GateState, action: GateAction, totalHints: number): GateState {
  if (action.type === 'reset') return initialGateState
  if (state.status !== 'playing') return state
  switch (action.type) {
    case 'miss': {
      const misses = state.misses + 1
      const auto = misses >= AUTO_HINT_AFTER ? misses - AUTO_HINT_AFTER + 1 : 0
      return { ...state, misses, hintsShown: Math.min(totalHints, Math.max(state.hintsShown, auto)) }
    }
    case 'hint':
      return { ...state, hintsShown: Math.min(totalHints, state.hintsShown + 1) }
    case 'find':
      return state.found.includes(action.id) ? state : { ...state, found: [...state.found, action.id] }
    case 'solve':
      return { ...state, status: 'solved' }
    case 'skip':
      return canSkip(state, totalHints) ? { ...state, status: 'skipped' } : state
  }
}

export function canSkip(state: GateState, totalHints: number): boolean {
  return state.status === 'playing' && (state.misses >= SKIP_AFTER_MISSES || state.hintsShown >= totalHints)
}

export function canHint(state: GateState, totalHints: number): boolean {
  return state.status === 'playing' && state.hintsShown < totalHints
}
