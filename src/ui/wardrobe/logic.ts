/** Pure wardrobe logic (tabs, what the main button does), unit-tested in logic.test.ts. */
import { FABRIC_COLORS, HAIR_COLORS, itemById, itemsForSlot, OUTFIT_SLOTS, SKIN_TONES, sameOutfit, unownedItems, type CatalogItem, type ItemId, type Outfit, type OutfitSlot, type Swatch } from '@/world/avatars/catalog'

export type TabId = 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'extras'

export interface TabSpec {
  id: TabId
  label: string
  /** The item slot this tab picks, if any. */
  slot?: OutfitSlot
  /** The colour field shown under the items, if any. */
  color?: { field: keyof Outfit; label: string; swatches: readonly Swatch[] }
}

export const TABS: readonly TabSpec[] = [
  { id: 'body', label: 'Skin', color: { field: 'skin', label: 'Skin tone', swatches: SKIN_TONES } },
  { id: 'hair', label: 'Hair', slot: 'hair', color: { field: 'hairColor', label: 'Hair colour', swatches: HAIR_COLORS } },
  { id: 'top', label: 'Top', slot: 'top', color: { field: 'topColor', label: 'Colour', swatches: FABRIC_COLORS } },
  { id: 'bottom', label: 'Bottom', slot: 'bottom', color: { field: 'bottomColor', label: 'Colour', swatches: FABRIC_COLORS } },
  { id: 'shoes', label: 'Shoes', slot: 'shoes', color: { field: 'shoesColor', label: 'Colour', swatches: FABRIC_COLORS } },
  { id: 'hat', label: 'Hat', slot: 'hat', color: { field: 'hatColor', label: 'Colour', swatches: FABRIC_COLORS } },
  { id: 'extras', label: 'Extras', slot: 'accessory' },
]

export const SLOT_FIELD: Record<OutfitSlot, keyof Outfit> = {
  hair: 'hair',
  top: 'top',
  bottom: 'bottom',
  shoes: 'shoes',
  hat: 'hat',
  accessory: 'accessory',
}

/** Items shown in a tab: free first, then by price, keeping catalogue order within a price. */
export function tabItems(tab: TabSpec): CatalogItem[] {
  if (!tab.slot) return []
  const items = itemsForSlot(tab.slot)
  return items.map((item, i) => ({ item, i })).sort((a, b) => a.item.price - b.item.price || a.i - b.i).map((x) => x.item)
}

/** Colour swatches only matter for some items (no colour for "no hat", a shaved head...). */
export function colorApplies(tab: TabSpec, draft: Outfit): boolean {
  if (!tab.color) return false
  if (tab.id === 'hat') return draft.hat !== 'hat-none'
  if (tab.id === 'hair') return draft.hair !== 'hair-none'
  return true
}

export type PrimaryAction =
  | { kind: 'unchanged' }
  | { kind: 'save' }
  | {
      kind: 'buy'
      item: CatalogItem
      affordable: boolean
      short: number
      /** True when this purchase makes the whole look wearable. */
      completes: boolean
      /** The other locked items in the look (empty when `completes`). */
      rest: CatalogItem[]
    }
  | { kind: 'signin'; item: CatalogItem }

/** What the wardrobe's main button does for this draft. */
export function primaryAction(draft: Outfit, saved: Outfit, owned: readonly ItemId[], balance: number | null, signedIn: boolean): PrimaryAction {
  const have = balance ?? 0
  // Offer the cheapest item you can afford first, then the cheapest overall.
  const missing = unownedItems(draft, owned).sort((a, b) => Number(b.price <= have) - Number(a.price <= have) || a.price - b.price)
  if (missing.length) {
    const item = missing[0]
    if (!signedIn) return { kind: 'signin', item }
    return { kind: 'buy', item, affordable: have >= item.price, short: Math.max(0, item.price - have), completes: missing.length === 1, rest: missing.slice(1) }
  }
  return sameOutfit(draft, saved) ? { kind: 'unchanged' } : { kind: 'save' }
}

/**
 * The part of `draft` you can wear now: every priced item you don't own goes back to what you
 * wear today (`saved`, which you own), or the slot's first free item if even that is locked.
 * Colours are kept. Used to wear an item you just unlocked while the rest of the look stays
 * locked, and for "Wear what you own".
 */
export function wearableDraft(draft: Outfit, saved: Outfit, owned: readonly string[]): Outfit {
  const have = new Set(owned)
  const ok = (id: string) => {
    const item = itemById(id)
    return !!item && (item.price === 0 || have.has(id))
  }
  const out = { ...draft }
  for (const slot of OUTFIT_SLOTS) {
    const field = SLOT_FIELD[slot]
    if (ok(out[field])) continue
    const fallback = ok(saved[field]) ? saved[field] : itemsForSlot(slot).find((i) => i.price === 0)!.id
    ;(out as Record<keyof Outfit, string>)[field] = fallback
  }
  return out
}

/** Names as a sentence: "A", "A and B", "A, B and C". */
export function listNames(items: readonly Pick<CatalogItem, 'name'>[]): string {
  const names = items.map((i) => i.name)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Columns for a row of colour swatches on a phone: as few rows as fit `maxPerRow`, then balanced,
 * so 8 skin tones are 4 + 4 rather than 7 + 1.
 */
export function swatchColumns(count: number, maxPerRow = 7): number {
  if (count <= maxPerRow) return Math.max(1, count)
  return Math.ceil(count / Math.ceil(count / maxPerRow))
}

/** Price label for an item tile. */
export function priceLabel(item: CatalogItem, owned: readonly ItemId[]): string {
  if (item.price === 0) return 'Free'
  if (owned.includes(item.id as ItemId)) return 'Owned'
  return `${item.price} keys`
}

/** Next/previous index for arrow-key navigation in a row of tabs (wraps). */
export function stepIndex(current: number, key: string, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Which edges of a horizontal scroller hide more content (for the tab strip's fade hints). */
export function scrollEdges(el: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): { start: boolean; end: boolean } {
  const max = el.scrollWidth - el.clientWidth
  return { start: el.scrollLeft > 2, end: max - el.scrollLeft > 2 }
}
