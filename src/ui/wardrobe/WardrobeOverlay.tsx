/**
 * The wardrobe (`overlay.kind === 'wardrobe'`): try on looks on a live 3D preview, unlock items
 * with keys and save your look. Keys are earned by logging rooms and solving Escape of the Day;
 * there is no real money anywhere.
 *
 * Layout: a bottom sheet on phones (preview on top, tabs, then the choices), a two-column dialog
 * from 768 px. Esc, Cancel, the close button or a backdrop click close it; with an unsaved look
 * they first ask "Keep trying on / Discard", so a look is never thrown away by accident.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react'
import { bus } from '@/contracts/events'
import { useShell } from '@/ui/shell/shellStore'
import { KEY_REWARDS, itemById, randomOutfit, sameOutfit, type CatalogItem, type ItemId, type Outfit, type Swatch } from '@/world/avatars/catalog'
import { IconCheck, IconClose, IconKey, IconLockSmall, IconShuffle, IconUndo } from './icons'
import { colorApplies, listNames, primaryAction, priceLabel, scrollEdges, SLOT_FIELD, stepIndex, swatchColumns, tabItems, TABS, wearableDraft, type TabId, type TabSpec } from './logic'
import { Preview } from './Preview'
import { useWardrobe } from './store'

const close = () => bus.emit('overlay:close')

/** Darker than the brand teal so small selected text and the active tab pass WCAG AA (5.9:1 on white, 4.9:1 on the selected tile). */
const TEAL_TEXT = 'text-[#1f6f6b]'
const TEAL_BG = 'bg-[#1f6f6b]'
const TEAL_RING = 'ring-[#1f6f6b]'

