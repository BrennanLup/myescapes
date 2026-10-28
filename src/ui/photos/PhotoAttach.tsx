/**
 * "Add photos" for a review form or an existing visit (Phase 3, workstream A).
 *
 *   <PhotoAttach target={draftKey} />                         // before the visit exists: queued
 *   <PhotoAttach target={visitTarget(id)} visitId={id} existing={visit.photos} meId={me.id} />
 *
 * Thumbnails show at once (resized in the browser), each with a remove button, an upload progress
 * bar, and Retry when it failed. Drop files on it on a desktop. Light: no three.js.
 */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import type { PhotoV2 } from '@/contracts/models'
import { ROUTES, callApi } from '@/contracts/routes'
import { MAX_PHOTOS_PER_VISIT, summarize, usePhotoQueue, visitTarget, type PendingPhoto } from './queue'

export interface PhotoAttachProps {
  /** Queue key while the visit doesn't exist yet (`newDraftTarget()`); ignored once `visitId` is set. */
  target: string
  /** Set once the visit exists: queued photos upload straight away. */
  visitId?: string | null
  /** Photos already on the visit. */
  existing?: readonly PhotoV2[]
  /** The signed-in user's id: their own existing photos get a remove button. */
  meId?: string | null
  /** Called after one of my photos (already there, or just uploaded here) was deleted. */
  onExistingDeleted?(photoId: string): void
  /** Shown instead of the picker (for example in the signed-out demo). */
  disabledReason?: string | null
  /** Smaller heading-less variant for the overlays. */
  compact?: boolean
  testId?: string
  fetch?: typeof fetch
}

const tile = 'relative aspect-square overflow-hidden rounded-xl border-2 border-panel-edge/70 bg-paper'
const xBtn =
  'absolute top-1 right-1 grid h-9 w-9 place-items-center rounded-full bg-ink/70 text-base font-bold text-white shadow transition hover:bg-ink focus-visible:outline-3 focus-visible:outline-accent disabled:opacity-50'

