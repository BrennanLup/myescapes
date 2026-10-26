/**
 * Escape of the Day UI (workstream 22): /daily page, home-screen card (mobile), door overlay in
 * the 3D room, share grid, streaks, friends leaderboard. STUB.
 */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function DailyPage(_props: Partial<RouteProps>) {
  return <Placeholder title="Escape of the Day" ws={22} />
}

export function DailyCard() {
  return <div data-testid="daily-card" />
}
