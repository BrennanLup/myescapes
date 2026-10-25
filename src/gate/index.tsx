// PLACEHOLDER (orchestrator). Owned by workstream 16: Memory Puzzle Gate.
import { AnchorPlaceholder } from '@/world/Anchor'

export function GateDoor() {
  return <AnchorPlaceholder name="gateDoor" color="#d4a24c" />
}

export function GateOverlay() {
  return null
}

/** Opens the gate overlay once per day on first visit. */
export function useGateAutoOpen() {}
