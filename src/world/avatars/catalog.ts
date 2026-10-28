/**
 * The wardrobe catalogue: every skin tone, colour and item a character can wear, with its price
 * in keys (the in-game currency, earned by logging rooms and solving Escape of the Day; there is
 * no real money anywhere). Pure data and helpers, no three.js or React, so the server imports it
 * to validate outfits and purchases.
 *
 * Ids are stored in the database (`avatars.outfit`, `avatar_purchases.item_id`): never rename or
 * reuse one. Retire an item by setting `retired: true` (still valid for people who own or wear
 * it, hidden from the wardrobe). `normalizeOutfit` repairs stored outfits that name an id that
 * no longer exists.
 */

export const OUTFIT_SLOTS = ['hair', 'top', 'bottom', 'shoes', 'hat', 'accessory'] as const
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number]

export interface Swatch {
  id: string
  name: string
  hex: string
}

export interface CatalogItem {
  id: string
  slot: OutfitSlot
  name: string
  /** Price in keys. 0 = free for everyone. */
  price: number
  /** One short line shown in the wardrobe. */
  blurb?: string
  /** Hidden from the wardrobe, still valid for anyone who already wears or owns it. */
  retired?: boolean
}

/** Keys earned per action. The server counts them from your data, so they can't be faked. */
export const KEY_REWARDS = {
  /** Everyone starts with a few keys so the first unlock comes quickly. */
  welcome: 20,
  /** Each room (visit) you logged or were tagged on and accepted. */
  roomLogged: 10,
  /** Each Escape of the Day you solved. */
  dailySolved: 5,
} as const

export const SKIN_TONES = [
  { id: 'porcelain', name: 'Porcelain', hex: '#f6dcc8' },
  { id: 'peach', name: 'Peach', hex: '#f1c6a5' },
  { id: 'sand', name: 'Sand', hex: '#e3b088' },
  { id: 'honey', name: 'Honey', hex: '#c98d5e' },
  { id: 'bronze', name: 'Bronze', hex: '#a86c43' },
  { id: 'umber', name: 'Umber', hex: '#7f4f31' },
  { id: 'espresso', name: 'Espresso', hex: '#5b3822' },
  { id: 'ebony', name: 'Ebony', hex: '#3f271a' },
] as const satisfies readonly Swatch[]

export const HAIR_COLORS = [
  { id: 'black', name: 'Black', hex: '#231a17' },
  { id: 'espresso', name: 'Dark brown', hex: '#3e2a1f' },
  { id: 'chestnut', name: 'Chestnut', hex: '#6b3f25' },
  { id: 'auburn', name: 'Auburn', hex: '#8e3b22' },
  { id: 'ginger', name: 'Ginger', hex: '#c8662c' },
  { id: 'honey', name: 'Honey blonde', hex: '#d9a65a' },
  { id: 'platinum', name: 'Platinum', hex: '#eee0c4' },
  { id: 'silver', name: 'Silver', hex: '#b8b4b0' },
  { id: 'teal', name: 'Teal dye', hex: '#2f8f8a' },
  { id: 'rose', name: 'Rose dye', hex: '#d97a92' },
  { id: 'violet', name: 'Violet dye', hex: '#7a5aa8' },
] as const satisfies readonly Swatch[]

