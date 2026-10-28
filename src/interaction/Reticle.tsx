/**
 * DOM overlay: centre reticle dot, the interact prompt chip (desktop "[E] label",
 * touch big round "Tap" button) and a "Click to look around" hint.
 *
 * On touch in third person the Tap button moves from the centre to the bottom right, just above
 * the round buttons there (`cornerBottom`): in the centre it sat on your character's head.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { useStore } from '@/state/store'
import { useCameraMode } from '@/player/view'
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

  const third = useCameraMode((s) => s.mode === 'third')
  const active = !!hovered
  const corner = isTouch && third
  const cornerAt = useCornerBottom(corner && active && !overlay && worldReady)

  if (overlay || !worldReady) return null

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

      {active && isTouch && corner && (
        <div
          data-testid="interact-tap-corner"
          className="absolute flex flex-col items-end gap-2"
          style={{ right: 'max(14px, env(safe-area-inset-right))', bottom: cornerAt === null ? CORNER_FALLBACK : cornerAt }}
        >
          <span className="max-w-[min(260px,70vw)] truncate rounded-full bg-panel/95 px-3 py-1 font-display text-[15px] font-medium text-ink shadow-[0_4px_12px_rgba(40,20,20,0.3)]">
            {hovered.label}
          </span>
          <TapButton label={hovered.label} />
        </div>
      )}

      {active && isTouch && !corner && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 translate-y-8 flex-col items-center gap-2">
          <TapButton label={hovered.label} />
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

function TapButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      data-testid="interact-tap"
      aria-label={touchPrompt(label)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => interactHovered()}
      className="pointer-events-auto flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-[var(--color-panel)] bg-[var(--color-led)] font-display text-xl font-semibold text-[#0d3532] shadow-[0_0_22px_rgba(45,226,208,0.65),0_8px_20px_rgba(30,15,15,0.4)] active:scale-95"
    >
      Tap
    </button>
  )
}

/** Before the round buttons on the right have been measured: above the camera and wardrobe buttons. */
const CORNER_FALLBACK = 'calc(max(16px, env(safe-area-inset-bottom)) + 170px)'
/** The round button clusters on the right of a touch screen (character HUD, people dock). */
const RIGHT_CLUSTERS = '[data-testid="character-hud"], [data-testid="people-dock"]'

/**
 * Bottom offset (px) that puts the corner Tap button 12 px above the highest round button on the
 * right edge of the screen, or null before anything was measured. Re-measured on resize.
 */
export function cornerBottom(rects: Array<Pick<DOMRect, 'top' | 'right' | 'width' | 'height'>>, viewportW: number, viewportH: number): number | null {
  let top = Infinity
  for (const r of rects) {
    // Only clusters on the right half count (the people dock sits bottom left on desktop).
    if (!r.width || !r.height || r.right < viewportW / 2) continue
    top = Math.min(top, r.top)
  }
  return Number.isFinite(top) ? Math.max(0, Math.round(viewportH - top + 12)) : null
}

function useCornerBottom(enabled: boolean): number | null {
  const [bottom, setBottom] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    const measure = () => {
      const rects = Array.from(document.querySelectorAll(RIGHT_CLUSTERS), (el) => el.getBoundingClientRect())
      setBottom(cornerBottom(rects, window.innerWidth, window.innerHeight))
    }
    measure()
    window.addEventListener('resize', measure)
    // The people dock can appear or grow (connection chip) while the button is up.
    const id = window.setInterval(measure, 1000)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(id)
    }
  }, [enabled])
  return bottom
}
