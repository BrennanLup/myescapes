import { describe, expect, it } from 'vitest'
import { OutfitSchema } from '@/contracts/avatar'
import {
  DEFAULT_OUTFIT,
  FABRIC_COLORS,
  HAIR_COLORS,
  ITEMS,
  KEY_REWARDS,
  OUTFIT_KEYS,
  OUTFIT_SLOTS,
  SKIN_TONES,
  isValidField,
  itemsForSlot,
  keyBalance,
  normalizeOutfit,
  randomOutfit,
  sameOutfit,
  starterOutfit,
  unownedItems,
  type Outfit,
} from './catalog'

describe('catalogue', () => {
  it('ids are unique and well formed', () => {
    for (const list of [ITEMS, SKIN_TONES, HAIR_COLORS, FABRIC_COLORS]) {
      const ids = list.map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
    }
    for (const c of [...SKIN_TONES, ...HAIR_COLORS, ...FABRIC_COLORS]) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('every slot has free choices and at least one item to unlock', () => {
    for (const slot of OUTFIT_SLOTS) {
      const items = itemsForSlot(slot)
      expect(items.some((i) => i.price === 0), slot).toBe(true)
      expect(items.some((i) => i.price > 0), slot).toBe(true)
      for (const i of items) expect(Number.isInteger(i.price) && i.price >= 0).toBe(true)
    }
  })

  it('hat and accessory slots can be empty for free', () => {
    expect(itemsForSlot('hat').find((i) => i.id === 'hat-none')?.price).toBe(0)
    expect(itemsForSlot('accessory').find((i) => i.id === 'acc-none')?.price).toBe(0)
  })

  it('the default and starter looks are valid, free and deterministic', () => {
    expect(OutfitSchema.parse(DEFAULT_OUTFIT)).toEqual(DEFAULT_OUTFIT)
    expect(unownedItems(DEFAULT_OUTFIT, [])).toEqual([])
    for (const seed of ['usr_alice', 'usr_bob', '', 'x'.repeat(200)]) {
      const o = starterOutfit(seed)
      expect(OutfitSchema.parse(o)).toEqual(o)
      expect(unownedItems(o, [])).toEqual([])
      expect(starterOutfit(seed)).toEqual(o)
    }
    // Different people mostly look different.
    const looks = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(starterOutfit(`usr_${i}`))))
    expect(looks.size).toBeGreaterThan(30)
  })

  it('randomOutfit uses the injected random source', () => {
    let n = 0
    const r = () => ((n = (n * 9301 + 49297) % 233280), n / 233280)
    const o = randomOutfit(r)
    expect(OutfitSchema.parse(o)).toEqual(o)
  })
})

describe('normalizeOutfit', () => {
  it('keeps valid fields and repairs the rest from the fallback', () => {
    const fallback = starterOutfit('fallback')
    const o = normalizeOutfit({ ...DEFAULT_OUTFIT, hat: 'hat-sombrero', top: 'hat-cap', skin: 42, extra: 'x' }, fallback)
    expect(o.hat).toBe(fallback.hat)
    expect(o.top).toBe(fallback.top)
    expect(o.skin).toBe(fallback.skin)
    expect(o.bottom).toBe(DEFAULT_OUTFIT.bottom)
    expect(Object.keys(o).sort()).toEqual([...OUTFIT_KEYS].sort())
  })

  it('accepts junk', () => {
    expect(normalizeOutfit(null)).toEqual(DEFAULT_OUTFIT)
    expect(normalizeOutfit('hat')).toEqual(DEFAULT_OUTFIT)
  })

  it('isValidField checks the slot', () => {
    expect(isValidField('hat', 'hat-cap')).toBe(true)
    expect(isValidField('hat', 'top-tee')).toBe(false)
    expect(isValidField('topColor', 'teal')).toBe(true)
    expect(isValidField('hairColor', 'cream')).toBe(false)
  })
})

describe('ownership and keys', () => {
  const look: Outfit = { ...DEFAULT_OUTFIT, hat: 'hat-crown', accessory: 'acc-lantern' }
  it('unownedItems lists priced items you have not bought', () => {
    expect(unownedItems(look, []).map((i) => i.id)).toEqual(['hat-crown', 'acc-lantern'])
    expect(unownedItems(look, ['acc-lantern']).map((i) => i.id)).toEqual(['hat-crown'])
    expect(unownedItems(look, ['acc-lantern', 'hat-crown'])).toEqual([])
  })

  it('keyBalance adds rewards and never goes below zero', () => {
    expect(keyBalance({ rooms: 3, dailies: 4, spent: 10 })).toEqual({
      rooms: 3,
      dailies: 4,
      spent: 10,
      earned: KEY_REWARDS.welcome + 3 * KEY_REWARDS.roomLogged + 4 * KEY_REWARDS.dailySolved,
      balance: KEY_REWARDS.welcome + 3 * KEY_REWARDS.roomLogged + 4 * KEY_REWARDS.dailySolved - 10,
    })
    expect(keyBalance({ rooms: 0, dailies: 0, spent: 500 }).balance).toBe(0)
  })

  it('sameOutfit', () => {
    expect(sameOutfit(DEFAULT_OUTFIT, { ...DEFAULT_OUTFIT })).toBe(true)
    expect(sameOutfit(DEFAULT_OUTFIT, { ...DEFAULT_OUTFIT, skin: 'ebony' })).toBe(false)
  })
})
