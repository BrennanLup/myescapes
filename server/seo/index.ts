/**
 * SEO and sharing: meta tags and Open Graph data for public pages (/games, /venues, /cities).
 * Owned by workstream 26 (server/seo). STUB: no routes, no head tags.
 *
 * `headTagsFor(url, ctx)` is called by the SPA fallback in server/static.ts for every HTML page
 * request; return a string of <meta>/<title> tags to inject before </head>, or null to serve
 * index.html unchanged. Escape every value you put in HTML. No image-rendering package is
 * installed: use the static brand images in public/ for og:image.
 */
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context'

export async function headTagsFor(_url: string, _ctx: AppContext): Promise<string | null> {
  return null
}

export async function seoRoutes(_app: FastifyInstance, _ctx: AppContext) {
  /* e.g. /sitemap.xml */
}
