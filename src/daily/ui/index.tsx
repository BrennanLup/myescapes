/**
 * Escape of the Day UI (workstream 22).
 * - `DailyPage`: the /daily page, for phones and desktops (no three.js).
 * - `DailyCard`: the mobile home-screen card linking to /daily.
 * - The door overlay for the 3D room lives in ./overlay (`DailyOverlay`), so this entry stays
 *   free of the 3D room's store.
 */
import { useEffect } from 'react'
import type { RouteProps } from '../../router'
import { Link } from '../../router'
import { formatDuration } from '../engine'
import { DailyGame, useDailyToday } from './DailyGame'
import { loadProgress } from './state'

export { DailyGame, StreakStats } from './DailyGame'

export function DailyPage(_props: Partial<RouteProps>) {
  useEffect(() => {
    const prev = document.title
    document.title = 'Escape of the Day · My Escapes'
    return () => {
      document.title = prev
    }
  }, [])
  return (
    <main data-testid="daily-page" className="min-h-dvh overflow-y-auto bg-panel font-body text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-8" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <nav className="flex items-center justify-between py-2 text-sm">
          <Link to="/" className="font-display text-lg font-semibold text-ink">
            ← My Escapes
          </Link>
          <Link to="/m" className="text-ink-soft underline">
            My rooms
          </Link>
        </nav>
        <div className="mt-2 flex-1 rounded-cozy bg-white/60 px-3 py-5 shadow-sm ring-1 ring-panel-edge sm:px-6">
          <DailyGame />
        </div>
        <footer className="mt-6 flex justify-center gap-4 text-xs text-ink-soft underline">
          <a href="/about">About</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </footer>
      </div>
    </main>
  )
}

/** Home-screen card for the mobile app. Always a plain link to /daily, even if loading fails. */
export function DailyCard() {
  const [load] = useDailyToday()
  let line = 'A new puzzle every day. Same one for everyone.'
  let cta = 'Play'
  let number: number | null = null
  if (load.status === 'ready') {
    const { puzzle, result, streak } = load.today
    number = puzzle.number
    const local = loadProgress(puzzle.day, puzzle.number)
    const done = result?.finishedAt ? result : null
    if (done) {
      line = done.solved ? `Escaped in ${done.guesses}/${puzzle.maxGuesses} · ${formatDuration(done.timeMs)}` : 'Locked today. Try again tomorrow.'
      cta = 'See result'
    } else if (local.status === 'solved' || local.status === 'failed') {
      line = local.status === 'solved' ? `Escaped in ${local.guesses.length}/${puzzle.maxGuesses}` : 'Locked today. Try again tomorrow.'
      cta = 'See result'
    } else if (local.status === 'playing') {
      line = `${puzzle.maxGuesses - local.guesses.length} guesses left`
      cta = 'Continue'
    } else if (puzzle.theme) {
      line = `Inspired by ${puzzle.theme.gameName}, ${puzzle.theme.city}`
    }
    if (streak && streak.current > 0) line += ` · 🔥 ${streak.current}`
  }
  return (
    <Link
      to="/daily"
      data-testid="daily-card"
      className="flex items-center gap-3 rounded-cozy bg-chalk px-4 py-3 text-[#f7efe0] shadow-sm ring-1 ring-black/10 transition active:scale-[0.99]"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f0c977] text-xl" aria-hidden>
        🔐
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold leading-tight">Escape of the Day{number ? ` #${number}` : ''}</span>
        <span className="block truncate text-sm opacity-85" data-testid="daily-card-line">
          {line}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 font-display text-sm font-semibold text-white">{cta}</span>
    </Link>
  )
}
