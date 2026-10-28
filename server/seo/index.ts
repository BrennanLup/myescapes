/**
 * SEO and sharing (workstream 26): meta tags and Open Graph data for public pages, plus
 * /robots.txt and /sitemap.xml.
 *
 * `headTagsFor(url, ctx)` is called by the SPA fallback in server/static.ts for every HTML page
 * request. It returns the <title>, description, canonical, Open Graph and Twitter tags for the
 * page (they replace the defaults in index.html), or null to serve index.html unchanged.
 *
 * Privacy (public/privacy.html): only public facts go into tags. Game pages show an average of
 * public, visible, own-score reviews by onboarded authors and the review count; never a
 * reviewer's name, email, transcript or a private/friends-only review. Per-user pages (/m,
 * /settings, /invite/...) get `noindex`, and invite pages never echo their secret URL.
 *
 * og:image is the static brand image (no image-rendering package is installed).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context'
import { cities, games, reviews, users, venues, visits } from '../db/schema'
import { DEFAULT_DESCRIPTION, SITE_NAME, absolute, escapeHtml, renderHeadTags, siteOrigin, type PageMeta } from './head'

export { injectHeadTags } from './head'

/** Max URLs in one sitemap file (the protocol's limit). */
export const SITEMAP_LIMIT = 50_000

const GENRE_LABEL: Record<string, string> = {
  horror: 'Horror',
  mystery: 'Mystery',
  adventure: 'Adventure',
  'sci-fi': 'Sci-fi',
  fantasy: 'Fantasy',
  heist: 'Heist',
  historical: 'Historical',
  comedy: 'Comedy',
  thriller: 'Thriller',
}

function placeName(city: string, region: string, country: string): string {
  // ZZ = unknown country (venues created from a log before anyone corrected them).
  const parts = [city, region && region !== city ? region : '', country && country !== 'ZZ' && country !== 'US' && country !== 'CA' ? country : '']
  return parts.filter(Boolean).join(', ')
}

