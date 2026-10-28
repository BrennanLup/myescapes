/**
 * Keep the 3D room's store in step with photo uploads (Phase 3, workstream A): a photo uploaded
 * for a visit shows up on that review (gallery, polaroid) without reloading the dataset, and one
 * removed disappears. In the 3D room a review id is the visit id (server/db/dataset.ts).
 */
import type { PhotoV2 } from '@/contracts/models'
import { onPhotoUploaded, visitOf } from '@/ui/photos'
import { useStore } from '@/state/store'

let unsubscribe: (() => void) | null = null

export function addPhotoToRoomStore(visitId: string, photo: Pick<PhotoV2, 'url' | 'caption'>): void {
  useStore.setState((s) => ({
    reviews: s.reviews.map((r) =>
      r.id === visitId && !r.photos.some((p) => p.url === photo.url) ? { ...r, photos: [...r.photos, { url: photo.url, caption: photo.caption || undefined }] } : r,
    ),
  }))
}

export function removePhotoFromRoomStore(visitId: string, url: string): void {
  useStore.setState((s) => ({ reviews: s.reviews.map((r) => (r.id === visitId ? { ...r, photos: r.photos.filter((p) => p.url !== url) } : r)) }))
}

/** Subscribe (again) to finished uploads. Safe to call on every mount. */
export function ensureRoomPhotoSync(): void {
  unsubscribe?.()
  unsubscribe = onPhotoUploaded((target, photo) => {
    const visitId = visitOf(target) ?? photo.visitId
    addPhotoToRoomStore(visitId, photo)
  })
}
