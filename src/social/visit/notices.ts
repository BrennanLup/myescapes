/**
 * In a friend's room, things that would change the room (logging a room, the wish list) stay
 * closed (src/state/store.ts refuses them). This says why, instead of a click doing nothing.
 */
import { bus } from '@/contracts/events'
import { useStore } from '@/state/store'
import { useShell } from '@/ui/shell/shellStore'

export function visitNotice(): string {
  const v = useStore.getState().visiting
  const name = v?.owner?.displayName.split(/\s+/)[0] ?? (v ? `@${v.handle}` : 'your friend')
  return `This is ${name}'s room, so it's look-only. Log rooms and wishes in your own.`
}

export function installVisitNotices(): () => void {
  const say = () => {
    if (useStore.getState().visiting) useShell.getState().showToast(visitNotice())
  }
  const offs = [bus.on('wishlist:open', say), bus.on('record:open', say)]
  return () => offs.forEach((o) => o())
}
