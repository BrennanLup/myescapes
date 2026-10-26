/**
 * Recordings waiting to upload (workstream 14). Basements have weak signal, so every recording is
 * saved in IndexedDB (idb-keyval) before the upload starts and stays there until the server
 * confirms the transcript. Then the audio is deleted right away (the privacy policy promises raw
 * audio is not kept once its transcript exists) and only the transcript waits, until the person
 * finishes logging it or discards it.
 *
 * Item lifecycle: `pending` (audio stored) -> `transcribed` (audio deleted, transcript kept) -> removed.
 * A `failed` item hit an error that retrying won't fix (bad file); it can be retried by hand or discarded.
 *
 * Each item belongs to the account that recorded it (`ownerId`). Listing, resuming and uploading
 * only ever see the current account's items, so a second person signing in on the same phone can
 * neither see nor upload them, and signing out or deleting the account clears the whole queue
 * (`clearRecordingQueue`, called from `signOut` in src/auth/api.ts).
 */
import { clear, createStore, del, entries, get, set, type UseStore } from 'idb-keyval'
import { ApiCallError } from '../../contracts/errors'

export type QueueStatus = 'pending' | 'transcribed' | 'failed'

export interface QueuedRecording {
  /** Also sent to the server as `clientId`, so retries are recognisable. */
  id: string
  /**
   * The signed-in account that recorded it (null only when nobody was signed in, e.g. in tests).
   * Items saved before this field existed have none and are treated as null.
   */
  ownerId?: string | null
  status: QueueStatus
  /**
   * The recorded bytes while `pending` / `failed`; deleted once the transcript is in. Stored as an
   * ArrayBuffer rather than a Blob, which some Safari versions could not keep in IndexedDB.
   */
  audio: ArrayBuffer | null
  mimeType: string
  durationSeconds: number
  createdAt: string
  attempts: number
  lastError: string | null
  /** The browser's live captions while recording (a preview, and a fallback). */
  liveTranscript: string
  /** The server transcript, once confirmed. */
  transcript: string | null
}

export interface TranscribeResult {
  transcript: string
}

export type Uploader = (item: QueuedRecording) => Promise<TranscribeResult>

let store: UseStore | null = null
function db(): UseStore {
  store ??= createStore('myescapes-recordings', 'queue')
  return store
}

/** Tests: drop the cached store handle (after deleting the database). */
export function resetQueueStoreForTests() {
  store = null
}

const listeners = new Set<() => void>()
function changed() {
  listeners.forEach((l) => l())
}
export function subscribeQueue(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function newRecordingId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `rec_${rnd}`
}

export async function enqueueRecording(input: { id?: string; ownerId?: string | null; audio: Blob; mimeType?: string; durationSeconds: number; liveTranscript?: string; now?: Date }): Promise<QueuedRecording> {
  const item: QueuedRecording = {
    id: input.id ?? newRecordingId(),
    ownerId: input.ownerId ?? null,
    status: 'pending',
    audio: await blobBytes(input.audio),
    mimeType: input.mimeType || input.audio.type || 'audio/webm',
    durationSeconds: Math.max(0, Math.round(input.durationSeconds * 10) / 10),
    createdAt: (input.now ?? new Date()).toISOString(),
    attempts: 0,
    lastError: null,
    liveTranscript: input.liveTranscript ?? '',
    transcript: null,
  }
  await set(item.id, item, db())
  changed()
  return item
}

async function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer()
  return new Response(b).arrayBuffer()
}

/** The queued audio as a Blob for the upload form. */
export function audioBlob(item: QueuedRecording): Blob | null {
  return item.audio ? new Blob([item.audio], { type: item.mimeType }) : null
}

function ownedBy(item: QueuedRecording, ownerId: string | null): boolean {
  return (item.ownerId ?? null) === ownerId
}

async function rawGet(id: string): Promise<QueuedRecording | undefined> {
  return get<QueuedRecording>(id, db())
}

/** One of `ownerId`'s recordings (undefined when it is missing or belongs to someone else). */
export async function getRecording(id: string, ownerId: string | null = null): Promise<QueuedRecording | undefined> {
  const item = await rawGet(id)
  return item && ownedBy(item, ownerId) ? item : undefined
}

