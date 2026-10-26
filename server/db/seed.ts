/**
 * Local demo seed: puts the 12 invented Phase 1 rooms (seed/reviews.json) into the directory as
 * venues and games, so a fresh local database has something to search. Idempotent.
 *
 *   npm run db:seed            # local PGlite store, or DATABASE_URL
 *
 * Refuses to run when NODE_ENV=production: the live directory comes from the importers
 * (scripts/import/*), never from invented data.
 */
import '../env'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSeed } from '../../src/data/server/seedRepository'
import { createDb, type Db } from './client'
import { runMigrations } from './migrate'
import { cities, games, venues } from './schema'
import { citySlug, slugify } from './util'

const SEED_CITIES: Record<string, { region: string; country: string; lat: number; lng: number }> = {
  'San Francisco': { region: 'CA', country: 'US', lat: 37.7749, lng: -122.4194 },
  Toronto: { region: 'ON', country: 'CA', lat: 43.6532, lng: -79.3832 },
}

export async function seedDemoDirectory(db: Db): Promise<{ venues: number; games: number }> {
  const seed = await loadSeed()
  let v = 0
  let g = 0
  for (const room of seed.rooms) {
    const c = SEED_CITIES[room.city] ?? { region: '', country: 'US', lat: null, lng: null }
    const cslug = citySlug(room.city, c.region, c.country)
    await db.insert(cities).values({ slug: cslug, name: room.city, region: c.region, country: c.country, lat: c.lat, lng: c.lng }).onConflictDoNothing()
    const vslug = slugify(`${room.company} ${room.city}`)
    const insertedVenue = await db
      .insert(venues)
      .values({ slug: vslug, name: room.company, brand: room.company, address: room.address, city: room.city, citySlug: cslug, region: c.region, country: c.country, website: room.website || null })
      .onConflictDoNothing({ target: venues.slug })
      .returning({ id: venues.id })
    v += insertedVenue.length
    const venue = insertedVenue[0] ?? (await db.query.venues.findFirst({ where: (t, { eq }) => eq(t.slug, vslug), columns: { id: true } }))
    if (!venue) continue
    const insertedGame = await db
      .insert(games)
      .values({ venueId: venue.id, slug: slugify(`${room.name} ${room.company} ${room.city}`), name: room.name, genre: room.genre, website: room.website || null })
      .onConflictDoNothing()
      .returning({ id: games.id })
    g += insertedGame.length
  }
  return { venues: v, games: g }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[db] Refusing to seed invented demo data when NODE_ENV=production.')
    process.exitCode = 1
    return
  }
  const handle = await createDb()
  try {
    await runMigrations(handle)
    const n = await seedDemoDirectory(handle.db)
    console.log(`[db] Demo directory seeded: ${n.venues} new venues, ${n.games} new games.`)
  } finally {
    await handle.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
