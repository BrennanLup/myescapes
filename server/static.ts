// Serves the Vite build (dist/) with caching and precompressed (br/gzip) variants, plus SPA fallback and JSON 404s for /api.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { precompressDist } from './precompress'
import { injectHeadTags } from './seo/head'

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_NONE = 'no-cache'
export const CACHE_SHORT = 'public, max-age=3600'

/** Cache-Control for a file under dist/, by its path relative to dist. */
export function cacheControlFor(relPath: string): string {
  // A precompressed sibling (app.js.br, index.html.gz) is cached like the file it stands for.
  const p = relPath.split(path.sep).join('/').replace(/^\/+/, '').replace(/\.(br|gz)$/, '')
  if (p.startsWith('assets/')) return CACHE_IMMUTABLE
  if (p.endsWith('.html')) return CACHE_NONE
  return CACHE_SHORT
}

/** Pages in public/ served at /<name> from <name>.html. */
export const STATIC_PAGES = ['about', 'privacy', 'terms'] as const

function isApi(url: string) {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')
}

function wantsSpa(req: FastifyRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const url = req.url
  if (isApi(url)) return false
  // A missing hashed asset should 404, not get HTML back.
  if (url.startsWith('/assets/')) return false
  return true
}

export const MISSING_DIST_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Escapes: build needed</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#2b1d14;color:#fbeedd;font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
  .card{max-width:440px;background:#3a2719;border-radius:18px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
  h1{margin:0 0 8px;font-size:22px;color:#ffb067}
  code{background:#1e140d;color:#5fe0d2;padding:2px 8px;border-radius:6px}
</style></head>
<body><div class="card"><h1>Almost there</h1>
<p>The server is running, but the app has not been built yet.</p>
<p>Run <code>npm run build</code> and reload, or just use <code>npm start</code>, which builds for you.</p>
</div></body></html>`

function notFound(req: FastifyRequest, reply: FastifyReply) {
  if (isApi(req.url)) return reply.code(404).send({ error: `not found: ${req.method} ${req.url.split('?')[0]}` })
  return reply.code(404).type('text/plain; charset=utf-8').send('Not found')
}

/**
 * Registers static serving for `distDir` and a not-found handler that falls back to index.html
 * for client-side routes. Returns whether a build was found.
 */
export interface StaticOptions {
  /**
   * Extra <head> tags for an HTML page request (SEO, workstream 26). Return null to serve
   * index.html unchanged. Errors fall back to the plain page.
   */
  headTags?: (url: string) => Promise<string | null>
}

export async function registerStatic(app: FastifyInstance, distDir: string, opts: StaticOptions = {}): Promise<boolean> {
  const ready = existsSync(path.join(distDir, 'index.html'))
  if (!ready) {
    app.setNotFoundHandler((req, reply) => {
      if (!wantsSpa(req)) return notFound(req, reply)
      return reply.code(503).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(MISSING_DIST_HTML)
    })
    return false
  }

  // Make sure every text asset has .br/.gz siblings (the build already wrote them; this covers
  // a dist built some other way). Cheap when they are fresh: it only compares mtimes.
  precompressDist(distDir)

  await app.register(fastifyStatic, {
    root: distDir,
    index: false,
    // Serve app.js.br / app.js.gz when Accept-Encoding allows, with Content-Encoding, the original
    // Content-Type and Vary: accept-encoding. Falls back to the plain file otherwise.
    preCompressed: true,
    cacheControl: false,
    redirect: false,
    setHeaders: (reply, filePath) => {
      reply.header('cache-control', cacheControlFor(path.relative(distDir, filePath)))
    },
  })

  let indexHtml: string | null = null
  const plainIndex = (reply: FastifyReply) => reply.header('cache-control', CACHE_NONE).sendFile('index.html')
  // Callbacks below never return the reply: a reply is thenable, and resolving a promise with it
  // makes Node call reply.then(), which piles 'close' listeners on the response.
  const sendIndex = (reply: FastifyReply, url?: string) => {
    if (!opts.headTags || !url) return plainIndex(reply)
    void opts
      .headTags(url)
      .catch((err: Error) => {
        console.error(`[seo] head tags failed for ${url.split('?')[0]}: ${err.message}`)
        return null
      })
      .then((tags) => {
        if (!tags) {
          plainIndex(reply)
          return
        }
        indexHtml ??= readFileSync(path.join(distDir, 'index.html'), 'utf8')
        reply.header('cache-control', CACHE_NONE).type('text/html; charset=utf-8').send(injectHeadTags(indexHtml, tags))
      })
    return reply
  }
  app.get('/', (req, reply) => sendIndex(reply, req.url))
  // Static info pages (public/*.html), served at clean URLs. Google's OAuth consent screen links to these.
  for (const page of STATIC_PAGES) {
    app.get(`/${page}`, (_req, reply) => reply.header('cache-control', CACHE_NONE).sendFile(`${page}.html`))
  }
  app.setNotFoundHandler((req, reply) => {
    if (!wantsSpa(req)) return notFound(req, reply)
    return sendIndex(reply, req.url)
  })
  return true
}
