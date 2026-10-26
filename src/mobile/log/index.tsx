/**
 * Mobile log flow (workstream 14): record (with IndexedDB retry queue via idb-keyval), transcribe,
 * extract, match (12), confirm, crew (36), save via ROUTES.createVisit. STUB.
 */
export interface LogFlowProps {
  onDone(visitId: string | null): void
}

export function LogFlow(_props: LogFlowProps) {
  return <div data-testid="log-flow">Logging is coming soon.</div>
}
