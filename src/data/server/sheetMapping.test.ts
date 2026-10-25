// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatasetSchema, type Dataset, type Entry } from '@/contracts/types'
import {
  TABS,
  bool,
  datasetToValues,
  isoDate,
  list,
  photos,
  photosCell,
  recordToReview,
  recordToRoom,
  recordToRow,
  reviewToRecord,
  roomToRecord,
  rowToRecord,
  valuesToDataset,
  type Row,
} from './sheetMapping'
import { SheetRepository, idRows } from './sheetRepository'
import type { FetchLike } from './sheetsApi'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const seed: Dataset = DatasetSchema.parse(JSON.parse(readFileSync(path.join(root, 'seed/reviews.json'), 'utf8')))

/** Sheets stores RAW values; simulate the trip through JSON. */
const viaSheet = (rows: Row[]): Row[] => JSON.parse(JSON.stringify(rows))

describe('sheet row mapping', () => {
  it('round-trips the whole seed dataset', () => {
    const values = datasetToValues(seed)
    expect(values.Rooms[0]).toEqual([...TABS.Rooms])
    const { dataset, skipped } = valuesToDataset({
      Rooms: viaSheet(values.Rooms),
      Reviews: viaSheet(values.Reviews),
      Puzzles: viaSheet(values.Puzzles),
      Wishlist: viaSheet(values.Wishlist),
      Crew: viaSheet(values.Crew),
    })
    expect(skipped).toEqual([])
    expect(dataset).toEqual({ ...seed, source: 'google-sheet' })
  })

  it('round-trips a room and review record', () => {
    const room = seed.rooms[0]
    const review = seed.reviews[0]
    const roomRow = recordToRow(TABS.Rooms, roomToRecord(room))
    expect(recordToRoom(rowToRecord(TABS.Rooms, roomRow))).toEqual(room)
    const revRow = recordToRow(TABS.Reviews, reviewToRecord(review))
    expect(recordToReview(rowToRecord(TABS.Reviews, revRow), review.puzzles)).toEqual(review)
  })

  it('matches columns by header name, in any order, ignoring extra columns', () => {
    const headers: string[] = [...[...TABS.Rooms].reverse(), 'notes']
    const row = recordToRow(headers, { ...roomToRecord(seed.rooms[1]), notes: 'hi' })
    const { dataset } = valuesToDataset({ Rooms: [headers, row, ['', '', '']] })
    expect(dataset.rooms).toEqual([seed.rooms[1]])
  })

  it('reads hand-typed cells leniently', () => {
    expect(bool('TRUE')).toBe(true)
    expect(bool('yes')).toBe(true)
    expect(bool('')).toBe(false)
    expect(bool(0)).toBe(false)
    expect(list('Maya, Jules; Theo')).toEqual(['Maya', 'Jules', 'Theo'])
    expect(list('["a, b","c"]')).toEqual(['a, b', 'c'])
    expect(photos('/a.svg\n/b.svg')).toEqual([{ url: '/a.svg' }, { url: '/b.svg' }])
    expect(isoDate(45366)).toBe('2024-03-15')
    expect(isoDate('2024-3-5')).toBe('2024-03-05')
    expect(recordToRoom({ id: 'r', name: 'N', company: 'C', city: 'X', genre: 'Romance' })?.genre).toBe('other')
  })

  it('skips invalid rows and reports them', () => {
    const { dataset, skipped } = valuesToDataset({ Reviews: [[...TABS.Reviews], ['rev1', 'room1', 'not-a-date']] })
    expect(dataset.reviews).toEqual([])
    expect(skipped).toEqual(['Reviews row 2'])
  })

  it('drops inline data: photos that would overflow a cell', () => {
    const big = [{ url: 'data:image/png;base64,' + 'A'.repeat(60_000) }, { url: '/x.svg' }]
    expect(JSON.parse(photosCell(big))).toEqual([{ url: '/x.svg' }])
  })

  it('finds id row numbers', () => {
    expect(idRows([['name', 'id'], ['a', 'x'], [], ['b', 'y']])).toEqual(new Map([['x', 2], ['y', 4]]))
  })
})

// ---------------------------------------------------------------------------
// SheetRepository against an in-memory fake of the Sheets REST API
// ---------------------------------------------------------------------------

