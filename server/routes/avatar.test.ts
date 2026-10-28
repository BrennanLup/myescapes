// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { AvatarStateSchema, type AvatarState } from '../../src/contracts/avatar'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { DEFAULT_OUTFIT, KEY_REWARDS, itemById, starterOutfit, type Outfit } from '../../src/world/avatars/catalog'
import { avatarPurchases, avatars, dailyResults } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'
import { avatarExport, keysForUser, outfitsForUsers } from './avatar.lib'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

const U = () => t.fx.users
const URL = '/api/me/avatar'

async function state(as?: string): Promise<AvatarState> {
  const res = await t.inject({ method: 'GET', url: URL, as })
  expect(res.statusCode).toBe(200)
  return AvatarStateSchema.parse(res.json())
}

const buy = (as: string | undefined, payload: Record<string, unknown>) => t.inject({ method: 'POST', url: `${URL}/purchases`, as, payload })

/** Give `userId` solved Escape of the Day results (each one is worth KEY_REWARDS.dailySolved). */
async function giveDailies(userId: string, n: number) {
  await t.db.insert(dailyResults).values(
    Array.from({ length: n }, (_, i) => ({ userId, day: `2025-01-${String(i + 1).padStart(2, '0')}`, number: i + 1, timeZone: 'UTC', solved: true, finishedAt: new Date() })),
  )
}

beforeEach(async () => {
  await t.db.delete(avatarPurchases)
  await t.db.delete(avatars)
  await t.db.delete(dailyResults).where(eq(dailyResults.userId, U().newbie))
})

describe('GET /api/me/avatar', () => {
  it('signed out: a starter look, nothing owned, no keys', async () => {
    const s = await state()
    expect(s.signedIn).toBe(false)
    expect(s.keys).toBeNull()
    expect(s.owned).toEqual([])
  })

  it('signed in, never saved: the deterministic starter look and the welcome keys', async () => {
    const s = await state(U().newbie)
    expect(s).toMatchObject({ signedIn: true, saved: false, owned: [] })
    expect(s.outfit).toEqual(starterOutfit(U().newbie))
    expect(s.keys).toMatchObject({ rooms: 0, dailies: 0, spent: 0, earned: KEY_REWARDS.welcome, balance: KEY_REWARDS.welcome })
  })

  it('counts rooms you are on (owner or accepted) and solved dailies', async () => {
    const keys = await keysForUser(t.db, U().alice)
    expect(keys.rooms).toBeGreaterThan(0)
    expect(keys.earned).toBe(KEY_REWARDS.welcome + keys.rooms * KEY_REWARDS.roomLogged + keys.dailies * KEY_REWARDS.dailySolved)
    await giveDailies(U().newbie, 3)
    expect((await state(U().newbie)).keys).toMatchObject({ dailies: 3, earned: KEY_REWARDS.welcome + 3 * KEY_REWARDS.dailySolved })
  })
})

describe('PUT /api/me/avatar', () => {
  const look: Outfit = { ...DEFAULT_OUTFIT, hair: 'hair-bob', topColor: 'teal', hat: 'hat-beanie' }

  it('needs a session', async () => {
    const res = await t.inject({ method: 'PUT', url: URL, payload: { outfit: look } })
    expect(res.statusCode).toBe(401)
  })

  it('saves a free look and returns it on the next GET', async () => {
    const res = await t.inject({ method: 'PUT', url: URL, as: U().alice, payload: { outfit: look } })
    expect(res.statusCode).toBe(200)
    expect(AvatarStateSchema.parse(res.json())).toMatchObject({ saved: true, outfit: look })
    expect((await state(U().alice)).outfit).toEqual(look)
    // Saving again replaces it.
    const again = { ...look, skin: 'ebony' as const }
    await t.inject({ method: 'PUT', url: URL, as: U().alice, payload: { outfit: again } })
    expect((await state(U().alice)).outfit.skin).toBe('ebony')
  })

  it('rejects unknown ids, wrong slots, missing and extra fields with 400', async () => {
    for (const outfit of [
      { ...look, hat: 'hat-sombrero' },
      { ...look, hat: 'top-tee' },
      { ...look, topColor: '#ff0000' },
      { ...look, accessory: undefined },
      { ...look, wings: 'yes' },
    ]) {
      const res = await t.inject({ method: 'PUT', url: URL, as: U().alice, payload: { outfit } })
      expect(res.statusCode, JSON.stringify(outfit)).toBe(400)
      expect(ApiErrorSchema.parse(res.json()).code).toBe('invalid')
    }
  })

  it('refuses priced items you do not own (403) and keeps the old look', async () => {
    const res = await t.inject({ method: 'PUT', url: URL, as: U().newbie, payload: { outfit: { ...look, hat: 'hat-crown' } } })
    expect(res.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(res.json()).error).toContain('Escape crown')
    expect((await state(U().newbie)).saved).toBe(false)
  })
})

