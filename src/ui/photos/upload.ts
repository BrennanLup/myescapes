/**
 * Upload one resized photo with progress. Browsers' `fetch` has no upload progress, so this uses
 * XMLHttpRequest when it exists and no `fetch` seam was passed (tests pass one and get a single
 * progress tick at the end). Errors are the same `ApiCallError` that `callApi` throws.
 */
import { ApiCallError, ApiErrorSchema } from '@/contracts/errors'
import { PhotoV2Schema, type PhotoV2 } from '@/contracts/models'
import { ROUTES, buildPath, callApi } from '@/contracts/routes'
import type { ResizedPhoto } from './resize'

export interface UploadOptions {
  caption?: string
  /** 0..1 as the bytes go out. */
  onProgress?(fraction: number): void
  signal?: AbortSignal
  /** Test seam: when set, the upload goes through `callApi` with this fetch. */
  fetch?: typeof fetch
}

export function photoForm(photo: ResizedPhoto, caption = ''): FormData {
  const fd = new FormData()
  fd.append('caption', caption)
  fd.append('width', String(photo.width))
  fd.append('height', String(photo.height))
  fd.append('photo', photo.blob, 'photo.jpg')
  return fd
}

/** Thrown when the network drops (not an HTTP error). */
export class UploadNetworkError extends Error {
  constructor() {
    super("The upload didn't go through. Check your connection and try again.")
    this.name = 'UploadNetworkError'
  }
}

export function abortError(): Error {
  const e = new Error('The upload was cancelled.')
  e.name = 'AbortError'
  return e
}

export async function uploadPhotoWithProgress(visitId: string, photo: ResizedPhoto, opts: UploadOptions = {}): Promise<PhotoV2> {
  const body = photoForm(photo, opts.caption ?? '')
  if (opts.fetch || typeof XMLHttpRequest === 'undefined') {
    const out = await callApi(ROUTES.uploadPhoto, { params: { id: visitId }, body }, { fetch: opts.fetch, signal: opts.signal })
    opts.onProgress?.(1)
    return out
  }
  const url = buildPath(ROUTES.uploadPhoto.path, { id: visitId })
  return new Promise<PhotoV2>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError())
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.responseType = 'text'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(0.99, e.loaded / e.total))
    }
    xhr.onload = () => {
      let json: unknown
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
      } catch {
        json = undefined
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = PhotoV2Schema.safeParse(json)
        if (!parsed.success) return reject(new Error('The server sent an unexpected answer.'))
        opts.onProgress?.(1)
        return resolve(parsed.data)
      }
      const err = ApiErrorSchema.safeParse(json)
      reject(new ApiCallError(xhr.status, err.success ? err.data : undefined, `${xhr.status} ${xhr.statusText}`))
    }
    xhr.onerror = () => reject(new UploadNetworkError())
    xhr.ontimeout = () => reject(new UploadNetworkError())
    xhr.onabort = () => reject(abortError())
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

/** A short, human message for a failed upload. */
export function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.code === 'unauthorized') return 'You were signed out. Sign in again, then retry.'
    if (err.code === 'too_large') return 'That photo is too large, even after resizing.'
    if (err.code === 'rate_limited') return 'Too many uploads at once. Wait a minute, then retry.'
    if (err.code === 'db_unavailable' || err.status >= 500) return 'The server is having a moment. Try again shortly.'
    return err.message
  }
  if (err instanceof Error && err.message) return err.message
  return 'The photo could not be uploaded.'
}

/** Errors a retry can't fix (wrong type, visit full, not allowed). */
export function isPermanentUploadError(err: unknown): boolean {
  return err instanceof ApiCallError && ['unsupported_media', 'forbidden', 'not_found', 'conflict', 'invalid', 'too_large'].includes(err.code ?? '')
}
