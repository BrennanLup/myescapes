/**
 * Phase 1 repository interface, now used only for the signed-out seed demo
 * (seed/reviews.json + a JSON overlay in DATA_DIR, default `.data/`).
 * Signed-in users' data lives in Postgres (server/db). The Google Sheet adapter was removed in Phase 2.
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

const seedRepos = new Map<string, Promise<Repository>>()

/**
 * The shared seed-demo repository for a DATA_DIR. One instance per folder, so every route
 * writes through the same serialized queue (the overlay is a single file).
 */
export function seedRepositoryFor(dataDir: string | undefined = process.env.DATA_DIR): Promise<Repository> {
  const key = dataDir || ''
  let repo = seedRepos.get(key)
  if (!repo) {
    repo = import('./seedRepository').then(({ SeedRepository }) => new SeedRepository({ dataDir: dataDir || undefined }))
    seedRepos.set(key, repo)
  }
  return repo
}
