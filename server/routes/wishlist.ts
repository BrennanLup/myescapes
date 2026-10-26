/**
 * Wish list: GET/PUT /api/wishlist. Signed in: the user's rows. Signed out: the seed demo overlay.
 * Owned by workstream 4 (server/routes/wishlist*).
 */
import type { FastifyInstance } from 'fastify'
import { ROUTES } from '../../src/contracts/routes'
import { seedRepositoryFor } from '../../src/data/server/repository'
import type { AppContext } from '../context'
import { getWishlistForUser, putWishlistForUser } from '../db/dataset'
import { defineRoute } from '../http'

export async function wishlistRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.wishlist, async ({ user }) => {
    if (user) return getWishlistForUser(ctx.db(), user.id)
    return (await seedRepositoryFor(ctx.env.DATA_DIR)).getWishlist()
  })
  defineRoute(app, ctx, ROUTES.putWishlist, async ({ user, body }) => {
    if (user) return putWishlistForUser(ctx.db(), user.id, body)
    const saved = await (await seedRepositoryFor(ctx.env.DATA_DIR)).putWishlist(body.map(({ gameId: _g, ...w }) => w))
    return saved
  })
}
