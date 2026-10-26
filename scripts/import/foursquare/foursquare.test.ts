// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Region } from '../types'
import {
  CATEGORY_COLUMN,
  FSQ_REGIONS,
  categoriesAllowNameMatch,
  httpParquetSource,
  inBbox,
  isEscapeRoom,
  nameLooksLikeEscapeRoom,
  regionForPlace,
  retryingFetch,
  rowGroupMayMatch,
  rowToRawPlace,
  scanFile,
  scanFoursquare,
  type FsqRow,
  type ParquetFileReader,
  type ParquetSource,
} from './index'

const ESCAPE = '5f2c2834b6d05514c704451e'
const BAR = '4bf58dd8d48988d116941735'

const US: Region = { id: 'us', name: 'United States', country: 'US' }
const LONDON: Region = { id: 'gb-london', name: 'London', country: 'GB', bbox: [51.28, -0.51, 51.69, 0.33] }

function row(over: Partial<FsqRow> = {}): FsqRow {
  return {
    fsq_place_id: 'abc123',
    name: 'Locked Inn Escape Rooms',
    latitude: 34.19,
    longitude: -79.81,
    address: '214A Dozier Blvd',
    locality: 'Florence',
    region: 'SC',
    postcode: '29501',
    country: 'US',
    tel: '(843) 621-8942',
    website: 'http://www.lockedinnsc.com',
    date_closed: null,
    date_refreshed: '2024-10-01',
    fsq_category_ids: [ESCAPE],
    fsq_category_labels: ['Arts and Entertainment > Escape Room'],
    ...over,
  }
}

/** A fake Parquet file: rows split into row groups of `size`, with footer-like stats. Records reads. */
function fakeFile(rows: FsqRow[], size = 3): ParquetFileReader & { reads: { columns: string[]; rowStart: number; rowEnd: number }[] } {
  const reads: { columns: string[]; rowStart: number; rowEnd: number }[] = []
  const rowGroups = []
  for (let s = 0; s < rows.length; s += size) {
    const g = rows.slice(s, s + size)
    const countries = g.map((r) => String(r.country)).sort()
    const lats = g.map((r) => Number(r.latitude))
    const lngs = g.map((r) => Number(r.longitude))
    rowGroups.push({
      rowStart: s, rowEnd: s + g.length, countryMin: countries[0], countryMax: countries[countries.length - 1],
      latMin: Math.min(...lats), latMax: Math.max(...lats), lngMin: Math.min(...lngs), lngMax: Math.max(...lngs),
    })
  }
  return {
    rowGroups,
    reads,
    async read(columns, rowStart, rowEnd) {
      reads.push({ columns: [...columns], rowStart, rowEnd })
      return rows.slice(rowStart, rowEnd).map((r) => Object.fromEntries(columns.map((c) => [c, (r as Record<string, unknown>)[c] ?? null])))
    },
  }
}

describe('category and name rules', () => {
  it('matches the escape room category id or label', () => {
    expect(isEscapeRoom([BAR, ESCAPE])).toBe(true)
    expect(isEscapeRoom([BAR])).toBe(false)
    expect(isEscapeRoom(null, ['Arts and Entertainment > Escape Room'])).toBe(true)
    expect(isEscapeRoom(undefined, ['Retail > Escape Room Supplies'])).toBe(false)
  })

  it('matches escape-room names in several languages, and not lookalikes', () => {
    for (const n of ['Riddles Escape Room', 'The Escape Game Nashville', 'Escapology', 'EXIT Games Berlin', 'Puzzle Room Sydney', '방탈출 카페 키이스케이프', 'リアル脱出ゲーム 渋谷', '密室逃脱', 'Escape-Rooms Hamburg', "Salle d'évasion Paris"]) {
      expect(nameLooksLikeEscapeRoom(n), n).toBe(true)
    }
    for (const n of ['Great Escape Pub', 'Escape Travel', 'Room 101', 'Escapade Bakery', null]) {
      expect(nameLooksLikeEscapeRoom(n), String(n)).toBe(false)
    }
  })

  it('drops name matches whose categories all rule them out', () => {
    expect(categoriesAllowNameMatch(['Dining and Drinking > Bar'])).toBe(false)
    expect(categoriesAllowNameMatch(['Dining and Drinking > Bar', 'Arts and Entertainment > Arcade'])).toBe(true)
    expect(categoriesAllowNameMatch([])).toBe(true)
    expect(categoriesAllowNameMatch(null)).toBe(true)
  })
})

