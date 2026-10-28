// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeSeed, readManifest } from '../../../server/routes/directory.seed'
import type { RawPlace, Region } from '../types'
import {
  assignSlugs,
  buildRegionSeed,
  buildSeeds,
  cleanWebsite,
  coreName,
  dedupePlaces,
  encodeSeed,
  fillMissingCities,
  isNonLatinCity,
  isSamePlace,
  latinizeCities,
  nameSimilarity,
  normaliseName,
  normalisePlace,
  phoneDigits,
  seedSlugs,
  seedPrimaryIds,
  seedSlugsById,
  tagBrands,
  venueSlugBase,
  websiteHost,
  writeSeeds,
} from './index'

let n = 0
function place(over: Partial<RawPlace> = {}): RawPlace {
  n++
  return {
    source: 'foursquare',
    sourceId: over.sourceId ?? `fsq${String(n).padStart(4, '0')}`,
    name: 'Starlight Escapes',
    brand: null,
    address: '12 Main St',
    city: 'San Francisco',
    region: 'CA',
    country: 'US',
    postalCode: '94105',
    lat: 37.7897,
    lng: -122.3942,
    website: null,
    phone: null,
    license: 'Apache-2.0',
    attribution: 'Foursquare Open Source Places',
    raw: {},
    ...over,
  }
}

/** Moves a point `m` metres north. */
const north = (lat: number, m: number) => lat + m / 111_195

const US: Region = { id: 'us', name: 'United States', country: 'US' }
const LONDON: Region = { id: 'gb-london', name: 'London', country: 'GB', bbox: [51.28, -0.51, 51.69, 0.33] }

describe('names', () => {
  it('normalises case, accents, punctuation and apostrophes', () => {
    expect(normaliseName('Escape Room SF!')).toBe('escape room sf')
    expect(normaliseName('Évasion & Co.')).toBe('evasion and co')
    expect(normaliseName('Time’s Up!')).toBe('times up')
    expect(normaliseName('방탈출 카페')).toBe('방탈출 카페')
  })

  it('strips generic words for the core name', () => {
    expect(coreName('The Escape Game Nashville')).toBe('nashville')
    expect(coreName('Escape Rooms')).toBe('')
  })

  it('scores similar names high and different names low', () => {
    expect(nameSimilarity('Time’s Up Escape Room', 'Times Up! Escape Rooms')).toBeGreaterThan(0.8)
    expect(nameSimilarity('Breakout Games - Greensboro', 'Breakout Greensboro')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('Starlight Escapes', 'starlight escapes')).toBe(1)
    expect(nameSimilarity('Starlight Escapes', 'Maple & Key')).toBeLessThan(0.3)
    expect(nameSimilarity('Escape Room Fayetteville', 'Escape Room Raleigh')).toBeLessThan(0.5)
    expect(nameSimilarity('', 'x')).toBe(0)
    expect(nameSimilarity('No Way Out', 'Nowayout Escape Rooms City Walk')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('EscapeQuest', 'Escape Quest Zurich')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('Escape', 'Escape Hunt')).toBeLessThan(0.8)
  })
})

describe('field cleaning', () => {
  it('cleans websites and hosts', () => {
    expect(cleanWebsite('www.example.com')).toBe('https://www.example.com/')
    expect(cleanWebsite('http://lockedinnsc.com')).toBe('http://lockedinnsc.com/')
    expect(cleanWebsite('javascript:alert(1)')).toBeNull()
    expect(cleanWebsite('not a url')).toBeNull()
    expect(websiteHost('https://www.Escapology.com/en/x')).toBe('escapology.com')
    expect(websiteHost('https://www.facebook.com/escape')).toBeNull()
    expect(websiteHost(null)).toBeNull()
  })

  it('compares phones by their last 10 digits', () => {
    expect(phoneDigits('(843) 990-1677')).toBe('8439901677')
    expect(phoneDigits('+1 843 990 1677')).toBe('8439901677')
    expect(phoneDigits('123')).toBeNull()
  })

  it('tags city regions with the region name and keeps the locality in the address', () => {
    const p = normalisePlace(place({ country: 'GB', city: 'Camden Town', address: '1 High St', lat: 51.54, lng: -0.14 }), LONDON)
    expect(p.city).toBe('London')
    expect(p.address).toBe('1 High St, Camden Town')
    expect(p.region).toBe('')
    const q = normalisePlace(place({ country: 'gb', city: 'London', address: '2 Low St' }), LONDON)
    expect(q.city).toBe('London')
    expect(q.address).toBe('2 Low St')
    expect(q.country).toBe('GB')
  })

  it('rounds coordinates and trims fields', () => {
    const p = normalisePlace(place({ name: '  Starlight   Escapes ', lat: 37.123456789, website: 'starlight.example.com' }), US)
    expect(p.name).toBe('Starlight Escapes')
    expect(p.lat).toBe(37.123457)
    expect(p.website).toBe('https://starlight.example.com/')
  })
})

