// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, type AppContext } from '../context'
import { FX, loadFixtures } from '../db/fixtures'
import { games, reviews, users, venues, visitParticipants, visits } from '../db/schema'
import { createTestDb, type TestDb } from '../db/testing'
import { buildServer, type EscapeServer } from '../index'
import { STATIC_PAGES } from '../static'
import { clip, escapeHtml, injectHeadTags, jsonForScript, renderHeadTags, siteOrigin } from './head'
import { headTagsFor, pageMetaFor, robotsTxt, sitemapUrls, sitemapXml, staticPageMeta } from './index'

const INDEX_HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
const ORIGIN = 'https://escapes.example.com'

let t: TestDb
let ctx: AppContext
beforeAll(async () => {
  t = await createTestDb()
  await loadFixtures(t.db)
  ctx = createContext({ dbState: { status: 'ready', handle: t.handle, error: null }, env: { NODE_ENV: 'test', PUBLIC_URL: ORIGIN } })
})
afterAll(async () => {
  await t.close()
})

describe('head helpers', () => {
  it('escape HTML and script JSON', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    const json = jsonForScript({ name: '</script><script>alert(1)</script>&' })
    expect(json).not.toContain('<')
    expect(json).not.toContain('&')
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>&' })
  })

  it('clip on a word boundary', () => {
    expect(clip('short  text')).toBe('short text')
    const long = 'word '.repeat(60)
    const c = clip(long, 50)
    expect(c.length).toBeLessThanOrEqual(50)
    expect(c.endsWith('word…')).toBe(true)
  })

  it('siteOrigin uses PUBLIC_URL, then RAILWAY_PUBLIC_DOMAIN, never junk', () => {
    expect(siteOrigin({ PUBLIC_URL: 'https://a.example.com/' })).toBe('https://a.example.com')
    expect(siteOrigin({ RAILWAY_PUBLIC_DOMAIN: 'bubbly.up.railway.app' })).toBe('https://bubbly.up.railway.app')
    expect(siteOrigin({ PUBLIC_URL: 'javascript:alert(1)' })).toBeNull()
    expect(siteOrigin({ RAILWAY_PUBLIC_DOMAIN: 'x" onload="y' })).toBeNull()
    expect(siteOrigin({})).toBeNull()
  })

  it('renderHeadTags: relative URLs without an origin, no canonical', () => {
    const tags = renderHeadTags({ title: 'T', description: 'D', path: '/games/x' }, null)
    expect(tags).toContain('<meta property="og:image" content="/og-image.png" />')
    expect(tags).not.toContain('canonical')
    expect(tags).not.toContain('og:url')
  })

  it('injectHeadTags replaces the default title and OG tags in index.html', () => {
    const html = injectHeadTags(INDEX_HTML, renderHeadTags({ title: 'Game X', description: 'About X', path: '/games/x' }, ORIGIN))
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html).toContain('<title>Game X</title>')
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html.match(/name="description"/g)).toHaveLength(1)
    // Everything else in the head stays.
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('<div id="root">')
    // The boot splash in the body (and its styles in the head) survive the head rewrite.
    expect(html).toContain('class="boot-splash"')
    expect(html).toContain('.boot-shimmer')
    expect(injectHeadTags('<p>no head</p>', '<title>x</title>')).toBe('<p>no head</p>')
  })
})

