/**
 * Bottom-right HUD cluster in the 3D room: the camera mode toggle (first / third person, also
 * the `V` key) and the wardrobe button with your key balance. Bigger round buttons on touch
 * screens, clear of the joystick (bottom-left) and the Tap button (centre).
 *
 * Also loads your look once and shows a "+10 keys" toast after you log a room or finish
 * Escape of the Day.
 */
import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { useCameraMode } from '@/player/view'
import { useShell } from '@/ui/shell/shellStore'
import { IconEye, IconHanger, IconKey, IconPerson } from './icons'
import { installWardrobeSync, useWardrobe } from './store'

const SAFE_RIGHT = 'max(14px, env(safe-area-inset-right))'
const SAFE_BOTTOM = 'max(16px, env(safe-area-inset-bottom))'

export function openWardrobe() {
  useStore.getState().openOverlay({ kind: 'wardrobe' })
}

export function CharacterHud() {
  const worldReady = useStore((s) => s.worldReady)
  const overlayOpen = useStore((s) => s.overlay !== null)
  const isTouch = useStore((s) => s.isTouch)
  const mode = useCameraMode((s) => s.mode)
  const toggle = useCameraMode((s) => s.toggle)
  const keys = useWardrobe((s) => s.keys)

  useEffect(() => installWardrobeSync((n) => useShell.getState().showToast(`+${n} keys for the wardrobe`)), [])

  if (!worldReady || overlayOpen) return null
  const third = mode === 'third'
  const cameraLabel = third ? 'Switch to first person (V)' : 'Switch to third person (V)'
  const wardrobeLabel = keys ? `Wardrobe: change your look (${keys.balance} keys)` : 'Wardrobe: change your look'

  if (isTouch) {
    return (
      <div data-testid="character-hud" className="pointer-events-none fixed z-30 flex flex-col items-end gap-3 font-body text-ink" style={{ right: SAFE_RIGHT, bottom: `calc(${SAFE_BOTTOM} + 18px)` }}>
        <button
          type="button"
          data-testid="camera-toggle"
          aria-label={cameraLabel}
          aria-pressed={third}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_20px_rgba(40,20,20,.35)] ring-2 transition active:scale-95 ${
            third ? 'bg-teal text-white ring-[rgba(255,255,255,.6)]' : 'bg-panel/95 text-ink ring-panel-edge'
          }`}
        >
          {third ? <IconPerson width={26} height={26} /> : <IconEye width={26} height={26} />}
        </button>
        <button
          type="button"
          data-testid="wardrobe-button"
          aria-label={wardrobeLabel}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={openWardrobe}
          className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-panel/95 text-ink shadow-[0_8px_20px_rgba(40,20,20,.35)] ring-2 ring-panel-edge transition active:scale-95"
        >
          <IconHanger width={26} height={26} />
          {keys ? <KeyBadge n={keys.balance} /> : null}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="character-hud" className="pointer-events-none fixed z-30 flex items-center gap-2 font-body text-ink" style={{ right: SAFE_RIGHT, bottom: SAFE_BOTTOM }}>
      <button
        type="button"
        data-testid="camera-toggle"
        title={cameraLabel}
        aria-label={cameraLabel}
        aria-pressed={third}
        onClick={(e) => {
          toggle()
          // Keep V and the mouse working: don't leave focus on the button.
          e.currentTarget.blur()
        }}
        className={`pointer-events-auto flex h-11 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 backdrop-blur transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95 ${
          third ? 'bg-teal text-white ring-teal' : 'bg-panel/90 text-ink ring-panel-edge'
        }`}
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${third ? 'bg-white/15' : 'bg-[rgba(47,143,138,.12)] text-teal'}`}>
          {third ? <IconPerson width={20} height={20} /> : <IconEye width={20} height={20} />}
        </span>
        <span className="text-sm font-bold">{third ? 'Third person' : 'First person'}</span>
        <kbd className={`rounded-md border-b-2 px-1.5 font-mono text-[11px] font-semibold ${third ? 'border-white/60 bg-white text-ink' : 'border-panel-edge bg-paper text-ink'}`}>V</kbd>
      </button>
      <button
        type="button"
        data-testid="wardrobe-button"
        title={wardrobeLabel}
        aria-label={wardrobeLabel}
        onClick={openWardrobe}
        className="pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-panel/90 py-1 pr-3 pl-1.5 text-ink shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 ring-panel-edge backdrop-blur transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(224,123,57,.14)] text-accent">
          <IconHanger width={20} height={20} />
        </span>
        <span className="text-sm font-bold">Wardrobe</span>
        {keys ? (
          <span className="flex items-center gap-1 rounded-full bg-[rgba(224,169,58,.22)] px-2 py-0.5 text-xs font-extrabold text-[#8a5d0c]">
            <IconKey width={14} height={14} />
            {keys.balance}
          </span>
        ) : null}
      </button>
    </div>
  )
}

function KeyBadge({ n }: { n: number }) {
  return (
    <span className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full bg-warn px-1.5 text-[11px] font-extrabold text-ink shadow ring-2 ring-panel">
      <IconKey width={11} height={11} strokeWidth={2.6} />
      {n}
    </span>
  )
}
