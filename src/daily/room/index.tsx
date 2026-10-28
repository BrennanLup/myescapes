/**
 * Escape of the Day as a playable 3D puzzle room: the `/daily/room` page (lazy-loaded, so /daily and
 * the phone app never download three.js). Loads today's puzzle like the 2D game, then mounts the
 * room. If loading fails it offers a retry and the 2D page.
 */
import { useEffect } from 'react'
import type { RouteProps } from '../../router'
import { Link } from '../../router'
import { useDailyToday } from '../ui/DailyGame'
import { DailyRoom } from './DailyRoom'

export function DailyRoomPage(_props: Partial<RouteProps>) {
  useEffect(() => {
    const prev = document.title
    document.title = 'Escape of the Day in 3D · My Escapes'
    return () => {
      document.title = prev
    }
  }, [])
  const [load, setToday, reload] = useDailyToday()
  if (load.status === 'ready') return <DailyRoom key={load.today.puzzle.day} today={load.today} setToday={setToday} reload={reload} />
  return (
    <main
      data-testid="daily-room-loading"
      className="fixed inset-0 flex items-center justify-center px-4 font-body text-[#ffe9d2]"
      style={{ background: 'linear-gradient(180deg, #2a1f2d 0%, #3d2638 55%, #5b2f3d 100%)' }}
    >
      {load.status === 'loading' ? (
        <p className="font-display text-xl">Unlocking today's room…</p>
      ) : (
        <div className="max-w-sm text-center" data-testid="daily-room-error">
          <p className="font-display text-xl">{load.message}</p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <button type="button" onClick={reload} className="min-h-12 rounded-full bg-accent px-6 font-display font-semibold text-white">
              Try again
            </button>
            <Link to="/daily" className="underline">
              Play the 2D version
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
