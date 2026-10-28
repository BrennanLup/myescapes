import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useStore } from '@/state/store'
import { bus } from '@/contracts/events'
import { SORT_KEYS, SORT_LABELS, type SortKey } from '@/contracts/types'
import { VolumeToggle } from '@/audio'
import { isTypingTarget, sortForKey } from './logic'
import { useServerStatus, useShell } from './shellStore'
import { hintLines, TouchLegend } from './hints'
import { useRealtime } from '@/net/store'
import { IconClose, IconGear, IconHelp, IconLock, IconMic, IconSort, IconStar, IconTrophy } from './icons'

export const HINT_AUTO_HIDE_MS = 8000
/** Height of the narrow-screen HUD stack (title line + button row + gap). */
const HUD_STACK_PX = 100
/** The friend's-room banner (src/social/visit) sits under the stack on narrow and touch screens. */
const VISIT_BANNER_PX = 50

const SAFE = {
  top: 'max(12px, env(safe-area-inset-top))',
  left: 'max(12px, env(safe-area-inset-left))',
  right: 'max(12px, env(safe-area-inset-right))',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
}

function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia?.(q)
      m?.addEventListener?.('change', cb)
      return () => m?.removeEventListener?.('change', cb)
    },
    () => window.matchMedia?.(q).matches ?? true,
    () => true,
  )
}

/** Sort hotkeys 1-6 while the world is active. */
function useSortHotkeys(active: boolean) {
  const setSort = useStore((s) => s.setSort)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return
      const key = sortForKey(e.key, e.code)
      if (key) setSort(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, setSort])
}

/** HUD: title, sort selector, action buttons, controls hint, toasts. */
export function Hud() {
  const worldReady = useStore((s) => s.worldReady)
  const overlayOpen = useStore((s) => s.overlay !== null)
  const visible = worldReady && !overlayOpen
  useSortHotkeys(visible)

  // Show the controls hint the first time the world becomes ready.
  const shownOnce = useRef(false)
  useEffect(() => {
    if (worldReady && !shownOnce.current) {
      shownOnce.current = true
      useShell.getState().openHint()
    }
  }, [worldReady])

  return (
    <>
      {visible ? <HudBar /> : null}
      {visible ? <ControlsHint /> : null}
      <Toast />
    </>
  )
}