/** Fabric colours for tops, bottoms, shoes and hats (the room's warm palette, plus basics). */
export const FABRIC_COLORS = [
  { id: 'cream', name: 'Cream', hex: '#efe0c8' },
  { id: 'white', name: 'White', hex: '#f7f3ec' },
  { id: 'orange', name: 'Pumpkin', hex: '#e07b39' },
  { id: 'rust', name: 'Rust', hex: '#b8503f' },
  { id: 'red', name: 'Tomato', hex: '#d4483b' },
  { id: 'rose', name: 'Rose', hex: '#e59aa8' },
  { id: 'plum', name: 'Plum', hex: '#6d3b5c' },
  { id: 'lilac', name: 'Lilac', hex: '#a78bc9' },
  { id: 'navy', name: 'Navy', hex: '#2d3b5c' },
  { id: 'denim', name: 'Denim', hex: '#4b6a93' },
  { id: 'sky', name: 'Sky', hex: '#8fc3e0' },
  { id: 'teal', name: 'Teal', hex: '#2f8f8a' },
  { id: 'forest', name: 'Forest', hex: '#3f7a3a' },
  { id: 'olive', name: 'Olive', hex: '#7d7a3e' },
  { id: 'mustard', name: 'Mustard', hex: '#e0a93a' },
  { id: 'tan', name: 'Tan', hex: '#c88a52' },
  { id: 'brown', name: 'Brown', hex: '#7a4a2b' },
  { id: 'grey', name: 'Grey', hex: '#8d8a87' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3d4248' },
  { id: 'black', name: 'Black', hex: '#24211f' },
] as const satisfies readonly Swatch[]

export const ITEMS = [
  // Hair
  { id: 'hair-none', slot: 'hair', name: 'Shaved', price: 0 },
  { id: 'hair-short', slot: 'hair', name: 'Short', price: 0 },
  { id: 'hair-buzz', slot: 'hair', name: 'Buzz cut', price: 0 },
  { id: 'hair-bob', slot: 'hair', name: 'Bob', price: 0 },
  { id: 'hair-long', slot: 'hair', name: 'Long', price: 0 },
  { id: 'hair-ponytail', slot: 'hair', name: 'Ponytail', price: 0 },
  { id: 'hair-curly', slot: 'hair', name: 'Curls', price: 0 },
  { id: 'hair-bun', slot: 'hair', name: 'Top bun', price: 0 },
  { id: 'hair-mohawk', slot: 'hair', name: 'Mohawk', price: 25, blurb: 'For the crew member who kicks the door open.' },
  { id: 'hair-afro', slot: 'hair', name: 'Big afro', price: 15 },
  // Tops
  { id: 'top-tee', slot: 'top', name: 'T-shirt', price: 0 },
  { id: 'top-tank', slot: 'top', name: 'Tank top', price: 0 },
  { id: 'top-sweater', slot: 'top', name: 'Sweater', price: 0 },
  { id: 'top-hoodie', slot: 'top', name: 'Hoodie', price: 0 },
  { id: 'top-jersey', slot: 'top', name: 'Crew jersey', price: 20, blurb: 'Striped, numbered, ready for game night.' },
  { id: 'top-jacket', slot: 'top', name: 'Bomber jacket', price: 30 },
  { id: 'top-trench', slot: 'top', name: 'Detective trench', price: 50, blurb: 'Every clue looks more important in a trench coat.' },
  // Bottoms
  { id: 'bottom-trousers', slot: 'bottom', name: 'Trousers', price: 0 },
  { id: 'bottom-shorts', slot: 'bottom', name: 'Shorts', price: 0 },
  { id: 'bottom-skirt', slot: 'bottom', name: 'Skirt', price: 0 },
  { id: 'bottom-cargo', slot: 'bottom', name: 'Cargo pants', price: 15, blurb: 'Pockets for every key you find.' },
  // Shoes
  { id: 'shoes-sneakers', slot: 'shoes', name: 'Sneakers', price: 0 },
  { id: 'shoes-boots', slot: 'shoes', name: 'Boots', price: 0 },
  { id: 'shoes-hightops', slot: 'shoes', name: 'High-tops', price: 15 },
  { id: 'shoes-slippers', slot: 'shoes', name: 'Bunny slippers', price: 35, blurb: 'Cozy mode, fully on.' },
  // Hats
  { id: 'hat-none', slot: 'hat', name: 'No hat', price: 0 },
  { id: 'hat-beanie', slot: 'hat', name: 'Beanie', price: 0 },
  { id: 'hat-cap', slot: 'hat', name: 'Cap', price: 0 },
  { id: 'hat-detective', slot: 'hat', name: 'Detective hat', price: 30, blurb: 'Deerstalker, flaps and all.' },
  { id: 'hat-tophat', slot: 'hat', name: 'Top hat', price: 45 },
  { id: 'hat-crown', slot: 'hat', name: 'Escape crown', price: 120, blurb: 'For the one who always finds the last key.' },
  // Accessories
  { id: 'acc-none', slot: 'accessory', name: 'Nothing', price: 0 },
  { id: 'acc-glasses', slot: 'accessory', name: 'Glasses', price: 0 },
  { id: 'acc-headphones', slot: 'accessory', name: 'Headphones', price: 10 },
  { id: 'acc-scarf', slot: 'accessory', name: 'Scarf', price: 15 },
  { id: 'acc-backpack', slot: 'accessory', name: 'Backpack', price: 20 },
  { id: 'acc-magnifier', slot: 'accessory', name: 'Magnifying glass', price: 35, blurb: 'Read the tiny print on every clue.' },
  { id: 'acc-lantern', slot: 'accessory', name: 'Lantern', price: 50, blurb: 'A warm glow for the darkest rooms.' },
  { id: 'acc-keyring', slot: 'accessory', name: 'Golden key ring', price: 80, blurb: 'Every key you ever earned, on your belt.' },
] as const satisfies readonly CatalogItem[]

export type SkinToneId = (typeof SKIN_TONES)[number]['id']
export type HairColorId = (typeof HAIR_COLORS)[number]['id']
export type FabricColorId = (typeof FABRIC_COLORS)[number]['id']
export type ItemId = (typeof ITEMS)[number]['id']
type ItemOf<S extends OutfitSlot> = Extract<(typeof ITEMS)[number], { slot: S }>['id']
export type HairId = ItemOf<'hair'>
export type TopId = ItemOf<'top'>
export type BottomId = ItemOf<'bottom'>
export type ShoesId = ItemOf<'shoes'>
export type HatId = ItemOf<'hat'>
export type AccessoryId = ItemOf<'accessory'>

/** A complete look. Every field is a catalogue id. */
export interface Outfit {
  skin: SkinToneId
  hair: HairId
  hairColor: HairColorId
  top: TopId
  topColor: FabricColorId
  bottom: BottomId
  bottomColor: FabricColorId
  shoes: ShoesId
  shoesColor: FabricColorId
  hat: HatId
  hatColor: FabricColorId
  accessory: AccessoryId
}

export const OUTFIT_KEYS = [
  'skin', 'hair', 'hairColor', 'top', 'topColor', 'bottom', 'bottomColor', 'shoes', 'shoesColor', 'hat', 'hatColor', 'accessory',
] as const satisfies readonly (keyof Outfit)[]

/** Which kind of value each outfit field holds. */
export const FIELD_KIND: Record<keyof Outfit, 'skin' | 'hairColor' | 'fabric' | OutfitSlot> = {
  skin: 'skin',
  hair: 'hair',
  hairColor: 'hairColor',
  top: 'top',
  topColor: 'fabric',
  bottom: 'bottom',
  bottomColor: 'fabric',
  shoes: 'shoes',
  shoesColor: 'fabric',
  hat: 'hat',
  hatColor: 'fabric',
  accessory: 'accessory',
}

export const DEFAULT_OUTFIT: Outfit = {
  skin: 'sand',
  hair: 'hair-short',
  hairColor: 'chestnut',
  top: 'top-hoodie',
  topColor: 'orange',
  bottom: 'bottom-trousers',
  bottomColor: 'denim',
  shoes: 'shoes-sneakers',
  shoesColor: 'white',
  hat: 'hat-none',
  hatColor: 'teal',
  accessory: 'acc-none',
}

const ITEM_BY_ID = new Map<string, CatalogItem>(ITEMS.map((i) => [i.id, i]))
const SKIN_BY_ID = new Map<string, Swatch>(SKIN_TONES.map((s) => [s.id, s]))
const HAIR_COLOR_BY_ID = new Map<string, Swatch>(HAIR_COLORS.map((s) => [s.id, s]))
const FABRIC_BY_ID = new Map<string, Swatch>(FABRIC_COLORS.map((s) => [s.id, s]))

export function itemById(id: string): CatalogItem | undefined {
  return ITEM_BY_ID.get(id)
}

export function itemsForSlot(slot: OutfitSlot, opts: { includeRetired?: boolean } = {}): CatalogItem[] {
  return ITEMS.filter((i) => i.slot === slot && (opts.includeRetired || !(i as CatalogItem).retired))
}

export const skinHex = (id: string) => (SKIN_BY_ID.get(id) ?? SKIN_BY_ID.get(DEFAULT_OUTFIT.skin)!).hex
export const hairHex = (id: string) => (HAIR_COLOR_BY_ID.get(id) ?? HAIR_COLOR_BY_ID.get(DEFAULT_OUTFIT.hairColor)!).hex
export const fabricHex = (id: string) => (FABRIC_BY_ID.get(id) ?? FABRIC_BY_ID.get('cream')!).hex

/** True when `value` is a valid id for outfit field `key`. */
export function isValidField(key: keyof Outfit, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const kind = FIELD_KIND[key]
  if (kind === 'skin') return SKIN_BY_ID.has(value)
  if (kind === 'hairColor') return HAIR_COLOR_BY_ID.has(value)
  if (kind === 'fabric') return FABRIC_BY_ID.has(value)
  return ITEM_BY_ID.get(value)?.slot === kind
}

/**
 * Any stored or received value -> a complete, valid outfit. Unknown or missing fields fall back
 * to `fallback` (default: DEFAULT_OUTFIT), so an old saved look never breaks rendering.
 */
export function normalizeOutfit(raw: unknown, fallback: Outfit = DEFAULT_OUTFIT): Outfit {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...fallback } as Record<keyof Outfit, string>
  for (const key of OUTFIT_KEYS) {
    if (isValidField(key, src[key])) out[key] = src[key] as string
  }
  return out as unknown as Outfit
}