/** `ownerId`'s recordings, oldest first. */
export async function listRecordings(ownerId: string | null = null): Promise<QueuedRecording[]> {
  const all = (await entries<string, QueuedRecording>(db())).map(([, v]) => v).filter((v) => ownedBy(v, ownerId))
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** How many recordings (any account) are on this device. */
export async function countAllRecordings(): Promise<number> {
  return (await entries(db())).length
}

/**
 * Delete every recording on this device, audio and transcripts, for every account. Called on
 * sign-out and account deletion so nothing is left for the next person to sign in on this phone.
 */
export async function clearRecordingQueue(): Promise<void> {
  await clear(db())
  changed()
}

export async function updateRecording(id: string, patch: Partial<QueuedRecording>): Promise<QueuedRecording | undefined> {
  const cur = await rawGet(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch, id: cur.id, ownerId: cur.ownerId ?? null }
  await set(id, next, db())
  changed()
  return next
}

/** Forget a recording completely (logged, or discarded by the person). */
export async function removeRecording(id: string): Promise<void> {
  await del(id, db())
  changed()
}

/** Save the confirmed transcript and delete the audio. */
export async function markTranscribed(id: string, transcript: string): Promise<QueuedRecording | undefined> {
  return updateRecording(id, { status: 'transcribed', transcript, audio: null, lastError: null })
}

/** Errors worth retrying later (offline, server down, cap reached for today, not signed in yet). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiCallError) {
    if (err.code === 'too_large' || err.code === 'unsupported_media' || err.code === 'invalid') return false
    return true
  }
  // fetch() network failures are TypeErrors; anything unknown is treated as transient.
  return true
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.code === 'spending_cap') return "Today's transcription allowance is used up. It will upload tomorrow, or you can type your notes."
    if (err.code === 'unauthorized') return 'Sign in again to upload this recording.'
    if (err.code === 'not_implemented') return 'Transcription is not available on the server yet.'
    if (err.status >= 500) return 'The server had a problem. It will try again.'
    return err.message
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline. It will upload when you're back online."
  return 'The upload did not go through. It will try again.'
}

/**
 * Upload one recording. On success the transcript is saved and the audio deleted. On failure the
 * audio stays queued (`pending`, or `failed` when retrying can't help) and the error is rethrown.
 */
const inFlight = new Map<string, Promise<QueuedRecording>>()

export function uploadRecording(id: string, upload: Uploader, ownerId: string | null = null): Promise<QueuedRecording> {
  // The log screen and the background retry may both try the same recording: share one upload.
  const key = `${ownerId ?? ''}\u0000${id}`
  const cur = inFlight.get(key)
  if (cur) return cur
  const p = doUpload(id, upload, ownerId).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

async function doUpload(id: string, upload: Uploader, ownerId: string | null): Promise<QueuedRecording> {
  const item = await getRecording(id, ownerId)
  if (!item) throw new Error('That recording is no longer on this phone.')
  if (item.status === 'transcribed') return item
  if (!item.audio) throw new Error('That recording has no audio left to upload.')
  try {
    const res = await upload(item)
    return (await markTranscribed(id, res.transcript))!
  } catch (err) {
    await updateRecording(id, { attempts: item.attempts + 1, lastError: errorMessage(err), status: isRetryable(err) ? 'pending' : 'failed' })
    throw err
  }
}

let flushing: { ownerId: string | null; token: object; run: Promise<{ uploaded: number; failed: number }> } | null = null

/**
 * Upload every `pending` recording of `ownerId` (only theirs), one at a time. Concurrent calls for
 * the same account share one run.
 */
export function flushQueue(upload: Uploader, opts: { includeFailed?: boolean; ownerId?: string | null } = {}): Promise<{ uploaded: number; failed: number }> {
  const ownerId = opts.ownerId ?? null
  if (flushing && flushing.ownerId === ownerId) return flushing.run
  const before = flushing?.run.catch(() => undefined)
  const token = {}
  const run = (async () => {
    let uploaded = 0
    let failed = 0
    try {
      await before
      for (const item of await listRecordings(ownerId)) {
        if (item.status === 'transcribed') continue
        if (item.status === 'failed' && !opts.includeFailed) continue
        try {
          await uploadRecording(item.id, upload, ownerId)
          uploaded++
        } catch {
          failed++
        }
      }
    } finally {
      if (flushing?.token === token) flushing = null
    }
    return { uploaded, failed }
  })()
  flushing = { ownerId, token, run }
  return run
}

export interface QueueSummary {
  /** Recordings with audio still on the phone. */
  waiting: number
  /** Transcripts ready to be turned into a log. */
  ready: number
  failed: number
}

export function summarize(items: QueuedRecording[]): QueueSummary {
  return {
    waiting: items.filter((i) => i.status === 'pending' || i.status === 'failed').length,
    ready: items.filter((i) => i.status === 'transcribed').length,
    failed: items.filter((i) => i.status === 'failed').length,
  }
}

/** "1 recording waiting to upload", "3 recordings waiting to upload". */
export function waitingLabel(n: number): string {
  return `${n} recording${n === 1 ? '' : 's'} waiting to upload`
}

export function readyLabel(n: number): string {
  return `${n} transcript${n === 1 ? '' : 's'} ready to log`
}