describe('rowToRawPlace', () => {
  it('maps the Foursquare columns', () => {
    const p = rowToRawPlace(row())!
    expect(p).toMatchObject({
      source: 'foursquare', sourceId: 'abc123', name: 'Locked Inn Escape Rooms', address: '214A Dozier Blvd', city: 'Florence', region: 'SC',
      country: 'US', postalCode: '29501', lat: 34.19, lng: -79.81, website: 'http://www.lockedinnsc.com', phone: '(843) 621-8942', license: 'Apache-2.0',
    })
    expect(p.raw.date_refreshed).toBe('2024-10-01')
    expect(p.raw).not.toHaveProperty('fsq_category_ids')
  })

  it('falls back to post_town and admin_region, and squashes whitespace', () => {
    const p = rowToRawPlace(row({ locality: null, post_town: 'London', region: null, admin_region: 'England', name: '  Clue   HQ ' }))!
    expect(p.city).toBe('London')
    expect(p.region).toBe('England')
    expect(p.name).toBe('Clue HQ')
  })

  it('rejects closed, nameless or country-less rows and bad coordinates', () => {
    expect(rowToRawPlace(row({ date_closed: '2023-01-01' }))).toBeNull()
    expect(rowToRawPlace(row({ name: '  ' }))).toBeNull()
    expect(rowToRawPlace(row({ country: 'USA' }))).toBeNull()
    expect(rowToRawPlace(row({ fsq_place_id: null }))).toBeNull()
    expect(rowToRawPlace(row({ latitude: 123 }))!.lat).toBeNull()
  })
})

describe('regions', () => {
  it('assigns places to country and city regions', () => {
    expect(inBbox(51.5, -0.12, LONDON.bbox!)).toBe(true)
    expect(inBbox(null, -0.12, LONDON.bbox!)).toBe(false)
    expect(regionForPlace({ country: 'US', lat: 1, lng: 1 }, [US, LONDON])?.id).toBe('us')
    expect(regionForPlace({ country: 'GB', lat: 51.5, lng: -0.12 }, [US, LONDON])?.id).toBe('gb-london')
    expect(regionForPlace({ country: 'GB', lat: 53.48, lng: -2.24 }, [US, LONDON])).toBeNull()
    // A London-shaped box in another country does not count.
    expect(regionForPlace({ country: 'FR', lat: 51.5, lng: -0.12 }, [LONDON])).toBeNull()
  })

  it('skips row groups by country and bbox statistics', () => {
    expect(rowGroupMayMatch({ rowStart: 0, rowEnd: 1, countryMin: 'UM', countryMax: 'US' }, [US])).toBe(true)
    expect(rowGroupMayMatch({ rowStart: 0, rowEnd: 1, countryMin: 'BM', countryMax: 'BM' }, [US])).toBe(false)
    expect(rowGroupMayMatch({ rowStart: 0, rowEnd: 1, countryMin: 'GB', countryMax: 'GB', latMin: 53, latMax: 54, lngMin: -3, lngMax: -2 }, [LONDON])).toBe(false)
    expect(rowGroupMayMatch({ rowStart: 0, rowEnd: 1, countryMin: 'GB', countryMax: 'GB', latMin: 51, latMax: 52, lngMin: -1, lngMax: 0 }, [LONDON])).toBe(true)
    expect(rowGroupMayMatch({ rowStart: 0, rowEnd: 1 }, [LONDON])).toBe(true)
  })

  it('has unique region ids, starting with the US and Canada', () => {
    expect(new Set(FSQ_REGIONS.map((r) => r.id)).size).toBe(FSQ_REGIONS.length)
    expect(FSQ_REGIONS.slice(0, 2).map((r) => r.id)).toEqual(['us', 'ca'])
    for (const r of FSQ_REGIONS) if (r.bbox) expect(r.bbox[0] < r.bbox[2] && r.bbox[1] < r.bbox[3], r.id).toBe(true)
  })
})

