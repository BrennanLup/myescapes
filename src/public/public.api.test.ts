// @vitest-environment node
/**
 * Server-side checks for the public pages (workstreams 16-19):
 *  1. The SPA routes for the landing, game, venue and city pages are served, and the static
 *     /about, /privacy and /terms pages keep working next to them.
 *  2. Contract checks on the public page APIs, run against the shared PGlite fixtures. The routes
 *     (workstreams 5 and 33) must answer 200 and keep what the public pages rely on: no emails,
 *     no transcripts, no friends-only or private reviews for anonymous visitors, spoiler-marked
 *     puzzles, copied scores left out of the averages, and attribution for directory data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildServer, type EscapeServer } from '../../server/index'
import { buildTestApp, type TestApp } from '../../server/testing'
import { FX } from '../../server/db/fixtures'
import { CityPageSchema, GamePageSchema, ReviewPageSchema, VenuePageSchema } from '../contracts/models'

const FIXTURE_EMAILS = ['alice@example.com', 'bob@example.com', 'mia@example.com', 'carol@example.com']

function expectNoPrivateData(body: string) {
  for (const email of FIXTURE_EMAILS) expect(body).not.toContain(email)
  expect(body).not.toMatch(/"email"\s*:/)
  expect(body).not.toContain('private transcript')
}

describe('SPA and static pages', () => {
  let dist: string
  let app: EscapeServer
  beforeAll(async () => {
    dist = mkdtempSync(path.join(os.tmpdir(), 'myescapes-public-dist-'))
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>My Escapes</title></head><body><div id="root"></div></body></html>')
    mkdirSync(path.join(dist, 'assets'))
    for (const page of ['about', 'privacy', 'terms']) copyFileSync(path.join(process.cwd(), 'public', `${page}.html`), path.join(dist, `${page}.html`))
    app = await buildServer({ distDir: dist })
    await app.ready()
  })
  afterAll(async () => {
    await app?.close()
    rmSync(dist, { recursive: true, force: true })
  })

  it.each(['/', '/welcome', '/welcome?next=%2Fdaily', '/?demo=1', '/games/the-lost-observatory', '/venues/starlight-escapes', '/cities/san-francisco-ca-us'])('serves the app shell at %s', async (url) => {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('<div id="root"></div>')
  })

  it.each([
    ['/about', 'What it does'],
    ['/privacy', 'Privacy policy'],
    ['/terms', 'Terms'],
  ])('keeps the static page %s', async (url, text) => {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(text)
    expect(res.body).not.toContain('<div id="root">')
  })
})

describe('public page APIs on the fixtures', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await buildTestApp({ fixtures: true })
  })
  afterAll(async () => {
    await t?.close()
  })

  /** Returns the parsed body (the `null` branch is kept so the checks below stay unchanged). */
  async function getPublic(url: string, as?: string): Promise<{ raw: string; json: unknown } | null> {
    const res = await t.inject({ method: 'GET', url, as })
    // Workstreams 5 and 33 are merged: every public page route must answer for real now.
    expect(res.statusCode).toBe(200)
    expectNoPrivateData(res.body)
    return { raw: res.body, json: res.json() }
  }

  it('game page: aggregates exclude copied scores, puzzles are spoilers, no private data', async () => {
    const lighthouse = await getPublic(`/api/games/${FX.gameSlugs.lighthouse}`)
    if (lighthouse) {
      const page = GamePageSchema.parse(lighthouse.json)
      // aliceGuest 92 + aliceCopy 84; Mia's untouched copy is left out.
      expect(page.aggregate.reviewCount).toBe(2)
      expect(page.aggregate.avg.overall).toBeCloseTo(88, 0)
      expect(page.reviews.reviews.find((r) => r.id === FX.reviews.miaCopy)?.scoresCopied ?? true).toBe(true)
      // Toronto venue imported from OSM.
      expect(page.attribution.map((a) => a.source)).toContain('osm')
    }

    const observatory = await getPublic(`/api/games/${FX.gameSlugs.observatory}`)
    if (observatory) {
      const page = GamePageSchema.parse(observatory.json)
      const ids = page.reviews.reviews.map((r) => r.id)
      expect(ids).toContain(FX.reviews.aliceTogether)
      expect(ids).toContain(FX.reviews.carol)
      // Bob's review is friends-only: not for anonymous visitors, not in the averages.
      expect(ids).not.toContain(FX.reviews.bobTogether)
      expect(page.aggregate.reviewCount).toBe(2)
      expect(page.puzzles.every((p) => p.spoiler === true)).toBe(true)
      expect(page.attribution.map((a) => a.source)).toContain('foursquare')
      for (const r of page.reviews.reviews) expect(r.author.handle).toBeTruthy()
    }
  })

  it('game page for an unknown slug is 404 (or not built yet)', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/games/no-such-game' })
    expect(res.statusCode).toBe(404)
  })

  it('game reviews: anonymous visitors only see public reviews', async () => {
    const res = await getPublic(`/api/games/${FX.gameSlugs.observatory}/reviews`)
    if (res) {
      const page = ReviewPageSchema.parse(res.json)
      expect(page.reviews.map((r) => r.id)).not.toContain(FX.reviews.bobTogether)
    }
    // Signed in as Carol (a stranger to Bob): still no friends-only review of Bob's.
    const carol = await getPublic(`/api/games/${FX.gameSlugs.observatory}/reviews`, FX.users.carol)
    if (carol) expect(ReviewPageSchema.parse(carol.json).reviews.map((r) => r.id)).not.toContain(FX.reviews.bobTogether)
  })

  it('venue page lists its games with attribution', async () => {
    const res = await getPublic(`/api/venues/${FX.venueSlugs.starlight}`)
    if (res) {
      const page = VenuePageSchema.parse(res.json)
      expect(page.games.map((g) => g.id).sort()).toEqual([FX.games.observatory, FX.games.vault].sort())
      expect(page.attribution.map((a) => a.source)).toContain('foursquare')
    }
  })

  it('city page lists its venues', async () => {
    const res = await getPublic(`/api/cities/${FX.cities.toronto}`)
    if (res) {
      const page = CityPageSchema.parse(res.json)
      expect(page.venues.map((v) => v.id)).toEqual([FX.venues.maple])
    }
  })

  it('reporting needs a signed-in user', async () => {
    const res = await t.inject({ method: 'POST', url: '/api/reports', payload: { targetType: 'review', targetId: FX.reviews.aliceGuest, reason: 'spam' } })
    expect(res.statusCode).toBe(401)
  })
})
