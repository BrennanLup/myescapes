/**
 * "Add photos" for a review form or an existing visit (Phase 3, workstream A).
 *
 *   <PhotoAttach target={draftKey} />                         // before the visit exists: queued
 *   <PhotoAttach target={visitTarget(id)} visitId={id} existing={visit.photos} meId={me.id} />
 *
 * Thumbnails show at once (resized in the browser), each with a remove button, an upload progress
 * bar, and Retry when it failed. Drop files on it on a desktop. Files that can't be added (not a
 * photo, too big, over the limit) get a short line under the status. Removing a photo that is
 * already uploaded hides it at once with "Photo removed · Undo"; the server delete waits
 * `removeUndoMs()` (5 s), or happens right away when another photo is removed or the form closes.
 * Tapping a thumbnail opens it full size (`Lightbox`). With `editToggle` (read views such as the
 * review overlay) saved photos show no remove button until "Edit photos" is pressed.
 * Light: no three.js.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { PhotoV2 } from '@/contracts/models'
import { ROUTES, callApi } from '@/contracts/routes'
import { Lightbox, type LightboxPhoto } from './Lightbox'
import { MAX_PHOTOS_PER_VISIT, removeUndoMs, summarize, usePhotoQueue, visitTarget, watchTarget, type PendingPhoto } from './queue'

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
  /**
   * Read views: hide the remove buttons on saved photos behind an "Edit photos" toggle, so every
   * photo doesn't carry a ×. Uploads still in progress or failed keep theirs.
   */
  editToggle?: boolean
  testId?: string
  fetch?: typeof fetch
}

const tile = 'relative aspect-square overflow-hidden rounded-xl border-2 border-panel-edge/70 bg-paper'
/** A 40 px tap target in the corner, drawn as a small 24 px dot so it covers little of the photo. */
const xBtn =
  'group absolute top-0 right-0 grid h-10 w-10 place-items-center rounded-bl-xl focus-visible:outline-none disabled:opacity-50'
const xDot =
  'grid h-6 w-6 place-items-center rounded-full bg-ink/65 text-sm leading-none font-bold text-white shadow ring-1 ring-white/60 transition group-hover:bg-ink group-focus-visible:outline-3 group-focus-visible:outline-accent'

function RemoveButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" className={xBtn} aria-label={label} disabled={disabled} onClick={onClick}>
      <span aria-hidden className={xDot}>
        ×
      </span>
    </button>
  )
}

/** An uploaded photo waiting out its Undo window before the server delete. */
interface PendingDelete {
  photoId: string
  /** The queue item it came from (a photo uploaded in this session), else null. */
  queueKey: string | null
}

