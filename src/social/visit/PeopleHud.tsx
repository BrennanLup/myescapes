/**
 * People in the 3D room (Phase 3, workstream C): who is here, chat, emotes, "Visit a friend",
 * and, in a friend's room, the visiting banner with "Back to my room". Mounted once by App.tsx.
 *
 * Desktop: a dock at the bottom left (People, Chat, three emotes) with the chat log above it.
 *   `T` or `Enter` opens the chat box, `F` the people panel, `Esc` closes them.
 * Phones and tablets: round buttons on the right above the camera and wardrobe buttons (beside
 *   them in landscape); people and chat open as sheets (chat at the top, clear of the keyboard).
 *
 * Signed-out demo visitors have no socket, so they see none of this.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { EMOTES, REALTIME_LIMITS, type Emote, type FriendPresence } from '@/contracts/realtime'
import type { PublicUser } from '@/contracts/models'
import { useStore } from '@/state/store'
import { isTypingTarget } from '@/ui/shell/logic'
import { useShell } from '@/ui/shell/shellStore'
import { kickPlayer, sendChat, sendEmote } from '@/net/session'
import { firstName, friendsInOrder, playersInOrder, useRealtime, whereLabel, type ChatLine, type Player } from '@/net/store'
import { homeUrl, pageNav, setSpoilersShown, spoilersShown, visitUrl } from './state'
import { IconBack, IconChat, IconCheer, IconClose, IconDance, IconEyeOff, IconHome, IconPeople, IconSend, IconWave } from './icons'

type Panel = null | 'people' | 'chat' | 'emotes'

const SAFE = {
  top: 'max(12px, env(safe-area-inset-top))',
  left: 'max(12px, env(safe-area-inset-left))',
  right: 'max(14px, env(safe-area-inset-right))',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
}
/** The narrow-screen HUD stack (src/ui/shell/Hud.tsx) is about this tall. */
const HUD_STACK_PX = 100

const EMOTE_INFO: Record<Emote, { label: string; Icon: (p: { width?: number; height?: number }) => ReactNode }> = {
  wave: { label: 'Wave', Icon: IconWave },
  cheer: { label: 'Cheer', Icon: IconCheer },
  dance: { label: 'Dance', Icon: IconDance },
}

function useMediaQuery(q: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia?.(q)
      m?.addEventListener?.('change', cb)
      return () => m?.removeEventListener?.('change', cb)
    },
    () => window.matchMedia?.(q).matches ?? fallback,
    () => fallback,
  )
}

/** Close any open panel when an overlay opens or the world closes. */
function useVisible(): boolean {
  const worldReady = useStore((s) => s.worldReady)
  const overlayOpen = useStore((s) => s.overlay !== null)
  return worldReady && !overlayOpen
}

function releasePointer() {
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.()
}