describe('isSamePlace', () => {
  const a = place({ name: 'Riddles Escape Room' })
  it('merges similar names under 75 m', () => {
    expect(isSamePlace(a, place({ name: 'Riddles Escape Rooms', lat: north(a.lat!, 60) }))).toBe(true)
  })
  it('keeps similar names further than 75 m apart without shared contacts', () => {
    expect(isSamePlace(a, place({ name: 'Riddles Escape Rooms', lat: north(a.lat!, 120) }))).toBe(false)
  })
  it('keeps different names at the same spot apart (two businesses in one building)', () => {
    expect(isSamePlace(a, place({ name: 'Captive Escape Rooms', lat: north(a.lat!, 10) }))).toBe(false)
  })
  it('merges a shared phone or website within 300 m when the names are related', () => {
    const x = place({ name: 'Myrtle Beach Room Escape', phone: '(843) 990-1677' })
    const y = place({ name: 'Myrtle Beach Escape Room', phone: '843-990-1677', lat: north(x.lat!, 240) })
    expect(isSamePlace(x, y)).toBe(true)
    const w = place({ name: 'One Way Out - Lynchburg Escape Room', website: 'http://www.lynchburgescape.com' })
    const z = place({ name: 'One Way Out Lynchburg VA Escape Room', website: 'https://lynchburgescape.com/', lat: north(w.lat!, 200) })
    expect(isSamePlace(w, z)).toBe(true)
  })
  it('merges a person or office listed at the same spot with the same phone', () => {
    const x = place({ name: 'George Nicksich', phone: '(919) 912-9080' })
    const y = place({ name: 'Ready Set Escape', phone: '(919) 912-9080', lat: north(x.lat!, 1) })
    expect(isSamePlace(x, y)).toBe(true)
  })
  it('never merges across countries or without coordinates', () => {
    expect(isSamePlace(a, place({ name: a.name, country: 'CA' }))).toBe(false)
    expect(isSamePlace(a, place({ name: a.name, lat: null, lng: null }))).toBe(false)
  })
})

describe('dedupePlaces', () => {
  it('merges duplicates transitively and keeps the best record as primary', () => {
    const base = place({ name: 'George Nicksich', phone: '(919) 912-9080', address: '' })
    const list = [
      base,
      place({ name: 'Ready Set Escape', phone: '(919) 912-9080', lat: north(base.lat!, 2), website: 'https://readyset.example.com', address: '1304D W Market St' }),
      place({ name: 'Ready Set Escape Rooms', lat: north(base.lat!, 50) }),
      place({ name: 'Somewhere Else Escape', lat: north(base.lat!, 5000) }),
    ]
    const merged = dedupePlaces(list)
    expect(merged).toHaveLength(2)
    const big = merged.find((m) => m.members.length === 3)!
    expect(big.primary.name).toBe('Ready Set Escape')
    expect(big.primary.address).toBe('1304D W Market St')
    expect(big.primary.phone).toBe('(919) 912-9080')
    expect(big.members[0].sourceId).toBe(big.primary.sourceId)
  })

  it('drops repeated source records and merges coordinate-less exact duplicates', () => {
    const a = place({ sourceId: 'same' })
    const b = { ...a }
    const c = place({ lat: null, lng: null, name: 'No Coords Escape' })
    const d = place({ lat: null, lng: null, name: 'no coords escape!' })
    const merged = dedupePlaces([a, b, c, d])
    expect(merged).toHaveLength(2)
  })

  it('is order independent', () => {
    const list = Array.from({ length: 30 }, (_, i) => place({ name: `Room ${i % 10} Escape`, lat: north(40, (i % 10) * 500 + (i >= 10 ? 20 : 0)), lng: -75 }))
    const a = dedupePlaces(list).map((m) => m.members.map((x) => x.sourceId).sort().join(','))
    const b = dedupePlaces([...list].reverse()).map((m) => m.members.map((x) => x.sourceId).sort().join(','))
    expect(new Set(a)).toEqual(new Set(b))
    expect(a).toHaveLength(10)
  })
})

