/**
 * After "Save & pin" the confirm overlay closes at once, but its photos are still uploading.
 * This follows them and says how it went through the shell toast (Phase 3, workstream A).
 * A photo that failed stays on the visit's queue, so the review overlay offers Retry.
 */
import { summarize, usePhotoQueue, visitTarget, watchTarget } from '@/ui/photos'
import { showToast } from './toast'

export function followUploads(visitId: string, roomName: string, notify: (text: string) => void = showToast): () => void {
  const target = visitTarget(visitId)
  // Hold the finished photos until the toast has counted them; then they're let go (on the server).
  const release = watchTarget(target)
  const check = (): boolean => {
    const s = summarize(usePhotoQueue.getState().items.filter((i) => i.target === target))
    if (s.active > 0) return false
    const n = (k: number) => `${k} photo${k === 1 ? '' : 's'}`
    if (s.failed) notify(`${n(s.failed)} didn't upload. Open ${roomName} on the board to retry.`)
    else if (s.done) notify(`${n(s.done)} added to ${roomName}.`)
    return true
  }
  if (check()) {
    release()
    return () => {}
  }
  const unsub = usePhotoQueue.subscribe(() => {
    if (check()) {
      unsub()
      release()
    }
  })
  return () => {
    unsub()
    release()
  }
}
