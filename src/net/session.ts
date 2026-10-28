/**
 * Connects the 3D room to the realtime socket (Phase 3, workstream C). Installed once by
 * src/desktop.tsx for signed-in, onboarded people (signed-out demo visitors get no socket).
 *
 * - Joins the room on screen: your own, or the friend's you are visiting (`store.visiting`).
 * - Shares your pose (feet, body yaw, look pitch, camera mode, walk/run/emote) up to 10 times a
 *   second while it changes, and your look whenever the wardrobe changes it.
 * - Feeds `useRealtime` (who is here, chat, emotes, friends' presence) and the pose buffers.
 * - Presence toasts: "Mia is in your room", "Mia left".
 * - Retries when the network comes back or the tab is shown again.
 */
import { getSessionState, refreshSession } from '@/auth/session'
import type { PlayerState, RealtimeOutfit, ServerMessage, Emote } from '@/contracts/realtime'
import { callApi, ROUTES } from '@/contracts/routes'
import { runtime } from '@/contracts/runtime'
import { playerView, useCameraMode } from '@/player/view'
import { useStore } from '@/state/store'
import { useShell } from '@/ui/shell/shellStore'
import { useWardrobe } from '@/ui/wardrobe/store'
import { RealtimeClient, type SendResult } from './client'
import { wrapAngle } from './interpolation'
import { BUBBLE_MS, CHAT_LOG_MAX, EMOTE_MS, firstName, outfitFor, poseBuffer, poses, useRealtime, type ChatLine, type Player } from './store'

/** How often the local pose is checked for changes (the client throttles to the server's rate). */
const PUBLISH_MS = 100
/** Presence list refresh (the socket keeps it live in between). */
const PRESENCE_REFRESH_MS = 60_000

let client: RealtimeClient | null = null
let localEmote: { emote: Emote; at: number } | null = null

/** The running client (null when signed out or not installed). */
export function realtimeClient(): RealtimeClient | null {
  return client
}

/** The emote your own character is playing now, if any (read by LocalAvatar every frame). */
export function activeLocalEmote(now = Date.now()): Emote | null {
  if (!localEmote) return null
  if (now - localEmote.at > EMOTE_MS) {
    localEmote = null
    return null
  }
  return localEmote.emote
}

const round = (n: number, step: number) => Math.round(n / step) * step
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** My pose to share, from the player controller's per-frame state. */
export function localState(now = Date.now()): PlayerState {
  const v = playerView
  const speed = clamp(Number.isFinite(v.speed) ? v.speed : 0, 0, 30)
  const emoting = activeLocalEmote(now) !== null
  return {
    p: [round(clamp(v.feet[0], -100, 100), 0.005), round(clamp(v.feet[1], -100, 100), 0.005), round(clamp(v.feet[2], -100, 100), 0.005)],
    yaw: round(wrapAngle(v.bodyYaw), 0.001),
    pitch: round(clamp(runtime.player.pitch, -Math.PI / 2, Math.PI / 2), 0.001),
    cam: useCameraMode.getState().mode,
    anim: emoting && speed < 0.3 ? 'emote' : speed > 3.2 ? 'run' : speed > 0.3 ? 'walk' : 'idle',
    v: round(speed, 0.01),
  }
}

/** True when `b` differs enough from `a` to be worth sending. */
export function poseChanged(a: PlayerState | null, b: PlayerState): boolean {
  if (!a) return true
  return (
    Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) > 0.01 ||
    Math.abs(wrapAngle(a.yaw - b.yaw)) > 0.01 ||
    Math.abs(a.pitch - b.pitch) > 0.02 ||
    a.anim !== b.anim ||
    a.cam !== b.cam ||
    Math.abs((a.v ?? 0) - (b.v ?? 0)) > 0.15
  )
}

function myOutfit(): RealtimeOutfit | undefined {
  const w = useWardrobe.getState()
  // Before the wardrobe loads, others see your starter look (the server sends no outfit).
  return w.status === 'ready' && w.signedIn ? ({ ...w.outfit } as RealtimeOutfit) : undefined
}

function toast(text: string) {
  useShell.getState().showToast(text)
}

const toPlayer = (p: { sid: string; user: Player['user']; isOwner: boolean; outfit: unknown; joinedAt: number }): Player => ({
  sid: p.sid,
  user: p.user,
  isOwner: p.isOwner,
  outfit: outfitFor(p.outfit, p.user.id),
  joinedAt: p.joinedAt,
})