export function PhotoAttach({ target: draftTarget, visitId = null, existing = [], meId = null, onExistingDeleted, disabledReason = null, compact = false, testId = 'photo-attach', fetch: fetchImpl }: PhotoAttachProps) {
  // Once the visit exists its photos live under the visit's key (see attachToVisit).
  const target = visitId ? visitTarget(visitId) : draftTarget
  const all = usePhotoQueue((s) => s.items)
  const items = useMemo(() => all.filter((i) => i.target === target), [all, target])
  const addFiles = usePhotoQueue((s) => s.addFiles)
  const attachToVisit = usePhotoQueue((s) => s.attachToVisit)
  const retry = usePhotoQueue((s) => s.retry)
  const retryAll = usePhotoQueue((s) => s.retryAll)
  const remove = usePhotoQueue((s) => s.remove)
  const input = useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const hintId = useId()

  useEffect(() => {
    if (visitId) attachToVisit(draftTarget, visitId)
  }, [visitId, draftTarget, attachToVisit])

  // Existing photos that also came back from this queue are shown once (as the queue's tile).
  const queued = new Set(items.map((i) => i.photo?.id).filter(Boolean))
  const shownExisting = existing.filter((p) => !queued.has(p.id))
  const used = shownExisting.length + items.filter((i) => !(i.status === 'error' && i.permanent)).length
  const slots = Math.max(0, MAX_PHOTOS_PER_VISIT - used)
  const sum = summarize(items)

  const pick = (files: FileList | File[] | null) => {
    const list = files ? [...files] : []
    if (!list.length) return
    const res = addFiles(target, list, { slots })
    setRejected(res.rejected)
    if (input.current) input.current.value = ''
  }

  const deleteUploaded = async (photoId: string, after: () => void) => {
    setDeleting(photoId)
    setDeleteError(null)
    try {
      await callApi(ROUTES.deletePhoto, { params: { id: photoId } }, { fetch: fetchImpl })
      after()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'The photo could not be removed.')
    } finally {
      setDeleting(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!disabledReason) pick([...e.dataTransfer.files])
  }

  const status = statusLine(sum, !!visitId)

  return (
    <div
      data-testid={testId}
      className={'flex flex-col gap-3 rounded-2xl transition ' + (dragging ? 'bg-teal/10 ring-2 ring-teal ring-offset-2 ring-offset-panel' : '')}
      onDragOver={(e) => {
        if (disabledReason || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {(shownExisting.length > 0 || items.length > 0) && (
        <ul className={'grid gap-2 ' + (compact ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4')} data-testid="photo-tiles">
          {shownExisting.map((p, i) => (
            <li key={p.id} className={tile} data-testid="photo-tile" data-status="saved">
              <img src={p.url} alt={p.caption || `Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
              {meId && p.uploaderId === meId && (
                <button
                  type="button"
                  className={xBtn}
                  aria-label={`Remove photo ${i + 1}`}
                  disabled={deleting === p.id}
                  onClick={() => void deleteUploaded(p.id, () => onExistingDeleted?.(p.id))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {items.map((it, i) => (
            <PendingTile
              key={it.key}
              item={it}
              index={shownExisting.length + i + 1}
              waitingForSave={!visitId}
              deleting={deleting === it.photo?.id}
              onRetry={() => retry(it.key)}
              onRemove={() => {
                const uploaded = it.status === 'done' ? it.photo : null
                if (!uploaded) return remove(it.key)
                void deleteUploaded(uploaded.id, () => {
                  remove(it.key)
                  onExistingDeleted?.(uploaded.id)
                })
              }}
            />
          ))}
        </ul>
      )}

      {disabledReason ? (
        <p className="rounded-xl bg-paper px-3 py-2 text-sm text-ink-soft" data-testid="photo-disabled">
          {disabledReason}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label
            className={
              'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 font-bold transition focus-within:outline-3 focus-within:outline-accent ' +
              (slots === 0 ? 'cursor-not-allowed border-panel-edge text-ink-soft/60' : 'border-teal/50 text-teal hover:border-teal hover:bg-teal/10')
            }
          >
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={slots === 0}
              aria-describedby={hintId}
              data-testid="photo-input"
              onChange={(e) => pick(e.currentTarget.files)}
            />
            <CameraIcon />
            {used > 0 ? 'Add more photos' : 'Add photos'}
          </label>
          <span id={hintId} className="text-xs text-ink-soft">
            {slots === 0 ? `That's the limit of ${MAX_PHOTOS_PER_VISIT} photos.` : `${used} of ${MAX_PHOTOS_PER_VISIT}`}
            {!compact && slots > 0 && <span className="hidden sm:inline"> · or drop them here</span>}
          </span>
        </div>
      )}

      <div aria-live="polite" className="text-sm empty:hidden" data-testid="photo-status">
        {status && <p className={sum.failed ? 'font-semibold text-bad' : 'text-ink-soft'}>{status}</p>}
      </div>
      {sum.failed > 1 && items.some((i) => i.status === 'error' && !i.permanent) && (
        <button type="button" data-testid="photo-retry-all" onClick={() => retryAll(target)} className="self-start rounded-full px-2 text-sm font-bold text-accent underline underline-offset-2 hover:bg-accent/10">
          Retry all
        </button>
      )}
      {(rejected.length > 0 || deleteError) && (
        <ul role="alert" className="space-y-0.5 text-sm text-bad" data-testid="photo-rejected">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {deleteError && <li>{deleteError}</li>}
        </ul>
      )}
    </div>
  )
}

function statusLine(s: ReturnType<typeof summarize>, bound: boolean): string | null {
  if (!s.total) return null
  const n = (k: number) => `${k} photo${k === 1 ? '' : 's'}`
  if (s.failed) return `${n(s.failed)} didn't upload.${s.active ? ` Still uploading ${s.active}.` : ''}`
  if (!bound && s.active) return `${n(s.active)} will upload when you save.`
  if (s.active) return `Uploading ${n(s.active)}…`
  return s.done ? `${n(s.done)} added.` : null
}

function PendingTile({ item, index, waitingForSave, deleting, onRetry, onRemove }: { item: PendingPhoto; index: number; waitingForSave: boolean; deleting: boolean; onRetry(): void; onRemove(): void }) {
  const [broken, setBroken] = useState(false)
  const pct = Math.round(item.progress * 100)
  return (
    <li className={tile + (item.status === 'error' ? ' border-bad' : '')} data-testid="photo-tile" data-status={item.status}>
      {item.previewUrl && !broken ? (
        <img src={item.previewUrl} alt={`Photo ${index}`} className={'h-full w-full object-cover transition ' + (item.status === 'done' ? '' : 'opacity-80')} onError={() => setBroken(true)} />
      ) : (
        <span className="grid h-full w-full place-items-center text-ink-soft/70" aria-label={`Photo ${index}`}>
          <CameraIcon />
        </span>
      )}
      {item.status === 'preparing' && <Badge>Preparing…</Badge>}
      {item.status === 'ready' && waitingForSave && <Badge>On save</Badge>}
      {(item.status === 'uploading' || (item.status === 'ready' && !waitingForSave)) && (
        <span className="absolute inset-x-1.5 bottom-1.5 h-2 overflow-hidden rounded-full bg-white/80 shadow" role="progressbar" aria-label={`Uploading photo ${index}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className="block h-full rounded-full bg-teal transition-[width] duration-200" style={{ width: `${Math.max(4, pct)}%` }} />
        </span>
      )}
      {item.status === 'done' && (
        <span aria-hidden className="absolute bottom-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-full bg-good text-xs font-bold text-white shadow">
          ✓
        </span>
      )}
      {item.status === 'error' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bad/75 p-1 text-center text-white">
          <span className="line-clamp-3 text-[11px] leading-tight font-semibold" title={item.error ?? undefined}>
            {item.error}
          </span>
          {!item.permanent && (
            <button type="button" onClick={onRetry} data-testid="photo-retry" className="min-h-8 rounded-full bg-white px-3 text-xs font-bold text-bad shadow hover:brightness-95">
              Retry
            </button>
          )}
        </span>
      )}
      <button type="button" className={xBtn} aria-label={`Remove photo ${index}`} disabled={deleting} onClick={onRemove}>
        ×
      </button>
    </li>
  )
}

function Badge({ children }: { children: string }) {
  return <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-bold text-white">{children}</span>
}

function CameraIcon() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
