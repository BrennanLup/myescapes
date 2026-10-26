/**
 * Mobile rooms table and review detail (workstream 15). Uses ROUTES.logs and ROUTES.visit. STUB.
 */
export function RoomsTable(_props: { onOpen(visitId: string): void }) {
  return <div data-testid="rooms-table" />
}

export function ReviewDetail(_props: { visitId: string; onBack(): void }) {
  return <div data-testid="review-detail" />
}