/** Apply one server message to the stores. Exported for tests. */
export function applyMessage(msg: ServerMessage, c: Pick<RealtimeClient, 'clock' | 'sid'>, now = Date.now()): void {
  const rt = useRealtime.getState()
  const set = useRealtime.setState
  switch (msg.type) {
    case 'hello':
      set({ me: msg.you, sid: msg.sid })
      return
    case 'joined': {
      poses.clear()
      const players: Record<string, Player> = {}
      for (const p of msg.players) {
        players[p.sid] = toPlayer(p)
        if (p.state) poseBuffer(p.sid).push(msg.serverTime, p.state)
      }
      set({ home: { handle: msg.home.handle, owner: msg.home.owner, isOwner: msg.isOwner }, sid: msg.sid, players, joinError: null, bubbles: {}, emotes: {} })
      return
    }
    case 'left': {
      poses.clear()
      const home = rt.home
      set({ home: null, players: {}, bubbles: {}, emotes: {} })
      if (msg.reason === 'kicked' && home) {
        const message = `${firstName(home.owner)} asked you to leave their room.`
        set({ joinError: { code: 'forbidden', message } })
        toast(message)
      } else if (msg.reason === 'removed' && home) {
        const message = `You left ${firstName(home.owner)}'s room.`
        set({ joinError: { code: 'not_friends', message } })
        toast(message)
      }
      else if (msg.reason === 'replaced') toast('You opened this room in another tab, so this one stepped out.')
      return
    }
    case 'player_joined': {
      const p = toPlayer(msg.player)
      if (msg.player.state) poseBuffer(p.sid).push(c.clock.now(now), msg.player.state)
      // A second tab of the same person replaces the first: no new toast for them.
      const already = Object.values(rt.players).some((x) => x.user.id === p.user.id)
      set({ players: { ...rt.players, [p.sid]: p } })
      if (!already && p.user.id !== rt.me?.id) {
        const name = firstName(p.user)
        toast(rt.home?.isOwner ? `${name} is in your room` : p.isOwner ? `${name} is home` : `${name} came in`)
      }
      return
    }
    case 'player_left': {
      const gone = rt.players[msg.sid]
      if (!gone) return
      const players = { ...rt.players }
      delete players[msg.sid]
      poses.delete(msg.sid)
      const { [msg.sid]: _b, ...bubbles } = rt.bubbles
      const { [msg.sid]: _e, ...emotes } = rt.emotes
      set({ players, bubbles, emotes })
      if (msg.reason !== 'replaced' && !Object.values(players).some((x) => x.user.id === gone.user.id)) toast(`${firstName(gone.user)} left`)
      return
    }
    case 'states':
      for (const { sid, s } of msg.players) if (rt.players[sid]) poseBuffer(sid).push(msg.at, s)
      return
    case 'outfit': {
      const p = rt.players[msg.sid]
      if (p) set({ players: { ...rt.players, [msg.sid]: { ...p, outfit: outfitFor(msg.outfit, p.user.id) } } })
      return
    }
    case 'emote':
      if (rt.players[msg.sid]) set({ emotes: { ...rt.emotes, [msg.sid]: { emote: msg.emote, at: now } } })
      return
    case 'chat': {
      const mine = msg.sid === (c.sid ?? rt.sid)
      const line: ChatLine = { id: msg.id, sid: msg.sid, user: msg.user, text: msg.text, at: now, mine }
      set({ chat: [...rt.chat, line].slice(-CHAT_LOG_MAX), bubbles: { ...rt.bubbles, [msg.sid]: line }, unread: mine ? rt.unread : rt.unread + 1 })
      return
    }
    case 'presence': {
      const prev = rt.friends[msg.user.id]
      const homeCount = prev?.homeCount ?? 0
      set({ friends: { ...rt.friends, [msg.user.id]: { user: msg.user, online: msg.online, where: msg.where, homeCount: msg.online ? homeCount : 0 } } })
      return
    }
    case 'visitor':
      if (msg.joined) toast(`${firstName(msg.user)} is in your room`)
      return
    case 'error':
      if (msg.about === 'join' && msg.code !== 'rate_limited') {
        set({ joinError: { code: msg.code, message: msg.message } })
        toast(msg.message)
      }
      return
    case 'pong':
      return
  }
}

/** Fetch the friends list with presence (the socket keeps it current afterwards). */
export async function loadPresence(): Promise<void> {
  try {
    const list = await callApi(ROUTES.presence)
    const friends = Object.fromEntries(list.friends.map((f) => [f.user.id, f]))
    useRealtime.setState({ friends, friendsLoaded: true })
  } catch (err) {
    console.warn('[realtime] presence unavailable', err instanceof Error ? err.message : err)
    useRealtime.setState({ friendsLoaded: true })
  }
}

/** Send a chat line from the chat box. */
export function sendChat(text: string): SendResult {
  return client?.sendChat(text) ?? { ok: false, reason: 'offline' }
}