export function PeopleHud() {
  const visible = useVisible()
  const status = useRealtime((s) => s.status)
  const visiting = useStore((s) => s.visiting)
  const isTouch = useStore((s) => s.isTouch)
  const [panel, setPanel] = useState<Panel>(null)
  const online = status !== 'off'

  useEffect(() => {
    if (!visible) setPanel(null)
  }, [visible])

  const toggle = useCallback((p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p))
    if (p !== 'chat') releasePointer()
  }, [])

  // Keyboard: T / Enter chat, F people, Esc closes.
  useEffect(() => {
    if (!visible || !online) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.key === 'Escape' && panel) {
        setPanel(null)
        return
      }
      if (isTypingTarget(e.target)) return
      if (e.code === 'KeyT' || e.key === 'Enter') {
        e.preventDefault()
        setPanel('chat')
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        toggle('people')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, online, panel, toggle])

  if (!visible) return null
  return (
    <>
      {visiting ? <VisitBanner touch={isTouch} /> : null}
      {online ? (
        isTouch ? (
          <TouchControls panel={panel} toggle={toggle} close={() => setPanel(null)} />
        ) : (
          <DesktopDock panel={panel} toggle={toggle} close={() => setPanel(null)} />
        )
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Visiting banner
// ---------------------------------------------------------------------------

function VisitBanner({ touch }: { touch: boolean }) {
  const visiting = useStore((s) => s.visiting)
  const home = useRealtime((s) => s.home)
  const joinError = useRealtime((s) => s.joinError)
  const status = useRealtime((s) => s.status)
  const [spoilers, setSpoilers] = useState(spoilersShown)
  const [busy, setBusy] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)', true)
  if (!visiting) return null
  const name = visiting.owner?.displayName ?? `@${visiting.handle}`
  const outside = status === 'open' && !home && joinError
  const toggleSpoilers = async () => {
    setBusy(true)
    try {
      await setSpoilersShown(!spoilers)
      setSpoilers(!spoilers)
    } finally {
      setBusy(false)
    }
  }
  const top = touch || !wide ? `calc(${SAFE.top} + ${HUD_STACK_PX + 6}px)` : SAFE.top
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[31] flex justify-center px-3" style={{ top }}>
      <div
        data-testid="visit-banner"
        role="region"
        aria-label={`Visiting ${name}'s room`}
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-panel/95 py-1 pr-1 pl-3 font-body text-ink shadow-[0_6px_18px_rgba(40,20,20,.3)] ring-1 ring-panel-edge backdrop-blur"
      >
        <IconHome width={18} height={18} className="shrink-0 text-teal" />
        <span className="min-w-0 truncate text-sm">
          <span className="font-bold">{name}'s room</span>
          <span className="hidden text-ink-soft sm:inline"> · {outside ? joinError.message : 'look around, nothing here changes'}</span>
        </span>
        <button
          type="button"
          data-testid="visit-spoilers"
          aria-pressed={spoilers}
          disabled={busy}
          title={spoilers ? 'Hide spoilers in their reviews' : 'Show spoilers in their reviews'}
          aria-label={spoilers ? 'Hide spoilers' : 'Show spoilers'}
          onClick={() => void toggleSpoilers()}
          className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold transition disabled:opacity-50 ${spoilers ? 'bg-warn/25 text-[#8a5d0c]' : 'text-ink-soft hover:bg-[rgba(224,123,57,.12)]'}`}
        >
          <IconEyeOff width={16} height={16} />
          <span className="hidden sm:inline">{spoilers ? 'Spoilers on' : 'Spoilers'}</span>
        </button>
        <button
          type="button"
          data-testid="visit-back-home"
          onClick={() => pageNav.go(homeUrl())}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 font-display text-sm font-semibold text-accent-ink shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95"
        >
          <IconBack width={16} height={16} />
          Back to my room
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

function DesktopDock({ panel, toggle, close }: { panel: Panel; toggle(p: Exclude<Panel, null>): void; close(): void }) {
  const players = useRealtime((s) => s.players)
  const unread = useRealtime((s) => s.unread)
  const count = Object.keys(players).length
  return (
    <div className="pointer-events-none fixed z-30 flex flex-col items-start gap-2 font-body text-ink" style={{ left: SAFE.left, bottom: SAFE.bottom }}>
      {panel === 'people' ? <PeoplePanel onClose={close} className="w-[340px]" /> : null}
      <ChatArea open={panel === 'chat'} onClose={close} />
      <div data-testid="people-dock" className="flex items-center gap-2">
        <button
          type="button"
          data-testid="people-button"
          aria-expanded={panel === 'people'}
          aria-label={`People: ${count ? `${count} here with you` : 'nobody else here'} (F)`}
          title="People and friends (F)"
          onClick={(e) => {
            toggle('people')
            e.currentTarget.blur()
          }}
          className={`pointer-events-auto flex h-11 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 backdrop-blur transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95 ${
            panel === 'people' ? 'bg-teal text-white ring-teal' : 'bg-panel/90 ring-panel-edge'
          }`}
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${panel === 'people' ? 'bg-white/15' : 'bg-[rgba(47,143,138,.12)] text-teal'}`}>
            <IconPeople width={20} height={20} />
          </span>
          <AvatarStack players={players} />
          <span className="text-sm font-bold">{count ? `${count + 1} here` : 'Friends'}</span>
          <Kbd on={panel === 'people'}>F</Kbd>
        </button>
        <button
          type="button"
          data-testid="chat-button"
          aria-expanded={panel === 'chat'}
          aria-label={`Chat${unread ? ` (${unread} new)` : ''} (T)`}
          title="Chat (T or Enter)"
          onClick={(e) => {
            toggle('chat')
            e.currentTarget.blur()
          }}
          className={`pointer-events-auto relative flex h-11 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 backdrop-blur transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-95 ${
            panel === 'chat' ? 'bg-teal text-white ring-teal' : 'bg-panel/90 ring-panel-edge'
          }`}
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${panel === 'chat' ? 'bg-white/15' : 'bg-[rgba(224,123,57,.14)] text-accent'}`}>
            <IconChat width={20} height={20} />
          </span>
          <span className="text-sm font-bold">Chat</span>
          <Kbd on={panel === 'chat'}>T</Kbd>
          {unread && panel !== 'chat' ? <Badge n={unread} /> : null}
        </button>
        <div role="group" aria-label="Emotes" className="pointer-events-auto flex items-center gap-1 rounded-full bg-panel/90 p-1 shadow-[0_6px_18px_rgba(40,20,20,.28)] ring-1 ring-panel-edge backdrop-blur">
          {EMOTES.map((e) => (
            <EmoteButton key={e} emote={e} size="sm" />
          ))}
        </div>
      </div>
    </div>
  )
}

function Kbd({ children, on }: { children: ReactNode; on: boolean }) {
  return <kbd className={`rounded-md border-b-2 px-1.5 font-mono text-[11px] font-semibold ${on ? 'border-white/40 bg-white/15' : 'border-panel-edge bg-paper text-ink-soft'}`}>{children}</kbd>
}

function Badge({ n }: { n: number }) {
  return (
    <span data-testid="chat-unread" className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-extrabold text-white shadow ring-2 ring-panel">
      {n > 9 ? '9+' : n}
    </span>
  )
}

function AvatarStack({ players }: { players: Record<string, Player> }) {
  const list = playersInOrder(players).slice(0, 3)
  if (!list.length) return null
  return (
    <span aria-hidden className="flex -space-x-2">
      {list.map((p) => (
        <MiniAvatar key={p.sid} user={p.user} size={24} ring />
      ))}
    </span>
  )
}

function EmoteButton({ emote, size, onDone }: { emote: Emote; size: 'sm' | 'lg'; onDone?(): void }) {
  const { label, Icon } = EMOTE_INFO[emote]
  const play = () => {
    const r = sendEmote(emote)
    if (!r.ok && r.reason === 'rate_limited') useShell.getState().showToast('Easy! Try that again in a moment.')
    else if (!r.ok) useShell.getState().showToast('Not connected right now.')
    onDone?.()
  }
  const big = size === 'lg'
  return (
    <button
      type="button"
      data-testid={`emote-${emote}`}
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        play()
        e.currentTarget.blur()
      }}
      className={`flex items-center justify-center rounded-full text-ink transition hover:bg-[rgba(224,123,57,.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal active:scale-90 ${
        big ? 'h-14 flex-col gap-0.5 rounded-2xl bg-white/70 px-4 text-xs font-bold ring-1 ring-panel-edge' : 'h-9 w-9'
      }`}
    >
      <Icon width={big ? 24 : 20} height={big ? 24 : 20} />
      {big ? label : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** How long a line stays in the passive (closed) chat log on desktop. */
const LOG_LINGER_MS = 15_000

function useNow(ms: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, active])
  return now
}

function ChatArea({ open, onClose }: { open: boolean; onClose(): void }) {
  const chat = useRealtime((s) => s.chat)
  const recent = useNow(1000, !open && chat.length > 0)
  const lines = open ? chat.slice(-12) : chat.filter((l) => recent - l.at < LOG_LINGER_MS).slice(-5)
  useEffect(() => {
    if (open) useRealtime.setState({ unread: 0 })
  }, [open, chat.length])
  if (!open && !lines.length) return null
  return (
    <div data-testid="chat-area" className={`pointer-events-auto flex w-[min(380px,calc(100vw-24px))] flex-col gap-2 ${open ? 'rounded-[var(--radius-cozy)] bg-panel/95 p-3 shadow-cozy ring-1 ring-panel-edge backdrop-blur' : ''}`}>
      <ChatLog lines={lines} faded={!open} />
      {open ? <ChatInput onClose={onClose} autoFocus /> : null}
    </div>
  )
}

function ChatLog({ lines, faded }: { lines: ChatLine[]; faded: boolean }) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [lines.length])
  if (!lines.length) {
    return <p className="m-0 px-1 text-sm text-ink-soft">Say hi! Chat is only seen by people in this room and is never saved.</p>
  }
  return (
    <ol data-testid="chat-log" aria-live="polite" aria-label="Chat" className={`m-0 flex max-h-[38vh] list-none flex-col gap-1 overflow-y-auto p-0 ${faded ? 'pointer-events-none' : ''}`}>
      {lines.map((l, i) => (
        <li key={l.id} ref={i === lines.length - 1 ? end : undefined} className={`w-fit max-w-full rounded-2xl px-3 py-1 text-sm leading-snug break-words ${faded ? 'bg-[rgba(42,31,45,0.72)] text-panel shadow' : l.mine ? 'self-end bg-teal text-white' : 'bg-white/80 text-ink ring-1 ring-panel-edge/70'}`}>
          {!l.mine || faded ? <span className={`mr-1.5 font-bold ${faded ? 'text-led' : 'text-accent'}`}>{l.mine ? 'You' : firstName(l.user)}</span> : null}
          {l.text}
        </li>
      ))}
    </ol>
  )
}

function ChatInput({ onClose, autoFocus }: { onClose(): void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true })
  }, [autoFocus])
  const left = REALTIME_LIMITS.CHAT_MAX_LENGTH - Array.from(text).length
  const submit = () => {
    if (!text.trim()) {
      onClose()
      return
    }
    const r = sendChat(text)
    if (r.ok) {
      setText('')
      setNote(null)
    } else if (r.reason === 'rate_limited') setNote(`Slow down a little: try again in ${Math.ceil((r.retryAfterMs ?? 1000) / 1000)} s.`)
    else if (r.reason === 'offline') setNote('Not connected right now. Your message was not sent.')
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Message to everyone in this room
        </label>
        <input
          ref={input}
          id={id}
          data-testid="chat-input"
          value={text}
          maxLength={REALTIME_LIMITS.CHAT_MAX_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Say something…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }}
          className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-ink ring-1 ring-panel-edge outline-none focus:ring-2 focus:ring-teal"
        />
        <button type="submit" data-testid="chat-send" aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition active:scale-95">
          <IconSend width={20} height={20} />
        </button>
      </div>
      <p aria-live="polite" className={`m-0 px-2 text-xs ${note ? 'text-bad' : 'text-ink-soft'}`}>
        {note ?? (left < 40 ? `${left} characters left` : 'Enter sends · Esc closes · never saved')}
      </p>
    </form>
  )
}

// ---------------------------------------------------------------------------
// People panel
// ---------------------------------------------------------------------------

function PeoplePanel({ onClose, className = '' }: { onClose(): void; className?: string }) {
  const me = useRealtime((s) => s.me)
  const sid = useRealtime((s) => s.sid)
  const home = useRealtime((s) => s.home)
  const status = useRealtime((s) => s.status)
  const players = useRealtime((s) => s.players)
  const friendsMap = useRealtime((s) => s.friends)
  const loaded = useRealtime((s) => s.friendsLoaded)
  const visiting = useStore((s) => s.visiting)
  const here = useMemo(() => playersInOrder(players), [players])
  const friends = useMemo(() => friendsInOrder(friendsMap), [friendsMap])
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    dialog.current?.focus({ preventScroll: true })
    return () => {
      if (prev && prev !== document.body && document.contains(prev)) prev.focus?.({ preventScroll: true })
    }
  }, [])

  const roomName = home ? (home.isOwner ? 'Your room' : `${home.owner.displayName}'s room`) : visiting ? `${visiting.owner?.displayName ?? '@' + visiting.handle}'s room` : 'Your room'
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="people-panel"
      className={`pointer-events-auto flex max-h-[min(70vh,560px)] flex-col overflow-hidden rounded-[var(--radius-cozy)] bg-panel/97 text-ink shadow-cozy ring-1 ring-panel-edge outline-none backdrop-blur ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-panel-edge/70 px-4 pt-3 pb-2">
        <h2 id={titleId} className="m-0 font-display text-lg font-semibold">
          People
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-[rgba(224,123,57,.12)] hover:text-ink">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
        <StatusLine status={status} />
        <section aria-label="Here now">
          <h3 className="m-0 mt-1 mb-1.5 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Here now · {roomName}</h3>
          <ul data-testid="people-here" className="m-0 list-none space-y-1 p-0">
            {me ? <PersonRow user={me} note={home?.isOwner ? 'You · host' : 'You'} you /> : null}
            {here.map((p) => (
              <PersonRow
                key={p.sid}
                user={p.user}
                note={p.isOwner ? 'Host' : 'Visiting'}
                action={
                  home?.isOwner && !p.isOwner && p.sid !== sid ? (
                    <button type="button" data-testid="kick-player" onClick={() => kickPlayer(p.sid)} className="min-h-9 rounded-full px-3 text-xs font-bold text-ink-soft ring-1 ring-panel-edge hover:bg-white">
                      Ask to leave
                    </button>
                  ) : null
                }
              />
            ))}
          </ul>
          {!here.length ? <p className="m-0 mt-1 text-sm text-ink-soft">Nobody else is here right now.</p> : null}
        </section>

        {visiting ? (
          <button
            type="button"
            onClick={() => pageNav.go(homeUrl())}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent font-display text-base font-semibold text-accent-ink shadow-sm active:scale-[.98]"
          >
            <IconBack width={18} height={18} />
            Back to my room
          </button>
        ) : null}

        <section aria-label="Visit a friend" className="mt-4">
          <h3 className="m-0 mb-1.5 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Visit a friend</h3>
          {!loaded ? <p className="m-0 text-sm text-ink-soft">Loading your friends…</p> : null}
          {loaded && !friends.length ? (
            <p className="m-0 text-sm text-ink-soft">
              No friends yet.{' '}
              <a href="/settings#friends" className="font-bold text-teal underline">
                Invite someone
              </a>{' '}
              to visit each other's rooms.
            </p>
          ) : null}
          <ul data-testid="visit-friends" className="m-0 list-none space-y-1 p-0">
            {friends.map((f) => (
              <FriendRow key={f.user.id} friend={f} current={visiting?.handle === f.user.handle} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function StatusLine({ status }: { status: string }) {
  const text =
    status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting… people may freeze for a moment.' : status === 'replaced' ? 'This room is open in another tab. Reload to bring it here.' : null
  if (!text) return null
  return (
    <p role="status" data-testid="realtime-status" className="m-0 mb-2 rounded-xl bg-warn/20 px-3 py-1.5 text-xs font-semibold text-[#7a520c]">
      {text}
    </p>
  )
}

function MiniAvatar({ user, size = 32, online, ring }: { user: PublicUser; size?: number; online?: boolean; ring?: boolean }) {
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {user.image ? (
        <img src={user.image} alt="" width={size} height={size} referrerPolicy="no-referrer" className={`rounded-full object-cover ${ring ? 'ring-2 ring-panel' : ''}`} style={{ width: size, height: size }} />
      ) : (
        <span aria-hidden className={`inline-flex items-center justify-center rounded-full bg-teal font-bold text-white ${ring ? 'ring-2 ring-panel' : ''}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
          {initials || '?'}
        </span>
      )}
      {online !== undefined ? (
        <span
          data-testid="presence-dot"
          data-online={online ? 'true' : 'false'}
          aria-hidden
          className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-panel ${online ? 'bg-good' : 'bg-[#bfae9f]'}`}
        />
      ) : null}
    </span>
  )
}

function PersonRow({ user, note, you, action }: { user: PublicUser; note: string; you?: boolean; action?: ReactNode }) {
  return (
    <li data-testid="person-row" data-handle={user.handle ?? ''} className="flex min-h-11 items-center gap-2.5 rounded-xl px-1">
      <MiniAvatar user={user} online />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">
          {user.displayName}
          {you ? null : user.handle ? <span className="font-normal text-ink-soft"> @{user.handle}</span> : null}
        </span>
        <span className="block text-xs text-ink-soft">{note}</span>
      </span>
      {action}
    </li>
  )
}

function FriendRow({ friend, current }: { friend: FriendPresence; current: boolean }) {
  const { user, online, where, homeCount } = friend
  const handle = user.handle
  const note = online ? whereLabel(where, firstName(user)) : 'Offline'
  const extra = homeCount > 0 && where !== 'your_home' ? ` · ${homeCount} in their room` : ''
  return (
    <li data-testid="visit-friend" data-handle={handle ?? ''} data-online={online ? 'true' : 'false'} className="flex min-h-12 items-center gap-2.5 rounded-xl px-1">
      <MiniAvatar user={user} online={online} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{user.displayName}</span>
        <span className="block truncate text-xs text-ink-soft">
          <span className="sr-only">{online ? 'Online. ' : 'Offline. '}</span>
          {note}
          {extra}
        </span>
      </span>
      {handle && !current ? (
        <button
          type="button"
          data-testid="visit-friend-button"
          aria-label={`Visit ${user.displayName}'s room`}
          onClick={() => pageNav.go(visitUrl(handle, { autostart: true }))}
          className="min-h-9 shrink-0 rounded-full bg-teal px-3.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110 active:scale-95"
        >
          Visit
        </button>
      ) : current ? (
        <span className="shrink-0 px-2 text-xs font-bold text-teal">You're here</span>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------

function TouchControls({ panel, toggle, close }: { panel: Panel; toggle(p: Exclude<Panel, null>): void; close(): void }) {
  const landscape = useMediaQuery('(max-height: 520px)')
  const players = useRealtime((s) => s.players)
  const unread = useRealtime((s) => s.unread)
  const count = Object.keys(players).length
  // Above the camera and wardrobe buttons (two 56 px buttons, 12 px apart, 18 px up), or beside them in landscape.
  const pos = landscape ? { right: `calc(${SAFE.right} + 68px)`, bottom: `calc(${SAFE.bottom} + 18px)` } : { right: SAFE.right, bottom: `calc(${SAFE.bottom} + 18px + 136px)` }
  const btn = (on: boolean) =>
    `pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full shadow-[0_8px_20px_rgba(40,20,20,.35)] ring-2 transition active:scale-95 ${
      on ? 'bg-teal text-white ring-[rgba(255,255,255,.6)]' : 'bg-panel/95 text-ink ring-panel-edge'
    }`
  return (
    <>
      <div data-testid="people-dock" className="pointer-events-none fixed z-30 flex flex-col items-end gap-2.5" style={pos}>
        <button type="button" data-testid="people-button" aria-expanded={panel === 'people'} aria-label={`People: ${count ? `${count} here with you` : 'nobody else here'}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle('people')} className={btn(panel === 'people')}>
          <IconPeople width={24} height={24} />
          {count ? (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-led px-1 text-[11px] font-extrabold text-[#0d3532] ring-2 ring-panel">{count + 1}</span>
          ) : null}
        </button>
        <button type="button" data-testid="chat-button" aria-expanded={panel === 'chat'} aria-label={`Chat${unread ? ` (${unread} new)` : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle('chat')} className={btn(panel === 'chat')}>
          <IconChat width={24} height={24} />
          {unread && panel !== 'chat' ? <Badge n={unread} /> : null}
        </button>
        <button type="button" data-testid="emote-button" aria-expanded={panel === 'emotes'} aria-label="Emotes" onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle('emotes')} className={btn(panel === 'emotes')}>
          <IconWave width={24} height={24} />
        </button>
      </div>

      {panel === 'emotes' ? (
        <div className="pointer-events-none fixed z-40" style={landscape ? { right: `calc(${SAFE.right} + 128px)`, bottom: `calc(${SAFE.bottom} + 18px)` } : { right: `calc(${SAFE.right} + 60px)`, bottom: `calc(${SAFE.bottom} + 18px + 136px)` }}>
          <div role="group" aria-label="Emotes" className="pointer-events-auto flex gap-2 rounded-[var(--radius-cozy)] bg-panel/95 p-2 shadow-cozy ring-1 ring-panel-edge" onPointerDown={(e) => e.stopPropagation()}>
            {EMOTES.map((e) => (
              <EmoteButton key={e} emote={e} size="lg" onDone={close} />
            ))}
          </div>
        </div>
      ) : null}

      {panel === 'people' ? (
        <Sheet onClose={close} side="bottom">
          <PeoplePanel onClose={close} className="w-full" />
        </Sheet>
      ) : null}

      {panel === 'chat' ? (
        <Sheet onClose={close} side="top">
          <TouchChat onClose={close} />
        </Sheet>
      ) : null}

      {panel !== 'chat' ? <TouchChatPeek /> : null}
    </>
  )
}

/** A sheet over the room; tapping the dimmed room closes it. */
function Sheet({ children, onClose, side }: { children: ReactNode; onClose(): void; side: 'top' | 'bottom' }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ justifyContent: side === 'top' ? 'flex-start' : 'flex-end' }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-[rgba(40,24,30,.35)]" />
      <div className="relative mx-auto w-full max-w-lg px-2" style={side === 'top' ? { paddingTop: SAFE.top } : { paddingBottom: SAFE.bottom }}>
        {children}
      </div>
    </div>
  )
}

function TouchChat({ onClose }: { onClose(): void }) {
  const chat = useRealtime((s) => s.chat)
  useEffect(() => {
    useRealtime.setState({ unread: 0 })
  }, [chat.length])
  return (
    <div role="dialog" aria-label="Chat" data-testid="chat-area" className="flex flex-col gap-2 rounded-[var(--radius-cozy)] bg-panel/97 p-3 text-ink shadow-cozy ring-1 ring-panel-edge">
      <div className="flex items-center justify-between">
        <h2 className="m-0 font-display text-lg font-semibold">Chat</h2>
        <button type="button" onClick={onClose} aria-label="Close chat" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div className="max-h-[30vh] overflow-y-auto">
        <ChatLog lines={chat.slice(-20)} faded={false} />
      </div>
      <ChatInput onClose={onClose} autoFocus />
    </div>
  )
}

/** The newest chat line, briefly, under the HUD (phones see bubbles too, but heads can be off screen). */
function TouchChatPeek() {
  const last = useRealtime((s) => s.chat[s.chat.length - 1])
  const now = useNow(1000, !!last)
  if (!last || last.mine || now - last.at > 6000) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[29] flex justify-center px-4" style={{ top: `calc(${SAFE.top} + ${HUD_STACK_PX + 52}px)` }}>
      <p className="m-0 max-w-full truncate rounded-full bg-[rgba(42,31,45,0.78)] px-3 py-1 text-sm text-panel shadow">
        <span className="mr-1.5 font-bold text-led">{firstName(last.user)}</span>
        {last.text}
      </p>
    </div>
  )
}