describe('page meta from the database', () => {
  it('game page: public averages only, no reviewer names or private text', async () => {
    const m = (await pageMetaFor(`/games/${FX.gameSlugs.observatory}?ref=x`, ctx))!
    expect(m.title).toBe('The Lost Observatory · Starlight Escapes, San Francisco · My Escapes')
    // alice 88 (public) + carol 65 (public); bob's friends-only 80 is left out.
    expect(m.description).toContain('Rated 77/100 from 2 reviews.')
    expect(m.description).toContain('Sci-fi · 2–6 players · 60 min.')
    expect(m.path).toBe(`/games/${FX.gameSlugs.observatory}`)
    const tags = (await headTagsFor(`/games/${FX.gameSlugs.observatory}`, ctx))!
    for (const secret of ['Bob', 'bob@example.com', 'alice@example.com', 'transcript', 'ending twist']) expect(tags).not.toContain(secret)
    expect(tags).toContain(`<link rel="canonical" href="${ORIGIN}/games/${FX.gameSlugs.observatory}" />`)
    expect(tags).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.png" />`)
  })

  it('game page: copied scores and private reviews are not averaged', async () => {
    // Lighthouse: alice 92 + alice 84 public; mia's untouched copy is excluded.
    expect((await pageMetaFor(`/games/${FX.gameSlugs.lighthouse}`, ctx))!.description).toContain('Rated 88/100 from 2 reviews.')
    // Vault: alice private 60 excluded, alice public 70.
    expect((await pageMetaFor(`/games/${FX.gameSlugs.vault}`, ctx))!.description).toContain('Rated 70/100 from 1 review.')
  })

  it('game page: reviews by authors without a public name do not count', async () => {
    await t.db.update(users).set({ handle: null }).where(eq(users.id, FX.users.carol))
    try {
      expect((await pageMetaFor(`/games/${FX.gameSlugs.observatory}`, ctx))!.description).toContain('Rated 88/100 from 1 review.')
    } finally {
      await t.db.update(users).set({ handle: 'carol' }).where(eq(users.id, FX.users.carol))
    }
  })

  it('venue page: games and JSON-LD', async () => {
    const m = (await pageMetaFor(`/venues/${FX.venueSlugs.starlight}`, ctx))!
    expect(m.title).toBe('Starlight Escapes, San Francisco: escape rooms · My Escapes')
    expect(m.description).toContain('2 rooms: The Lost Observatory, The Vault.')
    expect(m.jsonLd).toMatchObject({ '@type': 'EntertainmentBusiness', name: 'Starlight Escapes', geo: { latitude: 37.7897 }, address: { addressCountry: 'US', postalCode: '94105' } })
    const tags = (await headTagsFor(`/venues/${FX.venueSlugs.starlight}`, ctx))!
    expect(tags).toContain('<script type="application/ld+json">')
    expect(tags).toContain('og:type" content="place"')
  })

  it('city page', async () => {
    const m = (await pageMetaFor(`/cities/${FX.cities.toronto}`, ctx))!
    expect(m.title).toBe('Escape rooms in Toronto, ON · My Escapes')
    expect(m.description).toContain('1 escape room venue in Toronto')
  })

  it('unknown, malformed and hidden pages get no tags', async () => {
    expect(await pageMetaFor('/games/nope', ctx)).toBeNull()
    expect(await pageMetaFor('/games/%E0%A4%A', ctx)).toBeNull()
    expect(await pageMetaFor("/games/x'or'1'='1", ctx)).toBeNull()
    expect(await pageMetaFor('/venues/nope', ctx)).toBeNull()
    expect(await pageMetaFor('/cities/nope', ctx)).toBeNull()
    expect(await pageMetaFor('/somewhere/else', ctx)).toBeNull()
    await t.db.update(games).set({ status: 'hidden' }).where(eq(games.id, FX.games.vault))
    try {
      expect(await pageMetaFor(`/games/${FX.gameSlugs.vault}`, ctx)).toBeNull()
    } finally {
      await t.db.update(games).set({ status: 'active' }).where(eq(games.id, FX.games.vault))
    }
  })

  it('escapes hostile names', async () => {
    const [v] = await t.db
      .insert(venues)
      .values({ slug: 'evil-venue', name: '"><script>alert(1)</script>', city: 'X</title>', citySlug: 'x', country: 'US' })
      .returning()
    await t.db.insert(games).values({ venueId: v.id, slug: 'evil-game', name: '</title><script>alert(2)</script>' })
    for (const url of ['/games/evil-game', '/venues/evil-venue']) {
      const tags = (await headTagsFor(url, ctx))!
      expect(tags).not.toMatch(/<script>alert/)
      expect(tags).not.toContain('</title><')
      expect(tags.match(/<\/title>/g)).toHaveLength(1)
    }
  })

  it('without a database, public pages fall back to the defaults', async () => {
    const noDb = createContext({ env: { NODE_ENV: 'test' } })
    expect(await headTagsFor(`/games/${FX.gameSlugs.observatory}`, noDb)).toBeNull()
    expect(await headTagsFor('/daily', noDb)).toContain('Escape of the Day')
  })

  it('static app routes: per-user pages are noindex and invite links are not echoed', () => {
    expect(staticPageMeta('/m/log')?.noindex).toBe(true)
    expect(staticPageMeta('/settings')?.noindex).toBe(true)
    const invite = renderHeadTags(staticPageMeta('/invite/SECRETCODE')!, ORIGIN)
    expect(invite).toContain('noindex')
    expect(invite).not.toContain('SECRETCODE')
    expect(staticPageMeta('/')).toBeNull()
    expect(staticPageMeta('/welcome')).toBeNull()
  })
})

