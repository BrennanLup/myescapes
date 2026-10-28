/**
 * "Play in 3D": the way from the 2D game (the /daily page, the door overlay in your room) into the
 * puzzle room at /daily/room. Plain link semantics, so it also works as a normal page load.
 */
import type { MouseEvent } from 'react'
import { Link } from '../../router'

export const DAILY_ROOM_PATH = '/daily/room'

export function PlayIn3D({ onNavigate, compact }: { onNavigate?(e: MouseEvent<HTMLAnchorElement>): void; compact?: boolean }) {
  return (
    <Link
      to={DAILY_ROOM_PATH}
      data-testid="daily-play-3d"
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-2xl bg-chalk px-4 text-left text-[#f7efe0] shadow-sm ring-1 ring-black/10 transition hover:brightness-110 active:scale-[0.99] ${compact ? 'py-2.5' : 'py-3'}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f0c977] text-lg" aria-hidden>
        🚪
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold leading-tight">Play in 3D</span>
        <span className="block text-sm opacity-85">Walk around today's room, then out through the door.</span>
      </span>
      <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 font-display text-sm font-semibold text-white" aria-hidden>
        Enter
      </span>
    </Link>
  )
}
