/**
 * Characters and the wardrobe (Phase 3 workstream B): saved outfits, keys and purchases.
 *
 * Keys are never stored as a balance. They are counted from your own data every time (rooms you
 * are on, Escape of the Day puzzles you solved) minus what you spent, so there is nothing to
 * tamper with and nothing to keep in sync. No real money is involved anywhere.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AvatarState } from '../../src/contracts/avatar'
import { itemById, keyBalance, normalizeOutfit, starterOutfit, unownedItems, type ItemId, type KeyBalance, type Outfit } from '../../src/world/avatars/catalog'
import type { Db } from '../db/client'
import { avatarPurchases, avatars, dailyResults, visitParticipants } from '../db/schema'
import { HttpError } from '../http'

/** Run `fn` in a transaction with a `Db`-typed handle. */
function inTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (txRaw) => fn(txRaw as unknown as Db))
}

/** Serialises wardrobe writes per user (buying twice at once can't overspend). */
async function lockUser(tx: Db, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'avatar:' + userId}))`)
}

/** The saved look of a user, or their free starter look. Also used by realtime presence. */
export async function outfitForUser(db: Db, userId: string): Promise<{ outfit: Outfit; saved: boolean }> {
  const row = (await db.select({ outfit: avatars.outfit }).from(avatars).where(eq(avatars.userId, userId)).limit(1))[0]
  const starter = starterOutfit(userId)
  return row ? { outfit: normalizeOutfit(row.outfit, starter), saved: true } : { outfit: starter, saved: false }
}

/** Saved looks for many users at once (missing ones get their starter look). */
export async function outfitsForUsers(db: Db, userIds: string[]): Promise<Map<string, Outfit>> {
  const out = new Map<string, Outfit>(userIds.map((id) => [id, starterOutfit(id)]))
  if (!userIds.length) return out
  const rows = await db.select().from(avatars).where(inArray(avatars.userId, userIds))
  for (const r of rows) out.set(r.userId, normalizeOutfit(r.outfit, starterOutfit(r.userId)))
  return out
}

export async function keysForUser(db: Db, userId: string): Promise<KeyBalance> {
  const [rooms] = await db
    .select({ n: sql<number>`count(distinct ${visitParticipants.visitId})::int` })
    .from(visitParticipants)
    .where(and(eq(visitParticipants.userId, userId), inArray(visitParticipants.status, ['owner', 'accepted'])))
  const [dailies] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dailyResults)
    .where(and(eq(dailyResults.userId, userId), eq(dailyResults.solved, true)))
  const [spent] = await db
    .select({ n: sql<number>`coalesce(sum(${avatarPurchases.price}), 0)::int` })
    .from(avatarPurchases)
    .where(eq(avatarPurchases.userId, userId))
  return keyBalance({ rooms: rooms?.n ?? 0, dailies: dailies?.n ?? 0, spent: spent?.n ?? 0 })
}

export async function ownedItems(db: Db, userId: string): Promise<ItemId[]> {
  const rows = await db.select({ itemId: avatarPurchases.itemId }).from(avatarPurchases).where(eq(avatarPurchases.userId, userId))
  // Ids from a retired catalogue entry still count; unknown ones (removed entirely) are dropped.
  return rows.map((r) => r.itemId).filter((id): id is ItemId => !!itemById(id))
}

export async function avatarStateFor(db: Db, userId: string): Promise<AvatarState> {
  const [{ outfit, saved }, owned, keys] = await Promise.all([outfitForUser(db, userId), ownedItems(db, userId), keysForUser(db, userId)])
  return { signedIn: true, outfit, saved, owned, keys }
}

/** The response for a signed-out visitor. */
export function signedOutAvatarState(): AvatarState {
  return { signedIn: false, outfit: starterOutfit('guest'), saved: false, owned: [], keys: null }
}

function assertWearable(outfit: Outfit, owned: readonly string[]) {
  const missing = unownedItems(outfit, owned)
  if (missing.length) {
    throw new HttpError('forbidden', `Unlock ${missing.map((i) => i.name).join(', ')} with keys before wearing ${missing.length === 1 ? 'it' : 'them'}.`)
  }
}

async function saveOutfit(tx: Db, userId: string, outfit: Outfit) {
  await tx
    .insert(avatars)
    .values({ userId, outfit: { ...outfit } })
    .onConflictDoUpdate({ target: avatars.userId, set: { outfit: { ...outfit }, updatedAt: new Date() } })
}

/** Wear `outfit`. 403 when it uses a priced item you don't own. */
export async function putOutfit(db: Db, userId: string, outfit: Outfit): Promise<AvatarState> {
  await inTx(db, async (tx) => {
    await lockUser(tx, userId)
    assertWearable(outfit, await ownedItems(tx, userId))
    await saveOutfit(tx, userId, outfit)
  })
  return avatarStateFor(db, userId)
}

/**
 * Buy `itemId` with keys. With `wear`, also saves that outfit in the same transaction (it may use
 * the new item). 409 for free or already-owned items, 403 when the balance is too low.
 */
export async function buyItem(db: Db, userId: string, itemId: ItemId, wear?: Outfit): Promise<AvatarState> {
  const item = itemById(itemId)
  if (!item || item.retired) throw new HttpError('not_found', 'That item is not in the wardrobe.')
  if (item.price <= 0) throw new HttpError('conflict', `${item.name} is free: just wear it.`)
  await inTx(db, async (tx) => {
    await lockUser(tx, userId)
    const owned = await ownedItems(tx, userId)
    if (owned.includes(itemId)) throw new HttpError('conflict', `You already own ${item.name}.`)
    const keys = await keysForUser(tx, userId)
    if (keys.balance < item.price) {
      throw new HttpError('forbidden', `${item.name} costs ${item.price} keys and you have ${keys.balance}. Log rooms and solve Escape of the Day to earn more.`)
    }
    await tx.insert(avatarPurchases).values({ userId, itemId, price: item.price })
    if (wear) {
      assertWearable(wear, [...owned, itemId])
      await saveOutfit(tx, userId, wear)
    }
  })
  return avatarStateFor(db, userId)
}

/** For the account export (JSON download). */
export async function avatarExport(db: Db, userId: string) {
  const row = (await db.select().from(avatars).where(eq(avatars.userId, userId)).limit(1))[0]
  const purchases = await db
    .select({ itemId: avatarPurchases.itemId, price: avatarPurchases.price, createdAt: avatarPurchases.createdAt })
    .from(avatarPurchases)
    .where(eq(avatarPurchases.userId, userId))
  return {
    outfit: row ? ({ ...normalizeOutfit(row.outfit) } as Record<string, string>) : null,
    purchases: purchases.map((p) => ({ itemId: p.itemId, price: p.price, createdAt: p.createdAt.toISOString() })),
  }
}
