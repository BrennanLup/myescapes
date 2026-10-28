/**
 * Photo upload queue (Phase 3, workstream A). One small Zustand store shared by the review forms
 * (desktop confirm overlay, phone log flow), the 3D room's review overlay and the phone's room
 * detail, so an upload keeps going after the form that started it closes.
 *
 * Items belong to a *target*: a draft key (`draft:...`) for a review that isn't saved yet, or a
 * visit key (`visit:<id>`). Photos are resized as soon as they are picked, so the thumbnails
 * show at once; only visit items upload. `attachToVisit(draft, visitId)` is what "upload right
 * after save" calls: it moves the draft's photos onto the visit, so a failed one can be retried
 * later from anywhere that shows that visit. Uploads run one at a time, oldest first, which is
 * kindest to a weak phone signal.
 */
import { create } from 'zustand'
import type { PhotoV2 } from '@/contracts/models'
import { resizePhoto, type ResizedPhoto } from './resize'
import { isPermanentUploadError, uploadErrorMessage, uploadPhotoWithProgress, type UploadOptions } from './upload'

/** Server cap per visit (server/routes/photos.ts MAX_PHOTOS_PER_VISIT). */
export const MAX_PHOTOS_PER_VISIT = 30
/** Larger originals are refused before decoding (a phone photo is ~3-12 MB). */
export const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024

export type PendingStatus = 'preparing' | 'ready' | 'uploading' | 'done' | 'error'

export interface PendingPhoto {
  key: string
  target: string
  name: string
  status: PendingStatus
  /** 0..1 while uploading. */
  progress: number
  error: string | null
  /** True when retrying can't help (wrong type, visit full). */
  permanent: boolean
  /** Object URL of the resized JPEG (or the original until it is resized). */
  previewUrl: string | null
  source: Blob
  resized: ResizedPhoto | null
  photo: PhotoV2 | null
}

export interface AddResult {
  added: number
  /** One message per file that was refused (not an image, too big, over the limit). */
  rejected: string[]
}

type Resize = (file: Blob) => Promise<ResizedPhoto>
type Upload = (visitId: string, photo: ResizedPhoto, opts: UploadOptions) => Promise<PhotoV2>

interface Deps {
  resize: Resize
  upload: Upload
  createUrl(b: Blob): string | null
  revokeUrl(url: string): void
}

const defaultDeps = (): Deps => ({
  resize: (f) => resizePhoto(f),
  upload: uploadPhotoWithProgress,
  createUrl: (b) => (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null),
  revokeUrl: (u) => {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(u)
  },
})

let deps: Deps = defaultDeps()

/** Tests: swap the resizer, the uploader or the object URL helpers. */
export function configurePhotoQueue(over: Partial<Deps>): void {
  deps = { ...deps, ...over }
}

export const visitTarget = (visitId: string) => `visit:${visitId}`
/** The visit id of a `visit:<id>` target, else null. */
export const visitOf = (target: string): string | null => (target.startsWith('visit:') ? target.slice(6) || null : null)
let draftSeq = 0
export const newDraftTarget = () => `draft:${Date.now().toString(36)}-${++draftSeq}`