describe('cities, brands and slugs', () => {
  it('fills a missing city from the nearest tagged venue', () => {
    const merged = dedupePlaces([place({ name: 'Tagged Escape' }), place({ name: 'Untagged Puzzle Room', city: '', lat: north(37.7897, 3000) }), place({ name: 'Far Away Escape', city: '', lat: 10, lng: 10 })])
    fillMissingCities(merged, 'Unknown')
    expect(merged.map((m) => m.primary.city).sort()).toEqual(['San Francisco', 'San Francisco', 'Unknown'])
  })

  it('replaces a city name in another script with the nearby Latin-named city', () => {
    const merged = dedupePlaces([
      place({ name: 'Tagged Escape', city: 'Richmond', region: 'BC', country: 'CA', lat: 49.18, lng: -123.13 }),
      place({ name: 'Zone Puzzle Room', city: '里士满', region: 'BC', country: 'CA', lat: north(49.18, 1500), lng: -123.13 }),
      place({ name: 'Remote Puzzle Room', city: '温哥华', region: 'BC', country: 'CA', lat: 52, lng: -120 }),
    ])
    latinizeCities(merged)
    const city = (name: string) => merged.find((m) => m.primary.name === name)!.primary.city
    expect(city('Zone Puzzle Room')).toBe('Richmond')
    expect(city('Remote Puzzle Room')).toBe('温哥华')
    expect(isNonLatinCity('里士满')).toBe(true)
    expect(isNonLatinCity('‘Aiea')).toBe(false)
    expect(isNonLatinCity('Montréal')).toBe(false)
  })

  it('never shares one region-wide city slug between non-Latin city names', () => {
    const seed = buildRegionSeed({ id: 'ca', name: 'Canada', country: 'CA' } as Region, [
      place({ name: 'A Puzzle Room', city: '里士满', region: 'BC', country: 'CA', lat: 49.18, lng: -123.13 }),
      place({ name: 'B Puzzle Room', city: '温哥华', region: 'BC', country: 'CA', lat: 49.28, lng: -123.12 }),
    ])
    const slugs = seed.file.venues.map((v) => v.citySlug)
    expect(new Set(slugs).size).toBe(2)
    expect(slugs).not.toContain('bc-ca')
  })

  it('tags chains that share a website host across 3+ cities', () => {
    const merged = dedupePlaces([
      place({ name: 'Escapology Escape Rooms Myrtle Beach', city: 'Myrtle Beach', website: 'https://www.escapology.com/en/myrtle', lat: 33.6 }),
      place({ name: 'Escapology', city: 'Fayetteville', website: 'https://www.escapology.com/en/fayetteville-nc', lat: 35.0 }),
      place({ name: 'Escapology - Orlando', city: 'Orlando', website: 'https://escapology.com/orlando', lat: 28.5 }),
      place({ name: 'Local Escape', city: 'Orlando', website: 'https://local.example.com', lat: 28.6 }),
    ])
    tagBrands(merged)
    expect(merged.filter((m) => m.primary.brand === 'Escapology')).toHaveLength(3)
    expect(merged.find((m) => m.primary.name === 'Local Escape')!.primary.brand).toBeNull()
  })

  it('builds readable slugs, with a fallback for non-Latin names', () => {
    expect(venueSlugBase({ name: 'Starlight Escapes', city: 'San Francisco', sourceId: 'abc' })).toBe('starlight-escapes-san-francisco')
    expect(venueSlugBase({ name: 'Escape Room Fayetteville', city: 'Fayetteville', sourceId: 'abc' })).toBe('escape-room-fayetteville')
    expect(venueSlugBase({ name: '방탈출 카페', city: 'Seoul', sourceId: '5f2c2834b6d0551' })).toBe('escape-room-seoul-6d0551')
    expect(assignSlugs(['a', 'a', 'b', 'a'], new Set(['b']))).toEqual(['a', 'a-2', 'b-2', 'a-3'])
    // Previous slugs are kept (once), even when they are reserved in `taken`.
    expect(assignSlugs(['a', 'a', 'a'], new Set(['a-2']), [undefined, 'a-2', 'a-2'])).toEqual(['a', 'a-2', 'a-3'])
  })

  it('makes one city page per city in a whole-country region, whatever the spelling', () => {
    const ru = (city: string, region: string, lat: number, lng: number, name = `Квест ${city} ${lat}`) => place({ name, city, region, country: 'RU', lat, lng })
    const seed = buildRegionSeed({ id: 'ru', name: 'Russia', country: 'RU', unifyCities: true }, [
      ru('Москва', 'Москва', 55.75, 37.62),
      ru('Москва', '', 55.76, 37.6),
      ru('Moscow', 'Moscow', 55.74, 37.63),
      ru('Moskva', '', 55.751, 37.621),
      ru('Санкт-Петербург', 'Санкт-Петербург', 59.93, 30.33),
      ru('Tsentralny Rayon', '', 59.935, 30.34),
      ru('Saint Petersburg', '', 59.95, 30.31),
      ru('Saint Petersburg', '', 59.96, 30.32),
      ru('Казань', 'Татарстан', 55.79, 49.12),
      ru('Kazan', '', 55.8, 49.1),
      // The same name far away is another town.
      ru('Kirovsk', 'Мурманская область', 67.61, 33.67),
      ru('Kirovsk', 'Ленинградская область', 59.88, 30.99),
      ru('Kirovsk', 'Ленинградская область', 59.87, 30.98),
    ])
    const cityOf = (lat: number) => seed.file.venues.find((v) => v.lat === lat)!
    expect(new Set([55.75, 55.76, 55.74, 55.751].map((l) => cityOf(l).citySlug))).toEqual(new Set(['moscow-ru']))
    expect(cityOf(55.75).city).toBe('Moscow')
    expect(new Set([59.93, 59.935, 59.95, 59.96].map((l) => cityOf(l).citySlug))).toEqual(new Set(['saint-petersburg-ru']))
    expect(new Set([55.79, 55.8].map((l) => cityOf(l).citySlug))).toEqual(new Set(['kazan-ru']))
    expect(cityOf(59.88).citySlug).toBe('kirovsk-ru')
    expect(cityOf(67.61).citySlug).toBe('kirovsk-murmanskaya-oblast-ru')
    expect(seed.file.cities.map((c) => c.slug).sort()).toEqual(['kazan-ru', 'kirovsk-murmanskaya-oblast-ru', 'kirovsk-ru', 'moscow-ru', 'saint-petersburg-ru'])
    // Without the flag (us, ca), cities are kept as Foursquare tags them.
    const plain = buildRegionSeed({ id: 'ru', name: 'Russia', country: 'RU' }, [ru('Москва', 'Москва', 55.75, 37.62), ru('Moscow', 'Moscow', 55.74, 37.63)])
    expect(plain.file.cities).toHaveLength(2)
  })

  it('files a whole-country venue named after a city region under that city', () => {
    const gb: Region = { id: 'gb', name: 'United Kingdom', country: 'GB' }
    const seed = buildRegionSeed(gb, [
      place({ name: 'Edge Escape', city: 'london', region: 'England', country: 'GB', lat: 51.7, lng: -0.2 }),
      place({ name: 'Leeds Escape', city: 'Leeds', region: 'England', country: 'GB', lat: 53.8, lng: -1.55 }),
    ], new Set(), undefined, { cityRegions: [LONDON] })
    expect(seed.file.venues.map((v) => [v.city, v.citySlug]).sort()).toEqual([['Leeds', 'leeds-england-gb'], ['London', 'london-gb']])
    // The city region itself makes the same slug.
    expect(buildRegionSeed(LONDON, [place({ city: 'Camden', country: 'GB', lat: 51.54, lng: -0.14 })]).file.venues[0].citySlug).toBe('london-gb')
  })
})