describe('sitemap and robots', () => {
  it('lists directory pages, and user-created games only with a public review', async () => {
    const [v] = await t.db.insert(venues).values({ slug: 'private-venue', name: 'Private Venue', city: 'Nowhere', citySlug: 'nowhere', country: 'ZZ', createdBy: FX.users.alice }).returning()
    const [g] = await t.db.insert(games).values({ venueId: v.id, slug: 'private-game', name: 'Private Game', createdBy: FX.users.alice }).returning()
    const [vis] = await t.db.insert(visits).values({ gameId: g.id, date: '2026-01-01', createdBy: FX.users.alice }).returning()
    await t.db.insert(visitParticipants).values({ visitId: vis.id, userId: FX.users.alice, status: 'owner', addedBy: FX.users.alice })
    await t.db.insert(reviews).values({ visitId: vis.id, authorId: FX.users.alice, overallScore: 50, puzzlesScore: 50, settingScore: 50, storylineScore: 50, difficultyScore: 50, visibility: 'private' })

    const paths = (await sitemapUrls(ctx)).map((u) => u.path)
    for (const p of ['/', '/about', '/privacy', '/terms', '/daily', `/games/${FX.gameSlugs.observatory}`, `/games/${FX.gameSlugs.lighthouse}`, `/venues/${FX.venueSlugs.maple}`, `/cities/${FX.cities.sf}`]) {
      expect(paths).toContain(p)
    }
    expect(paths).not.toContain('/games/private-game')
    expect(paths).not.toContain('/venues/private-venue')
    expect(paths).not.toContain('/cities/nowhere')

    await t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.visitId, vis.id))
    const after = (await sitemapUrls(ctx)).map((u) => u.path)
    expect(after).toContain('/games/private-game')
    expect(after).toContain('/venues/private-venue')
    // Respects the limit.
    expect(await sitemapUrls(ctx, 7)).toHaveLength(7)
  })

  it('renders valid, escaped XML', () => {
    const xml = sitemapXml(ORIGIN, [{ path: '/games/a&b', lastmod: new Date('2026-10-01T05:00:00Z') }, { path: '/x', lastmod: 'nonsense' }])
    expect(xml).toContain('<loc>https://escapes.example.com/games/a&amp;b</loc><lastmod>2026-10-01</lastmod>')
    expect(xml).toContain('<loc>https://escapes.example.com/x</loc></url>')
    expect(robotsTxt(ORIGIN)).toContain('Sitemap: https://escapes.example.com/sitemap.xml')
  })
})

describe('served pages', () => {
  let dir: string
  let app: EscapeServer
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'seo-dist-'))
    writeFileSync(path.join(dir, 'index.html'), INDEX_HTML)
    for (const page of STATIC_PAGES) writeFileSync(path.join(dir, `${page}.html`), `<html><head><title>${page}</title></head><body>${page} page</body></html>`)
    app = await buildServer({ context: ctx, distDir: dir })
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a game page gets its own title and Open Graph tags', async () => {
    const res = await app.inject({ method: 'GET', url: `/games/${FX.gameSlugs.observatory}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body.match(/<title>/g)).toHaveLength(1)
    expect(res.body).toContain('<title>The Lost Observatory · Starlight Escapes, San Francisco · My Escapes</title>')
    expect(res.body).toContain('og:description')
    expect(res.body).toContain('<div id="root">')
    expect(res.body).toContain('class="boot-splash"')
  })

  it('unknown pages get the plain index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/does-not-exist' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(INDEX_HTML)
  })

  it('the static info pages are untouched', async () => {
    for (const page of STATIC_PAGES) {
      const res = await app.inject({ method: 'GET', url: `/${page}` })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(`${page} page`)
      expect(res.body).not.toContain('og:title')
    }
  })

  it('serves robots.txt and sitemap.xml', async () => {
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(robots.statusCode).toBe(200)
    expect(robots.headers['content-type']).toMatch(/text\/plain/)
    expect(robots.body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    const sm = await app.inject({ method: 'GET', url: '/sitemap.xml' })
    expect(sm.statusCode).toBe(200)
    expect(sm.headers['content-type']).toMatch(/application\/xml/)
    expect(sm.body).toContain(`<loc>${ORIGIN}/games/${FX.gameSlugs.observatory}</loc>`)
    expect(sm.body).toContain(`<loc>${ORIGIN}/privacy</loc>`)
  })
})
