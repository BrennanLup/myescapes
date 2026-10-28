/**
 * "Photos" card in the 3D room's review overlay (Phase 3, workstream A): add photos to a visit
 * that is already on the board, see uploads in progress (also ones started from the confirm form,
 * with Retry), and remove your own (behind "Edit photos"). Tap a photo to see it full size. Only for
 * signed-in rooms, where a review id is the visit id.
 */
import { useEffect, useState } from 'react'
import type { PhotoV2 } from '@/contracts/models'
import { callApi, ROUTES } from '@/contracts/routes'
import { useSession } from '@/auth'
import { PhotoAttach, visitTarget } from '@/ui/photos'
import { PaperCard } from './sections'
import { ensureRoomPhotoSync, removePhotoFromRoomStore } from './photoSync'

export function VisitPhotos({ visitId, fetch: fetchImpl }: { visitId: string; fetch?: typeof fetch }) {
  const session = useSession()
  const meId = session.status === 'signed-in' ? session.user.id : null
  const [photos, setPhotos] = useState<PhotoV2[] | null>(null)
  const [canAdd, setCanAdd] = useState(true)

  useEffect(() => {
    ensureRoomPhotoSync()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    setPhotos(null)
    callApi(ROUTES.visit, { params: { id: visitId } }, { signal: ac.signal, fetch: fetchImpl })
      .then((v) => {
        setPhotos(v.photos)
        setCanAdd(v.myStatus === 'owner' || v.myStatus === 'accepted')
      })
      .catch(() => {
        // Still let the owner add photos; the list just starts empty.
        if (!ac.signal.aborted) setPhotos([])
      })
    return () => ac.abort()
  }, [visitId, fetchImpl])

  return (
    <PaperCard label="Photos">
      <h3 className="mb-3 font-display text-xl font-semibold text-ink">Photos</h3>
      {photos === null ? (
        <p className="text-sm text-ink-soft">Loading photos…</p>
      ) : (
        <PhotoAttach
          target={visitTarget(visitId)}
          visitId={visitId}
          existing={photos}
          meId={meId}
          fetch={fetchImpl}
          testId="review-photo-attach"
          editToggle
          disabledReason={canAdd ? null : 'Accept the tag on this visit to add photos.'}
          onExistingDeleted={(id) => {
            const gone = photos.find((p) => p.id === id)
            setPhotos((ps) => (ps ?? []).filter((p) => p.id !== id))
            removePhotoFromRoomStore(visitId, gone?.url ?? `/api/photos/${encodeURIComponent(id)}`)
          }}
        />
      )}
    </PaperCard>
  )
}