describe('scanning', () => {
  const rows: FsqRow[] = [
    // group 0: US, one escape room by category, one bar
    row({ fsq_place_id: 'a' }),
    row({ fsq_place_id: 'bar', name: 'Great Escape Pub', fsq_category_ids: [BAR], fsq_category_labels: ['Dining and Drinking > Bar'] }),
    row({ fsq_place_id: 'b', name: 'Puzzle Room Florence', fsq_category_ids: [], fsq_category_labels: ['Arts and Entertainment'] }),
    // group 1: Bermuda only (skipped by stats)
    row({ fsq_place_id: 'bm1', country: 'BM' }),
    row({ fsq_place_id: 'bm2', country: 'BM' }),
    row({ fsq_place_id: 'bm3', country: 'BM' }),
    // group 2: US, nothing matching
    row({ fsq_place_id: 'n1', name: 'Bakery', fsq_category_ids: [BAR] }),
    row({ fsq_place_id: 'n2', name: 'Escape Room Supply Shop', fsq_category_ids: ['x'], fsq_category_labels: ['Retail > Hobby Store'] }),
    row({ fsq_place_id: 'n3', name: 'Closed Escape', date_closed: '2020-01-01' }),
  ]

  it('reads the category column first and place columns only for matching groups', async () => {
    const file = fakeFile(rows)
    const r = await scanFile(file, [US])
    expect(r.hits.map((h) => h.place.sourceId).sort()).toEqual(['a', 'b'])
    expect(r.hits.every((h) => h.regionId === 'us')).toBe(true)
    expect(r.read).toBe(2)
    expect(r.skipped).toBe(1)
    const placeReads = file.reads.filter((x) => x.columns.includes('address'))
    // Group 0 (two hits) and group 2 (a name match the categories rule out, and a closed one).
    expect(placeReads.map((x) => [x.rowStart, x.rowEnd])).toEqual([[0, 3], [7, 9]])
    expect(file.reads.filter((x) => x.columns.includes(CATEGORY_COLUMN) && !x.columns.includes('address'))).toHaveLength(2)
    expect(r.hits.find((h) => h.place.sourceId === 'b')!.place.raw.matched_by).toBe('name')
  })

  let cacheDir: string | null = null
  afterEach(() => {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true })
    cacheDir = null
  })

  it('streams all files and resumes from the per-file cache', async () => {
    cacheDir = mkdtempSync(path.join(os.tmpdir(), 'fsq-cache-'))
    let opened = 0
    const source: ParquetSource = {
      listFiles: async () => ['0.parquet', '1.parquet'],
      open: async (f) => {
        opened++
        return fakeFile(f === '0.parquet' ? rows.slice(0, 3) : [row({ fsq_place_id: 'ldn', country: 'GB', latitude: 51.5, longitude: -0.1, locality: 'London' })])
      },
    }
    const progress: boolean[] = []
    const first = []
    for await (const h of scanFoursquare(source, [US, LONDON], { cacheDir, onProgress: (p) => progress.push(p.cached) })) first.push(h)
    expect(first.map((h) => `${h.regionId}:${h.place.sourceId}`)).toEqual(['us:a', 'us:b', 'gb-london:ldn'])
    expect(opened).toBe(2)
    const second = []
    for await (const h of scanFoursquare(source, [US, LONDON], { cacheDir, onProgress: (p) => progress.push(p.cached) })) second.push(h)
    expect(second).toEqual(first)
    expect(opened).toBe(2)
    expect(progress).toEqual([false, false, true, true])
    // A different region set does not reuse the cache.
    for await (const _ of scanFoursquare(source, [US], { cacheDir, maxFiles: 1 })) void _
    expect(opened).toBe(3)
  })
})

describe('HTTP source', () => {
  it('lists Parquet files from an S3 bucket in numeric order, following continuation tokens', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      const page2 = url.includes('continuation-token')
      const xml = page2
        ? '<ListBucketResult><Contents><Key>p/places/10.parquet</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>'
        : '<ListBucketResult><Contents><Key>p/places/2.parquet</Key></Contents><Contents><Key>p/places/_metadata</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken></ListBucketResult>'
      return new Response(xml, { status: 200 })
    }) as unknown as typeof fetch
    const src = httpParquetSource({ base: 'https://s3.example.com/bucket/p/places', fetch: fakeFetch })
    expect(await src.listFiles()).toEqual(['2.parquet', '10.parquet'])
    expect(calls[0]).toContain('https://s3.example.com/bucket?list-type=2&prefix=p%2Fplaces%2F')
  })

  it('retries network errors and 5xx', async () => {
    let n = 0
    const flaky = (async () => {
      n++
      if (n === 1) throw new Error('reset')
      if (n === 2) return new Response('busy', { status: 503 })
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const res = await retryingFetch(flaky, 4)('https://x.example')
    expect(await res.text()).toBe('ok')
    expect(n).toBe(3)
  }, 10_000)
})