function pathOf(url: string): string {
  const p = url.split(/[?#]/)[0] || '/'
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

/** One path segment (a slug), decoded; null when it isn't a plausible slug. */
function slugParam(segment: string | undefined): string | null {
  if (!segment) return null
  let s: string
  try {
    s = decodeURIComponent(segment)
  } catch {
    return null
  }
  return /^[a-z0-9][a-z0-9-]{0,200}$/i.test(s) ? s.toLowerCase() : null
}

export interface GameMetaRow {
  name: string
  slug: string
  genre: string | null
  minPlayers: number | null
  maxPlayers: number | null
  durationMinutes: number | null
  description: string | null
  venueName: string
  venueSlug: string
  city: string
  region: string
  country: string
  reviewCount: number
  averageOverall: number | null
}

export function gameMeta(g: GameMetaRow): PageMeta {
  const where = placeName(g.city, g.region, g.country)
  const facts: string[] = []
  if (g.genre && GENRE_LABEL[g.genre]) facts.push(GENRE_LABEL[g.genre])
  if (g.minPlayers && g.maxPlayers) facts.push(g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`)
  else if (g.maxPlayers) facts.push(`up to ${g.maxPlayers} players`)
  if (g.durationMinutes) facts.push(`${g.durationMinutes} min`)
  const rating =
    g.reviewCount > 0 && g.averageOverall !== null
      ? `Rated ${g.averageOverall}/100 from ${g.reviewCount} review${g.reviewCount === 1 ? '' : 's'}.`
      : 'Read reviews and log your own escape.'
  const lead = `Escape room by ${g.venueName}${where ? ` in ${where}` : ''}.`
  const description = [lead, rating, facts.length ? `${facts.join(' · ')}.` : '', g.description ?? ''].filter(Boolean).join(' ')
  return {
    title: `${g.name} · ${g.venueName}${g.city ? `, ${g.city}` : ''} · ${SITE_NAME}`,
    description,
    path: `/games/${g.slug}`,
    type: 'website',
  }
}

export interface VenueMetaRow {
  name: string
  slug: string
  address: string
  city: string
  region: string
  country: string
  postalCode: string | null
  lat: number | null
  lng: number | null
  website: string | null
  status: string
  games: string[]
}

export function venueMeta(v: VenueMetaRow, origin: string | null): PageMeta {
  const where = placeName(v.city, v.region, v.country)
  const n = v.games.length
  const list = n ? `${n} room${n === 1 ? '' : 's'}: ${v.games.slice(0, 6).join(', ')}${n > 6 ? ', and more' : ''}.` : 'Escape rooms, reviews and visits.'
  const closed = v.status === 'closed' ? 'Permanently closed. ' : ''
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'EntertainmentBusiness',
    name: v.name,
    url: absolute(origin, `/venues/${v.slug}`),
    address: {
      '@type': 'PostalAddress',
      ...(v.address ? { streetAddress: v.address } : {}),
      addressLocality: v.city,
      ...(v.region ? { addressRegion: v.region } : {}),
      ...(v.postalCode ? { postalCode: v.postalCode } : {}),
      ...(v.country && v.country !== 'ZZ' ? { addressCountry: v.country } : {}),
    },
    ...(v.lat !== null && v.lng !== null ? { geo: { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } } : {}),
    ...(v.website && /^https?:\/\//i.test(v.website) ? { sameAs: [v.website] } : {}),
  }
  return {
    title: `${v.name}${v.city ? `, ${v.city}` : ''}: escape rooms · ${SITE_NAME}`,
    description: `${closed}Escape room venue${where ? ` in ${where}` : ''}. ${list}`,
    path: `/venues/${v.slug}`,
    type: 'place',
    jsonLd,
  }
}

export function cityMeta(c: { slug: string; name: string; region: string; country: string; venueCount: number }): PageMeta {
  const where = placeName(c.name, c.region, c.country)
  const n = c.venueCount
  return {
    title: `Escape rooms in ${where || c.name} · ${SITE_NAME}`,
    description: n
      ? `${n} escape room venue${n === 1 ? '' : 's'} in ${where || c.name}, with player reviews, scores and puzzle highlights.`
      : `Escape rooms in ${where || c.name}, with player reviews, scores and puzzle highlights.`,
    path: `/cities/${c.slug}`,
  }
}

/** Static app routes: their tags need no database. */
export function staticPageMeta(p: string): PageMeta | null {
  // The home page keeps index.html as is (its default tags), so it is still served precompressed.
  if (p === '/' || p === '/welcome') return null
  if (p === '/daily') {
    return {
      title: `Escape of the Day · ${SITE_NAME}`,
      description: 'A new escape-room puzzle every day, the same for everyone. Solve it, share your grid and keep your streak.',
      path: '/daily',
    }
  }
  if (p === '/reviews') {
    return {
      title: `Escape room reviews · ${SITE_NAME}`,
      description: 'What players thought of the escape rooms they played, newest first. Filter out reviews with spoilers.',
      path: '/reviews',
    }
  }
  if (p.startsWith('/invite/')) {
    return { title: `You're invited to ${SITE_NAME}`, description: 'Join me on My Escapes to log the escape rooms we play together.', path: p, noindex: true, noUrl: true }
  }
  if (p === '/m' || p.startsWith('/m/')) return { title: SITE_NAME, description: DEFAULT_DESCRIPTION, path: '/m', noindex: true }
  if (p.startsWith('/admin')) return { title: `Admin · ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, path: p, noindex: true, noUrl: true }
  if (p === '/settings') return { title: `Settings · ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, path: '/settings', noindex: true }
  return null
}

async function gameRow(ctx: AppContext, slug: string): Promise<GameMetaRow | null> {
  const db = ctx.db()
  const row = (
    await db
      .select({
        id: games.id,
        name: games.name,
        slug: games.slug,
        genre: games.genre,
        minPlayers: games.minPlayers,
        maxPlayers: games.maxPlayers,
        durationMinutes: games.durationMinutes,
        description: games.description,
        venueName: venues.name,
        venueSlug: venues.slug,
        city: venues.city,
        region: venues.region,
        country: venues.country,
      })
      .from(games)
      .innerJoin(venues, eq(venues.id, games.venueId))
      .where(and(eq(games.slug, slug), sql`${games.status} <> 'hidden'`, sql`${venues.status} <> 'hidden'`))
      .limit(1)
  )[0]
  if (!row) return null
  // The same rule as public averages: public, not hidden, own scores (not a copy), by an onboarded author.
  const agg = (
    await db
      .select({ n: sql<number>`count(*)::int`, avg: sql<number | null>`round(avg(${reviews.overallScore}))::int` })
      .from(reviews)
      .innerJoin(visits, eq(visits.id, reviews.visitId))
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(
        and(
          eq(visits.gameId, row.id),
          eq(reviews.visibility, 'public'),
          isNull(reviews.hiddenAt),
          eq(reviews.scoresCopied, false),
          sql`${users.handle} is not null`,
        ),
      )
  )[0]
  const { id: _id, ...rest } = row
  return { ...rest, reviewCount: Number(agg?.n ?? 0), averageOverall: agg?.avg === null || agg?.avg === undefined ? null : Number(agg.avg) }
}

async function venueRow(ctx: AppContext, slug: string): Promise<VenueMetaRow | null> {
  const db = ctx.db()
  const v = (await db.select().from(venues).where(and(eq(venues.slug, slug), sql`${venues.status} <> 'hidden'`)).limit(1))[0]
  if (!v) return null
  const gs = await db
    .select({ name: games.name })
    .from(games)
    .where(and(eq(games.venueId, v.id), eq(games.status, 'active')))
    .orderBy(asc(games.name))
    .limit(50)
  return {
    name: v.name,
    slug: v.slug,
    address: v.address,
    city: v.city,
    region: v.region,
    country: v.country,
    postalCode: v.postalCode,
    lat: v.lat,
    lng: v.lng,
    website: v.website,
    status: v.status,
    games: gs.map((g) => g.name),
  }
}

async function cityRow(ctx: AppContext, slug: string) {
  const db = ctx.db()
  const [c] = await db.select().from(cities).where(eq(cities.slug, slug)).limit(1)
  const [count] = await db
    .select({ n: sql<number>`count(*)::int`, name: sql<string | null>`min(${venues.city})`, region: sql<string | null>`min(${venues.region})`, country: sql<string | null>`min(${venues.country})` })
    .from(venues)
    .where(and(eq(venues.citySlug, slug), eq(venues.status, 'active')))
  const n = Number(count?.n ?? 0)
  if (!c && !n) return null
  return { slug, name: c?.name ?? count?.name ?? slug, region: c?.region ?? count?.region ?? '', country: c?.country ?? count?.country ?? '', venueCount: n }
}

/** Meta for any page path, or null when the page has no specific tags (or doesn't exist). */
export async function pageMetaFor(url: string, ctx: AppContext): Promise<PageMeta | null> {
  const p = pathOf(url)
  const fixed = staticPageMeta(p)
  if (fixed) return fixed
  const m = /^\/(games|venues|cities)\/([^/]+)$/.exec(p)
  if (!m) return null
  const slug = slugParam(m[2])
  if (!slug) return null
  // Without a database the page still renders (client side); keep the default tags.
  if (ctx.dbState.status !== 'ready') return null
  const origin = siteOrigin(ctx.env)
  if (m[1] === 'games') {
    const g = await gameRow(ctx, slug)
    return g ? gameMeta(g) : null
  }
  if (m[1] === 'venues') {
    const v = await venueRow(ctx, slug)
    return v ? venueMeta(v, origin) : null
  }
  const c = await cityRow(ctx, slug)
  return c ? cityMeta(c) : null
}

export async function headTagsFor(url: string, ctx: AppContext): Promise<string | null> {
  const meta = await pageMetaFor(url, ctx)
  return meta ? renderHeadTags(meta, siteOrigin(ctx.env)) : null
}

// ---------------------------------------------------------------------------
// robots.txt and sitemap.xml
// ---------------------------------------------------------------------------

export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /m',
    'Disallow: /settings',
    'Disallow: /invite/',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

export interface SitemapUrl {
  path: string
  lastmod?: Date | string | null
}

export function sitemapXml(origin: string, urls: SitemapUrl[]): string {
  const day = (d: Date | string | null | undefined) => {
    if (!d) return null
    const date = d instanceof Date ? d : new Date(d)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const body = urls
    .map((u) => {
      const lm = day(u.lastmod)
      return `  <url><loc>${escapeHtml(origin + u.path)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}</url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/**
 * Public pages worth indexing: the static pages, every active directory venue and game, games
 * created by users only once they have a public review (a private log shouldn't advertise a page),
 * venues with an indexed game or from an import, and cities with an active venue.
 */
export async function sitemapUrls(ctx: AppContext, limit = SITEMAP_LIMIT): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [{ path: '/' }, { path: '/daily' }, { path: '/reviews' }, { path: '/about' }, { path: '/privacy' }, { path: '/terms' }]
  if (ctx.dbState.status !== 'ready') return urls
  const db = ctx.db()
  const hasPublicReview = sql`exists (
    select 1 from ${reviews} r join ${visits} v on v.id = r.visit_id join ${users} u on u.id = r.author_id
    where v.game_id = ${games.id} and r.visibility = 'public' and r.hidden_at is null and u.handle is not null)`
  const room = () => limit - urls.length
  const gameRows = await db
    .select({ slug: games.slug, updatedAt: games.updatedAt })
    .from(games)
    .innerJoin(venues, eq(venues.id, games.venueId))
    .where(and(eq(games.status, 'active'), sql`${venues.status} <> 'hidden'`, sql`(${games.createdBy} is null or ${hasPublicReview})`))
    .orderBy(asc(games.slug))
    .limit(Math.max(room(), 0))
  for (const g of gameRows) urls.push({ path: `/games/${g.slug}`, lastmod: g.updatedAt })
  if (room() > 0) {
    const venueRows = await db
      .select({ slug: venues.slug, updatedAt: venues.updatedAt })
      .from(venues)
      .where(
        and(
          sql`${venues.status} <> 'hidden'`,
          sql`(${venues.createdBy} is null or exists (select 1 from ${games} where ${games.venueId} = ${venues.id} and ${games.status} = 'active' and (${games.createdBy} is null or ${hasPublicReview})))`,
        ),
      )
      .orderBy(asc(venues.slug))
      .limit(room())
    for (const v of venueRows) urls.push({ path: `/venues/${v.slug}`, lastmod: v.updatedAt })
  }
  if (room() > 0) {
    const cityRows = await db
      .selectDistinct({ slug: venues.citySlug })
      .from(venues)
      .where(and(eq(venues.status, 'active'), sql`${venues.country} <> 'ZZ'`))
      .orderBy(asc(venues.citySlug))
      .limit(room())
    for (const c of cityRows) urls.push({ path: `/cities/${c.slug}` })
  }
  return urls
}

export async function seoRoutes(app: FastifyInstance, ctx: AppContext) {
  const originFor = (req: Parameters<AppContext['origin']>[0]) => siteOrigin(ctx.env) ?? ctx.origin(req)

  app.get('/robots.txt', async (req, reply) => {
    reply.header('cache-control', 'public, max-age=3600').type('text/plain; charset=utf-8')
    return robotsTxt(originFor(req))
  })

  let cache: { at: number; xml: string; origin: string } | null = null
  app.get('/sitemap.xml', async (req, reply) => {
    const origin = originFor(req)
    const now = Date.now()
    if (!cache || cache.origin !== origin || now - cache.at > 10 * 60_000) {
      const urls = await sitemapUrls(ctx)
      // Don't cache a database-less answer: it would hide the directory for ten minutes.
      const xml = sitemapXml(origin, urls)
      cache = ctx.dbState.status === 'ready' ? { at: now, xml, origin } : null
      reply.header('cache-control', 'public, max-age=3600').type('application/xml; charset=utf-8')
      return xml
    }
    reply.header('cache-control', 'public, max-age=3600').type('application/xml; charset=utf-8')
    return cache.xml
  })
}
