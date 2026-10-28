import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiCallError } from '@/contracts/errors'
import type { PhotoV2 } from '@/contracts/models'
import { configurePhotoQueue, MAX_PHOTOS_PER_VISIT, onPhotoUploaded, resetPhotoQueueForTests, summarize, usePhotoQueue } from './queue'
import type { ResizedPhoto } from './resize'
import type { UploadOptions } from './upload'

const photo = (id: string): PhotoV2 => ({ id, visitId: 'vis_1', url: `/api/photos/${id}`, uploaderId: 'usr_me', caption: '', width: 10, height: 10, createdAt: '2026-10-28T00:00:00.000Z' })
const file = (name = 'a.jpg', type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], name, { type })
const resized: ResizedPhoto = { blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const q = () => usePhotoQueue.getState()
const statuses = (target: string) => q().items.filter((i) => i.target === target).map((i) => i.status)

let uploads: { visitId: string; opts: UploadOptions; resolve(p: PhotoV2): void; reject(e: unknown): void }[]
beforeEach(() => {
  uploads = []
  configurePhotoQueue({
    resize: vi.fn(async () => resized),
    upload: (visitId, _p, opts) => new Promise<PhotoV2>((resolve, reject) => uploads.push({ visitId, opts, resolve, reject })),
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
  })
})
afterEach(() => resetPhotoQueueForTests())

describe('photo queue', () => {
  it('resizes picked photos at once but waits for a visit before uploading', async () => {
    const res = q().addFiles('draft:1', [file(), file('b.png', 'image/png')])
    expect(res).toEqual({ added: 2, rejected: [] })
    await flush()
    expect(statuses('draft:1')).toEqual(['ready', 'ready'])
    expect(uploads).toHaveLength(0)

    q().attachToVisit('draft:1', 'vis_1')
    expect(statuses('draft:1')).toEqual([])
    await flush()
    expect(uploads).toHaveLength(1) // one at a time
    expect(uploads[0].visitId).toBe('vis_1')
    uploads[0].opts.onProgress?.(0.5)
    expect(q().items[0].progress).toBe(0.5)
    uploads[0].resolve(photo('pho_1'))
    await flush()
    expect(uploads).toHaveLength(2)
    uploads[1].resolve(photo('pho_2'))
    await flush()
    expect(statuses('visit:vis_1')).toEqual(['done', 'done'])
    expect(q().items.map((i) => i.photo?.id)).toEqual(['pho_1', 'pho_2'])
  })

  it('refuses non-images, huge originals and photos over the per-visit limit', () => {
    const res = q().addFiles('draft:2', [file('notes.txt', 'text/plain'), file('big.jpg', 'image/jpeg', 41 * 1024 * 1024), file('1.jpg'), file('2.jpg')], { slots: 1 })
    expect(res.added).toBe(1)
    expect(res.rejected).toHaveLength(3)
    expect(res.rejected[0]).toMatch(/isn't a photo/)
    expect(res.rejected[1]).toMatch(/40 MB/)
    expect(res.rejected[2]).toMatch(new RegExp(`${MAX_PHOTOS_PER_VISIT} photos`))
  })

  it('marks a failed upload, retries it, and tells listeners when it lands', async () => {
    const seen = vi.fn()
    onPhotoUploaded(seen)
    q().addFiles('visit:vis_1', [file()])
    await flush()
    uploads[0].reject(new TypeError('Failed to fetch'))
    await flush()
    const failed = q().items[0]
    expect(failed.status).toBe('error')
    expect(failed.permanent).toBe(false)
    expect(failed.error).toBeTruthy()
    expect(summarize(q().items)).toMatchObject({ failed: 1, active: 0 })

    q().retry(failed.key)
    await flush()
    expect(uploads).toHaveLength(2)
    uploads[1].resolve(photo('pho_9'))
    await flush()
    expect(q().items[0].status).toBe('done')
    expect(seen).toHaveBeenCalledWith('visit:vis_1', expect.objectContaining({ id: 'pho_9' }))
  })

  it('treats a full visit or a wrong file type as permanent', async () => {
    q().addFiles('visit:vis_1', [file()])
    await flush()
    uploads[0].reject(new ApiCallError(409, { error: 'A visit can hold at most 30 photos.', code: 'conflict' }, '409'))
    await flush()
    expect(q().items[0]).toMatchObject({ status: 'error', permanent: true, error: 'A visit can hold at most 30 photos.' })
  })

  it('shows a friendly message when the browser cannot decode the photo', async () => {
    configurePhotoQueue({ resize: async () => Promise.reject(new DOMException('The source image could not be decoded.', 'EncodingError')) })
    q().addFiles('draft:3', [file('x.heic', 'image/heic')])
    await flush()
    expect(q().items[0].status).toBe('error')
    expect(q().items[0].error).toMatch(/JPEG or PNG/)
  })

  it('remove cancels an upload in flight; clear forgets a target and its binding', async () => {
    q().addFiles('visit:vis_1', [file(), file()])
    await flush()
    const signal = uploads[0].opts.signal!
    q().remove(q().items[0].key)
    expect(signal.aborted).toBe(true)
    uploads[0].reject(Object.assign(new Error('x'), { name: 'AbortError' }))
    await flush()
    expect(q().items).toHaveLength(1)
    q().clear('visit:vis_1')
    expect(q().items).toHaveLength(0)
  })
})