type Listener = (target: string, photo: PhotoV2) => void
const listeners = new Set<Listener>()
/** Called once per finished upload. Returns an unsubscribe function. */
export function onPhotoUploaded(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

interface QueueState {
  items: PendingPhoto[]
  addFiles(target: string, files: Iterable<Blob>, opts?: { slots?: number }): AddResult
  /** Move a draft's photos onto a saved visit and start uploading them. */
  attachToVisit(target: string, visitId: string): void
  retry(key: string): void
  retryAll(target: string): void
  remove(key: string): void
  /** Forget finished items of a target (their photos now live in the visit). */
  clearDone(target: string): void
  /** Drop everything of a target, cancelling uploads. */
  clear(target: string): void
}

let keySeq = 0
const controllers = new Map<string, AbortController>()
let pumping = false

const looksLikeImage = (b: Blob & { name?: string }) => (b.type ? b.type.startsWith('image/') : /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(b.name ?? ''))

export const usePhotoQueue = create<QueueState>()((set, get) => {
  const patch = (key: string, p: Partial<PendingPhoto>) => set((s) => ({ items: s.items.map((it) => (it.key === key ? { ...it, ...p } : it)) }))
  const find = (key: string) => get().items.find((i) => i.key === key)

  async function prepare(key: string) {
    const item = find(key)
    if (!item) return
    patch(key, { status: 'preparing', error: null, permanent: false })
    try {
      const resized = await deps.resize(item.source)
      const cur = find(key)
      if (!cur) return
      const url = deps.createUrl(resized.blob)
      if (cur.previewUrl && url) deps.revokeUrl(cur.previewUrl)
      patch(key, { status: 'ready', resized, previewUrl: url ?? cur.previewUrl })
      void pump()
    } catch (err) {
      if (!find(key)) return
      // DOMExceptions aren't always `instanceof Error` (older engines, jsdom).
      const e = (err ?? {}) as { name?: string; message?: string }
      const msg = typeof e.message === 'string' && e.message ? e.message : "This photo couldn't be read."
      const undecodable = /decode|source image|InvalidStateError|EncodingError/i.test(`${e.name ?? ''} ${msg}`)
      patch(key, { status: 'error', error: undecodable ? "This browser can't open that photo. Try a JPEG or PNG." : msg })
    }
  }

  async function pump() {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        const next = get().items.find((i) => i.status === 'ready' && visitOf(i.target))
        if (!next || !next.resized) break
        const visitId = visitOf(next.target)!
        const ctl = new AbortController()
        controllers.set(next.key, ctl)
        patch(next.key, { status: 'uploading', progress: 0, error: null })
        try {
          const photo = await deps.upload(visitId, next.resized, { signal: ctl.signal, onProgress: (f) => patch(next.key, { progress: f }) })
          if (find(next.key)) patch(next.key, { status: 'done', progress: 1, photo })
          for (const fn of listeners) fn(next.target, photo)
        } catch (err) {
          if (find(next.key)) {
            const aborted = (err as { name?: string })?.name === 'AbortError'
            patch(next.key, { status: 'error', progress: 0, error: aborted ? 'Upload cancelled.' : uploadErrorMessage(err), permanent: isPermanentUploadError(err) })
          }
        } finally {
          controllers.delete(next.key)
        }
      }
    } finally {
      pumping = false
    }
  }

  const drop = (it: PendingPhoto) => {
    controllers.get(it.key)?.abort()
    controllers.delete(it.key)
    if (it.previewUrl) deps.revokeUrl(it.previewUrl)
  }

  return {
    items: [],
    addFiles(target, files, opts = {}) {
      const rejected: string[] = []
      const fresh: PendingPhoto[] = []
      let slots = opts.slots ?? Infinity
      for (const f of files) {
        const name = (f as Blob & { name?: string }).name || 'photo'
        if (!looksLikeImage(f)) {
          rejected.push(`${name} isn't a photo.`)
          continue
        }
        if (f.size > MAX_ORIGINAL_BYTES) {
          rejected.push(`${name} is over 40 MB.`)
          continue
        }
        if (slots <= 0) {
          rejected.push(`${name} wasn't added: a visit holds at most ${MAX_PHOTOS_PER_VISIT} photos.`)
          continue
        }
        slots--
        fresh.push({ key: `ph_${++keySeq}`, target, name, status: 'preparing', progress: 0, error: null, permanent: false, previewUrl: deps.createUrl(f), source: f, resized: null, photo: null })
      }
      if (fresh.length) set((s) => ({ items: [...s.items, ...fresh] }))
      // One at a time: decoding a dozen 12-megapixel photos at once can run a phone out of memory.
      void (async () => {
        for (const it of fresh) await prepare(it.key)
      })()
      return { added: fresh.length, rejected }
    },
    attachToVisit(target, visitId) {
      const to = visitTarget(visitId)
      if (target !== to) set((s) => ({ items: s.items.map((i) => (i.target === target ? { ...i, target: to } : i)) }))
      void pump()
    },
    retry(key) {
      const it = find(key)
      if (!it || it.status !== 'error') return
      if (!it.resized) void prepare(key)
      else {
        patch(key, { status: 'ready', error: null, permanent: false })
        void pump()
      }
    },
    retryAll(target) {
      for (const it of get().items) if (it.target === target && it.status === 'error' && !it.permanent) get().retry(it.key)
    },
    remove(key) {
      const it = find(key)
      if (!it) return
      drop(it)
      set((s) => ({ items: s.items.filter((i) => i.key !== key) }))
    },
    clearDone(target) {
      const gone = get().items.filter((i) => i.target === target && i.status === 'done')
      if (!gone.length) return
      gone.forEach(drop)
      set((s) => ({ items: s.items.filter((i) => !gone.includes(i)) }))
    },
    clear(target) {
      const gone = get().items.filter((i) => i.target === target)
      gone.forEach(drop)
      set((s) => ({ items: s.items.filter((i) => i.target !== target) }))
    },
  }
})

/** Counts for a target: what's left to do and what failed. */
export function summarize(items: readonly PendingPhoto[]) {
  let waiting = 0
  let uploading = 0
  let failed = 0
  let done = 0
  for (const i of items) {
    if (i.status === 'error') failed++
    else if (i.status === 'done') done++
    else if (i.status === 'uploading') uploading++
    else waiting++
  }
  return { waiting, uploading, failed, done, active: waiting + uploading, total: items.length }
}

/** Tests: empty the queue and restore the real dependencies. */
export function resetPhotoQueueForTests(): void {
  for (const c of controllers.values()) c.abort()
  controllers.clear()
  listeners.clear()
  pumping = false
  deps = defaultDeps()
  usePhotoQueue.setState({ items: [] })
}
