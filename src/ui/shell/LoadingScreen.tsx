import { useEffect, useMemo, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useStore } from '@/state/store'
import { bus } from '@/contracts/events'
import { computeProgress, loadingMessage, MIN_LOADING_MS, readFlags } from './logic'
import { IconKey } from './icons'

const FADE_MS = 550

const CSS = `
@keyframes esc-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
@keyframes esc-key { 0%,100% { transform: translate(0,0) rotate(-8deg) } 45% { transform: translate(-7px,2px) rotate(0deg) } 60% { transform: translate(-7px,2px) rotate(18deg) } }
@keyframes esc-shackle { 0%,55% { transform: translateY(0) } 65%,85% { transform: translateY(-5px) } 100% { transform: translateY(0) } }
@keyframes esc-glow { 0%,100% { opacity: .45 } 50% { opacity: .8 } }
@keyframes esc-shine { from { background-position: 0 0 } to { background-position: 40px 0 } }
@keyframes esc-pop { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }
.esc-float { animation: esc-float 3.2s ease-in-out infinite }
.esc-key { animation: esc-key 2.4s ease-in-out infinite; transform-origin: 70% 50%; transform-box: fill-box }
.esc-shackle { animation: esc-shackle 2.4s ease-in-out infinite }
.esc-glow { animation: esc-glow 4s ease-in-out infinite }
.esc-bar { background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0 10px, transparent 10px 20px); animation: esc-shine .9s linear infinite }
.esc-pop { animation: esc-pop .35s ease-out both }
@media (prefers-reduced-motion: reduce) { .esc-float, .esc-key, .esc-shackle, .esc-glow, .esc-bar { animation: none } }
`

