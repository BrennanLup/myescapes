/**
 * Server-side storage. One interface, two adapters:
 *  - seed:         seed/reviews.json + a JSON overlay in DATA_DIR (default `.data/`)
 *  - google-sheet: a Google Sheet via the Sheets REST v4 API
 *
 * `createRepository()` picks the Google Sheet when GOOGLE_SHEET_ID and
 * GOOGLE_SERVICE_ACCOUNT_JSON are set and the sheet answers; otherwise (or on
 * any startup error) it logs a warning and falls back to the seed adapter.
 */
import type { CrewMember, Dataset, Entry, Review, WishlistItem } from '../../contracts/types'
import { EntrySchema } from '../../contracts/types'

export type StorageMode = Dataset['source']

export interface Repository {
  readonly mode: StorageMode
  getDataset(): Promise<Dataset>
  /** Saves (upserts) a room + review. Returns the normalized saved entry. */
  saveEntry(entry: Entry): Promise<Entry>
  getWishlist(): Promise<WishlistItem[]>
  /** Replaces the whole wishlist. Returns the saved list. */
  putWishlist(items: WishlistItem[]): Promise<WishlistItem[]>
}

/**
 * Normalizes an entry before saving: schema defaults applied, the review points
 * at the room and every puzzle points at the review.
 */
export function normalizeEntry(input: Entry): Entry {
  const { room, review } = EntrySchema.parse(input)
  const fixed: Review = {
    ...review,
    roomId: room.id,
    puzzles: review.puzzles.map((p) => ({ ...p, reviewId: review.id })),
  }
  return { room, review: fixed }
}

/** Crew list plus any names that appear in reviews but are not in the list yet. */
export function mergeCrew(crew: CrewMember[], reviews: Review[]): CrewMember[] {
  const out = [...crew]
  const known = new Set(crew.map((c) => c.name.trim().toLowerCase()))
  for (const r of reviews) {
    for (const raw of r.crew) {
      const name = raw.trim()
      if (!name || known.has(name.toLowerCase())) continue
      known.add(name.toLowerCase())
      out.push({ id: `crew_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name })
    }
  }
  return out
}

/** Upsert by id, keeping order (existing items are replaced in place). */
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = [...list]
  next[i] = item
  return next
}

export async function createRepository(env: NodeJS.ProcessEnv = process.env): Promise<Repository> {
  const { SeedRepository } = await import('./seedRepository')
  if (env.GOOGLE_SHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const { SheetRepository } = await import('./sheetRepository')
      const repo = await SheetRepository.connect({
        sheetId: env.GOOGLE_SHEET_ID,
        serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
      })
      console.log('[data] Using Google Sheet storage')
      return repo
    } catch (err) {
      console.warn(
        `[data] WARNING: Google Sheet storage failed to start (${err instanceof Error ? err.message : String(err)}). ` +
          'Falling back to seed storage (seed/reviews.json + local overlay).',
      )
    }
  }
  return new SeedRepository({ dataDir: env.DATA_DIR })
}
