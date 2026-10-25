import { useEffect, useRef, useState } from 'react'
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'

const LONG_PRESS_MS = 450
const CLOSE_DELAY_MS = 280

function SpeakerIcon({ muted, volume }: { muted: boolean; volume: number }) {
  const waves = muted || volume <= 0 ? 0 : volume < 0.4 ? 1 : 2
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" fill="currentColor" fillOpacity="0.18" />
      {muted || volume <= 0 ? (
        <>
          <path d="M16 9.5l5 5" />
          <path d="M21 9.5l-5 5" />
        </>
      ) : (
        <>
          {waves >= 1 && <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />}
          {waves >= 2 && <path d="M18.3 6.6a7.6 7.6 0 0 1 0 10.8" />}
        </>
      )}
    </svg>
  )
}

/**
 * Round cozy mute button for the HUD. Click/tap toggles mute; hover (mouse) or
 * long-press (touch) reveals a small volume slider.
 */
export function VolumeToggle() {
  const volume = useStore((s) => s.settings.volume)
  const muted = useStore((s) => s.settings.muted)
  const updateSettings = useStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const clearTimers = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    pressTimer.current = closeTimer.current = null
  }
  useEffect(() => clearTimers, [])

  // Tap outside closes the popover (touch).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const silent = muted || volume <= 0

  const toggle = () => {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (silent) {
      updateSettings({ muted: false, volume: volume <= 0 ? 0.5 : volume })
      bus.emit('sfx', { name: 'click' })
    } else {
      updateSettings({ muted: true })
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex pointer-events-auto"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        if (closeTimer.current) clearTimeout(closeTimer.current)
        setOpen(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
      }}
    >
      <button
        type="button"
        data-testid="volume-toggle"
        aria-label={silent ? 'Unmute sound' : 'Mute sound'}
        aria-pressed={silent}
        title={silent ? 'Sound off' : 'Sound on'}
        onClick={toggle}
        onPointerDown={(e) => {
          longPressed.current = false
          if (e.pointerType === 'mouse') return
          pressTimer.current = setTimeout(() => {
            longPressed.current = true
            setOpen(true)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onPointerCancel={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onContextMenu={(e) => e.preventDefault()}
        className={`grid h-12 w-12 place-items-center rounded-full border-2 border-panel-edge bg-panel shadow-cozy transition active:scale-95 hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal ${
          silent ? 'text-ink-soft' : 'text-accent'
        }`}
      >
        <SpeakerIcon muted={muted} volume={volume} />
      </button>
      {open && (
        <div
          data-testid="volume-popover"
          className="absolute right-0 top-full z-10 mt-2 flex items-center gap-2 rounded-cozy border-2 border-panel-edge bg-panel px-3 py-2 shadow-cozy"
        >
          <span className="font-display text-sm text-ink-soft">Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            data-testid="volume-slider"
            onChange={(e) => {
              const v = Number(e.target.value)
              updateSettings({ volume: v, muted: v <= 0 })
            }}
            className="h-8 w-32 cursor-pointer accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right font-mono text-xs text-ink-soft">{Math.round((muted ? 0 : volume) * 100)}</span>
        </div>
      )}
    </div>
  )
}
