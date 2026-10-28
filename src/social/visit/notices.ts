/**
 * In a friend's room, things that would change the room (logging a room, the wish list) stay
 * closed (src/state/store.ts refuses them). This says why, instead of a click doing nothing.
 */
import { bus } from '@/contracts/events'
import type { InteractableSpec } from '@/contracts/interaction'
import { useStore, type Visiting } from '@/state/store'
import { useShell } from '@/ui/shell/shellStore'

function ownerName(v: Visiting | null): string {
  return v?.owner?.displayName.trim().split(/\s+/)[0] || (v ? `@${v.handle}` : 'your friend')
}

export function visitNotice(): string {
  return `This is ${ownerName(useStore.getState().visiting)}'s room, so it's look-only. Log rooms and wishes in your own.`
}

/** Said when the trophy (Wrapped) is pressed in a friend's room. */
export function wrapNotice(): string {
  return `${ownerName(useStore.getState().visiting)}'s Wrapped is theirs to open. Yours is on the shelf in your own room.`
}

/**
 * The hover prompt ("[E] Log a new escape room") for things a visitor can't use: it says whose
 * they are and that they are look-only, instead of advertising an action that only shows a toast.
 */
export function visitorPromptLabel(spec: InteractableSpec, visiting: Visiting | null): string {
  if (!visiting) return spec.label
  const name = ownerName(visiting)
  switch (spec.event?.type) {
    case 'record:open':
      return `${name}'s desk (look only)`
    case 'wishlist:open':
      return `${name}'s wish list (look only)`
    case 'wrap:open':
      return `${name}'s trophy shelf (look only)`
    default:
      return spec.label
  }
}

export function installVisitNotices(): () => void {
  const say = () => {
    if (useStore.getState().visiting) useShell.getState().showToast(visitNotice())
  }
  const sayWrap = () => {
    if (useStore.getState().visiting) useShell.getState().showToast(wrapNotice())
  }
  const offs = [bus.on('wishlist:open', say), bus.on('record:open', say), bus.on('wrap:open', sayWrap)]
  return () => offs.forEach((o) => o())
}