/** Full-screen loading view. Calls setWorldReady(true) once the player enters. */
export function LoadingScreen() {
  const worldReady = useStore((s) => s.worldReady)
  const dataStatus = useStore((s) => s.dataStatus)
  const dataError = useStore((s) => s.dataError)
  const loadData = useStore((s) => s.loadData)
  const setWorldReady = useStore((s) => s.setWorldReady)
  const { progress: assetProgress, active: assetActive, total: assetTotal } = useProgress()
  const flags = useMemo(readFlags, [])

  const mountedAt = useRef(performance.now())
  const [now, setNow] = useState(() => performance.now())
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'gone'>('loading')

  const { percent, ready, error } = computeProgress({
    assetProgress,
    assetActive,
    assetTotal,
    dataStatus,
    elapsedMs: now - mountedAt.current,
    minMs: MIN_LOADING_MS,
  })

  // Tick the clock over the minimum display time so the bar glides up.
  const timeDone = now - mountedAt.current >= MIN_LOADING_MS
  useEffect(() => {
    if (timeDone || phase !== 'loading') return
    const t = setInterval(() => setNow(performance.now()), 50)
    return () => clearInterval(t)
  }, [timeDone, phase])

  const enter = useRef((_gesture: boolean) => {})
  enter.current = (gesture: boolean) => {
    if (phase !== 'loading') return
    setPhase('leaving')
    // Only a real click/key press may unlock audio; automation's autostart is not one.
    if (gesture) bus.emit('user:gesture')
  }

  useEffect(() => {
    if (phase !== 'leaving') return
    const t = setTimeout(() => {
      setWorldReady(true)
      setPhase('gone')
    }, FADE_MS)
    return () => clearTimeout(t)
  }, [phase, setWorldReady])

  // Automation: skip the button.
  useEffect(() => {
    if (ready && flags.autostart) enter.current(false)
  }, [ready, flags.autostart])

  // Enter / Space also enters once ready.
  useEffect(() => {
    if (!ready || phase !== 'loading') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        enter.current(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, phase])

  if (phase === 'gone' || (worldReady && phase === 'loading')) return null

  const leaving = phase === 'leaving'
  const shown = leaving ? 100 : percent

  return (
    <div
      data-testid="loading-screen"
      role="dialog"
      aria-label="Loading My Escapes"
      aria-busy={!ready}
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden px-4 font-body text-paper transition-opacity ease-out"
      style={{
        opacity: leaving ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
        pointerEvents: leaving ? 'none' : 'auto',
        background:
          'radial-gradient(120% 80% at 50% 110%, #b8503f 0%, rgba(184,80,63,0) 55%), radial-gradient(90% 70% at 85% -10%, rgba(45,226,208,.25) 0%, rgba(45,226,208,0) 60%), linear-gradient(180deg, #2a1f2d 0%, #3d2638 55%, #5b2f3d 100%)',
      }}
    >
      <style>{CSS}</style>
      {/* Lamp glow and LED twinkles */}
      <div
        className="esc-glow pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,179,107,.45) 0%, rgba(255,179,107,0) 70%)' }}
      />
      <Twinkles />

      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <PolaroidLock />
        <h1 className="mt-4 font-display text-5xl font-semibold tracking-tight text-[#ffe9d2] drop-shadow-[0_4px_18px_rgba(255,140,60,.45)] sm:text-6xl">
          My Escapes
        </h1>
        <p className="mt-2 font-hand text-2xl text-[#f7b98a]">every room we ever broke out of</p>

        <div className="mt-8 w-full max-w-sm">
          <div
            className="h-4 w-full overflow-hidden rounded-full bg-[rgba(255,247,236,.12)] p-[3px] ring-1 ring-[rgba(255,247,236,.18)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shown}
            data-testid="loading-progress"
          >
            <div
              className={`esc-bar h-full rounded-full ${error ? 'bg-bad' : 'bg-accent'}`}
              style={{ width: `${Math.max(4, shown)}%`, boxShadow: error ? 'none' : '0 0 14px rgba(255,160,90,.7)' }}
            />
          </div>
          <div className="mt-2 flex justify-between text-sm text-[rgba(255,233,210,.75)]">
            <span>{loadingMessage(shown, dataStatus)}</span>
            <span className="font-mono">{shown}%</span>
          </div>
        </div>

        <div className="mt-8 flex min-h-[124px] flex-col items-center">
          {error ? (
            <div className="esc-pop flex flex-col items-center gap-3" data-testid="loading-error">
              <p className="max-w-xs text-[rgba(255,233,210,.9)]">
                We couldn't fetch the room's records.
                {dataError ? <span className="mt-1 block font-mono text-xs text-[rgba(255,233,210,.6)]">{dataError}</span> : null}
              </p>
              <button
                type="button"
                data-testid="retry-button"
                onClick={() => void loadData()}
                className="min-h-12 rounded-full bg-panel px-7 font-display text-lg font-semibold text-ink shadow-cozy transition hover:scale-[1.03] active:scale-95"
              >
                Try again
              </button>
            </div>
          ) : ready && !flags.autostart ? (
            <div className="esc-pop flex flex-col items-center gap-3">
              <button
                type="button"
                data-testid="enter-button"
                autoFocus
                onClick={() => enter.current(true)}
                className="flex min-h-14 items-center gap-3 rounded-full bg-accent px-9 font-display text-xl font-semibold text-accent-ink shadow-[0_10px_30px_rgba(224,123,57,.55)] ring-4 ring-[rgba(255,217,176,.25)] transition hover:scale-[1.04] hover:bg-[#ea8a48] focus-visible:outline-none focus-visible:ring-[rgba(45,226,208,.7)] active:scale-95"
              >
                <IconKey width={26} height={26} />
                Enter the room
              </button>
              <p className="text-sm text-[rgba(255,233,210,.6)]">Sound on for the full cozy experience</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Three fanned polaroids with a padlock and a wiggling key. */
function PolaroidLock() {
  return (
    <svg viewBox="0 0 220 170" width={220} height={170} className="esc-float" aria-hidden="true">
      <defs>
        <filter id="esc-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#1a0f14" floodOpacity="0.45" />
        </filter>
      </defs>
      <g filter="url(#esc-shadow)">
        <Polaroid x={38} y={34} rot={-14} photo="#2f8f8a" sky="#9fc6ff" />
        <Polaroid x={118} y={30} rot={12} photo="#6d3b5c" sky="#f7b98a" />
        <Polaroid x={78} y={18} rot={-2} photo="#c0603f" sky="#ffd9b0" />
        {/* push pin */}
        <circle cx="110" cy="24" r="6" fill="#e8433a" />
        <circle cx="108" cy="22" r="2" fill="#ffb3a8" />
      </g>
      {/* padlock */}
      <g transform="translate(118 92)" filter="url(#esc-shadow)">
        <path className="esc-shackle" d="M8 18V10a14 14 0 0 1 28 0v8" fill="none" stroke="#9aa3a8" strokeWidth="6" strokeLinecap="round" />
        <rect x="0" y="16" width="44" height="36" rx="9" fill="#d4a24c" />
        <rect x="0" y="16" width="44" height="8" rx="4" fill="#e8bf6a" />
        <circle cx="22" cy="32" r="4.5" fill="#5a3a2a" />
        <rect x="20" y="33" width="4" height="9" rx="2" fill="#5a3a2a" />
      </g>
      {/* key */}
      <g transform="translate(166 116)">
        <g className="esc-key">
          <circle cx="26" cy="8" r="9" fill="none" stroke="#ffd9b0" strokeWidth="5" />
          <path d="M17 8H2M6 8v6M11 8v4" stroke="#ffd9b0" strokeWidth="5" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  )
}

function Polaroid({ x, y, rot, photo, sky }: { x: number; y: number; rot: number; photo: string; sky: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} 32 38)`}>
      <rect width="64" height="76" rx="3" fill="#fbf5ea" />
      <rect x="6" y="6" width="52" height="48" fill={sky} />
      <path d="M6 54 L22 34 L32 44 L44 28 L58 46 V54 Z" fill={photo} />
      <circle cx="46" cy="16" r="5" fill="#fff3d6" />
      <rect x="14" y="62" width="34" height="3" rx="1.5" fill="#c9b8a6" />
    </g>
  )
}

const STARS = [
  [8, 14, 2],
  [18, 70, 1.5],
  [30, 30, 1],
  [70, 18, 1.5],
  [82, 62, 2],
  [92, 28, 1],
  [12, 88, 1],
  [88, 86, 1.5],
] as const

function Twinkles() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {STARS.map(([l, t, s], i) => (
        <span
          key={i}
          className="esc-glow absolute rounded-full"
          style={{
            left: `${l}%`,
            top: `${t}%`,
            width: s * 4,
            height: s * 4,
            background: i % 2 ? '#2de2d0' : '#ffb36b',
            boxShadow: `0 0 ${s * 8}px ${i % 2 ? '#2de2d0' : '#ffb36b'}`,
            animationDelay: `${i * 0.45}s`,
          }}
        />
      ))}
    </div>
  )
}
