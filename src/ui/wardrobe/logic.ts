/** Pure wardrobe logic (tabs, what the main button does), unit-tested in logic.test.ts. */
import { FABRIC_COLORS, HAIR_COLORS, itemsForSlot, SKIN_TONES, sameOutfit, unownedItems, type CatalogItem, type ItemId, type Outfit, type OutfitSlot, type Swatch } from '@/world/avatars/catalog'

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
  | { kind: 'buy'; item: CatalogItem; affordable: boolean; short: number; /** True when this purchase makes the whole look wearable. */ completes: boolean }
  | { kind: 'signin'; item: CatalogItem }

/** What the wardrobe's main button does for this draft. */
export function primaryAction(draft: Outfit, saved: Outfit, owned: readonly ItemId[], balance: number | null, signedIn: boolean): PrimaryAction {
  const have = balance ?? 0
  // Offer the cheapest item you can afford first, then the cheapest overall.
  const missing = unownedItems(draft, owned).sort((a, b) => Number(b.price <= have) - Number(a.price <= have) || a.price - b.price)
  if (missing.length) {
    const item = missing[0]
    if (!signedIn) return { kind: 'signin', item }
    return { kind: 'buy', item, affordable: have >= item.price, short: Math.max(0, item.price - have), completes: missing.length === 1 }
  }
  return sameOutfit(draft, saved) ? { kind: 'unchanged' } : { kind: 'save' }
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