function fakeSheets() {
  const tabs = new Map<string, Row[]>()
  const calls: string[] = []
  const parse = (range: string) => {
    const m = /^'(.+)'(?:!(.+))?$/.exec(range)!
    const tab = m[1].replace(/''/g, "'")
    const sub = m[2]
    const rowMatch = sub ? /^[A-Z]*(\d+)(?::[A-Z]*(\d+))?$/.exec(sub) : null
    return { tab, from: rowMatch ? Number(rowMatch[1]) : 1, to: rowMatch?.[2] ? Number(rowMatch[2]) : rowMatch && sub === `${rowMatch[1]}:${rowMatch[1]}` ? Number(rowMatch[1]) : undefined }
  }
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    const p = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''))
    calls.push(`${method} ${p}`)
    const ok = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) })
    if (method === 'GET' && p === '') return ok({ sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) })
    if (p === ':batchUpdate') {
      for (const r of body.requests) tabs.set(r.addSheet.properties.title, [])
      return ok({})
    }
    if (p === '/values:batchGet') {
      const valueRanges = u.searchParams.getAll('ranges').map((r) => {
        const { tab, from, to } = parse(r)
        const rows = tabs.get(tab) ?? []
        const slice = rows.slice(from - 1, to)
        return { range: r, values: slice.length ? slice : undefined }
      })
      return ok({ valueRanges })
    }
    const m = /^\/values\/(.+?)(:append|:clear)?$/.exec(p)!
    const { tab, from, to } = parse(m[1])
    const rows = tabs.get(tab)!
    if (m[2] === ':append') rows.push(...body.values)
    else if (m[2] === ':clear') {
      const end = to ?? rows.length
      for (let i = from - 1; i < end; i++) if (rows[i]) rows[i] = []
      if (to === undefined && from === 1) rows.length = 0
    } else body.values.forEach((row: Row, i: number) => (rows[from - 1 + i] = row))
    return ok({})
  }
  return { tabs, calls, fetchImpl }
}

describe('SheetRepository (fake Sheets API)', () => {
  const connect = (fake: ReturnType<typeof fakeSheets>) =>
    SheetRepository.connect({ sheetId: 'sheet123', getToken: async () => 'tok', fetchImpl: fake.fetchImpl })

  it('creates missing tabs and header rows on connect', async () => {
    const fake = fakeSheets()
    fake.tabs.set('Rooms', [['id', 'name']])
    const repo = await connect(fake)
    expect(repo.mode).toBe('google-sheet')
    expect([...fake.tabs.keys()].sort()).toEqual(['Crew', 'Puzzles', 'Reviews', 'Rooms', 'Wishlist'])
    expect(fake.tabs.get('Reviews')![0]).toEqual([...TABS.Reviews])
    expect(fake.tabs.get('Rooms')![0]).toEqual([...TABS.Rooms])
    expect((await repo.getDataset()).rooms).toEqual([])
  })

  it('appends new entries, upserts existing ones and rewrites the wishlist', async () => {
    const fake = fakeSheets()
    const repo = await connect(fake)
    const entry: Entry = { room: seed.rooms[2], review: seed.reviews[2] }
    await repo.saveEntry(entry)
    await repo.saveEntry({ room: seed.rooms[3], review: seed.reviews[3] })
    let d = await repo.getDataset()
    expect(d.rooms).toEqual([seed.rooms[2], seed.rooms[3]])
    expect(d.reviews).toEqual([seed.reviews[2], seed.reviews[3]])
    expect(d.crew.map((c) => c.name).sort()).toEqual(['Brennan', 'Jules', 'Maya', 'Priya', 'Theo'])

    // Re-save with one puzzle removed and a renamed room: rows are updated, not duplicated.
    const edited: Entry = {
      room: { ...entry.room, name: 'Europa (remastered)' },
      review: { ...entry.review, puzzles: entry.review.puzzles.slice(1) },
    }
    await repo.saveEntry(edited)
    d = await repo.getDataset()
    expect(d.rooms).toHaveLength(2)
    expect(d.rooms[0].name).toBe('Europa (remastered)')
    expect(d.reviews[0].puzzles).toEqual(entry.review.puzzles.slice(1))
    expect(d.crew).toHaveLength(5)

    await repo.putWishlist(seed.wishlist)
    expect(await repo.getWishlist()).toEqual(seed.wishlist)
    await repo.putWishlist(seed.wishlist.slice(0, 2))
    expect(await repo.getWishlist()).toEqual(seed.wishlist.slice(0, 2))
    expect(fake.tabs.get('Wishlist')).toHaveLength(3)
  })

  it('connect throws on API errors (so the caller can fall back to seed)', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '{"error":{"message":"no access"}}' })
    await expect(SheetRepository.connect({ sheetId: 's', getToken: async () => 't', fetchImpl })).rejects.toThrow(/403.*no access/)
  })
})
