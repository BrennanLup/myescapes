/**
 * Data loading for the friends UI, settings and the mobile rooms table (workstreams 15, 35).
 * Plain async functions over `callApi`, each taking an optional `fetch`, so they can be tested
 * against the real server (server/testing.ts) as well as a fake one (./testing/fakeApi.ts).
 * No React here.
 */
import { ApiCallError } from '../contracts/errors'
import type { GuestClaim, Notification, PendingTag } from '../contracts/models'
import { callApi, ROUTES } from '../contracts/routes'

export type Fetch = typeof fetch
export interface CallOpts {
  fetch?: Fetch
  signal?: AbortSignal
}

/** One section of a page that loads independently, so one failing route doesn't blank the page. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: ApiCallError | Error }

export async function settle<T>(p: Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await p }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export const isUnauthorized = (e: unknown) => e instanceof ApiCallError && e.status === 401
export const isNotBuilt = (e: unknown) => e instanceof ApiCallError && e.status === 501

/** A short, friendly line for an error. Never echoes server internals beyond the API message. */
export function errorText(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.status === 401) return 'Sign in to see this.'
    if (e.status === 501) return "This part isn't ready yet."
    if (e.status === 503) return 'The database is waking up. Try again in a moment.'
    if (e.status === 429) return 'Too many tries. Wait a moment and try again.'
    return e.message || `Something went wrong (${e.status}).`
  }
  if (e instanceof TypeError) return "Couldn't reach the server. Check your connection."
  return 'Something went wrong.'
}

// ---------------------------------------------------------------------------
// Inbox: pending tags, guest-name claims, notifications
// ---------------------------------------------------------------------------

export interface InboxData {
  tags: Section<PendingTag[]>
  claims: Section<GuestClaim[]>
  notifications: Section<{ items: Notification[]; unread: number; nextCursor: string | null }>
}

export async function loadInbox(opts: CallOpts = {}): Promise<InboxData> {
  const [tags, claims, notifications] = await Promise.all([
    settle(callApi(ROUTES.pendingTags, {}, opts).then((r) => r.tags)),
    settle(callApi(ROUTES.claims, {}, opts).then((r) => r.claims)),
    settle(callApi(ROUTES.notifications, { query: { limit: 30 } }, opts)),
  ])
  return { tags, claims, notifications }
}

/** "N visits to confirm": pending tags plus guest-name visits that may be me. */
export function visitsToConfirm(tags: readonly PendingTag[], claims: readonly GuestClaim[]): number {
  const ids = new Set(tags.map((t) => t.visitId))
  for (const c of claims) for (const v of c.visits) ids.add(v.visitId)
  return ids.size
}

/**
 * The badge number: unread notifications, plus pending tags that no unread notification already
 * covers (a "tagged" notification and its pending tag are the same thing to the user).
 */
export function badgeCount(unread: number, unreadItems: readonly Notification[], tags: readonly PendingTag[]): number {
  const covered = new Set(unreadItems.filter((n) => !n.readAt && n.visitId).map((n) => n.visitId as string))
  return unread + tags.filter((t) => !covered.has(t.visitId)).length
}

export async function loadBadge(opts: CallOpts = {}): Promise<number | null> {
  const [n, t] = await Promise.all([
    settle(callApi(ROUTES.notifications, { query: { limit: 50 } }, opts)),
    settle(callApi(ROUTES.pendingTags, {}, opts)),
  ])
  if (!n.ok && !t.ok) return null
  return badgeCount(n.ok ? n.data.unread : 0, n.ok ? n.data.items : [], t.ok ? t.data.tags : [])
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export async function loadFriends(opts: CallOpts = {}) {
  const [friends, requests, invites] = await Promise.all([
    settle(callApi(ROUTES.friends, {}, opts).then((r) => r.friends)),
    settle(callApi(ROUTES.friendRequests, {}, opts).then((r) => r.requests)),
    settle(callApi(ROUTES.myInvites, {}, opts).then((r) => r.invites)),
  ])
  return { friends, requests, invites }
}

/** Normalise what someone typed in the friend search: "@Mia " -> "@mia", emails trimmed. */
export function normaliseSearch(q: string): string {
  const t = q.trim()
  if (!t) return ''
  if (t.includes('@') && !t.startsWith('@')) return t.toLowerCase()
  return '@' + t.replace(/^@+/, '').toLowerCase()
}

/** Text to send with an invite link. */
export function inviteMessage(url: string, inviterName: string | null): string {
  const who = inviterName ? `${inviterName} invited you` : "You're invited"
  return `${who} to My Escapes, so we can log the escape rooms we play together: ${url}`
}

/** `sms:` link that opens the Messages app with the invite text (iOS and Android both accept `?&body=`). */
export function smsHref(text: string): string {
  return `sms:?&body=${encodeURIComponent(text)}`
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type HandleCheck = { state: 'idle' } | { state: 'invalid'; message: string } | { state: 'checking' } | { state: 'available' } | { state: 'unavailable'; message: string } | { state: 'error'; message: string }

const HANDLE_RE_LOCAL = /^[a-z][a-z0-9_]{2,23}$/

/** Client-side handle check before asking the server (mirrors HandleSchema). */
export function localHandleCheck(raw: string): { handle: string; error: string | null } {
  const handle = raw.trim().replace(/^@/, '').toLowerCase()
  if (!handle) return { handle, error: 'Pick a handle.' }
  if (!HANDLE_RE_LOCAL.test(handle)) return { handle, error: '3-24 letters, digits or _, starting with a letter.' }
  return { handle, error: null }
}

export async function checkHandle(raw: string, currentHandle: string | null, opts: CallOpts = {}): Promise<HandleCheck> {
  const { handle, error } = localHandleCheck(raw)
  if (error) return { state: 'invalid', message: error }
  if (currentHandle && handle === currentHandle.toLowerCase()) return { state: 'available' }
  try {
    const r = await callApi(ROUTES.handleAvailable, { params: { handle } }, opts)
    if (r.available) return { state: 'available' }
    const message = r.reason === 'reserved' ? 'That handle is reserved.' : r.reason === 'invalid' ? 'That handle is not allowed.' : 'That handle is taken.'
    return { state: 'unavailable', message }
  } catch (e) {
    return { state: 'error', message: errorText(e) }
  }
}

/** File name for the data download: myescapes-export-2026-10-26.json */
export function exportFileName(now = new Date()): string {
  return `myescapes-export-${now.toISOString().slice(0, 10)}.json`
}

/**
 * Fetch the full JSON export as raw text (not re-parsed through the schema, so nothing the
 * server includes is dropped from the user's copy).
 */
export async function fetchExport(opts: CallOpts = {}): Promise<string> {
  const res = await (opts.fetch ?? fetch)(ROUTES.exportMe.path, { method: 'GET', credentials: 'same-origin', signal: opts.signal })
  const text = await res.text()
  if (!res.ok) {
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    throw new ApiCallError(res.status, body && typeof body.error === 'string' && typeof body.code === 'string' ? body : undefined, `${res.status} ${res.statusText}`)
  }
  return text
}

/** Hand the export to the browser as a file download. */
export function downloadText(text: string, fileName: string, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
