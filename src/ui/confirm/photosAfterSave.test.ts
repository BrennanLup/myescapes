import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhotoV2 } from '@/contracts/models'
import { configurePhotoQueue, resetPhotoQueueForTests, usePhotoQueue } from '@/ui/photos'
import { followUploads } from './photosAfterSave'

const photo = (id: string): PhotoV2 => ({ id, visitId: 'vis_1', url: `/api/photos/${id}`, uploaderId: 'usr_me', caption: '', width: 4, height: 3, createdAt: '2026-10-28T00:00:00.000Z' })
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

let uploads: { resolve(p: PhotoV2): void; reject(e: unknown): void }[]
beforeEach(() => {
  uploads = []
  configurePhotoQueue({
    resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
    upload: () => new Promise<PhotoV2>((resolve, reject) => uploads.push({ resolve, reject })),
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
  })
})
afterEach(() => resetPhotoQueueForTests())

describe('followUploads', () => {
  it('toasts once every photo landed, then lets the finished ones go', async () => {
    const q = usePhotoQueue.getState()
    q.addFiles('draft:a', [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })])
    await flush()
    q.attachToVisit('draft:a', 'vis_1')
    const notify = vi.fn()
    followUploads('vis_1', 'The Vault', notify)
    await flush()
    uploads[0].resolve(photo('p1'))
    await flush()
    expect(usePhotoQueue.getState().items).toHaveLength(2)
    uploads[1].resolve(photo('p2'))
    await flush()
    expect(notify).toHaveBeenCalledWith('2 photos added to The Vault.')
    // Both are on the server now: the queue no longer holds their JPEGs.
    expect(usePhotoQueue.getState().items).toHaveLength(0)
  })

  it('keeps a failed photo for Retry', async () => {
    const q = usePhotoQueue.getState()
    q.addFiles('visit:vis_2', [new File(['a'], 'a.jpg', { type: 'image/jpeg' })])
    const notify = vi.fn()
    followUploads('vis_2', 'The Vault', notify)
    await flush()
    uploads[0].reject(new TypeError('Failed to fetch'))
    await flush()
    expect(notify).toHaveBeenCalledWith("1 photo didn't upload. Open The Vault on the board to retry.")
    expect(usePhotoQueue.getState().items.map((i) => i.status)).toEqual(['error'])
  })
})
