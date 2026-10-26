/**
 * Phase 1 data migration (workstream 28): import the Phase 1 logs into one signed-in user's account.
 *
 * Sources, in Phase 1's own precedence order (an overlay entry replaces a seed entry with the same id):
 *   - `<data-dir>/store.json`, the Phase 1 overlay (`{ entries: Entry[], wishlist: WishlistItem[] | null }`)
 *     written by the 3D room's add-entry flow. Default data dir: `$DATA_DIR`, else `.data`.
 *   - `seed/reviews.json`, only with `--include-seed`. The seed rooms are invented demo data, so they are
 *     never imported unless asked for.
 *
 * Each entry goes through `saveEntryForUser` (server/db/dataset.ts), which finds or creates the venue
 * and game and writes the visit (keyed by `legacy_id` = the Phase 1 review id), the user's review,
 * the puzzles and the crew as guest names (so friends can claim them later). On top of that this
 * script sets the review visibility, copies `data:` image photos into `visit_photos`, and adds the
 * wish list items that are not there yet.
 *
 * Idempotent: an entry whose visit already exists is skipped (so edits made in the app survive a
 * re-run) unless `--update` is given. `--dry-run` reports what would happen and writes nothing.
 * Imported reviews are private unless `--visibility public|friends` is given.
 *
 * The user must have signed in once (with Google) so the account exists.
 *
 *   npx tsx scripts/migrate-phase1/index.ts --email you@example.com [--data-dir .data]
 *     [--include-seed] [--visibility private|friends|public] [--update] [--dry-run]
 *     [--self-name Brennan] [--no-wishlist] [--no-photos]
 *
 * With DATABASE_URL set it writes to that Postgres (for Railway, use the database's public URL);
 * otherwise to the local PGlite store in the data dir. Secrets are never printed.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatasetSchema, EntrySchema, WishlistItemSchema, type Entry, type Photo, type Room, type WishlistItem } from '../../src/contracts/types'
import type { Db } from '../../server/db/client'
import { saveEntryForUser } from '../../server/db/dataset'
import { reviews, users, visitPhotos, visits, wishlistItems, VISIBILITY } from '../../server/db/schema'

export type Visibility = (typeof VISIBILITY)[number]

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SEED_FILE = path.resolve(HERE, '../../seed/reviews.json')
/** Photos bigger than this are skipped (the app resizes new photos to well under 1 MB). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export class MigrationError extends Error {}

export interface MigrateOptions {
  /** The account to import into (case-insensitive). */
  email: string
  /** Folder holding the Phase 1 `store.json`. Default `$DATA_DIR`, else `<cwd>/.data`. */
  dataDir?: string
  /** Also import the invented seed rooms (seed/reviews.json). Default false. */
  includeSeed?: boolean
  seedFile?: string
  /** Visibility of the imported reviews. Default `private`. */
  visibility?: Visibility
  /** Re-import entries that were imported before (overwrites in-app edits). Default false. */
  update?: boolean
  /** Report only; write nothing. */
  dryRun?: boolean
  /** Extra crew names that mean "me" (dropped from the crew instead of becoming guests). */
  selfNames?: string[]
  /** Import the wish list. Default true. */
  wishlist?: boolean
  /** Copy `data:` image photos into visit_photos. Default true. */
  photos?: boolean
  log?: (line: string) => void
}

export type EntryAction = 'imported' | 'updated' | 'skipped' | 'failed'

export interface MigrateResult {
  userId: string
  /** New visits created (or that would be, in a dry run). */
  imported: number
  /** Existing visits overwritten (`update`). */
  updated: number
  /** Entries already imported earlier. */
  skipped: number
  /** Entries that could not be read or saved. */
  failed: number
  photos: { imported: number; skipped: number }
  wishlist: { added: number; skipped: number }
  entries: { legacyId: string; room: string; date: string; action: EntryAction; visitId?: string; error?: string }[]
  /** Problems reading the sources (invalid entries are listed here and skipped). */
  warnings: string[]
  dryRun: boolean
}

