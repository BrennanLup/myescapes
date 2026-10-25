/**
 * DOM overlay for editing the wish list: add, reorder (buttons or drag), remove
 * with undo, mark done. Every change goes through `useStore.getState().setWishlist`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { bus } from '@/contracts/events'
import type { WishlistItem } from '@/contracts/types'
import { useStore } from '@/state/store'
import { addItem, insertAt, moveDown, moveToIndex, moveUp, removeItem, safeHref, sortByPriority, toggleDone } from './listOps'

const ADDED_BY_KEY = 'myescapes.wishlist.addedBy'
const TOAST_MS = 6000

type Toast = { kind: 'undo'; item: WishlistItem; index: number } | { kind: 'error'; text: string }

function readAddedBy(): string {
  try {
    return globalThis.localStorage?.getItem(ADDED_BY_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveAddedBy(v: string) {
  try {
    globalThis.localStorage?.setItem(ADDED_BY_KEY, v)
  } catch {
    /* ignore */
  }
}

const iconBtn =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-panel-edge bg-white/70 px-2 text-lg text-ink transition hover:bg-white active:scale-95 disabled:opacity-30 disabled:hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-teal'

export function WishlistOverlay() {
  const wishlist = useStore((s) => s.wishlist)
  const crew = useStore((s) => s.crew)
  const isTouch = useStore((s) => s.isTouch)
  const items = useMemo(() => sortByPriority(wishlist), [wishlist])

  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [link, setLink] = useState('')
  const [addedBy, setAddedBy] = useState(readAddedBy)
  const [nameError, setNameError] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // On phones the add form starts collapsed so the list gets the screen.
  const [formOpen, setFormOpen] = useState(() => {
    try {
      return !window.matchMedia?.('(max-width: 639px)').matches
    } catch {
      return true
    }
  })

  const close = useCallback(() => bus.emit('overlay:close'), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  /** Optimistic save; the store rolls back on failure and we tell the user. */
  const commit = useCallback((next: WishlistItem[]) => {
    useStore
      .getState()
      .setWishlist(next)
      .catch(() => setToast({ kind: 'error', text: "Couldn't save that change. It was undone." }))
  }, [])

  const current = () => sortByPriority(useStore.getState().wishlist)

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNameError(true)
      nameRef.current?.focus()
      return
    }
    commit(addItem(current(), { name, city, link, addedBy }))
    bus.emit('sfx', { name: 'chalk' })
    if (addedBy.trim()) saveAddedBy(addedBy.trim())
    setName('')
    setCity('')
    setLink('')
    setNameError(false)
    nameRef.current?.focus()
  }

  const onToggleDone = (item: WishlistItem) => {
    commit(toggleDone(current(), item.id))
    if (!item.done) bus.emit('sfx', { name: 'chalk' })
  }

  const onRemove = (item: WishlistItem) => {
    const r = removeItem(current(), item.id)
    if (!r.removed) return
    commit(r.items)
    bus.emit('sfx', { name: 'paper' })
    setToast({ kind: 'undo', item: r.removed, index: r.index })
  }

  const onUndo = () => {
    if (toast?.kind !== 'undo') return
    commit(insertAt(current(), toast.item, toast.index))
    setToast(null)
  }

  // Desktop drag-and-drop reorder.
  const dragProps = (item: WishlistItem, index: number) =>
    isTouch
      ? {}
      : {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            setDragId(item.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', item.id)
          },
          onDragOver: (e: DragEvent) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (overIndex !== index) setOverIndex(index)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            const id = dragId ?? e.dataTransfer.getData('text/plain')
            if (id && id !== item.id) commit(moveToIndex(current(), id, index))
            setDragId(null)
            setOverIndex(null)
          },
          onDragEnd: () => {
            setDragId(null)
            setOverIndex(null)
          },
        }

  const crewNames = useMemo(() => [...new Set(crew.map((c) => c.name))].slice(0, 8), [crew])
  const openCount = items.filter((i) => !i.done).length

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-backdrop p-0 sm:items-center sm:p-6"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wishlist-title"
        className="relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-cozy bg-panel text-ink shadow-cozy sm:max-h-[88dvh] sm:rounded-cozy"
      >
        {/* Chalkboard header */}
        <header className="relative flex items-center gap-3 border-b-8 border-[#7a4a2b] bg-chalk px-5 py-4 text-[#f6f4e8] sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="wishlist-title" className="font-hand text-4xl leading-none font-bold sm:text-5xl">
              Rooms to try
            </h2>
            <p className="mt-1 font-body text-sm text-[#f6f4e8]/70">
              {items.length === 0
                ? 'Your crew wish list is empty.'
                : `${openCount} to go${items.length - openCount ? `, ${items.length - openCount} done` : ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close wish list"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl text-[#f6f4e8] transition hover:bg-white/20"
          >
            ✕
          </button>
        </header>

        {/* List */}
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5" aria-label="Wish list">
          {items.length === 0 && (
            <li className="rounded-2xl border-2 border-dashed border-panel-edge px-4 py-8 text-center font-hand text-2xl text-ink-soft">
              Nothing yet. Add the first room you want to try below!
            </li>
          )}
          {items.map((item, i) => {
            const href = safeHref(item.link)
            const isOver = overIndex === i && dragId !== null && dragId !== item.id
            return (
              <li
                key={item.id}
                data-testid={`wishlist-item-${item.id}`}
                {...dragProps(item, i)}
                className={[
                  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-white/60 px-3 py-2.5 transition',
                  item.done ? 'border-panel-edge/60 opacity-75' : 'border-panel-edge',
                  dragId === item.id ? 'opacity-40' : '',
                  isOver ? 'ring-2 ring-teal' : '',
                ].join(' ')}
              >
                {!isTouch && (
                  <span className="cursor-grab text-xl text-ink-soft/60 select-none active:cursor-grabbing" aria-hidden title="Drag to reorder">
                    ⠿
                  </span>
                )}
                <span
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-base font-semibold ${
                    item.done ? 'bg-good text-white' : 'bg-accent text-accent-ink'
                  }`}
                  aria-label={item.done ? 'Done' : `Priority ${item.priority}`}
                >
                  {item.done ? '✓' : item.priority}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <div className={`truncate font-display text-lg leading-tight font-semibold ${item.done ? 'text-ink-soft line-through' : ''}`}>{item.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
                    {item.city && <span>📍 {item.city}</span>}
                    {item.addedBy && <span>added by {item.addedBy}</span>}
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal underline-offset-2 hover:underline">
                        Visit site ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`wishlist-done-${item.id}`}
                    onClick={() => onToggleDone(item)}
                    aria-pressed={item.done}
                    className={`${iconBtn} px-3 text-sm font-semibold ${item.done ? '' : 'border-good/50 text-good'}`}
                  >
                    {item.done ? 'Undo' : '✓ Done'}
                  </button>
                  <button type="button" data-testid={`wishlist-up-${item.id}`} onClick={() => commit(moveUp(current(), item.id))} disabled={i === 0} aria-label={`Move ${item.name} up`} className={iconBtn}>
                    ▲
                  </button>
                  <button
                    type="button"
                    data-testid={`wishlist-down-${item.id}`}
                    onClick={() => commit(moveDown(current(), item.id))}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${item.name} down`}
                    className={iconBtn}
                  >
                    ▼
                  </button>
                  <button type="button" data-testid={`wishlist-remove-${item.id}`} onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`} className={`${iconBtn} text-bad`}>
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Add form */}
        {!formOpen && (
          <div className="border-t border-panel-edge bg-paper px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              data-testid="wishlist-add-open"
              onClick={() => {
                setFormOpen(true)
                requestAnimationFrame(() => nameRef.current?.focus())
              }}
              className="h-12 w-full rounded-xl bg-accent font-display text-base font-semibold text-accent-ink shadow-sm active:scale-[0.98]"
            >
              + Add a room
            </button>
          </div>
        )}
        <form
          hidden={!formOpen} onSubmit={onAdd} className="border-t border-panel-edge bg-paper px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" noValidate>
          <h3 className="mb-2 font-display text-base font-semibold">Add a room</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2">
              <span className="sr-only">Room name (required)</span>
              <input
                ref={nameRef}
                data-testid="wishlist-add-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (nameError && e.target.value.trim()) setNameError(false)
                }}
                placeholder="Room name *"
                required
                aria-invalid={nameError}
                maxLength={120}
                className={`h-12 w-full rounded-xl border bg-white px-3 text-base outline-none focus:border-teal ${nameError ? 'border-bad' : 'border-panel-edge'}`}
              />
            </label>
            <label>
              <span className="sr-only">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" maxLength={80} className="h-12 w-full rounded-xl border border-panel-edge bg-white px-3 text-base outline-none focus:border-teal" />
            </label>
            <label>
              <span className="sr-only">Added by</span>
              <input
                value={addedBy}
                onChange={(e) => setAddedBy(e.target.value)}
                placeholder="Added by"
                list="wishlist-crew"
                maxLength={60}
                className="h-12 w-full rounded-xl border border-panel-edge bg-white px-3 text-base outline-none focus:border-teal"
              />
              <datalist id="wishlist-crew">
                {crewNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <label className="col-span-2 sm:col-span-3">
              <span className="sr-only">Link</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Link (optional)"
                inputMode="url"
                maxLength={500}
                className="h-12 w-full rounded-xl border border-panel-edge bg-white px-3 text-base outline-none focus:border-teal"
              />
            </label>
            <button
              type="submit"
              data-testid="wishlist-add-submit"
              className="col-span-2 h-12 rounded-xl bg-accent px-4 font-display text-base font-semibold text-accent-ink shadow-sm transition hover:brightness-105 active:scale-[0.98] sm:col-span-1"
            >
              + Add
            </button>
          </div>
          {nameError && <p className="mt-1 text-sm text-bad">Give the room a name first.</p>}
          {crewNames.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-ink-soft">Added by:</span>
              {crewNames.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAddedBy(n)}
                  aria-pressed={addedBy === n}
                  className={`h-9 rounded-full border px-3 transition ${addedBy === n ? 'border-teal bg-teal text-white' : 'border-panel-edge bg-white hover:border-teal'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </form>

        {toast && (
          <div
            role="status"
            className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-cozy sm:bottom-5"
          >
            <span className="min-w-0 flex-1 truncate">{toast.kind === 'undo' ? `Removed “${toast.item.name}”` : toast.text}</span>
            {toast.kind === 'undo' && (
              <button type="button" data-testid="wishlist-undo" onClick={onUndo} className="h-10 rounded-xl bg-accent px-4 font-semibold text-accent-ink">
                Undo
              </button>
            )}
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="h-10 w-10 rounded-xl text-white/70 hover:text-white">
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