export function PhotoAttach({ target: draftTarget, visitId = null, existing = [], meId = null, onExistingDeleted, disabledReason = null, compact = false, editToggle = false, testId = 'photo-attach', fetch: fetchImpl }: PhotoAttachProps) {
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
  const [undo, setUndo] = useState<PendingDelete | null>(null)
  // Deleted on the server: stay hidden even if the parent's list hasn't caught up yet.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const undoRef = useRef<PendingDelete | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const hintId = useId()
  const [editing, setEditing] = useState(false)
  /** Key (photo id or queue key) of the photo open full size. */
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    if (visitId) attachToVisit(draftTarget, visitId)
  }, [visitId, draftTarget, attachToVisit])

  // Keep this target's finished photos in the queue only while they're shown here.
  useEffect(() => watchTarget(target), [target])

  // Existing photos that also came back from this queue are shown once (as the queue's tile).
  const queued = new Set(items.map((i) => i.photo?.id).filter(Boolean))
  const hidden = (photoId: string | null | undefined) => !!photoId && (undo?.photoId === photoId || deleting === photoId || gone.has(photoId))
  const shownExisting = existing.filter((p) => !queued.has(p.id) && !hidden(p.id))
  const shownItems = items.filter((i) => !hidden(i.photo?.id))
  // A photo in its Undo window still counts: it is on the server until the window ends.
  const used = existing.filter((p) => !queued.has(p.id) && !gone.has(p.id)).length + items.filter((i) => !(i.status === 'error' && i.permanent)).length
  const slots = Math.max(0, MAX_PHOTOS_PER_VISIT - used)
  const sum = summarize(shownItems)
  const canRemoveSaved = !editToggle || editing
  const mine = (p: PhotoV2) => !!meId && p.uploaderId === meId
  const removableSaved = shownExisting.some(mine) || shownItems.some((i) => i.status === 'done')
  // What the lightbox pages through: every thumbnail that has a picture to show.
  const viewable: (LightboxPhoto & { key: string })[] = [
    ...shownExisting.map((p, i) => ({ key: p.id, src: p.url, alt: p.caption || `Photo ${i + 1}`, caption: p.caption })),
    ...shownItems.flatMap((it, i) => (it.previewUrl && it.status !== 'error' ? [{ key: it.key, src: it.previewUrl, alt: `Photo ${shownExisting.length + i + 1}` }] : [])),
  ]
  const viewIndex = viewing === null ? -1 : viewable.findIndex((v) => v.key === viewing)

  const pick = (files: FileList | File[] | null) => {
    const list = files ? [...files] : []
    if (!list.length) return
    const res = addFiles(target, list, { slots })
    setRejected(res.rejected)
    if (input.current) input.current.value = ''
  }

  const commitDelete = useCallback(
    async (d: PendingDelete) => {
      if (mounted.current) {
        setDeleting(d.photoId)
        setDeleteError(null)
      }
      try {
        await callApi(ROUTES.deletePhoto, { params: { id: d.photoId } }, { fetch: fetchImpl })
        if (mounted.current) setGone((g) => new Set(g).add(d.photoId))
        if (d.queueKey) usePhotoQueue.getState().remove(d.queueKey)
        onExistingDeleted?.(d.photoId)
      } catch (err) {
        if (mounted.current) setDeleteError(err instanceof Error ? `That photo is back: ${err.message}` : 'The photo could not be removed.')
      } finally {
        if (mounted.current) setDeleting((cur) => (cur === d.photoId ? null : cur))
      }
    },
    [fetchImpl, onExistingDeleted],
  )

  const startUndo = (d: PendingDelete | null) => {
    clearTimeout(undoTimer.current)
    undoRef.current = d
    setUndo(d)
    if (d)
      undoTimer.current = setTimeout(() => {
        if (undoRef.current !== d) return
        undoRef.current = null
        setUndo(null)
        void commitDelete(d)
      }, removeUndoMs())
  }

  /** Hide an uploaded photo now; delete it on the server once the Undo window is over. */
  const requestDelete = (d: PendingDelete) => {
    // Only one Undo at a time: an earlier removal is final now.
    const prev = undoRef.current
    if (prev) void commitDelete(prev)
    setDeleteError(null)
    startUndo(d)
  }

  // Leaving (the overlay closed, another page) makes a pending removal final.
  const commitRef = useRef(commitDelete)
  commitRef.current = commitDelete
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(undoTimer.current)
      const d = undoRef.current
      undoRef.current = null
      if (d) void commitRef.current(d)
    }
  }, [])

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
      {(shownExisting.length > 0 || shownItems.length > 0) && (
        <ul className={'grid gap-2 ' + (compact ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4')} data-testid="photo-tiles">
          {shownExisting.map((p, i) => (
            <li key={p.id} className={tile} data-testid="photo-tile" data-status="saved">
              <OpenButton label={`Open photo ${i + 1}`} onClick={() => setViewing(p.id)}>
                <img src={p.url} alt={p.caption || `Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
              </OpenButton>
              {mine(p) && canRemoveSaved && <RemoveButton label={`Remove photo ${i + 1}`} disabled={deleting === p.id} onClick={() => requestDelete({ photoId: p.id, queueKey: null })} />}
            </li>
          ))}
          {shownItems.map((it, i) => (
            <PendingTile
              key={it.key}
              item={it}
              index={shownExisting.length + i + 1}
              waitingForSave={!visitId}
              deleting={deleting === it.photo?.id}
              removable={it.status !== 'done' || canRemoveSaved}
              onOpen={viewable.some((v) => v.key === it.key) ? () => setViewing(it.key) : undefined}
              onRetry={() => retry(it.key)}
              onRemove={() => {
                const uploaded = it.status === 'done' ? it.photo : null
                if (!uploaded) return remove(it.key)
                requestDelete({ photoId: uploaded.id, queueKey: it.key })
              }}
            />
          ))}
        </ul>
      )}

      {disabledReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 rounded-xl bg-paper px-3 py-2 text-sm text-ink-soft" data-testid="photo-disabled">
            {disabledReason}
          </p>
          {editToggle && removableSaved && <EditToggle editing={editing} onToggle={() => setEditing((e) => !e)} />}
        </div>
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
          {editToggle && removableSaved && <EditToggle editing={editing} onToggle={() => setEditing((e) => !e)} />}
        </div>
      )}

      {undo && (
        <div role="status" data-testid="photo-undo" className="flex items-center gap-3 self-start rounded-full bg-ink/85 py-1 pr-1 pl-4 text-sm text-white shadow">
          <span>Photo removed</span>
          <button
            type="button"
            data-testid="photo-undo-button"
            onClick={() => startUndo(null)}
            className="min-h-9 rounded-full bg-white/15 px-3 font-bold text-white transition hover:bg-white/25 focus-visible:outline-3 focus-visible:outline-accent"
          >
            Undo
          </button>
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-0.5 text-sm empty:hidden" data-testid="photo-status">
        {status && <p className={sum.failed ? 'font-semibold text-bad' : 'text-ink-soft'}>{status}</p>}
        {rejected.map((r) => (
          <p key={r} data-testid="photo-skipped" className="flex items-start gap-1.5 text-ink-soft">
            <span aria-hidden className="text-warn">●</span>
            <span>{r}</span>
          </p>
        ))}
      </div>
      {sum.failed > 1 && items.some((i) => i.status === 'error' && !i.permanent) && (
        <button type="button" data-testid="photo-retry-all" onClick={() => retryAll(target)} className="self-start rounded-full px-2 text-sm font-bold text-accent underline underline-offset-2 hover:bg-accent/10">
          Retry all
        </button>
      )}
      {deleteError && (
        <p role="alert" className="text-sm font-semibold text-bad" data-testid="photo-delete-error">
          {deleteError}
        </p>
      )}
      {viewIndex >= 0 && <Lightbox photos={viewable} index={viewIndex} onIndex={(i) => setViewing(viewable[i]?.key ?? null)} onClose={() => setViewing(null)} />}
    </div>
  )
}

/** The whole thumbnail is the tap target that opens the photo full size. */
function OpenButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="photo-open"
      onClick={onClick}
      className="block h-full w-full cursor-zoom-in focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

function EditToggle({ editing, onToggle }: { editing: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      aria-pressed={editing}
      data-testid="photo-edit-toggle"
      onClick={onToggle}
      className={
        'ml-auto min-h-10 rounded-full px-3 text-sm font-bold transition focus-visible:outline-3 focus-visible:outline-accent ' +
        (editing ? 'bg-teal text-white hover:brightness-110' : 'text-teal underline underline-offset-2 hover:bg-teal/10')
      }
    >
      {editing ? 'Done' : 'Edit photos'}
    </button>
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

function PendingTile({
  item,
  index,
  waitingForSave,
  deleting,
  removable,
  onOpen,
  onRetry,
  onRemove,
}: {
  item: PendingPhoto
  index: number
  waitingForSave: boolean
  deleting: boolean
  removable: boolean
  onOpen?(): void
  onRetry(): void
  onRemove(): void
}) {
  const [broken, setBroken] = useState(false)
  const pct = Math.round(item.progress * 100)
  return (
    <li className={tile + (item.status === 'error' ? ' border-bad' : '')} data-testid="photo-tile" data-status={item.status}>
      {item.previewUrl && !broken ? (
        onOpen ? (
          <OpenButton label={`Open photo ${index}`} onClick={onOpen}>
            <img src={item.previewUrl} alt={`Photo ${index}`} className={'h-full w-full object-cover transition ' + (item.status === 'done' ? '' : 'opacity-80')} onError={() => setBroken(true)} />
          </OpenButton>
        ) : (
          <img src={item.previewUrl} alt={`Photo ${index}`} className={'h-full w-full object-cover transition ' + (item.status === 'done' ? '' : 'opacity-80')} onError={() => setBroken(true)} />
        )
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
      {removable && <RemoveButton label={`Remove photo ${index}`} disabled={deleting} onClick={onRemove} />}
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