describe('POST /api/me/avatar/purchases', () => {

  it('needs a session', async () => {
    expect((await buy(undefined, { itemId: 'acc-headphones' })).statusCode).toBe(401)
  })

  it('buys with the welcome keys, then you may wear it', async () => {
    const price = itemById('acc-headphones')!.price
    const res = await buy(U().newbie, { itemId: 'acc-headphones' })
    expect(res.statusCode).toBe(200)
    const s = AvatarStateSchema.parse(res.json())
    expect(s.owned).toEqual(['acc-headphones'])
    expect(s.keys).toMatchObject({ spent: price, balance: KEY_REWARDS.welcome - price })
    const wear = await t.inject({ method: 'PUT', url: URL, as: U().newbie, payload: { outfit: { ...DEFAULT_OUTFIT, accessory: 'acc-headphones' } } })
    expect(wear.statusCode).toBe(200)
  })

  it('buy-and-wear in one step', async () => {
    const outfit = { ...DEFAULT_OUTFIT, accessory: 'acc-headphones' }
    const res = await buy(U().newbie, { itemId: 'acc-headphones', wear: outfit })
    expect(res.statusCode).toBe(200)
    expect(AvatarStateSchema.parse(res.json())).toMatchObject({ saved: true, outfit })
  })

  it('a wear outfit that needs another unowned item rolls the whole purchase back', async () => {
    const res = await buy(U().newbie, { itemId: 'acc-headphones', wear: { ...DEFAULT_OUTFIT, accessory: 'acc-headphones', hat: 'hat-crown' } })
    expect(res.statusCode).toBe(403)
    expect((await state(U().newbie)).owned).toEqual([])
  })

  it('too few keys: 403, nothing bought', async () => {
    const res = await buy(U().newbie, { itemId: 'hat-crown' })
    expect(res.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(res.json()).error).toMatch(/costs 120 keys and you have 20/)
    expect((await state(U().newbie)).owned).toEqual([])
  })

  it('free, owned and unknown items', async () => {
    expect((await buy(U().newbie, { itemId: 'hat-cap' })).statusCode).toBe(409)
    await buy(U().newbie, { itemId: 'acc-headphones' })
    expect((await buy(U().newbie, { itemId: 'acc-headphones' })).statusCode).toBe(409)
    expect((await buy(U().newbie, { itemId: 'acc-jetpack' })).statusCode).toBe(400)
  })

  it('two purchases at once cannot overspend', async () => {
    // 20 welcome + 2 dailies = 30 keys: enough for one 25-key item, not two of 25 and 20.
    await giveDailies(U().newbie, 2)
    const results = await Promise.all([buy(U().newbie, { itemId: 'hair-mohawk' }), buy(U().newbie, { itemId: 'top-jersey' })])
    const ok = results.filter((r) => r.statusCode === 200)
    expect(ok).toHaveLength(1)
    const s = await state(U().newbie)
    expect(s.owned).toHaveLength(1)
    expect(s.keys!.balance).toBeGreaterThanOrEqual(0)
  })
})

describe('helpers', () => {
  it('outfitsForUsers fills in starter looks and normalises stored ones', async () => {
    await t.db.insert(avatars).values({ userId: U().bob, outfit: { ...DEFAULT_OUTFIT, hat: 'hat-retired-thing' } })
    const m = await outfitsForUsers(t.db, [U().alice, U().bob])
    expect(m.get(U().alice)).toEqual(starterOutfit(U().alice))
    expect(m.get(U().bob)!.hat).toBe(starterOutfit(U().bob).hat)
    expect(m.get(U().bob)!.top).toBe(DEFAULT_OUTFIT.top)
  })

  it('avatarExport lists the look and purchases', async () => {
    await buy(U().newbie, { itemId: 'acc-headphones', wear: { ...DEFAULT_OUTFIT, accessory: 'acc-headphones' } })
    const e = await avatarExport(t.db, U().newbie)
    expect(e.outfit?.accessory).toBe('acc-headphones')
    expect(e.purchases).toEqual([expect.objectContaining({ itemId: 'acc-headphones', price: itemById('acc-headphones')!.price })])
  })
})