function HudBar() {
  const wide = useMediaQuery('(min-width: 768px)')
  const rooms = useStore((s) => s.rooms.length)
  // In a friend's room (Phase 3 C) nothing can be logged or wished for: src/social/visit shows a banner instead.
  const visit = useStore((s) => s.visiting)
  const visiting = visit !== null
  const owner = visit ? (visit.owner?.displayName.trim().split(/\s+/)[0] || `@${visit.handle}`) : null
  const title = (
    <div data-testid="hud-title" className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full bg-panel/90 px-3.5 py-1.5 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 ring-panel-edge backdrop-blur">
      <IconLock width={18} height={18} className="shrink-0 text-accent" />
      <span className="truncate font-display text-base font-semibold leading-none">{owner ? `${owner}'s escapes` : 'My Escapes'}</span>
      <span className="shrink-0 rounded-full bg-[rgba(47,143,138,.14)] px-2 py-0.5 text-xs font-bold text-teal">
        {rooms} {rooms === 1 ? 'room' : 'rooms'}
      </span>
    </div>
  )
  const buttons = (
    <>
      {!wide ? <SortMenu /> : null}
      {!visiting ? (
        <RoundButton label="Wish list" onClick={() => bus.emit('wishlist:open')} testId="wishlist-button">
          <IconStar />
        </RoundButton>
      ) : null}
      {!visiting ? (
        <RoundButton label="Year in Escape Rooms" onClick={() => bus.emit('wrap:open')} testId="wrap-button">
          <IconTrophy />
        </RoundButton>
      ) : null}
      {!visiting ? (
        <RoundButton label="Log a new room" onClick={() => bus.emit('record:open')} testId="record-button" accent>
          <IconMic />
        </RoundButton>
      ) : null}
      <RoundButton label="Settings" onClick={() => bus.emit('settings:open')} testId="settings-button">
        <IconGear />
      </RoundButton>
      <div className="pointer-events-auto empty:hidden">
        <VolumeToggle />
      </div>
      <RoundButton label="Controls help" onClick={() => useShell.getState().openHint()} testId="help-button">
        <IconHelp />
      </RoundButton>
    </>
  )

  if (!wide) {
    // Narrow screens: title + badge on one line, then a single row of buttons along
    // the top edge, so nothing sits over the sides of the view.
    return (
      <div data-testid="hud" className="pointer-events-none fixed inset-0 z-30 font-body text-ink">
        <div className="absolute flex flex-col gap-2" style={{ top: SAFE.top, left: SAFE.left, right: SAFE.right }}>
          <div className="flex flex-wrap items-center gap-2">
            {title}
            <ModeBadge />
          </div>
          <div data-testid="hud-row" className="flex items-center justify-between gap-1">
            {buttons}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="hud" className="pointer-events-none fixed inset-0 z-30 font-body text-ink">
      {/* top-left */}
      <div className="absolute flex flex-col items-start gap-2" style={{ top: SAFE.top, left: SAFE.left }}>
        {title}
        <ModeBadge />
      </div>

      {/* top-right */}
      <div className="absolute flex flex-col items-end gap-2" style={{ top: SAFE.top, right: SAFE.right }}>
        <div className="flex flex-row items-center gap-2">{buttons}</div>
        <SortChips />
      </div>
    </div>
  )
}

function RoundButton({
  label,
  onClick,
  children,
  testId,
  accent,
  active,
}: {
  label: string
  onClick(): void
  children: ReactNode
  testId?: string
  accent?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95 ${
        accent ? 'bg-accent text-accent-ink ring-[rgba(255,217,176,.6)]' : active ? 'bg-teal text-white ring-teal' : 'bg-panel/95 text-ink ring-panel-edge hover:bg-panel'
      }`}
    >
      {children}
    </button>
  )
}

function SortChip({ k, current, onPick }: { k: SortKey; current: SortKey; onPick(k: SortKey): void }) {
  const on = k === current
  const n = SORT_KEYS.indexOf(k) + 1
  return (
    <button
      type="button"
      data-testid={`sort-${k}`}
      aria-pressed={on}
      title={`Sort the board by ${SORT_LABELS[k].toLowerCase()} (key ${n})`}
      onClick={() => onPick(k)}
      className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition active:scale-95 ${
        on ? 'bg-teal text-white shadow-[0_0_0_2px_rgba(45,226,208,.35)]' : 'text-ink-soft hover:bg-[rgba(224,123,57,.12)] hover:text-ink'
      }`}
    >
      <span className={`font-mono text-[10px] ${on ? 'text-white/75' : 'text-ink-soft/70'}`}>{n}</span>
      {SORT_LABELS[k]}
    </button>
  )
}

/** Desktop: always-visible chip group. */
function SortChips() {
  const sort = useStore((s) => s.sort)
  const setSort = useStore((s) => s.setSort)
  return (
    <div
      role="group"
      aria-label="Sort the board"
      data-testid="sort-chips"
      className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-panel/90 p-1 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 ring-panel-edge backdrop-blur"
    >
      <span className="flex items-center gap-1 pr-1 pl-2 text-xs font-bold tracking-wide text-ink-soft uppercase">
        <IconSort width={16} height={16} />
        Sort
      </span>
      {SORT_KEYS.map((k) => (
        <SortChip key={k} k={k} current={sort} onPick={setSort} />
      ))}
    </div>
  )
}