export function WardrobeOverlay() {
  const status = useWardrobe((s) => s.status)
  const saved = useWardrobe((s) => s.outfit)
  const owned = useWardrobe((s) => s.owned)
  const keys = useWardrobe((s) => s.keys)
  const signedIn = useWardrobe((s) => s.signedIn)
  const busy = useWardrobe((s) => s.busy)
  const [draft, setDraft] = useState<Outfit>(saved)
  const [tab, setTab] = useState<TabId>('body')
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const prompt = useRef<HTMLDivElement>(null)
  const ids = { title: useId(), panel: useId(), discard: useId() }
  const dirty = !sameOutfit(draft, saved)
  // Read by the (once-registered) key handler.
  const live = useRef({ dirty, discarding })
  live.current = { dirty, discarding }
  /** Close, asking first when the look you are trying on isn't saved. */
  const requestClose = () => {
    if (live.current.dirty) setDiscarding(true)
    else close()
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  // Load (or refresh) on open; adopt the server's look if it arrives while untouched.
  const touched = useRef(false)
  useEffect(() => {
    void useWardrobe.getState().load({ quiet: true })
  }, [])
  useEffect(() => {
    if (!touched.current) setDraft(saved)
  }, [saved])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Esc on the prompt means "keep trying on".
        if (live.current.discarding) setDiscarding(false)
        else requestCloseRef.current()
      } else if (e.key === 'Tab') trapFocus(e, live.current.discarding ? prompt.current : dialog.current)
    }
    window.addEventListener('keydown', onKey)
    // Start keyboard users on the first tab.
    dialog.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const set = (patch: Partial<Outfit>) => {
    touched.current = true
    setMessage(null)
    setDraft((d) => ({ ...d, ...patch }))
  }

  const action = primaryAction(draft, saved, owned, keys?.balance ?? null, signedIn)
  const spec = TABS.find((t) => t.id === tab)!
  const describe = useMemo(() => describeOutfit(draft), [draft])
  // With locked items you can't afford yet, offer to keep only the parts you own.
  const ownable = useMemo(() => wearableDraft(draft, saved, owned), [draft, saved, owned])
  const canWearOwned = action.kind === 'buy' && !action.affordable && !sameOutfit(ownable, saved)

  const onPrimary = async () => {
    setMessage(null)
    try {
      if (action.kind === 'save') {
        await useWardrobe.getState().save(draft)
        useShell.getState().showToast(signedIn ? 'Looking good! Your look is saved.' : 'Looking good! Saved on this device.')
        close()
      } else if (action.kind === 'buy' && action.affordable) {
        const id = action.item.id as ItemId
        // Always wear what you just bought: the whole look when this was the last locked item,
        // otherwise the look with the still-locked items swapped back to what you wear today.
        await useWardrobe.getState().buy(id, action.completes ? draft : wearableDraft(draft, saved, [...owned, id]))
        bus.emit('sfx', { name: 'unlock' })
        if (action.completes) {
          useShell.getState().showToast(`Unlocked ${action.item.name}. Looking good!`)
          close()
        } else {
          const n = action.rest.length
          setMessage({ tone: 'ok', text: `Unlocked ${action.item.name} and put it on. ${listNames(action.rest)} ${n === 1 ? 'is' : 'are'} still locked: you're only trying ${n === 1 ? 'it' : 'them'} on.` })
        }
      }
    } catch (err) {
      bus.emit('sfx', { name: 'error' })
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-backdrop p-0 font-body text-ink md:items-center md:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !discarding) requestClose()
      }}
    >
      <div
        ref={dialog}
        data-testid="wardrobe-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        className="relative flex h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-cozy bg-panel shadow-cozy ring-1 ring-panel-edge md:h-[min(720px,90dvh)] md:rounded-cozy"
      >
        <header className="flex items-center gap-3 border-b border-panel-edge/70 px-4 py-3 md:px-6 md:py-4">
          <h2 id={ids.title} className="font-display text-2xl font-semibold">
            Wardrobe
          </h2>
          <KeyChip balance={keys?.balance ?? null} signedIn={signedIn} />
          <button
            type="button"
            aria-label="Close the wardrobe"
            data-testid="wardrobe-close"
            onClick={requestClose}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition hover:bg-[rgba(224,123,57,.12)] hover:text-ink"
          >
            <IconClose />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Preview */}
          <div className="relative h-[30dvh] max-h-72 min-h-44 shrink-0 md:h-auto md:max-h-none md:w-[42%]">
            <Preview outfit={draft} describe={describe} />
            <div className="absolute top-2 right-2 flex gap-1.5">
              <SmallButton label="Surprise me (a random free look)" testId="wardrobe-random" onClick={() => set(randomOutfit())}>
                <IconShuffle width={18} height={18} />
              </SmallButton>
              <SmallButton label="Undo changes" testId="wardrobe-reset" onClick={() => set(saved)} disabled={action.kind === 'unchanged'}>
                <IconUndo width={18} height={18} />
              </SmallButton>
            </div>
          </div>

          {/* Choices */}
          <div className="flex min-h-0 flex-1 flex-col">
            <Tabs current={tab} onPick={setTab} panelId={ids.panel} />
            <div id={ids.panel} role="tabpanel" aria-label={spec.label} data-testid="wardrobe-panel" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
              {status === 'error' ? (
                <p className="mb-3 rounded-2xl bg-[rgba(196,81,63,.1)] px-3 py-2 text-sm text-bad">
                  Couldn't load your saved look. You can still try things on.{' '}
                  <button type="button" className="font-bold underline" onClick={() => void useWardrobe.getState().load()}>
                    Retry
                  </button>
                </p>
              ) : null}
              <TabBody tab={spec} draft={draft} saved={saved} owned={owned} set={set} />
              <EarnInfo keys={keys} signedIn={signedIn} />
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-panel-edge/70 px-4 py-3 md:flex-row md:items-center md:px-6" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <p role="status" aria-live="polite" data-testid="wardrobe-message" className={`min-h-5 text-sm ${message?.tone === 'error' ? 'text-bad' : 'text-ink-soft'}`}>
              {message?.text ?? footerHint(action)}
            </p>
            {canWearOwned ? (
              <button
                type="button"
                data-testid="wardrobe-wear-owned"
                onClick={() => {
                  set(ownable)
                  setMessage({ tone: 'ok', text: 'Locked items swapped back to what you wear now. Save to keep the rest.' })
                }}
                className={`min-h-9 rounded-full px-2 text-sm font-bold underline underline-offset-2 ${TEAL_TEXT} hover:bg-[rgba(47,143,138,.1)]`}
              >
                Wear what you own
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" data-testid="wardrobe-cancel" onClick={requestClose} className="min-h-11 shrink-0 rounded-full px-4 font-bold text-ink-soft ring-1 ring-panel-edge transition hover:bg-paper md:px-5">
              Cancel
            </button>
            <PrimaryButton action={action} busy={busy} onClick={() => void onPrimary()} />
          </div>
        </footer>

        {discarding ? (
          <DiscardPrompt
            ref={prompt}
            titleId={ids.discard}
            onKeep={() => {
              setDiscarding(false)
              dialog.current?.querySelector<HTMLElement>('[data-testid="wardrobe-primary"]')?.focus({ preventScroll: true })
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function DiscardPrompt({ ref, titleId, onKeep }: { ref: Ref<HTMLDivElement>; titleId: string; onKeep(): void }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-backdrop p-4" role="alertdialog" aria-modal="true" aria-labelledby={titleId} data-testid="wardrobe-discard">
      <div ref={ref} className="w-full max-w-sm rounded-cozy border-2 border-panel-edge bg-panel p-5 text-center shadow-cozy">
        <h3 id={titleId} className="font-display text-2xl font-semibold">
          Discard this look?
        </h3>
        <p className="mt-1 text-sm text-ink-soft">You haven't saved what you're trying on.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" data-testid="wardrobe-discard-no" autoFocus onClick={onKeep} className="min-h-12 flex-1 rounded-xl border-2 border-panel-edge font-bold hover:bg-ink/5">
            Keep trying on
          </button>
          <button type="button" data-testid="wardrobe-discard-yes" onClick={close} className="min-h-12 flex-1 rounded-xl bg-bad font-bold text-white hover:brightness-110">
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

/** Keep Tab inside the dialog. */
function trapFocus(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement)
  if (!items.length) return
  const firstEl = items[0]
  const lastEl = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (!active || !root.contains(active)) {
    e.preventDefault()
    firstEl.focus()
  } else if (e.shiftKey && active === firstEl) {
    e.preventDefault()
    lastEl.focus()
  } else if (!e.shiftKey && active === lastEl) {
    e.preventDefault()
    firstEl.focus()
  }
}

function describeOutfit(o: Outfit): string {
  const name = (id: string) => itemById(id)?.name.toLowerCase() ?? id
  const parts = [name(o.hair) === 'shaved' ? 'shaved head' : `${name(o.hair)} hair`, name(o.top), name(o.bottom), name(o.shoes)]
  if (o.hat !== 'hat-none') parts.push(name(o.hat))
  if (o.accessory !== 'acc-none') parts.push(name(o.accessory))
  return `Your character: ${parts.join(', ')}`
}

function footerHint(a: ReturnType<typeof primaryAction>): string {
  switch (a.kind) {
    case 'unchanged':
      return 'This is your current look. Try something on.'
    case 'save':
      return 'Looks good? Save to wear it in your room.'
    case 'signin':
      return `${a.item.name} unlocks with keys. Sign in to earn them.`
    case 'buy': {
      const short = (n: number) => `${n} more ${n === 1 ? 'key' : 'keys'}`
      if (!a.affordable) return `${a.item.name} needs ${short(a.short)}. Log rooms and solve Escape of the Day to earn them.`
      if (a.completes) return `You're trying on ${a.item.name} (${a.item.price} keys).`
      // Say up front that the rest stays locked, so an unlock never looks like it did nothing.
      return `Unlock ${a.item.name} to wear it now. ${listNames(a.rest)} ${a.rest.length === 1 ? 'stays' : 'stay'} locked for now.`
    }
  }
}

function PrimaryButton({ action, busy, onClick }: { action: ReturnType<typeof primaryAction>; busy: boolean; onClick(): void }) {
  const base = 'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-5 font-bold transition md:flex-none disabled:cursor-not-allowed'
  if (action.kind === 'signin') {
    return (
      <a href="/welcome" data-testid="wardrobe-primary" className={`${base} bg-accent text-accent-ink hover:scale-[1.02]`}>
        Sign in to unlock
      </a>
    )
  }
  if (action.kind === 'buy') {
    return (
      <button
        type="button"
        data-testid="wardrobe-primary"
        aria-label={busy ? undefined : `Unlock ${action.item.name} for ${action.item.price} keys${action.completes ? '' : ' and wear it'}`}
        title={`Unlock ${action.item.name} · ${action.item.price} keys`}
        disabled={busy || !action.affordable}
        onClick={onClick}
        className={`${base} bg-warn text-ink enabled:hover:scale-[1.02] disabled:opacity-55`}
      >
        <IconKey width={18} height={18} className="shrink-0" />
        {busy ? (
          'Unlocking...'
        ) : (
          // The item name always shows (truncated on a narrow phone), so you know what you pay for.
          <>
            <span className="min-w-0 truncate">Unlock {action.item.name}</span>
            <span className="shrink-0">· {action.item.price}</span>
          </>
        )}
      </button>
    )
  }
  return (
    <button type="button" data-testid="wardrobe-primary" disabled={busy || action.kind === 'unchanged'} onClick={onClick} className={`${base} bg-accent text-accent-ink enabled:hover:scale-[1.02] disabled:opacity-55`}>
      <IconCheck width={18} height={18} />
      {busy ? 'Saving...' : 'Save look'}
    </button>
  )
}

function KeyChip({ balance, signedIn }: { balance: number | null; signedIn: boolean }) {
  if (!signedIn || balance === null) return null
  return (
    <span data-testid="key-balance" aria-label={`${balance} keys to spend`} className="flex items-center gap-1.5 rounded-full bg-[rgba(224,169,58,.22)] px-3 py-1 text-sm font-extrabold text-[#8a5d0c]">
      <IconKey width={16} height={16} />
      {balance}
      <span className="font-bold">{balance === 1 ? 'key' : 'keys'}</span>
    </span>
  )
}

function SmallButton({ label, testId, onClick, disabled, children }: { label: string; testId: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-panel/90 text-ink shadow ring-1 ring-panel-edge transition enabled:hover:scale-105 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

const FADE = '28px'

function Tabs({ current, onPick, panelId }: { current: TabId; onPick(t: TabId): void; panelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const strip = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const onKeyDown = (e: ReactKeyboardEvent, i: number) => {
    const next = stepIndex(i, e.key, TABS.length)
    if (next === null) return
    e.preventDefault()
    onPick(TABS[next].id)
    refs.current[next]?.focus()
  }
  // Fade the edge(s) that hide more tabs, so phones show there is more to scroll to.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const update = () =>
      setEdges((prev) => {
        const next = scrollEdges(el)
        return prev.start === next.start && prev.end === next.end ? prev : next
      })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [])
  // Keep the active tab in view (keyboard arrows, or a tab picked at the edge).
  useEffect(() => {
    const i = TABS.findIndex((t) => t.id === current)
    const el = refs.current[i]
    const box = strip.current
    if (!el || !box) return
    const pad = 28
    const left = el.offsetLeft - box.offsetLeft
    if (left - pad < box.scrollLeft) box.scrollTo?.({ left: Math.max(0, left - pad), behavior: 'smooth' })
    else if (left + el.offsetWidth + pad > box.scrollLeft + box.clientWidth) box.scrollTo?.({ left: left + el.offsetWidth + pad - box.clientWidth, behavior: 'smooth' })
  }, [current])
  const mask = `linear-gradient(to right, ${edges.start ? 'transparent' : '#000'}, #000 ${FADE}, #000 calc(100% - ${FADE}), ${edges.end ? 'transparent' : '#000'})`
  return (
    <div className="relative shrink-0 border-b border-panel-edge/70">
      <div
        ref={strip}
        role="tablist"
        aria-label="Wardrobe sections"
        data-testid="wardrobe-tabs"
        data-more-start={edges.start ? 'true' : 'false'}
        data-more-end={edges.end ? 'true' : 'false'}
        className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:px-5 [&::-webkit-scrollbar]:hidden"
        style={edges.start || edges.end ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {TABS.map((t, i) => {
          const on = t.id === current
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              data-testid={`wardrobe-tab-${t.id}`}
              onClick={() => onPick(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              // No colour transition: a half-faded pill could show teal text on teal.
              className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm font-bold ${on ? `${TEAL_BG} text-white` : 'text-ink-soft hover:bg-[rgba(224,123,57,.12)] hover:text-ink'}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {edges.end ? (
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-lg leading-none font-bold text-ink-soft">
          ›
        </span>
      ) : null}
    </div>
  )
}

function TabBody({ tab, draft, saved, owned, set }: { tab: TabSpec; draft: Outfit; saved: Outfit; owned: ItemId[]; set(p: Partial<Outfit>): void }) {
  const items = tabItems(tab)
  return (
    <div className="flex flex-col gap-5">
      {tab.slot ? (
        <Section title={tab.label === 'Extras' ? 'Accessory' : 'Style'}>
          <div role="group" aria-label={`${tab.label} styles`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((item) => (
              <ItemTile
                key={item.id}
                item={item}
                on={draft[SLOT_FIELD[tab.slot!]] === item.id}
                wearing={saved[SLOT_FIELD[tab.slot!]] === item.id}
                owned={owned}
                onPick={() => set({ [SLOT_FIELD[tab.slot!]]: item.id } as Partial<Outfit>)}
              />
            ))}
          </div>
        </Section>
      ) : null}
      {tab.color && colorApplies(tab, draft) ? (
        <Section title={tab.id === 'hat' && draft.hat === 'hat-crown' ? 'Gem colour' : tab.color.label}>
          <Swatches swatches={tab.color.swatches} value={draft[tab.color.field]} label={tab.color.label} onPick={(id) => set({ [tab.color!.field]: id } as Partial<Outfit>)} />
        </Section>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-extrabold tracking-wider text-ink-soft uppercase">{title}</h3>
      {children}
    </section>
  )
}

/**
 * One item. Two separate cues: the teal ring and check mark what you are trying on (the draft),
 * and a small "Wearing" tag marks what you wear today (the saved look).
 */
function ItemTile({ item, on, wearing, owned, onPick }: { item: CatalogItem; on: boolean; wearing: boolean; owned: ItemId[]; onPick(): void }) {
  const locked = item.price > 0 && !owned.includes(item.id as ItemId)
  const label = priceLabel(item, owned)
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={`item-${item.id}`}
      data-locked={locked ? 'true' : 'false'}
      data-wearing={wearing ? 'true' : 'false'}
      aria-label={`${item.name}, ${locked ? `locked, ${item.price} keys` : label.toLowerCase()}${wearing ? ', wearing now' : ''}`}
      title={item.blurb ?? item.name}
      onClick={onPick}
      className={`relative flex min-h-16 flex-col items-start justify-between gap-1 rounded-2xl px-3 py-2.5 text-left ring-2 transition active:scale-[.98] ${
        on ? `bg-[rgba(47,143,138,.1)] ${TEAL_RING}` : 'bg-paper ring-panel-edge/50 hover:ring-panel-edge'
      }`}
    >
      <span className={`pr-6 font-display text-[15px] leading-tight font-semibold ${on ? TEAL_TEXT : ''}`}>{item.name}</span>
      <span className="flex flex-wrap items-center gap-1">
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
            locked ? 'bg-[rgba(224,169,58,.22)] text-[#7a5208]' : label === 'Owned' ? 'bg-[rgba(79,157,90,.15)] text-[#2f6b38]' : 'bg-[rgba(122,98,88,.1)] text-[#5e4a42]'
          }`}
        >
          {locked ? <IconLockSmall width={11} height={11} strokeWidth={2.6} /> : null}
          {locked ? (
            <>
              <IconKey width={11} height={11} strokeWidth={2.6} />
              {item.price}
            </>
          ) : (
            label
          )}
        </span>
        {wearing ? (
          <span data-testid="wearing-tag" className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-extrabold text-paper">
            Wearing
          </span>
        ) : null}
      </span>
      {on ? (
        <span className={`absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full ${TEAL_BG} text-white`}>
          <IconCheck width={12} height={12} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  )
}

function Swatches({ swatches, value, label, onPick }: { swatches: readonly Swatch[]; value: string; label: string; onPick(id: string): void }) {
  // Phones: a balanced grid (8 skin tones are 4 + 4, not 7 + 1); wider screens: one wrapping row.
  const style = { '--swatch-cols': swatchColumns(swatches.length) } as CSSProperties
  return (
    <div role="group" aria-label={label} data-testid="swatch-group" style={style} className="grid w-max grid-cols-[repeat(var(--swatch-cols),2.5rem)] gap-2 sm:flex sm:w-auto sm:flex-wrap">
      {swatches.map((s) => {
        const on = s.id === value
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            aria-label={s.name}
            title={s.name}
            data-testid={`swatch-${s.id}`}
            onClick={() => onPick(s.id)}
            className={`h-10 w-10 rounded-full transition hover:scale-110 active:scale-95 ${on ? `ring-[3px] ${TEAL_RING} ring-offset-2 ring-offset-panel` : 'ring-1 ring-black/15'}`}
            style={{ background: s.hex }}
          />
        )
      })}
    </div>
  )
}

function EarnInfo({ keys, signedIn }: { keys: ReturnType<typeof useWardrobe.getState>['keys']; signedIn: boolean }) {
  return (
    <div data-testid="earn-info" className="mt-6 flex items-start gap-3 rounded-2xl bg-[rgba(224,169,58,.12)] p-3.5 text-sm ring-1 ring-[rgba(224,169,58,.35)]">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn text-ink">
        <IconKey width={18} height={18} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-bold">Earn keys to unlock more</p>
        <p className="text-ink-soft">
          {KEY_REWARDS.roomLogged} keys for every room you log and {KEY_REWARDS.dailySolved} for each Escape of the Day you solve. Keys are only for the wardrobe: no real money, ever.
        </p>
        {signedIn && keys ? (
          <p className="text-ink-soft" data-testid="earn-summary">
            So far: {keys.earned} earned ({KEY_REWARDS.welcome} welcome, {keys.rooms} {keys.rooms === 1 ? 'room' : 'rooms'}, {keys.dailies} {keys.dailies === 1 ? 'puzzle' : 'puzzles'}), {keys.spent} spent.
          </p>
        ) : (
          <p className="text-ink-soft">
            <a href="/welcome" className={`font-bold underline ${TEAL_TEXT}`}>
              Sign in
            </a>{' '}
            to earn keys and keep your look on every device. In the demo, free looks are saved on this device.
          </p>
        )}
      </div>
    </div>
  )
}
