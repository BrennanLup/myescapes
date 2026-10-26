/**
 * Account, profile, export, deletion and my-rooms routes. Owned by workstream 4.
 *
 * - `GET /api/me`, `PATCH /api/me` (onboarding: display name + unique @handle)
 * - `GET /api/handles/:handle` (public availability check; never reveals who has it)
 * - `GET /api/me/export` (JSON download, promised by /privacy)
 * - `DELETE /api/me` (account deletion, promised by /privacy)
 * - `GET /api/logs` (my room: visits I own or accepted, with my review and crew)
 *
 * Everything here is scoped to the signed-in user; no route takes another user's id.
 */
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { ROUTES } from '../../src/contracts/routes'
import { clearSessionCookies } from '../auth'
import { checkHandle, meFromRow, updateProfile } from '../auth/users'
import type { AppContext } from '../context'
import { users } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { deleteAccount, exportAccount } from './logs.account'
import { logRowsFor } from './logs.load'

export async function logsRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, ROUTES.me, async ({ user, reply }) => {
    const row = (await ctx.db().select().from(users).where(eq(users.id, user.id)).limit(1))[0]
    if (!row) throw new HttpError('unauthorized', 'Please sign in first.')
    reply.header('cache-control', 'no-store')
    return meFromRow(row)
  })

  defineRoute(
    app,
    ctx,
    ROUTES.updateMe,
    async ({ user, body, reply }) => {
      const row = await updateProfile(ctx.db(), user.id, body, ctx.now())
      reply.header('cache-control', 'no-store')
      return meFromRow(row)
    },
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
  )

  defineRoute(
    app,
    ctx,
    ROUTES.handleAvailable,
    // Public route, but a signed-in user's own current handle counts as available to them.
    async ({ params, req }) => checkHandle(ctx.db(), params.handle.slice(0, 64), (await ctx.getUser(req))?.id),
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
  )

  defineRoute(
    app,
    ctx,
    ROUTES.exportMe,
    async ({ user, req, reply }) => {
      const now = ctx.now()
      const data = await exportAccount(ctx.db(), user.id, ctx.origin(req), now)
      reply.header('cache-control', 'no-store')
      reply.header('content-disposition', `attachment; filename="myescapes-export-${now.toISOString().slice(0, 10)}.json"`)
      return data
    },
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  )

  defineRoute(app, ctx, ROUTES.deleteMe, async ({ user, reply }) => {
    await deleteAccount(ctx.db(), user.id)
    clearSessionCookies(reply, ctx.env)
    reply.header('cache-control', 'no-store')
    return { deleted: true as const }
  })

  defineRoute(app, ctx, ROUTES.logs, async ({ user, query }) => {
    return { rows: await logRowsFor(ctx.db(), user.id, query) }
  })
}