/** Item ids an outfit wears (not colours). */
export function wornItems(outfit: Outfit): ItemId[] {
  return [outfit.hair, outfit.top, outfit.bottom, outfit.shoes, outfit.hat, outfit.accessory]
}

/** The priced items in `outfit` that are not in `owned`. Empty = you may wear it. */
export function unownedItems(outfit: Outfit, owned: Iterable<string>): CatalogItem[] {
  const have = new Set(owned)
  return wornItems(outfit)
    .map((id) => itemById(id)!)
    .filter((i) => i.price > 0 && !have.has(i.id))
}

export interface KeyCounts {
  rooms: number
  dailies: number
  spent: number
}

export interface KeyBalance extends KeyCounts {
  earned: number
  /** Never below 0 (deleting a visit after spending its keys keeps what you bought). */
  balance: number
}

export function keyBalance({ rooms, dailies, spent }: KeyCounts): KeyBalance {
  const earned = KEY_REWARDS.welcome + rooms * KEY_REWARDS.roomLogged + dailies * KEY_REWARDS.dailySolved
  return { rooms, dailies, spent, earned, balance: Math.max(0, earned - spent) }
}

/** Small deterministic hash (FNV-1a) so a seed always gives the same look. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A free, deterministic starter look for a seed (a user id or handle), so people who never
 * opened the wardrobe don't all look the same. Only free items.
 */