/** Play an emote: you see it on your character, others see it on theirs. */
export function sendEmote(emote: Emote): SendResult {
  const r = client?.sendEmote(emote) ?? { ok: false, reason: 'offline' as const }
  if (r.ok) {
    const now = Date.now()
    localEmote = { emote, at: now }
    const sid = useRealtime.getState().sid
    if (sid) useRealtime.setState((s) => ({ emotes: { ...s.emotes, [sid]: { emote, at: now } } }))
  }
  return r
}

/** The owner asks a guest to leave (they can come back later). */
export function kickPlayer(sid: string): void {
  client?.kick(sid)
}

declare global {
  interface Window {
    /** Read-mostly test hook (Playwright): the realtime client and stores. */
    __ESCAPE_NET__?: { client: () => RealtimeClient | null; store: typeof useRealtime; poses: typeof poses; localState: typeof localState }
  }
}

export interface InstallOptions {
  /** Inject a client (tests). */
  client?: RealtimeClient
  /** Skip the session check (tests). */
  handle?: string
}

/**
 * Start the realtime connection for this page. Resolves once it decided (signed out: no socket).
 * Returns an uninstall function.
 */
export async function installRealtime(opts: InstallOptions = {}): Promise<() => void> {
  if (typeof window !== 'undefined') window.__ESCAPE_NET__ = { client: () => client, store: useRealtime, poses, localState }
  let myHandle = opts.handle ?? null
  if (!myHandle) {
    let session = getSessionState()
    if (session.status === 'loading') session = await refreshSession()
    if (session.status !== 'signed-in' || !session.user.onboarded || !session.user.handle) return () => {}
    myHandle = session.user.handle
  }
  const target = useStore.getState().visiting?.handle ?? myHandle

  let lastSent: PlayerState | null = null
  const canShare = () => useStore.getState().worldReady
  const c =
    opts.client ??
    new RealtimeClient({
      snapshot: () => {
        const state = canShare() ? localState() : undefined
        if (state) lastSent = state
        return { state, outfit: myOutfit() }
      },
    })
  client = c
  const offs: (() => void)[] = []
  offs.push(c.onStatus((status) => useRealtime.setState({ status })))
  offs.push(
    c.onMessage((msg) => {
      applyMessage(msg, c)
      if (msg.type === 'hello') void loadPresence()
      if (msg.type === 'joined') lastSent = null
    }),
  )

  // Share my pose while it changes.
  const publish = setInterval(() => {
    if (!canShare() || !c.currentHome) return
    const s = localState()
    if (!poseChanged(lastSent, s)) return
    lastSent = s
    c.sendState(s)
  }, PUBLISH_MS)

  // My look, when the wardrobe loads or changes it.
  offs.push(
    useWardrobe.subscribe((w, prev) => {
      if (w.outfit !== prev.outfit || w.status !== prev.status) {
        const o = myOutfit()
        if (o) c.sendOutfit(o)
      }
    }),
  )

  // Bubbles and emotes expire.
  const sweep = setInterval(() => {
    const now = Date.now()
    const st = useRealtime.getState()
    const bubbles = Object.fromEntries(Object.entries(st.bubbles).filter(([, b]) => now - b.at < BUBBLE_MS))
    const emotes = Object.fromEntries(Object.entries(st.emotes).filter(([, e]) => now - e.at < EMOTE_MS))
    if (Object.keys(bubbles).length !== Object.keys(st.bubbles).length || Object.keys(emotes).length !== Object.keys(st.emotes).length) {
      useRealtime.setState({ bubbles, emotes })
    }
  }, 500)

  const presence = setInterval(() => {
    if (document.visibilityState !== 'hidden' && c.ready) void loadPresence()
  }, PRESENCE_REFRESH_MS)

  const retry = () => {
    if (document.visibilityState !== 'hidden') c.reconnectNow()
  }
  window.addEventListener('online', retry)
  document.addEventListener('visibilitychange', retry)
  const bye = () => c.stop()
  // Back from the back/forward cache: the old socket is gone, open a new one.
  const back = (e: PageTransitionEvent) => {
    if (e.persisted) c.start()
  }
  window.addEventListener('pagehide', bye)
  window.addEventListener('pageshow', back)

  c.join(target)
  c.start()

  return () => {
    offs.forEach((o) => o())
    clearInterval(publish)
    clearInterval(sweep)
    clearInterval(presence)
    window.removeEventListener('online', retry)
    document.removeEventListener('visibilitychange', retry)
    window.removeEventListener('pagehide', bye)
    window.removeEventListener('pageshow', back)
    c.stop()
    if (client === c) client = null
  }
}
