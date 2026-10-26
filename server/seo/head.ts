/**
 * Pure helpers for SEO head tags (workstream 26): escaping, tag building and injection into
 * index.html. No database access here, so these are cheap to unit test.
 */

export const SITE_NAME = 'My Escapes'
export const DEFAULT_DESCRIPTION = "Every escape room you've played, pinned up in your own cozy 3D room."
/** 1200 x 630 brand image in public/. No image-rendering package is installed, so every page shares it. */
export const OG_IMAGE_PATH = '/og-image.png'
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const OG_IMAGE_ALT = 'My Escapes: a cozy room with escape-room polaroids pinned to a board'

/** Escape text for an HTML attribute or element body. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** JSON for a <script type="application/ld+json"> block: `<`, `>`, `&` escaped so it can't close the script. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/** Collapse whitespace and cut to `max` characters on a word boundary, with an ellipsis. */
export function clip(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

/**
 * The public origin for absolute URLs (canonical, og:url, og:image): PUBLIC_URL, else Railway's
 * RAILWAY_PUBLIC_DOMAIN, else null (then URLs stay relative). Never the request's Host header, so
 * a forged header can't end up in a page.
 */
export function siteOrigin(env: NodeJS.ProcessEnv): string | null {
  const configured = env.PUBLIC_URL?.trim().replace(/\/+$/, '')
  if (configured && /^https?:\/\/[^\s/]+$/i.test(configured)) return configured
  const domain = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  if (domain && /^[a-z0-9.-]+(:\d+)?$/i.test(domain)) return `https://${domain}`
  return null
}

export interface PageMeta {
  title: string
  description: string
  /** Path of the page, e.g. `/games/the-lost-observatory`. */
  path: string
  /** Default `website`. */
  type?: 'website' | 'place' | 'profile'
  /** Ask search engines not to index (private or per-user pages). */
  noindex?: boolean
  /** Leave out canonical/og:url (pages whose URL is a secret, e.g. invite links). */
  noUrl?: boolean
  /** schema.org JSON-LD object. */
  jsonLd?: Record<string, unknown>
}

/** Absolute URL when the origin is known, else the path as is. */
export function absolute(origin: string | null, p: string): string {
  return origin ? `${origin}${p.startsWith('/') ? p : `/${p}`}` : p
}

/** The <title>, description, canonical, Open Graph, Twitter and robots tags for a page. Every value is escaped. */
export function renderHeadTags(meta: PageMeta, origin: string | null): string {
  const e = escapeHtml
  const title = clip(meta.title, 110)
  const description = clip(meta.description, 200)
  const url = absolute(origin, meta.path)
  const image = absolute(origin, OG_IMAGE_PATH)
  const tags = [
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex" />' : '',
    origin && !meta.noUrl ? `<link rel="canonical" href="${e(url)}" />` : '',
    `<meta property="og:site_name" content="${e(SITE_NAME)}" />`,
    `<meta property="og:type" content="${e(meta.type === 'place' ? 'place' : meta.type === 'profile' ? 'profile' : 'website')}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(description)}" />`,
    origin && !meta.noUrl ? `<meta property="og:url" content="${e(url)}" />` : '',
    `<meta property="og:image" content="${e(image)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${e(OG_IMAGE_ALT)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${e(title)}" />`,
    `<meta name="twitter:description" content="${e(description)}" />`,
    `<meta name="twitter:image" content="${e(image)}" />`,
    meta.jsonLd ? `<script type="application/ld+json">${jsonForScript(meta.jsonLd)}</script>` : '',
  ]
  return tags.filter(Boolean).join('\n    ') + '\n  '
}

/**
 * Tags in index.html that `renderHeadTags` replaces. Removed before injecting so a page never has
 * two <title>s or two og:title tags (crawlers pick the first one).
 */
const REPLACED_TAGS: RegExp[] = [
  /<title\b[^>]*>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name=["']description["'][^>]*>\s*/gi,
  /<meta\s+name=["']robots["'][^>]*>\s*/gi,
  /<meta\s+name=["']twitter:[^"']*["'][^>]*>\s*/gi,
  /<meta\s+property=["']og:[^"']*["'][^>]*>\s*/gi,
  /<link\s+rel=["']canonical["'][^>]*>\s*/gi,
]

/** Put `tags` into `html` before </head>, replacing the default title/description/OG tags. */
export function injectHeadTags(html: string, tags: string): string {
  const end = html.search(/<\/head>/i)
  if (end === -1) return html
  let head = html.slice(0, end)
  for (const re of REPLACED_TAGS) head = head.replace(re, '')
  return `${head}${tags}${html.slice(end)}`
}
