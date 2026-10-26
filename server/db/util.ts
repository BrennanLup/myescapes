/**
 * Small shared helpers for route modules and importers. Owned by foundation.
 */
import { like, or, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PublicUser } from '../../src/contracts/models'
import type { Db } from './client'

/** "Starlight Escapes: The Lost Observatory!" -> "starlight-escapes-the-lost-observatory". */
export function slugify(text: string, maxLength = 80): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return s || 'item'
}

/** City slug: `san-francisco-ca-us`. */
export function citySlug(city: string, region: string, country: string): string {
  return slugify([city, region, country].filter(Boolean).join(' '))
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
