/**
 * User helpers shared by auth (3) and the account routes (4): the `Me` shape, @handle rules,
 * onboarding, and the "may this user's reviews be public" rule.
 */
import { and, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { HANDLE_RE, RESERVED_HANDLES, type Me } from '../../src/contracts/models'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { isUniqueViolation } from '../db/util'
import { HttpError } from '../http'

type UserRow = typeof users.$inferSelect

/** The signed-in user's own view of themselves (`GET /api/me`). Never put this in a public response. */
export function meFromRow(u: UserRow): Me {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName || u.name,
    image: u.image,
    email: u.email,
    onboarded: isOnboarded(u),
    isAdmin: u.isAdmin,
    createdAt: u.createdAt.toISOString(),
  }
}

/** Onboarded = a display name and an @handle are chosen. Needed before any review is public. */
export function isOnboarded(u: { handle: string | null; displayName: string | null }): boolean {
  return Boolean(u.handle && u.displayName)
}

/**
 * SQL condition: the author (a `users` row joined in the query) may appear on public pages.
 * Public review queries must AND this in, so a review written before onboarding stays off
 * public pages until a display name and @handle are chosen.
 */
export function authorIsPublic(userTable: { handle: AnyPgColumn; displayName: AnyPgColumn } = users): SQL {
  return and(isNotNull(userTable.handle), isNotNull(userTable.displayName))!
}

/**
 * For routes that set a review's visibility (33, mobile save): a public review needs a display
 * name and @handle first. Throws 403 `onboarding_required`.
 */
export function assertCanPublish(user: { onboarded: boolean }, visibility: 'public' | 'friends' | 'private'): void {
  if (visibility === 'public' && !user.onboarded) {
    throw new HttpError('onboarding_required', 'Choose a display name and @handle before posting a public review.')
  }
}

export type HandleCheck ={ handle: string; available: boolean; reason: 'taken' | 'reserved' | 'invalid' | null }

/** Normalise a typed handle: trim, drop a leading @, lowercase. */
export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

export function isReservedHandle(handle: string): boolean {
  return (RESERVED_HANDLES as readonly string[]).includes(handle.toLowerCase())
}

/** Is `raw` free for `forUserId` (their own current handle counts as available)? */
export async function checkHandle(db: Db, raw: string, forUserId?: string): Promise<HandleCheck> {
  const handle = normaliseHandle(raw)
  if (!HANDLE_RE.test(handle)) return { handle, available: false, reason: 'invalid' }
  if (isReservedHandle(handle)) return { handle, available: false, reason: 'reserved' }
  const where = forUserId ? and(sql`lower(${users.handle}) = ${handle}`, ne(users.id, forUserId)) : sql`lower(${users.handle}) = ${handle}`
  const taken = (await db.select({ id: users.id }).from(users).where(where).limit(1)).length > 0
  return taken ? { handle, available: false, reason: 'taken' } : { handle, available: true, reason: null }
}

/**
 * A handle suggestion from a Google name or email: "Brennan Lup" -> "brennanlup".
 * Not checked against the database; see `suggestFreeHandle`.
 */
export function handleBase(name: string, email = ''): string {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '')
  let base = clean(name)
  if (base.length < 3) base = clean(email.split('@')[0] ?? '')
  base = base.replace(/^[^a-z]+/, '')
  if (base.length < 3) base = `escaper${base}`
  return base.slice(0, 20)
}

/** First free handle among base, base2, base3, ... */
export async function suggestFreeHandle(db: Db, name: string, email = '', forUserId?: string): Promise<string> {
  const base = handleBase(name, email)
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base}${i}`
    const c = await checkHandle(db, candidate, forUserId)
    if (c.available) return c.handle
  }
  return `${base.slice(0, 12)}${Date.now().toString(36)}`.slice(0, 24)
}

/**
 * Set display name and/or handle. The first time both are set, `onboardedAt` is stamped.
 * Throws 409 `handle_taken` (taken or reserved) or 400 `invalid`.
 */
export async function updateProfile(db: Db, userId: string, input: { displayName?: string; handle?: string }, now = new Date()): Promise<UserRow> {
  const current = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  if (!current) throw new HttpError('unauthorized', 'Please sign in first.')
  const patch: Partial<typeof users.$inferInsert> = {}
  if (input.handle !== undefined) {
    const c = await checkHandle(db, input.handle, userId)
    if (c.reason === 'invalid') throw new HttpError('invalid', 'A handle is 3-24 letters, digits or _, starting with a letter.')
    if (!c.available) throw new HttpError('handle_taken', c.reason === 'reserved' ? `@${c.handle} is reserved. Try another.` : `@${c.handle} is taken. Try another.`)
    patch.handle = c.handle
  }
  if (input.displayName !== undefined) {
    const d = input.displayName.trim()
    if (!d || d.length > 60) throw new HttpError('invalid', 'A display name is 1-60 characters.')
    patch.displayName = d
  }
  const next = { handle: patch.handle ?? current.handle, displayName: patch.displayName ?? current.displayName }
  if (!current.onboardedAt && isOnboarded(next)) patch.onboardedAt = now
  if (!Object.keys(patch).length) return current
  try {
    return (await db.update(users).set(patch).where(eq(users.id, userId)).returning())[0]
  } catch (err) {
    // Two people racing for the same handle: the unique index decides.
    if (isUniqueViolation(err)) throw new HttpError('handle_taken', `@${patch.handle} is taken. Try another.`)
    throw err
  }
}
