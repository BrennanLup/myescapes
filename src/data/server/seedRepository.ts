/**
 * Seed adapter: read-only seed/reviews.json plus a writable overlay at
 * `<DATA_DIR>/store.json` (default `.data/store.json`, gitignored).
 *
 * Overlay shape: { entries: Entry[], wishlist: WishlistItem[] | null }.
 * Entries are upserted over the seed by room id / review id; a non-null overlay
 * wishlist replaces the seed wishlist. Writes are serialized and atomic (tmp + rename).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DatasetSchema, EntrySchema, WishlistItemSchema, type Dataset, type Entry, type WishlistItem } from '../../contracts/types'
import { mergeCrew, normalizeEntry, upsertById, type Repository } from './repository'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SEED_PATH = path.resolve(here, '../../../seed/reviews.json')

const OverlaySchema = z.object({
  entries: z.array(EntrySchema).default([]),
  wishlist: z.array(WishlistItemSchema).nullable().default(null),
})
type Overlay = z.infer<typeof OverlaySchema>

/** The overlay keeps at most this many entries (the newest); older demo saves drop off. */
export const MAX_OVERLAY_ENTRIES = 100

let seedCache: { file: string; data: Dataset } | null = null

export async function loadSeed(file = DEFAULT_SEED_PATH): Promise<Dataset> {
  if (seedCache?.file === file) return structuredClone(seedCache.data)
  const data = DatasetSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  seedCache = { file, data }
  return structuredClone(data)
}

export class SeedRepository implements Repository {
  readonly mode = 'seed' as const
  private readonly storeFile: string
  private readonly seedFile: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(opts: { dataDir?: string; seedFile?: string } = {}) {
    const dir = path.resolve(opts.dataDir || path.join(process.cwd(), '.data'))
    this.storeFile = path.join(dir, 'store.json')
    this.seedFile = opts.seedFile ?? DEFAULT_SEED_PATH
  }

  private async readOverlay(): Promise<Overlay> {
    let raw: string
    try {
      raw = await readFile(this.storeFile, 'utf8')
    } catch {
      return { entries: [], wishlist: null }
    }
    const parsed = OverlaySchema.safeParse(JSON.parse(raw || '{}'))
    if (!parsed.success) {
      console.warn(`[data] Ignoring unreadable overlay ${this.storeFile}: ${parsed.error.message}`)
      return { entries: [], wishlist: null }
    }
    return parsed.data
  }

  private async writeOverlay(o: Overlay): Promise<void> {
    await mkdir(path.dirname(this.storeFile), { recursive: true })
    const tmp = `${this.storeFile}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(o, null, 2))
    await rename(tmp, this.storeFile)
  }

  /** Runs read-modify-write operations one at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  async getDataset(): Promise<Dataset> {
    const [seed, overlay] = await Promise.all([loadSeed(this.seedFile), this.readOverlay()])
    let rooms = seed.rooms
    let reviews = seed.reviews
    for (const e of overlay.entries) {
      rooms = upsertById(rooms, e.room)
      reviews = upsertById(reviews, e.review)
    }
    return {
      source: 'seed',
      rooms,
      reviews,
      wishlist: overlay.wishlist ?? seed.wishlist,
      crew: mergeCrew(seed.crew, reviews),
    }
  }

  /**
   * The overlay is shared by every signed-out visitor of this (local or test) server, so a voice
   * transcript is never stored in it, only returned to the caller (/privacy: voice notes and transcripts are visible only to you),
   * and only the newest MAX_OVERLAY_ENTRIES entries are kept.
   */
  saveEntry(entry: Entry): Promise<Entry> {
    const normalized = normalizeEntry(entry)
    // The caller gets its own transcript back; the shared file never holds it.
    const saved: Entry = { ...normalized, review: { ...normalized.review, voiceTranscript: '' } }
    return this.serial(async () => {
      const o = await this.readOverlay()
      const others = o.entries.filter((e) => e.review.id !== saved.review.id)
      // Keep the room in sync for earlier overlay entries of the same room.
      const entries = [...others.map((e) => (e.room.id === saved.room.id ? { ...e, room: saved.room } : e)), saved].slice(-MAX_OVERLAY_ENTRIES)
      await this.writeOverlay({ ...o, entries })
      return normalized
    })
  }

  async getWishlist(): Promise<WishlistItem[]> {
    return (await this.getDataset()).wishlist
  }

  putWishlist(items: WishlistItem[]): Promise<WishlistItem[]> {
    const list = z.array(WishlistItemSchema).parse(items)
    return this.serial(async () => {
      const o = await this.readOverlay()
      await this.writeOverlay({ ...o, wishlist: list })
      return list
    })
  }
}
