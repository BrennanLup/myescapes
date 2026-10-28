/**
 * Who may be in whose home (Phase 3, workstream C). One rule, used by the websocket hub and by
 * `GET /api/homes/:handle`:
 *
 *   - the owner may always enter their own home;
 *   - an accepted friend may enter;
 *   - a block in either direction hides the home completely (`not_found`, like everywhere else);
 *   - anyone else (a stranger, a pending request) gets `not_friends`.
 *
 * Homes are addressed by @handle (case-insensitive). A user without a handle has no home address.
 */
import { eq, sql } from 'drizzle-orm'
import type { PublicUser } from '../../src/contracts/models'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { toPublicUser } from '../db/util'
import { friendIds, friendshipBetween } from '../routes/friends.lib'

export interface HomeOwner {
  id: string
  handle: string
  user: PublicUser
}

export type VisitAccess = 'owner' | 'friend' | 'not_friends' | 'not_found'

/** The onboarded user behind a handle (leading `@` allowed), or null. */
export async function homeOwnerByHandle(db: Db, rawHandle: string): Promise<HomeOwner | null> {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase()
  if (!handle) return null
  const u = (
    await db
      .select({ id: users.id, handle: users.handle, displayName: users.displayName, name: users.name, image: users.image })
      .from(users)
      .where(eq(sql`lower(${users.handle})`, handle))
      .limit(1)
  )[0]
  if (!u?.handle || !u.displayName) return null
  return { id: u.id, handle: u.handle, user: toPublicUser(u) }
}

/** Can `viewerId` enter `ownerId`'s home? */
export async function visitAccess(db: Db, viewerId: string, ownerId: string): Promise<VisitAccess> {
  if (viewerId === ownerId) return 'owner'
  const f = await friendshipBetween(db, viewerId, ownerId)
  if (!f) return 'not_friends'
  if (f.row.status === 'blocked') return 'not_found'
  return f.row.status === 'accepted' ? 'friend' : 'not_friends'
}

/** Ids of the user's accepted friends. */
export async function acceptedFriendIds(db: Db, userId: string): Promise<Set<string>> {
  return friendIds(db, userId)
}
