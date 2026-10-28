// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { EnrichStatusSchema } from '../../src/contracts/models'
import { games, sources, venues } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'
import { costUsd, parseSiteFacts, type EnrichClient, type SiteFacts } from './extract'
import { runEnrichment } from './index'
import { htmlToText, isPrivateAddress, isPublicHost, pickRoomLinks, readVenueSite, robotsAllows } from './site'
import { ensureEnrichTables, saveRooms } from './store'

const publicLookup = async () => ['93.184.216.34']

function siteFetch(pages: Record<string, { status?: number; body: string; type?: string; location?: string }>) {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const p = pages[url]
    if (!p) return new Response('nope', { status: 404 })
    return new Response(p.body, { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html', ...(p.location ? { location: p.location } : {}) } })
  }
  return { fn, calls }
}

describe('site reading', () => {
  it('turns HTML into text, keeping alt text and dropping scripts', () => {
    const r = htmlToText('<title>Lock &amp; Key</title><script>var x=1</script><h1>Our rooms</h1><p>The Vault<br>60 min</p><img alt="Pirate Cove"><a href="/rooms">Rooms</a>', 'https://lock.example/')
    expect(r.title).toBe('Lock & Key')
    expect(r.text).toContain('The Vault')
    expect(r.text).toContain('Pirate Cove')
    expect(r.text).not.toContain('var x')
    expect(r.links).toEqual([{ href: 'https://lock.example/rooms', label: 'Rooms' }])
  })

  it('picks same-site room pages and skips the rest', () => {
    const site = new URL('https://www.lock.example/')
    const links = [
      { href: 'https://lock.example/our-rooms', label: 'Our rooms' },
      { href: 'https://lock.example/blog/news', label: 'News' },
      { href: 'https://other.example/rooms', label: 'Rooms' },
      { href: 'https://lock.example/book-now', label: 'Book' },
      { href: 'https://lock.example/privacy', label: 'Privacy' },
    ]
    expect(pickRoomLinks(links, site)).toEqual(['https://lock.example/our-rooms', 'https://lock.example/book-now'])
  })

  it('follows robots.txt for our agent, else *', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /admin', '/rooms')).toBe(true)
    expect(robotsAllows('User-agent: MyEscapesBot\nDisallow: /\n\nUser-agent: *\nAllow: /', '/x')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /rooms', '/rooms/vault')).toBe(true)
    expect(robotsAllows('', '/')).toBe(true)
  })

  it('never fetches private or internal hosts', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip)).toBe(true)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    expect(await isPublicHost(new URL('http://localhost/'))).toBe(false)
    expect(await isPublicHost(new URL('http://railway.internal/'))).toBe(false)
    expect(await isPublicHost(new URL('http://evil.example/'), async () => ['10.0.0.5'])).toBe(false)
    // A redirect into the private network is refused too.
    const f = siteFetch({
      'https://shop.example/robots.txt': { status: 404, body: '' },
      'https://shop.example/': { status: 302, body: '', location: 'http://metadata.example/' },
    })
    const lookup = async (h: string) => (h === 'metadata.example' ? ['169.254.169.254'] : ['93.184.216.34'])
    expect(await readVenueSite('shop.example', f.fn, lookup)).toEqual({ pages: [], reason: 'unreachable' })
    expect(f.calls).not.toContain('http://metadata.example/')
  })

  it('reads the home page and room pages, honouring robots', async () => {
    const f = siteFetch({
      'https://lock.example/robots.txt': { body: 'User-agent: *\nDisallow: /book', type: 'text/plain' },
      'https://lock.example/': { body: '<h1>Lock</h1><a href="/rooms">Rooms</a><a href="/book">Book</a>' },
      'https://lock.example/rooms': { body: '<h2>The Vault</h2><p>2-6 players</p>' },
    })
    const r = await readVenueSite('lock.example', f.fn, publicLookup)
    expect(r.pages.map((p) => p.url)).toEqual(['https://lock.example/', 'https://lock.example/rooms'])
    expect(r.pages[1].text).toContain('2-6 players')
    expect(f.calls).not.toContain('https://lock.example/book')
    const blocked = siteFetch({ 'https://no.example/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' } })
    expect(await readVenueSite('no.example', blocked.fn, publicLookup)).toEqual({ pages: [], reason: 'robots' })
  })
})

