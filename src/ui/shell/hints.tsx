/**
 * What the "How to play" card lists (QA r3: it also covers the Phase 3 controls now): people,
 * chat and emotes when the room is live, the camera switch and the wardrobe. On touch screens it
 * ends with a small legend of the round buttons on the right, top to bottom as they sit there.
 */
import type { ReactNode } from 'react'
import { IconChat, IconPeople, IconWave } from '@/social/visit/icons'
import { IconEye, IconHanger } from '@/ui/wardrobe/icons'

export type HintLine = [key: string, text: string]

/** Keyboard (or gesture) lines. `live` = the realtime room is on (people, chat, emotes). */
export function hintLines(touch: boolean, live: boolean): HintLine[] {
  if (touch) {
    return [
      ['Left thumb', 'to walk'],
      ['Drag', 'to look around'],
      ['Tap', 'things to interact'],
    ]
  }
  const lines: HintLine[] = [
    ['WASD', 'to walk, mouse to look (click to lock)'],
    ['Click / E', 'to interact'],
    ['Esc', 'to release the mouse'],
    ['V', 'to see your character (third person)'],
  ]
  if (live) lines.push(['F · T', 'people here · chat (Enter too)'])
  lines.push(['Wardrobe', 'button, bottom right: your look'])
  return lines
}

export interface LegendItem {
  id: string
  icon: ReactNode
  label: string
}

/** The round buttons down the right edge on touch screens, top to bottom. */
export function touchLegend(live: boolean): LegendItem[] {
  const s = { width: 16, height: 16 }
  const items: LegendItem[] = []
  if (live) {
    items.push({ id: 'people', icon: <IconPeople {...s} />, label: 'People here' })
    items.push({ id: 'chat', icon: <IconChat {...s} />, label: 'Chat' })
    items.push({ id: 'emotes', icon: <IconWave {...s} />, label: 'Wave, cheer, dance' })
  }
  items.push({ id: 'camera', icon: <IconEye {...s} />, label: 'See your character' })
  items.push({ id: 'wardrobe', icon: <IconHanger {...s} />, label: 'Wardrobe: your look' })
  return items
}

/** The legend block under the touch lines. */
export function TouchLegend({ live }: { live: boolean }) {
  return (
    <div data-testid="hint-legend" className="mt-2.5 border-t border-panel-edge/70 pt-2">
      <p className="mb-1.5 text-xs font-extrabold tracking-wider text-ink-soft uppercase">Round buttons on the right</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
        {touchLegend(live).map((it) => (
          <li key={it.id} data-testid={`hint-legend-${it.id}`} className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper text-ink ring-1 ring-panel-edge">{it.icon}</span>
            <span className="text-ink-soft">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
