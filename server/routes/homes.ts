/**
 * Phase 3, workstream C: visiting a friend's room, and who is online.
 *
 *   GET /api/homes/:handle  A user's room as the `Dataset` the 3D room renders, read-only and
 *                           friends-only (see `HomeViewSchema` in src/contracts/realtime.ts).
 *   GET /api/presence       My friends with online status and where they are, and who is in my home.
 *
 * Access is server/realtime/access.ts (`visitAccess`): owner or accepted friend; a stranger gets
 * 403 `forbidden`; an unknown handle or a block in either direction gets 404.
 */
import type { FastifyInstance } from 'fastify'
import type { PublicUser } from '../../src/contracts/models'
import type { FriendPresence, HomeView } from '../../src/contracts/realtime'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { datasetForUser } from '../db/dataset'
import { httpError, defineRoute } from '../http'
import { homeOwnerByHandle, visitAccess } from '../realtime/access'
import { existingHub } from '../realtime'
import { friendIds, publicUsers } from './friends.lib'
import { wantsSpoilers } from './reviews.lib'
import { visitorDataset } from './homes.lib'

const LOOKUP_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } }

export async function homesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  defineRoute(
    app,
    ctx,
    ROUTES.home,
    async ({ params, user, req }): Promise<HomeView> => {
      const db = ctx.db()
      const owner = await homeOwnerByHandle(db, params.handle)
      if (!owner) throw httpError('not_found', 'There is no room with that @handle.')
      const access = await visitAccess(db, user.id, owner.id)
      if (access === 'not_found') throw httpError('not_found', 'There is no room with that @handle.')
      if (access === 'not_friends') throw httpError('forbidden', `Only @${owner.handle}'s friends can visit their room.`)
      const hub = existingHub(ctx)
      const presence = {
        ownerOnline: hub?.isOnline(owner.id) ?? false,
        visitors: (hub?.peopleInHome(owner.id) ?? []).filter((u) => u.id !== user.id),
      }
      if (access === 'owner') {
        return { owner: owner.user, isOwner: true, readOnly: false, dataset: await datasetForUser(db, owner.id), spoilersHidden: false, presence }
      }
      const reveal = wantsSpoilers(req.query)
      return { owner: owner.user, isOwner: false, readOnly: true, dataset: await visitorDataset(db, owner.id, user.id, { reveal }), spoilersHidden: !reveal, presence }
    },
    { config: LOOKUP_LIMIT },
  )

  defineRoute(
    app,
    ctx,
    ROUTES.presence,
    async ({ user }) => {
      const db = ctx.db()
      const hub = existingHub(ctx)
      const ids = [...(await friendIds(db, user.id))]
      const people = await publicUsers(db, ids)
      const friends: FriendPresence[] = ids.flatMap((id) => {
        const u = people.get(id)
        if (!u) return []
        const where = hub?.whereFor(id, user.id) ?? 'offline'
        return [{ user: u, online: where !== 'offline', where, homeCount: hub?.peopleInHome(id).length ?? 0 }]
      })
      friends.sort((a, b) => Number(b.online) - Number(a.online) || a.user.displayName.localeCompare(b.user.displayName))
      const here: PublicUser[] = (hub?.peopleInHome(user.id) ?? []).filter((u) => u.id !== user.id)
      return { friends, here, realtime: Boolean(hub) }
    },
    { config: LOOKUP_LIMIT },
  )
}