describe('room extraction output', () => {
  it('keeps valid rooms, drops bad and duplicate ones', () => {
    const room = { name: 'The Vault', summary: 'A heist.', minPlayers: 6, maxPlayers: 2, durationMinutes: 60, difficulty: 3, genre: 'heist', status: 'open', url: null }
    const f = parseSiteFacts(JSON.stringify({ isEscapeRoomVenue: true, rooms: [room, { ...room, name: 'the vault' }, { ...room, name: '', genre: 'nope' }, { ...room, name: 'Lab', genre: 'nope' }] }))!
    expect(f.rooms.map((r) => r.name)).toEqual(['The Vault'])
    expect(f.rooms[0]).toMatchObject({ minPlayers: null, maxPlayers: null })
    expect(parseSiteFacts('not json')).toBeNull()
  })

  it('prices by model', () => {
    expect(costUsd({ model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6)
    expect(costUsd({ model: 'unknown', inputTokens: 1_000_000, outputTokens: 0 })).toBe(4)
  })
})

describe('crawler run', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await buildTestApp({ fixtures: true })
    await ensureEnrichTables(t.db)
    const base = { address: '', region: 'CA', country: 'US', citySlug: 'san-francisco-ca-us', city: 'San Francisco' }
    await t.db.insert(venues).values([
      { id: 'ven_lock', slug: 'lock-sf', name: 'Lock Room', website: 'https://lock.example/', fsqId: 'fsq_lock', ...base },
      { id: 'ven_down', slug: 'down-sf', name: 'Down Room', website: 'https://down.example/', fsqId: 'fsq_down', ...base },
      { id: 'ven_user', slug: 'user-sf', name: 'User Room', website: 'https://user.example/', fsqId: null, ...base },
    ])
  })
  afterAll(async () => {
    await t?.close()
  })

  const facts: SiteFacts = {
    isEscapeRoomVenue: true,
    rooms: [
      { name: 'The Vault', summary: 'Crack the bank vault before the guards return.', minPlayers: 2, maxPlayers: 6, durationMinutes: 60, difficulty: 4, genre: 'heist', status: 'open', url: 'https://lock.example/rooms/vault' },
      { name: 'Old Mine', summary: null, minPlayers: null, maxPlayers: null, durationMinutes: null, difficulty: null, genre: null, status: 'closed', url: 'https://elsewhere.example/x' },
      { name: 'Next Year', summary: null, minPlayers: null, maxPlayers: null, durationMinutes: null, difficulty: null, genre: null, status: 'coming_soon', url: null },
    ],
  }

  it('saves rooms for readable venues, records the rest, and respects the budget', async () => {
    const f = siteFetch({
      'https://lock.example/robots.txt': { status: 404, body: '' },
      'https://lock.example/': { body: '<h1>Lock Room</h1><p>The Vault, Old Mine</p>' },
    })
    const client: EnrichClient = { extract: async () => ({ facts, usage: { model: 'claude-haiku-5-5', inputTokens: 5000, outputTokens: 500 } }) }
    const runId = 'enr_test1'
    await t.db.execute(sql`insert into enrich_runs (id, kind, status, venue_limit, budget_usd) values (${runId}, 'admin', 'running', 10, 5)`)
    const run = await runEnrichment(t.db, runId, { limit: 10, budgetUsd: 5, client, model: 'claude-haiku-5-5', fetchFn: f.fn, lookupFn: publicLookup, concurrency: 1 })
    expect(run).toMatchObject({ status: 'done', venues: 2, venuesWithRooms: 1, roomsAdded: 2 })
    const rows = await t.db.select().from(games).where(eq(games.venueId, 'ven_lock'))
    expect(rows.map((g) => [g.name, g.status, g.website]).sort()).toEqual([
      ['Old Mine', 'closed', null],
      ['The Vault', 'active', 'https://lock.example/rooms/vault'],
    ])
    expect(rows.find((g) => g.name === 'The Vault')).toMatchObject({ minPlayers: 2, maxPlayers: 6, durationMinutes: 60, genre: 'heist' })
    const src = await t.db.select().from(sources).where(eq(sources.source, 'website'))
    expect(src).toHaveLength(2)
    expect(src[0].attribution).toBe('Room details from lock.example')
    // User-added venues (no Foursquare id) are never crawled.
    expect(f.calls.some((u) => u.includes('user.example'))).toBe(false)

    const status = EnrichStatusSchema.parse((await t.inject({ method: 'GET', url: '/api/admin/enrich', as: t.fx.users.admin })).json())
    expect(status).toMatchObject({ venuesTried: 2, venuesWithRooms: 1, venuesLeft: 0 })
    expect(status.runs[0].id).toBe(runId)
  })

  it('a second read fills only empty fields of an existing room', async () => {
    const mine = and(eq(games.venueId, 'ven_lock'), eq(games.name, 'The Vault'))
    await t.db.update(games).set({ durationMinutes: 75, description: null }).where(mine)
    await saveRooms(t.db, { id: 'ven_lock', name: 'Lock Room', city: 'San Francisco', country: 'US', website: 'https://lock.example/' }, { ...facts, rooms: [facts.rooms[0]] }, ['https://lock.example/'])
    const vault = (await t.db.select().from(games).where(mine))[0]
    expect(vault.durationMinutes).toBe(75)
    expect(vault.description).toBe('Crack the bank vault before the guards return.')
  })

  it('stops before a venue could pass the budget', async () => {
    await t.db.insert(venues).values({ id: 'ven_pricey', slug: 'pricey-sf', name: 'Pricey', website: 'https://pricey.example/', fsqId: 'fsq_pricey', address: '', region: 'CA', country: 'US', citySlug: 'san-francisco-ca-us', city: 'San Francisco' })
    let calls = 0
    const client: EnrichClient = { extract: async () => (calls++, { facts, usage: { model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 100 } }) }
    await t.db.execute(sql`insert into enrich_runs (id, kind, status, venue_limit, budget_usd) values ('enr_test3', 'admin', 'running', 10, 0.1)`)
    const run = await runEnrichment(t.db, 'enr_test3', { limit: 10, budgetUsd: 0.1, client, model: 'claude-opus-5-5', fetchFn: siteFetch({}).fn, lookupFn: publicLookup })
    expect(calls).toBe(0)
    expect(run).toMatchObject({ status: 'done', venues: 0, note: 'Stopped at the budget.' })
  })

  it('admin only, and the start route is off in tests', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/admin/enrich', as: t.fx.users.alice })).statusCode).toBe(403)
    expect((await t.inject({ method: 'POST', url: '/api/admin/enrich', as: t.fx.users.alice, payload: { limit: 5, budgetUsd: 1 } })).statusCode).toBe(403)
    expect((await t.inject({ method: 'POST', url: '/api/admin/enrich', as: t.fx.users.admin, payload: { limit: 5, budgetUsd: 1 } })).statusCode).toBe(409)
  })
})