export function starterOutfit(seed: string): Outfit {
  let h = hash(seed || 'guest')
  const pick = <T,>(list: readonly T[]): T => {
    const v = list[h % list.length]
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
    return v
  }
  const free = (slot: OutfitSlot) => itemsForSlot(slot).filter((i) => i.price === 0)
  const fabric = FABRIC_COLORS.map((c) => c.id)
  return normalizeOutfit({
    skin: pick(SKIN_TONES.map((s) => s.id)),
    hair: pick(free('hair').map((i) => i.id)),
    hairColor: pick(HAIR_COLORS.slice(0, 8).map((c) => c.id)),
    top: pick(free('top').map((i) => i.id)),
    topColor: pick(fabric),
    bottom: pick(free('bottom').map((i) => i.id)),
    bottomColor: pick(['denim', 'navy', 'charcoal', 'tan', 'black', 'olive', 'brown', 'grey']),
    shoes: pick(free('shoes').map((i) => i.id)),
    shoesColor: pick(['white', 'black', 'brown', 'charcoal', 'red', 'teal']),
    hat: pick(['hat-none', 'hat-none', 'hat-none', 'hat-beanie', 'hat-cap']),
    hatColor: pick(fabric),
    accessory: pick(['acc-none', 'acc-none', 'acc-glasses']),
  })
}

/** A random free look (the wardrobe's "Surprise me"). */
export function randomOutfit(rand: () => number = Math.random): Outfit {
  return starterOutfit(String(Math.floor(rand() * 2 ** 31)))
}

/** True when two outfits are the same look. */
export function sameOutfit(a: Outfit, b: Outfit): boolean {
  return OUTFIT_KEYS.every((k) => a[k] === b[k])
}
