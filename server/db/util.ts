/**
 * Small shared helpers for route modules and importers. Owned by foundation.
 */
import { like, or, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PublicUser } from '../../src/contracts/models'
import type { Db } from './client'

/**
 * Cyrillic and Greek letters -> Latin (after NFKD, so accents are already split off), so names
 * like "Квест Ловушка" or "Θεσσαλονίκη" get readable slugs, plus the Latin letters NFKD leaves
 * whole ("Kaçış" -> "kacis", "Łódź" -> "lodz", "Straße" -> "strasse"). Other scripts have no transliteration
 * here: those names fall back as before (citySlug hashes them).
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya', і: 'i', є: 'ye', ґ: 'g', ў: 'u', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz', ѓ: 'gj', ќ: 'kj', ѕ: 'dz',
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o',
  π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
  // Latin letters NFKD does not split into a base letter and an accent.
  ı: 'i', ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd',
}
const TRANSLIT_RE = /[\u0400-\u04ff\u0370-\u03ffıłđøßæœþð]/g

/** "Starlight Escapes: The Lost Observatory!" -> "starlight-escapes-the-lost-observatory". */
export function slugify(text: string, maxLength = 80): string {
  const s = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(TRANSLIT_RE, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return s || 'item'
}

/**
 * City slug: `san-francisco-ca-us`. A name with no Latin letters or digits ("里士满", "東京") would
 * slugify to nothing and every such city in a region would share `bc-ca`, so it gets a stable
 * `city-<hash>` part instead.
 */
export function citySlug(city: string, region: string, country: string): string {
  const name = city.trim()
  const latin = slugify(name) !== 'item' || /item/i.test(name)
  const cityPart = !name || latin ? name : `city ${shortHash(name.normalize('NFKC').toLowerCase())}`
  return slugify([cityPart, region, country].filter(Boolean).join(' '))
}

/** 8 hex characters of FNV-1a: stable across runs and machines, not for security. */
function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * A slug not yet used in `column`: `base`, else `base-2`, `base-3`, ...
 * Not a lock: the unique index is the real guard, so retry on a unique violation.
 */
export async function uniqueSlug(db: Db, table: PgTable, column: PgColumn, base: string): Promise<string> {
  const rows = (await db
    .select({ slug: column })
    .from(table)
    .where(or(eq(column, base), like(column, `${base}-%`)))) as { slug: string }[]
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** The public face of a user row. Never includes the email. */
export function toPublicUser(u: { id: string; handle: string | null; displayName: string | null; name: string; image: string | null }): PublicUser {
  return { id: u.id, handle: u.handle, displayName: u.displayName || u.name, image: u.image }
}

/** Postgres unique-violation check (works for pg and PGlite errors, also when wrapped by Drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (e.code === '23505') return true
  }
  return false
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** "Open in Google Maps" link from a stored place id (allowed by Google's terms). */
export function googleMapsUrl(placeId: string | null, name: string): string | null {
  if (!placeId) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`
}

/** Only http(s) links are stored, so a page never renders a `javascript:` URL. */
export function safeWebsite(url: string | null | undefined): string | null {
  if (!url) return null
  const s = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    const u = new URL(s)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}