export interface Phase1Data {
  entries: Entry[]
  wishlist: WishlistItem[]
  warnings: string[]
  sources: string[]
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Read the Phase 1 data the way the Phase 1 server showed it: seed rooms and reviews (optional),
 * then the overlay's entries upserted over them by room id and review id. Invalid overlay entries
 * are reported in `warnings` and left out, so one bad entry doesn't block the rest.
 */
export async function readPhase1Data(opts: { dataDir?: string; includeSeed?: boolean; seedFile?: string } = {}): Promise<Phase1Data> {
  const warnings: string[] = []
  const sources: string[] = []
  const rooms = new Map<string, Room>()
  const reviewsById = new Map<string, Entry['review']>()
  let wishlist: WishlistItem[] | null = null

  if (opts.includeSeed) {
    const file = opts.seedFile ?? DEFAULT_SEED_FILE
    const seed = DatasetSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    for (const r of seed.rooms) rooms.set(r.id, r)
    for (const r of seed.reviews) reviewsById.set(r.id, r)
    wishlist = seed.wishlist
    sources.push(`seed (${seed.reviews.length} reviews)`)
  }

  const dataDir = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(process.cwd(), '.data'))
  const storeFile = path.join(dataDir, 'store.json')
  if (existsSync(storeFile)) {
    let raw: unknown
    try {
      raw = JSON.parse((await readFile(storeFile, 'utf8')) || '{}')
    } catch (err) {
      throw new MigrationError(`Could not read ${storeFile}: ${errMessage(err)}`)
    }
    const o = (raw && typeof raw === 'object' ? raw : {}) as { entries?: unknown; wishlist?: unknown }
    const rawEntries = Array.isArray(o.entries) ? o.entries : []
    let ok = 0
    rawEntries.forEach((e, i) => {
      const parsed = EntrySchema.safeParse(e)
      if (!parsed.success) {
        const id = (e as { review?: { id?: unknown } } | null)?.review?.id
        warnings.push(`store.json entry ${i}${typeof id === 'string' ? ` (${id})` : ''} is not a valid Phase 1 entry, skipped: ${parsed.error.issues[0]?.path.join('.') || ''} ${parsed.error.issues[0]?.message ?? ''}`.trim())
        return
      }
      ok++
      rooms.set(parsed.data.room.id, parsed.data.room)
      reviewsById.set(parsed.data.review.id, { ...parsed.data.review, roomId: parsed.data.room.id })
    })
    if (Array.isArray(o.wishlist)) {
      wishlist = []
      o.wishlist.forEach((w, i) => {
        const parsed = WishlistItemSchema.safeParse(w)
        if (parsed.success) wishlist!.push(parsed.data)
        else warnings.push(`store.json wish list item ${i} is invalid, skipped`)
      })
    }
    sources.push(`store.json (${ok} entries)`)
  } else if (!opts.includeSeed) {
    throw new MigrationError(`No Phase 1 data found: ${storeFile} does not exist. Pass --data-dir, or --include-seed to import the demo seed.`)
  }

  const entries: Entry[] = []
  for (const review of reviewsById.values()) {
    const room = rooms.get(review.roomId)
    if (!room) {
      warnings.push(`review ${review.id} points at unknown room ${review.roomId}, skipped`)
      continue
    }
    entries.push({ room, review })
  }
  entries.sort((a, b) => a.review.date.localeCompare(b.review.date) || a.review.id.localeCompare(b.review.id))
  return { entries, wishlist: wishlist ?? [], warnings, sources }
}

/** Decode a `data:image/...;base64,` URL. Null for anything else (http links, SVG, seed files). */
export function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)(?:;[a-z0-9=._-]+)*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(url)
  if (!m) return null
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase()
  // SVG can carry script, so it is never stored as a user photo.
  if (!PHOTO_MIME.has(mime)) return null
  const bytes = Uint8Array.from(Buffer.from(m[2].replace(/\s+/g, ''), 'base64'))
  return bytes.length ? { mime, bytes } : null
}

