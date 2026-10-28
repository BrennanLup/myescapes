/**
 * GET/PUT /api/me/avatar and POST /api/me/avatar/purchases (Phase 3 workstream B).
 * Outfits are validated against the catalogue (src/world/avatars/catalog.ts) by the contract
 * schemas, and the server checks you own every priced item you wear. Keys are earned in the app;
 * there is no payment provider and no real money.
 */
import type { FastifyInstance } from 'fastify'
import { AVATAR_ROUTES } from '../../src/contracts/avatar'
import type { AppContext } from '../context'
import { defineRoute } from '../http'
import { avatarStateFor, buyItem, putOutfit, signedOutAvatarState } from './avatar.lib'

const WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } }

export async function avatarRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, AVATAR_ROUTES.getAvatar, async ({ user }) => (user ? avatarStateFor(ctx.db(), user.id) : signedOutAvatarState()))
  defineRoute(app, ctx, AVATAR_ROUTES.putAvatar, async ({ user, body }) => putOutfit(ctx.db(), user.id, body.outfit), { config: WRITE_LIMIT })
  defineRoute(app, ctx, AVATAR_ROUTES.buyItem, async ({ user, body }) => buyItem(ctx.db(), user.id, body.itemId, body.wear), { config: WRITE_LIMIT })
}
