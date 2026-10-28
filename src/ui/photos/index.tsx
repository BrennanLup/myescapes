/**
 * Photo UI (workstream 24): pick, resize in the browser (~1600 px, < 400 KB), upload via
 * ROUTES.uploadPhoto (multipart field `photo`), and a grid where the uploader can remove their own.
 *
 *   <PhotoUploader visitId={id} onUploaded={(id, photo) => ...} />
 *   <PhotoGrid photos={visit.photos} meId={me.id} onDeleted={(id) => ...} />
 */
import { useRef, useState } from 'react'
import type { PhotoV2 } from '@/contracts/models'
import { ROUTES, callApi } from '@/contracts/routes'
import { resizePhoto, type ResizedPhoto } from './resize'

export { fitWithin, encodeUnderBudget, resizePhoto, TARGET_MAX_PX, TARGET_MAX_BYTES } from './resize'
export { PhotoAttach, type PhotoAttachProps } from './PhotoAttach'
export {
  usePhotoQueue,
  visitTarget,
  visitOf,
  newDraftTarget,
  onPhotoUploaded,
  summarize,
  configurePhotoQueue,
  resetPhotoQueueForTests,
  MAX_PHOTOS_PER_VISIT,
  type PendingPhoto,
} from './queue'
export { uploadPhotoWithProgress, uploadErrorMessage } from './upload'

/** Resize to fit `maxPx` on the long side and re-encode as JPEG under ~400 KB. */
export async function resizeImage(file: Blob, maxPx = 1600): Promise<Blob> {
  return (await resizePhoto(file, maxPx)).blob
}

/** Upload one already-resized photo. */
export async function uploadPhoto(visitId: string, photo: ResizedPhoto, caption = '', init: { fetch?: typeof fetch } = {}): Promise<PhotoV2> {
  const fd = new FormData()
  fd.append('caption', caption)
  fd.append('width', String(photo.width))
  fd.append('height', String(photo.height))
  fd.append('photo', photo.blob, 'photo.jpg')
  return callApi(ROUTES.uploadPhoto, { params: { id: visitId }, body: fd }, init)
}

export interface PhotoUploaderProps {
  visitId: string
  /** Called once per uploaded photo (the id first, matching the original stub signature). */
  onUploaded?(photoId: string, photo: PhotoV2): void
  /** Test seams. */
  resize?: (file: Blob) => Promise<ResizedPhoto>
  fetch?: typeof fetch
}

type State = { kind: 'idle' } | { kind: 'busy'; done: number; total: number } | { kind: 'error'; message: string }

export function PhotoUploader({ visitId, onUploaded, resize = (f) => resizePhoto(f), fetch: fetchImpl }: PhotoUploaderProps) {
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function onFiles(files: FileList | null) {
    const list = files ? [...files] : []
    if (!list.length) return
    setState({ kind: 'busy', done: 0, total: list.length })
    try {
      for (let i = 0; i < list.length; i++) {
        const resized = await resize(list[i])
        const photo = await uploadPhoto(visitId, resized, '', { fetch: fetchImpl })
        onUploaded?.(photo.id, photo)
        setState({ kind: 'busy', done: i + 1, total: list.length })
      }
      setState({ kind: 'idle' })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'The photo could not be uploaded.' })
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const busy = state.kind === 'busy'
  return (
    <div data-testid="photo-uploader" className="flex flex-col gap-1">
      <label className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-700/40 px-4 py-2 font-medium text-amber-900 ${busy ? 'opacity-60' : 'hover:bg-amber-50'}`}>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={busy}
          aria-label="Add photos"
          data-testid="photo-input"
          onChange={(e) => void onFiles(e.currentTarget.files)}
        />
        <span aria-hidden="true">📷</span>
        {busy ? `Uploading ${state.done + 1} of ${state.total}…` : 'Add photos'}
      </label>
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </div>
  )
}

export interface PhotoGridProps {
  photos: readonly PhotoV2[]
  /** The signed-in user's id: their own photos get a remove button. */
  meId?: string | null
  onDeleted?(photoId: string): void
  fetch?: typeof fetch
}

export function PhotoGrid({ photos, meId, onDeleted, fetch: fetchImpl }: PhotoGridProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!photos.length) return null

  async function remove(id: string) {
    setBusy(id)
    setError(null)
    try {
      await callApi(ROUTES.deletePhoto, { params: { id } }, { fetch: fetchImpl })
      onDeleted?.(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="photo-grid">
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <li key={p.id} className="relative overflow-hidden rounded-lg bg-stone-100">
            <img src={p.url} alt={p.caption || 'Visit photo'} loading="lazy" className="aspect-square w-full object-cover" />
            {meId && p.uploaderId === meId && (
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={busy === p.id}
                aria-label="Remove photo"
                className="absolute top-1 right-1 min-h-8 min-w-8 rounded-full bg-black/60 px-2 text-sm text-white"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