/** Width and height from a PNG, GIF or JPEG header (null when unknown). */
export function imageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (mime === 'image/png' && b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (mime === 'image/gif' && b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]
        const len = b.readUInt16BE(i + 2)
        // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

/** Lowercased names that mean the importing user: their Google name, display name, first names, and extras. */
export function selfNameSet(user: { name: string; displayName: string | null }, extra: string[] = []): Set<string> {
  const out = new Set<string>()
  for (const n of [user.name, user.displayName, ...extra]) {
    const t = n?.trim().toLowerCase()
    if (!t) continue
    out.add(t)
    const first = t.split(/\s+/)[0]
    if (first) out.add(first)
  }
  return out
}

export async function migratePhase1(db: Db, opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? (() => {})
  const email = opts.email?.trim()
  if (!email) throw new MigrationError('An --email is required: the account to import into.')
  const visibility = opts.visibility ?? 'private'
  if (!(VISIBILITY as readonly string[]).includes(visibility)) throw new MigrationError(`--visibility must be one of ${VISIBILITY.join(', ')}.`)

  const user = (
    await db
      .select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1)
  )[0]
  if (!user) throw new MigrationError('No account with that email. Sign in once with Google on the app first, then re-run.')

  const data = await readPhase1Data({ dataDir: opts.dataDir, includeSeed: opts.includeSeed, seedFile: opts.seedFile })
  log(`Read ${data.sources.join(' + ')}: ${data.entries.length} entries, ${data.wishlist.length} wish list items.`)
  for (const w of data.warnings) log(`warning: ${w}`)

  const result: MigrateResult = {
    userId: user.id,
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    photos: { imported: 0, skipped: 0 },
    wishlist: { added: 0, skipped: 0 },
    entries: [],
    warnings: data.warnings,
    dryRun: Boolean(opts.dryRun),
  }

  const legacyIds = data.entries.map((e) => e.review.id)
  const existing = new Map(
    legacyIds.length
      ? (
          await db
            .select({ id: visits.id, legacyId: visits.legacyId })
            .from(visits)
            .where(and(eq(visits.createdBy, user.id), inArray(visits.legacyId, legacyIds)))
        ).map((v) => [v.legacyId!, v.id])
      : [],
  )

  const selfNames = selfNameSet(user, opts.selfNames)
  // Room-level photos go on the earliest visit of that room.
  const firstOfRoom = new Map<string, string>()
  for (const e of data.entries) if (!firstOfRoom.has(e.room.id)) firstOfRoom.set(e.room.id, e.review.id)

  for (const entry of data.entries) {
    const { room, review } = entry
    const row: MigrateResult['entries'][number] = { legacyId: review.id, room: room.name, date: review.date, action: 'imported' }
    result.entries.push(row)
    const prior = existing.get(review.id)
    if (prior && !opts.update) {
      row.action = 'skipped'
      row.visitId = prior
      result.skipped++
      continue
    }
    row.action = prior ? 'updated' : 'imported'
    if (opts.dryRun) {
      if (prior) result.updated++
      else result.imported++
      continue
    }
    try {
      const crew = review.crew.filter((c) => c.trim() && !selfNames.has(c.trim().toLowerCase()))
      const saved = await saveEntryForUser(db, user.id, { room, review: { ...review, crew } })
      const visitId = saved.review.id
      row.visitId = visitId
      await db.update(reviews).set({ visibility }).where(and(eq(reviews.visitId, visitId), eq(reviews.authorId, user.id)))
      if (prior) result.updated++
      else result.imported++

      if (opts.photos !== false && !prior) {
        const photos: Photo[] = [...review.photos, ...(firstOfRoom.get(room.id) === review.id ? room.photos : [])]
        const seen = new Set<string>()
        for (const p of photos) {
          if (seen.has(p.url)) continue
          seen.add(p.url)
          const decoded = decodeDataUrl(p.url)
          if (!decoded || decoded.bytes.length > MAX_PHOTO_BYTES) {
            result.photos.skipped++
            continue
          }
          const size = imageSize(decoded.bytes, decoded.mime)
          await db.insert(visitPhotos).values({
            visitId,
            uploaderId: user.id,
            mime: decoded.mime,
            bytes: decoded.bytes,
            sizeBytes: decoded.bytes.length,
            width: size?.width ?? null,
            height: size?.height ?? null,
            caption: (p.caption ?? '').slice(0, 300),
          })
          result.photos.imported++
        }
      }
    } catch (err) {
      row.action = 'failed'
      row.error = errMessage(err)
      result.failed++
      log(`failed: ${review.id} (${room.name}, ${review.date}): ${row.error}`)
    }
  }

  if (opts.wishlist !== false && data.wishlist.length) {
    const key = (name: string, city: string) => `${name.trim().toLowerCase()}|${city.trim().toLowerCase()}`
    const have = new Set((await db.select({ name: wishlistItems.name, city: wishlistItems.city }).from(wishlistItems).where(eq(wishlistItems.userId, user.id))).map((w) => key(w.name, w.city)))
    const toAdd: WishlistItem[] = []
    for (const w of data.wishlist) {
      const k = key(w.name, w.city)
      if (have.has(k)) {
        result.wishlist.skipped++
        continue
      }
      have.add(k)
      toAdd.push(w)
    }
    result.wishlist.added = toAdd.length
    if (toAdd.length && !opts.dryRun) {
      // Fresh ids: Phase 1 ids are not unique across accounts.
      await db.insert(wishlistItems).values(toAdd.map((w) => ({ userId: user.id, name: w.name, city: w.city, link: w.link, addedBy: w.addedBy, priority: w.priority, done: w.done })))
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliArgs extends Omit<MigrateOptions, 'log'> {
  help?: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { email: '', selfNames: [] }
  const value = (i: number, flag: string) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new MigrationError(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const take = () => (inline !== undefined ? inline : value(i++, flag))
    switch (flag) {
      case '--email': out.email = take(); break
      case '--data-dir': out.dataDir = take(); break
      case '--seed-file': out.seedFile = take(); break
      case '--visibility': out.visibility = take() as Visibility; break
      case '--self-name': out.selfNames!.push(take()); break
      case '--include-seed': out.includeSeed = true; break
      case '--update': out.update = true; break
      case '--dry-run': out.dryRun = true; break
      case '--no-wishlist': out.wishlist = false; break
      case '--no-photos': out.photos = false; break
      case '-h': case '--help': out.help = true; break
      default: throw new MigrationError(`Unknown option ${a}. Run with --help.`)
    }
  }
  return out
}

export const USAGE = `Import Phase 1 logs into a My Escapes account.

  npx tsx scripts/migrate-phase1/index.ts --email you@example.com [options]

  --data-dir DIR        folder with the Phase 1 store.json (default $DATA_DIR or .data)
  --include-seed        also import the invented demo rooms in seed/reviews.json
  --visibility V        private (default), friends or public
  --self-name NAME      a crew name that means you (repeatable); your Google first name is automatic
  --update              overwrite visits imported earlier (default: skip them)
  --dry-run             report only, write nothing
  --no-wishlist         don't import the wish list
  --no-photos           don't copy photos
Writes to DATABASE_URL when set, otherwise to the local PGlite store.`

export function formatSummary(r: MigrateResult): string {
  const lines = [
    `${r.dryRun ? '[dry run] would import' : 'Imported'} ${r.imported} visit(s), ${r.dryRun ? 'would update' : 'updated'} ${r.updated}, skipped ${r.skipped} already imported, ${r.failed} failed.`,
    `Photos: ${r.photos.imported} copied, ${r.photos.skipped} skipped (only data: JPEG/PNG/WebP/GIF images are copied). Wish list: ${r.wishlist.added} added, ${r.wishlist.skipped} already there.`,
  ]
  for (const e of r.entries) lines.push(`  ${e.action.padEnd(8)} ${e.date}  ${e.room}${e.error ? `  (${e.error})` : ''}`)
  return lines.join('\n')
}

async function main() {
  await import('../../server/env')
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(errMessage(err))
    process.exitCode = 2
    return
  }
  if (args.help || !args.email) {
    console.log(USAGE)
    if (!args.help) process.exitCode = 2
    return
  }
  const { createDb } = await import('../../server/db/client')
  const { runMigrations } = await import('../../server/db/migrate')
  // Same folder for the local PGlite store and the Phase 1 store.json, unless DATABASE_URL is set.
  const dataDir = path.resolve(args.dataDir || process.env.DATA_DIR || path.join(process.cwd(), '.data'))
  console.log(`[migrate-phase1] Target: ${process.env.DATABASE_URL ? 'Postgres (DATABASE_URL)' : `local PGlite store in ${dataDir}`}`)
  const handle = await createDb(process.env.DATABASE_URL ? {} : { pgliteDir: path.join(dataDir, 'pglite') })
  try {
    await runMigrations(handle, { timeoutMs: 120_000 })
    const result = await migratePhase1(handle.db, { ...args, dataDir, log: (l) => console.log(`[migrate-phase1] ${l}`) })
    console.log(formatSummary(result))
    if (result.failed) process.exitCode = 1
  } catch (err) {
    console.error(`[migrate-phase1] ${errMessage(err)}`)
    process.exitCode = 1
  } finally {
    await handle.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
