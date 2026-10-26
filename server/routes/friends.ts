/**
 * Friends, user search, invite links and notifications.
 * Owned by workstream 31 (server/routes/friends* (also owns notifications)). STUB: every route answers 501 (after its auth check).
 * Replace `notImplemented` with `defineRoute(app, ctx, ROUTES.x, handler)` per route; keep the export name.
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import type { AppContext } from '../context'
import { notImplemented } from '../http'

export async function friendsRoutes(app: FastifyInstance, ctx: AppContext) {
  notImplemented(app, ctx, [
    ROUTES.friends,
    ROUTES.friendRequests,
    ROUTES.sendFriendRequest,
    ROUTES.acceptFriend,
    ROUTES.declineFriend,
    ROUTES.unfriend,
    ROUTES.blockUser,
    ROUTES.unblockUser,
    ROUTES.setAutoAccept,
    ROUTES.userSearch,
    ROUTES.createInvite,
    ROUTES.myInvites,
    ROUTES.invitePreview,
    ROUTES.acceptInvite,
    ROUTES.revokeInvite,
    ROUTES.notifications,
    ROUTES.readNotifications,
  ])
}
