import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTFIT, itemById, OUTFIT_SLOTS } from '@/world/avatars/catalog'
import { colorApplies, primaryAction, priceLabel, stepIndex, tabItems, TABS } from './logic'

describe('tabs', () => {
  it('cover every slot once and every outfit field', () => {
    const slots = TABS.flatMap((t) => (t.slot ? [t.slot] : []))
    expect(slots.sort()).toEqual([...OUTFIT_SLOTS].sort())
    const fields = new Set(TABS.flatMap((t) => [t.slot === 'accessory' ? 'accessory' : t.slot, t.color?.field].filter(Boolean)))
    for (const k of Object.keys(DEFAULT_OUTFIT)) expect(fields.has(k), k).toBe(true)
  })

  it('lists free items first, then by price', () => {
    const hats = tabItems(TABS.find((t) => t.id === 'hat')!)
    const prices = hats.map((i) => i.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(hats[0].id).toBe('hat-none')
    expect(tabItems(TABS.find((t) => t.id === 'body')!)).toEqual([])
  })

  it('hides colours that do not apply', () => {
    const hat = TABS.find((t) => t.id === 'hat')!
    expect(colorApplies(hat, DEFAULT_OUTFIT)).toBe(false)
    expect(colorApplies(hat, { ...DEFAULT_OUTFIT, hat: 'hat-cap' })).toBe(true)
    expect(colorApplies(TABS.find((t) => t.id === 'hair')!, { ...DEFAULT_OUTFIT, hair: 'hair-none' })).toBe(false)
    expect(colorApplies(TABS.find((t) => t.id === 'extras')!, DEFAULT_OUTFIT)).toBe(false)
  })
})

describe('primaryAction', () => {
  const saved = DEFAULT_OUTFIT
  it('unchanged and save', () => {
    expect(primaryAction(saved, saved, [], 20, true)).toEqual({ kind: 'unchanged' })
    expect(primaryAction({ ...saved, skin: 'ebony' }, saved, [], 20, true)).toEqual({ kind: 'save' })
  })

  it('buy, affordable or short, and whether it completes the look', () => {
    const one = primaryAction({ ...saved, accessory: 'acc-headphones' }, saved, [], 20, true)
    expect(one).toMatchObject({ kind: 'buy', affordable: true, short: 0, completes: true })
    const two = primaryAction({ ...saved, accessory: 'acc-headphones', hat: 'hat-crown' }, saved, [], 20, true)
    // The affordable item is offered first.
    expect(two).toMatchObject({ kind: 'buy', item: { id: 'acc-headphones' }, affordable: true, completes: false })
    const poor = primaryAction({ ...saved, hat: 'hat-tophat', accessory: 'acc-lantern' }, saved, [], 20, true)
    expect(poor).toMatchObject({ kind: 'buy', item: { id: 'hat-tophat' }, affordable: false, short: 25, completes: false })
    // Owned items don't need buying.
    expect(primaryAction({ ...saved, hat: 'hat-crown' }, saved, ['hat-crown'], 0, true)).toEqual({ kind: 'save' })
  })

  it('signed out: sign in to unlock', () => {
    const a = primaryAction({ ...saved, hat: 'hat-crown' }, saved, [], null, false)
    expect(a).toEqual({ kind: 'signin', item: itemById('hat-crown') })
  })
})

describe('labels and keys', () => {
  it('priceLabel', () => {
    expect(priceLabel(itemById('hat-cap')!, [])).toBe('Free')
    expect(priceLabel(itemById('hat-crown')!, [])).toBe('120 keys')
    expect(priceLabel(itemById('hat-crown')!, ['hat-crown'])).toBe('Owned')
  })

  it('stepIndex wraps and handles Home/End', () => {
    expect(stepIndex(0, 'ArrowRight', 3)).toBe(1)
    expect(stepIndex(2, 'ArrowRight', 3)).toBe(0)
    expect(stepIndex(0, 'ArrowLeft', 3)).toBe(2)
    expect(stepIndex(1, 'Home', 3)).toBe(0)
    expect(stepIndex(1, 'End', 3)).toBe(2)
    expect(stepIndex(1, 'a', 3)).toBeNull()
  })
})
