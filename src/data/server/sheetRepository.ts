/**
 * Google Sheet adapter. Tabs: Rooms, Reviews, Puzzles, Wishlist, Crew (see
 * sheetMapping.ts for the columns). Missing tabs and header rows are created on
 * connect; missing columns are appended to an existing header row.
 */
import { z } from 'zod'
import { WishlistItemSchema, type CrewMember, type Dataset, type Entry, type WishlistItem } from '../../contracts/types'
import { mergeCrew, normalizeEntry, type Repository } from './repository'
import {
  TABS,
  TAB_NAMES,
  crewToRecord,
  entryToRecords,
  recordToRow,
  str,
  valuesToDataset,
  wishlistToRecord,
  type Row,
  type RowRecord,
  type TabName,
  type TabValues,
} from './sheetMapping'
import { SheetsApi, a1, serviceAccountTokenProvider, type FetchLike } from './sheetsApi'

export interface SheetRepositoryOptions {
  sheetId: string
  /** Raw service-account JSON or a path to the key file. Ignored when `getToken` is given. */
  serviceAccountJson?: string
  getToken?: () => Promise<string>
  fetchImpl?: FetchLike
}

/** Row numbers (1-based, header is row 1) of every id in a tab. */
export function idRows(values: Row[]): Map<string, number> {
  const out = new Map<string, number>()
  if (values.length === 0) return out
  const col = values[0].findIndex((h) => str(h) === 'id')
  if (col === -1) return out
  values.slice(1).forEach((row, i) => {
    const id = str(row[col])
    if (id && !out.has(id)) out.set(id, i + 2)
  })
  return out
}

export class SheetRepository implements Repository {
  readonly mode = 'google-sheet' as const
  private headers: Record<TabName, string[]> = { ...TABS } as unknown as Record<TabName, string[]>
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(private readonly api: SheetsApi) {}

  /** Connects, creates missing tabs/headers and does a test read. Throws on any failure. */
  static async connect(opts: SheetRepositoryOptions): Promise<SheetRepository> {
    const getToken = opts.getToken ?? serviceAccountTokenProvider(opts.serviceAccountJson ?? '')
    const repo = new SheetRepository(new SheetsApi(opts.sheetId, getToken, opts.fetchImpl))
    await repo.ensureTabs()
    await repo.getDataset()
    return repo
  }

  private async ensureTabs(): Promise<void> {
    const existing = new Set(await this.api.tabTitles())
    await this.api.addTabs(TAB_NAMES.filter((t) => !existing.has(t)))
    const firstRows = await this.api.batchGet(TAB_NAMES.map((t) => a1(t, '1:1')))
    for (const [i, tab] of TAB_NAMES.entries()) {
      const current = (firstRows[i][0] ?? []).map((h) => str(h))
      while (current.length && !current[current.length - 1]) current.pop()
      const missing = TABS[tab].filter((h) => !current.includes(h))
      const headers = [...current, ...missing]
      if (missing.length) await this.api.update(a1(tab, 'A1'), [headers])
      this.headers[tab] = headers
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async readTabs(tabs: readonly TabName[]): Promise<TabValues> {
    const values = await this.api.batchGet(tabs.map((t) => a1(t)))
    const out: TabValues = {}
    tabs.forEach((t, i) => (out[t] = values[i]))
    return out
  }

  async getDataset(): Promise<Dataset> {
    const { dataset, skipped } = valuesToDataset(await this.readTabs(TAB_NAMES))
    if (skipped.length) console.warn(`[data] Skipped invalid sheet rows: ${skipped.join(', ')}`)
    return { ...dataset, crew: mergeCrew(dataset.crew, dataset.reviews) }
  }

  /** Updates rows whose id already exists and appends the rest. */
  private async upsert(tab: TabName, values: Row[], recs: RowRecord[]): Promise<void> {
    const rows = idRows(values)
    const headers = this.headers[tab]
    const append: Row[] = []
    for (const rec of recs) {
      const row = recordToRow(headers, rec)
      const n = rows.get(String(rec.id))
      if (n) await this.api.update(a1(tab, `A${n}`), [row])
      else append.push(row)
    }
    await this.api.append(a1(tab, 'A1'), append)
  }

  saveEntry(entry: Entry): Promise<Entry> {
    const saved = normalizeEntry(entry)
    return this.serial(async () => {
      const tabs = await this.readTabs(['Rooms', 'Reviews', 'Puzzles', 'Crew'])
      const recs = entryToRecords(saved)
      await this.upsert('Rooms', tabs.Rooms ?? [], recs.Rooms)
      await this.upsert('Reviews', tabs.Reviews ?? [], recs.Reviews)

      // Puzzles: clear rows of this review's puzzles that are no longer present, then upsert.
      const puzzles = tabs.Puzzles ?? []
      const keep = new Set(saved.review.puzzles.map((p) => p.id))
      const h = (puzzles[0] ?? []).map((c) => str(c))
      const idCol = h.indexOf('id'), reviewCol = h.indexOf('reviewId')
      if (idCol !== -1 && reviewCol !== -1) {
        for (const [i, row] of puzzles.slice(1).entries()) {
          if (str(row[reviewCol]) === saved.review.id && !keep.has(str(row[idCol]))) await this.api.clear(a1('Puzzles', `${i + 2}:${i + 2}`))
        }
      }
      await this.upsert('Puzzles', puzzles, recs.Puzzles)

      // New crew names get a Crew row.
      const { dataset } = valuesToDataset({ Crew: tabs.Crew })
      const merged = mergeCrew(dataset.crew, [saved.review])
      const added: CrewMember[] = merged.slice(dataset.crew.length)
      await this.api.append(a1('Crew', 'A1'), added.map((c) => recordToRow(this.headers.Crew, crewToRecord(c))))
      return saved
    })
  }

  async getWishlist(): Promise<WishlistItem[]> {
    return valuesToDataset(await this.readTabs(['Wishlist'])).dataset.wishlist
  }

  putWishlist(items: WishlistItem[]): Promise<WishlistItem[]> {
    const list = z.array(WishlistItemSchema).parse(items)
    return this.serial(async () => {
      const headers = this.headers.Wishlist
      await this.api.clear(a1('Wishlist'))
      await this.api.update(a1('Wishlist', 'A1'), [headers, ...list.map((w) => recordToRow(headers, wishlistToRecord(w)))])
      return list
    })
  }
}