describe('seed files', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('round-trips a region seed through the compact gzip format', () => {
    const seed = buildRegionSeed(US, [
      place({ name: 'Starlight Escapes', website: 'starlight.example.com', raw: { date_refreshed: '2025-01-01' } }),
      place({ name: 'Starlight Escape', lat: north(37.7897, 30), raw: {} }),
      place({ name: 'Maple Room Escape', city: 'Oakland', lat: 37.8, lng: -122.27 }),
      place({ name: 'Wrong Country Escape', country: 'CA' }),
    ])
    expect(seed.stats).toEqual({ read: 4, merged: 1, dropped: 1 })
    expect(seed.file.venues).toHaveLength(2)
    expect(seed.file.cities.map((c) => c.slug)).toEqual(['oakland-ca-us', 'san-francisco-ca-us'])
    const decoded = decodeSeed(encodeSeed(seed.file))
    expect(decoded).toEqual(seed.file)
    const star = decoded.venues.find((v) => v.name === 'Starlight Escapes')!
    expect(star.src).toHaveLength(2)
    expect(star.src[0].id).toBe(star.fsqId)
    expect(star.src[0].fields.date_refreshed).toBe('2025-01-01')
  })

  it('keeps slugs unique across regions and writes a versioned manifest', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'seed-test-'))
    const paris: Region = { id: 'fr-paris', name: 'Paris', country: 'FR', bbox: [48.8, 2.22, 48.92, 2.47] }
    const parisTx: RawPlace = place({ name: 'Escape Room', city: 'Paris', region: '', country: 'US', lat: 33.66, lng: -95.55 })
    const parisFr: RawPlace = place({ name: 'Escape Room', city: 'Paris', region: '', country: 'FR', lat: 48.86, lng: 2.35 })
    const seeds = buildSeeds([US, paris], new Map([['us', [parisTx]], ['fr-paris', [parisFr]]]))
    const slugs = seeds.flatMap((s) => s.file.venues.map((v) => v.slug))
    expect(new Set(slugs).size).toBe(2)
    const m1 = writeSeeds(dir, seeds)
    expect(m1.regions.map((r) => r.id)).toEqual(['us', 'fr-paris'])
    expect(readManifest(dir)?.version).toBe(m1.version)
    expect(seedSlugs(dir)).toEqual(new Set(slugs))
    expect(decodeSeed(readFileSync(path.join(dir, 'us.json.gz'))).venues[0].name).toBe('Escape Room')
    // A single-region re-run keeps the other region and changes the version only if content changed.
    const again = buildSeeds([US], new Map([['us', [parisTx, place({ name: 'New Escape', city: 'Dallas', lat: 32.7, lng: -96.8 })]]]), { takenSlugs: seedSlugs(dir, new Set(['us'])) })
    const m2 = writeSeeds(dir, again, { merge: true })
    expect(m2.regions.map((r) => r.id).sort()).toEqual(['fr-paris', 'us'])
    expect(m2.version).not.toBe(m1.version)
  })

  it('keeps every venue\'s slug from the previous seed when new venues arrive', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'seed-test-'))
    const old1 = place({ sourceId: 'm', name: 'Escape Room', city: 'Austin', lat: 30.2, lng: -97.7 })
    const old2 = place({ sourceId: 'p', name: 'Puzzle Hub', city: 'Austin', lat: 30.3, lng: -97.7 })
    writeSeeds(dir, buildSeeds([US], new Map([['us', [old1, old2]]])))
    const before = seedSlugsById(dir)
    expect(before.get('m')).toBe('escape-room-austin')
    // A new record with the same name and an earlier id would take "escape-room-austin" without memory;
    // a second record merged into Puzzle Hub, now the primary, still maps to its old slug.
    const newcomer = place({ sourceId: 'a', name: 'Escape Room', city: 'Austin', lat: 30.25, lng: -97.7 })
    const better = place({ sourceId: 'b', name: 'Puzzle Hub', city: 'Austin', lat: 30.3, lng: -97.7, website: 'https://puzzlehub.example.com', phone: '512 555 0100' })
    const seeds = buildSeeds([US], new Map([['us', [old1, old2, newcomer, better]]]), { previousSlugs: before })
    const slug = (id: string) => seeds[0].file.venues.find((v) => v.src.some((s) => s.id === id))!.slug
    expect(slug('m')).toBe('escape-room-austin')
    expect(slug('a')).toBe('escape-room-austin-2')
    expect(seeds[0].file.venues.find((v) => v.fsqId === 'b')).toBeDefined()
    expect(slug('b')).toBe(before.get('p'))
    // With the previous primaries, the old record stays the venue's id (its database row).
    const stable = buildSeeds([US], new Map([['us', [old1, old2, newcomer, better]]]), { previousSlugs: before, previousPrimaries: seedPrimaryIds(dir) })
    const hub = stable[0].file.venues.find((v) => v.src.some((s) => s.id === 'b'))!
    expect(hub.fsqId).toBe('p')
    expect(hub.slug).toBe(before.get('p'))
    // Gaps are still filled from the better record.
    expect(hub.website).toBe('https://puzzlehub.example.com/')
  })
})
