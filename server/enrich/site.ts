/**
 * Reads a venue's own website for the room crawler: the home page plus up to a few same-site pages
 * that look like room lists ("rooms", "games", "book"…), as plain text. Polite by default: one
 * request at a time per site, a short timeout, a size cap, our own user agent, and robots.txt.
 * Only public hosts are fetched (every redirect hop is checked), so a stored website can't point
 * the crawler into our own network.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const USER_AGENT = 'MyEscapesBot/1.0 (+https://myescapes.club/about)'
const TIMEOUT_MS = 12_000
const MAX_BYTES = 1_500_000
const MAX_PAGE_CHARS = 12_000
const MAX_TOTAL_CHARS = 32_000
const MAX_EXTRA_PAGES = 3

export interface SitePage {
  url: string
  title: string
  text: string
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
/** Resolves a host name to its addresses (injectable for tests). */
export type LookupLike = (host: string) => Promise<string[]>

const defaultLookup: LookupLike = async (host) => (await lookup(host, { all: true })).map((a) => a.address)

/** Loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(ip)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  const x = ip.toLowerCase()
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff')
}

/** True when every address of the URL's host is public (no requests into our own network). */
export async function isPublicHost(url: URL, lookupFn: LookupLike = defaultLookup): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false
  try {
    const addrs = isIP(host) ? [host] : await lookupFn(host)
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a))
  } catch {
    return false
  }
}

/** Absolute http(s) URL for a stored website, or null. */
export function normalizeSite(website: string | null | undefined): URL | null {
  const raw = (website ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

const MAX_REDIRECTS = 5

async function get(fetchFn: FetchLike, url: string, lookupFn: LookupLike, accept = 'text/html,application/xhtml+xml'): Promise<{ url: string; body: string; type: string } | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    // Redirects are followed by hand so every hop's host is checked.
    let current = url
    let res: Response | null = null
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current)
      if (!/^https?:$/.test(u.protocol) || !(await isPublicHost(u, lookupFn))) return null
      res = await fetchFn(current, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'manual', signal: ctl.signal })
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!loc) break
      await res.body?.cancel().catch(() => undefined)
      current = new URL(loc, current).href
      res = null
    }
    if (!res || !res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    const reader = res.body?.getReader()
    if (!reader) return { url: current, body: await res.text(), type }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(value)
    }
    return { url: current, body: new TextDecoder().decode(Buffer.concat(chunks)), type }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** robots.txt rules for us (our agent's group, else `*`): true when `path` may be fetched. */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false
      if (val) current.rules.push({ allow: key === 'allow', path: val })
    } else {
      lastWasAgent = false
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && 'myescapesbot'.startsWith(a))) ?? groups.find((g) => g.agents.includes('*'))
  if (!mine) return true
  // Longest matching rule wins; Allow wins a tie.
  let best: { allow: boolean; len: number } | null = null
  for (const r of mine.rules) {
    const re = new RegExp('^' + r.path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'))
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length }
  }
  return best ? best.allow : true
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Visible text of an HTML page (scripts, styles and markup dropped), plus its title and links. */
export function htmlToText(html: string, baseUrl: string): { title: string; text: string; links: { href: string; label: string }[] } {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim())
  const links: { href: string; label: string }[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(decodeEntities(m[1]), baseUrl).href
      links.push({ href, label: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80) })
    } catch {
      /* skip */
    }
  }
  // Keep image alt text and meta descriptions: room names often live there.
  const meta = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/gi)].map((m) => m[1])
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' $1 ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title, text: [meta.join(' '), text].filter(Boolean).join('\n'), links }
}

const ROOMISH = /\b(rooms?|games?|escape|missions?|adventures?|experiences?|quests?|book(ing)?|reserv|tickets?|our-|spiele?|salles?|salas?|jeux|juegos|stanze|kamer|pokoj|quest)\b/i
const SKIP = /\b(blog|news|careers?|jobs|privacy|terms|cookie|faq|contact|gift|voucher|party|parties|corporate|team-?building|login|cart|account|wp-content|cdn-cgi)\b|\.(pdf|jpe?g|png|gif|zip|mp4)$/i

/** Same-site links most likely to list the venue's rooms, best first. */
export function pickRoomLinks(links: { href: string; label: string }[], site: URL, max = MAX_EXTRA_PAGES): string[] {
  const host = site.hostname.replace(/^www\./, '')
  const seen = new Set<string>([site.href.replace(/\/$/, '')])
  const scored: { href: string; score: number }[] = []
  for (const l of links) {
    let u: URL
    try {
      u = new URL(l.href)
    } catch {
      continue
    }
    if (u.hostname.replace(/^www\./, '') !== host || !/^https?:$/.test(u.protocol)) continue
    u.hash = ''
    const key = u.href.replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const hay = `${decodeURIComponent(u.pathname)} ${l.label}`
    if (SKIP.test(hay)) continue
    let score = 0
    if (ROOMISH.test(u.pathname)) score += 2
    if (ROOMISH.test(l.label)) score += 2
    if (/\b(rooms|games|escape-rooms?|our-rooms|all-rooms)\b/i.test(hay)) score += 3
    if (score > 0) scored.push({ href: u.href, score: score - u.pathname.split('/').length * 0.1 })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.href)
}

export interface SiteReadResult {
  pages: SitePage[]
  /** Why nothing was read, when `pages` is empty. */
  reason?: 'no_website' | 'robots' | 'unreachable' | 'not_html'
}

/** Reads the home page and the best room-looking pages of a venue's site. */
export async function readVenueSite(website: string | null | undefined, fetchFn: FetchLike = fetch, lookupFn: LookupLike = defaultLookup): Promise<SiteReadResult> {
  const site = normalizeSite(website)
  if (!site) return { pages: [], reason: 'no_website' }
  const robots = await get(fetchFn, new URL('/robots.txt', site).href, lookupFn, 'text/plain')
  const allowed = (u: URL) => !robots || !/text\/plain/i.test(robots.type) || robotsAllows(robots.body, u.pathname + u.search)
  if (!allowed(site)) return { pages: [], reason: 'robots' }
  const home = await get(fetchFn, site.href, lookupFn)
  if (!home) return { pages: [], reason: 'unreachable' }
  if (home.type && !/html|xml/i.test(home.type)) return { pages: [], reason: 'not_html' }
  const parsed = htmlToText(home.body, home.url)
  const pages: SitePage[] = [{ url: home.url, title: parsed.title, text: parsed.text.slice(0, MAX_PAGE_CHARS) }]
  let total = pages[0].text.length
  for (const href of pickRoomLinks(parsed.links, new URL(home.url))) {
    if (total >= MAX_TOTAL_CHARS) break
    if (!allowed(new URL(href))) continue
    const p = await get(fetchFn, href, lookupFn)
    if (!p || (p.type && !/html|xml/i.test(p.type))) continue
    const t = htmlToText(p.body, p.url)
    const text = t.text.slice(0, Math.min(MAX_PAGE_CHARS, MAX_TOTAL_CHARS - total))
    pages.push({ url: p.url, title: t.title, text })
    total += text.length
  }
  return { pages }
}
