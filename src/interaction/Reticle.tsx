/**
 * DOM overlay: centre reticle dot, the interact prompt chip (desktop "[E] label",
 * touch big round "Tap" button) and a "Click to look around" hint.
 */
import { useEffect, useState } from 'react'
import { useStore } from '@/state/store'
import { interactHovered, useInteraction } from './controller'
import { touchPrompt } from './logic'
import { useShell } from '@/ui/shell/shellStore'

/** Pointer lock happened at least once on this page. */
let everLocked = false

export function Reticle() {
  const overlay = useStore((s) => s.overlay)
  const worldReady = useStore((s) => s.worldReady)
  const isTouch = useStore((s) => s.isTouch)
  const storeLocked = useStore((s) => s.pointerLocked)
  const hovered = useInteraction((s) => s.hovered)
  const docLocked = useInteraction((s) => s.locked)
  const locked = storeLocked || docLocked
  // The controls hint card already explains click-to-look and sits in the same spot.
  const hintOpen = useShell((s) => s.hintOpen)
  const panelOpen = useShell((s) => s.hudPanelOpen)
  // Once you have clicked into the room you know how: the pill would only cover people's feet.
  const [learned, setLearned] = useState(everLocked)
  useEffect(() => {
    if (locked && !everLocked) {
      everLocked = true
      setLearned(true)
    }
  }, [locked])

  if (overlay || !worldReady) return null
  const active = !!hovered

  return (
    <div className="pointer-events-none fixed inset-0 z-20" data-testid="reticle-layer">
      {/* centre dot */}
      {(!isTouch || active) && (
        <div
          data-testid="reticle"
          data-hovering={active ? 'true' : 'false'}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out"
          style={{
            width: active ? 18 : 7,
            height: active ? 18 : 7,
            background: active ? 'rgba(45,226,208,0.22)' : 'rgba(255,247,236,0.85)',
            border: active ? '2.5px solid var(--color-led)' : '1px solid rgba(59,42,38,0.35)',
            boxShadow: active
              ? '0 0 12px rgba(45,226,208,0.75), 0 0 2px rgba(0,0,0,0.4)'
              : '0 0 6px rgba(255,200,150,0.5), 0 1px 2px rgba(0,0,0,0.35)',
          }}
        />
      )}

      {/* prompt */}
      {active && !isTouch && (
        <div
          data-testid="interact-prompt"
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 translate-y-10 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-panel-edge)] bg-panel/95 py-1.5 pl-1.5 pr-4 font-display text-[15px] font-medium text-ink shadow-[0_6px_18px_rgba(40,20,20,0.35)]"
        >
          <kbd
            aria-label="E key"
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg border border-[#2a7f79] bg-[var(--color-led)] px-1.5 font-mono text-[14px] font-semibold text-[#0d3532] shadow-[inset_0_-3px_0_rgba(0,0,0,0.22),0_1px_2px_rgba(0,0,0,0.3)]"
          >
            E
          </kbd>
          <span>{hovered.label}</span>
        </div>
      )}

      {active && isTouch && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 translate-y-8 flex-col items-center gap-2">
          <button
            type="button"
            data-testid="interact-tap"
            aria-label={touchPrompt(hovered.label)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => interactHovered()}
            className="pointer-events-auto flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-[var(--color-panel)] bg-[var(--color-led)] font-display text-xl font-semibold text-[#0d3532] shadow-[0_0_22px_rgba(45,226,208,0.65),0_8px_20px_rgba(30,15,15,0.4)] active:scale-95"
          >
            Tap
          </button>
          <span className="whitespace-nowrap rounded-full bg-panel/95 px-3 py-1 font-display text-[15px] font-medium text-ink shadow-[0_4px_12px_rgba(40,20,20,0.3)]">
            {hovered.label}
          </span>
        </div>
      )}

      {/* look hint (desktop, not locked) */}
      {!isTouch && !locked && !hintOpen && !learned && !panelOpen && (
        <div
          data-testid="look-hint"
          className="absolute bottom-[14%] left-1/2 -translate-x-1/2 animate-pulse whitespace-nowrap rounded-full bg-[rgba(42,31,45,0.62)] px-4 py-2 font-display text-[15px] text-[var(--color-panel)] shadow-[0_4px_14px_rgba(0,0,0,0.3)] backdrop-blur-sm"
        >
          Click to look around
        </div>
      )}
    </div>
  )
}
