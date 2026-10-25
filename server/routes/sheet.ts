// Data routes. Owned by workstream 14: Data Layer.
import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import { API, WishlistPutSchema } from '../../src/contracts/api'
import { EntrySchema, type Dataset, type Entry, type WishlistItem } from '../../src/contracts/types'
import { createRepository, type Repository, type StorageMode } from '../../src/data/server/repository'

let active: Repository | null = null

/** The storage backend in use: the active repository once routes are registered, else what env asks for. */
export function storageMode(): StorageMode {
  if (active) return active.mode
  return process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'google-sheet' : 'seed'
}

function issues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

export async function sheetRoutes(app: FastifyInstance, opts: { repository?: Repository } = {}) {
  const repo = opts.repository ?? (await createRepository())
  active = repo

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    app.log.error(err)
    console.error(`[data] ${repo.mode} storage error: ${message}`)
    return { error: `Storage error: ${message}` }
  }

  app.get(API.data, async (_req, reply): Promise<Dataset | { error: string }> => {
    try {
      return await repo.getDataset()
    } catch (err) {
      return reply.code(502).send(fail(err))
    }
  })

  app.post(API.entries, async (req, reply): Promise<Entry | { error: string }> => {
    const body = EntrySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: `Invalid entry: ${issues(body.error)}` })
    try {
      return await repo.saveEntry(body.data)
    } catch (err) {
      return reply.code(502).send(fail(err))
    }
  })

  app.get(API.wishlist, async (_req, reply): Promise<WishlistItem[] | { error: string }> => {
    try {
      return await repo.getWishlist()
    } catch (err) {
      return reply.code(502).send(fail(err))
    }
  })

  app.put(API.wishlist, async (req, reply): Promise<WishlistItem[] | { error: string }> => {
    const body = WishlistPutSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: `Invalid wishlist: ${issues(body.error)}` })
    try {
      return await repo.putWishlist(body.data)
    } catch (err) {
      return reply.code(502).send(fail(err))
    }
  })
}