/** Mobile: a round button that opens the chip list. */
function SortMenu() {
  const sort = useStore((s) => s.sort)
  const setSort = useStore((s) => s.setSort)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div className="relative" ref={root}>
      <RoundButton label={`Sort: ${SORT_LABELS[sort]}`} onClick={() => setOpen((o) => !o)} testId="sort-button" active={open}>
        <IconSort />
      </RoundButton>
      {open ? (
        <div
          role="group"
          aria-label="Sort the board"
          className="pointer-events-auto absolute top-full left-0 z-10 mt-2 flex w-40 flex-col gap-0.5 rounded-cozy bg-panel p-2 shadow-cozy ring-1 ring-panel-edge"
        >
          <span className="px-2 pb-1 text-xs font-bold tracking-wide text-ink-soft uppercase">Sort board by</span>
          {SORT_KEYS.map((k) => (
            <SortChip
              key={k}
              k={k}
              current={sort}
              onPick={(key) => {
                setSort(key)
                setOpen(false)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** "Demo mode" badge when extraction is mocked or storage is the seed. */
function ModeBadge() {
  const { status } = useServerStatus()
  const seed = useStore((s) => s.dataSource) === 'seed'
  if (!status) return null
  const mockAi = status.extraction === 'mock'
  if (!mockAi && !seed) return null
  const parts = [mockAi ? 'voice notes use a mock extractor (no ANTHROPIC_API_KEY)' : null, seed ? 'the rooms shown are built-in demo data, not your own' : null].filter(Boolean)
  const tip = `Demo mode: ${parts.join('; ')}. Open settings for details.`
  return (
    <button
      type="button"
      data-testid="mode-badge"
      title={tip}
      aria-label={tip}
      onClick={() => bus.emit('settings:open')}
      className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[rgba(224,169,58,.95)] px-3 py-1 text-xs font-extrabold tracking-wide text-ink uppercase shadow-[0_4px_12px_rgba(40,20,20,.25)] transition hover:scale-105"
    >
      <span className="h-2 w-2 rounded-full bg-ink/70" />
      Demo mode
    </button>
  )
}

function ControlsHint() {
  const open = useShell((s) => s.hintOpen)
  const nonce = useShell((s) => s.hintNonce)
  const isTouch = useStore((s) => s.isTouch)
  const visiting = useStore((s) => s.visiting !== null)
  const live = useRealtime((s) => s.status !== 'off')
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (!open) return
    setFading(false)
    const fade = setTimeout(() => setFading(true), HINT_AUTO_HIDE_MS - 600)
    const hide = setTimeout(() => useShell.getState().closeHint(), HINT_AUTO_HIDE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(hide)
    }
  }, [open, nonce])

  if (!open) return null
  const lines = hintLines(isTouch, live)
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      // Touch: under the HUD at the top, clear of the joystick and the tap button.
      style={isTouch ? { top: `calc(${SAFE.top} + ${HUD_STACK_PX + (visiting ? VISIT_BANNER_PX : 0)}px)` } : { bottom: SAFE.bottom }}
    >
      <div
        data-testid="controls-hint"
        role="status"
        className="pointer-events-auto relative w-full max-w-sm rounded-cozy bg-panel/95 px-5 pt-4 pb-4 text-ink shadow-cozy ring-1 ring-panel-edge transition-opacity duration-500"
        style={{ opacity: fading ? 0 : 1 }}
      >
        <button
          type="button"
          aria-label="Dismiss controls hint"
          data-testid="hint-close"
          onClick={() => useShell.getState().closeHint()}
          className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-[rgba(224,123,57,.12)] hover:text-ink"
        >
          <IconClose width={18} height={18} />
        </button>
        <p className="mb-2 font-display text-lg font-semibold">How to play</p>
        <ul className="flex flex-col gap-1.5 text-[15px]">
          {lines.map(([k, rest]) => (
            <li key={k} className="flex items-baseline gap-2">
              <kbd className="shrink-0 rounded-lg border-b-2 border-panel-edge bg-paper px-2 py-0.5 font-mono text-xs font-semibold text-ink">{k}</kbd>
              <span className="text-ink-soft">{rest}</span>
            </li>
          ))}
        </ul>
        {isTouch ? <TouchLegend live={live} /> : <p className="mt-2 text-xs text-ink-soft/80">Keys 1-6 re-sort the board.</p>}
      </div>
    </div>
  )
}

const TOAST_MS = 4500
/** Desktop: below the button row and the sort chips under it, so a long toast covers neither. */
const TOAST_WIDE_TOP_PX = 112

function Toast() {
  const toast = useShell((s) => s.toast)
  const wide = useMediaQuery('(min-width: 768px)')
  const visiting = useStore((s) => s.visiting !== null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useShell.getState().clearToast(toast.id), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: `calc(${SAFE.top} + ${wide ? TOAST_WIDE_TOP_PX : HUD_STACK_PX + (visiting ? VISIT_BANNER_PX : 0)}px)` }}>
      <div data-testid="shell-toast" role="status" className="rounded-full bg-ink/90 px-4 py-2 text-sm font-semibold text-paper shadow-cozy">
        {toast.text}
      </div>
    </div>
  )
}
