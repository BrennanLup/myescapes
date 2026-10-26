/**
 * Friends UI (workstream 35): invite link + QR (qrcode), search by @handle/email, requests,
 * per-friend auto-accept, inbox (pending tags, claims), notifications badge. STUB.
 */
import type { RouteProps } from '../router'
import { Placeholder } from '../pages/Placeholder'

export function InvitePage({ params }: RouteProps) {
  return <Placeholder title="You're invited" ws={35}><p className="mt-2 text-sm opacity-60">{params.code}</p></Placeholder>
}

export function FriendsPanel() {
  return <div data-testid="friends-panel" />
}

export function Inbox() {
  return <div data-testid="inbox" />
}

export function NotificationsBadge() {
  return null
}
