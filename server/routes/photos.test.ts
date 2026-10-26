// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { PhotoV2Schema } from '../../src/contracts/models'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { TINY_PNG } from '../db/fixtures'
import { games, reviews, users, venues, visitParticipants, visitPhotos } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'
import { MAX_PHOTOS_PER_VISIT } from './photos'
import { jpegHeader, multipart, pngHeader, webpHeader } from './photos.testutil'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

const U = () => t.fx.users
const V = () => t.fx.visits

async function upload(visitId: string, as: string | undefined, bytes: Uint8Array, fields: Record<string, string> = {}, field = 'photo') {
  const body = await multipart(fields, { bytes, field, type: 'image/png' })
  return t.inject({ method: 'POST', url: `/api/visits/${visitId}/photos`, as, payload: body.payload, headers: body.headers })
}
const get = (id: string, as?: string) => t.inject({ method: 'GET', url: `/api/photos/${id}`, as })
const del = (id: string, as?: string) => t.inject({ method: 'DELETE', url: `/api/photos/${id}`, as })
const code = (res: { json(): unknown }) => ApiErrorSchema.parse(res.json()).code

describe('upload', () => {
  it('an owner uploads; type and size come from the file, not the form fields', async () => {
    const res = await upload(V().together, U().alice, pngHeader(1600, 1200), { caption: '  Group shot  ', width: '1', height: '1' })
    expect(res.statusCode).toBe(201)
    const p = PhotoV2Schema.parse(res.json())
    expect(p).toMatchObject({ visitId: V().together, uploaderId: U().alice, caption: 'Group shot', width: 1600, height: 1200, url: `/api/photos/${p.id}` })
    const row = (await t.db.select().from(visitPhotos).where(eq(visitPhotos.id, p.id)))[0]
    expect(row.mime).toBe('image/png')
    expect(row.sizeBytes).toBe(33)
  })

  it('an accepted participant uploads JPEG and WebP', async () => {
    const jpg = await upload(V().together, U().bob, jpegHeader(800, 600))
    expect(jpg.statusCode).toBe(201)
    expect(PhotoV2Schema.parse(jpg.json())).toMatchObject({ width: 800, height: 600, uploaderId: U().bob })
    const webp = await upload(V().copy, U().mia, webpHeader(640, 480))
    expect(webp.statusCode).toBe(201)
  })

  it('uses the form width and height when the header has no size', async () => {
    const res = await upload(V().together, U().alice, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), { width: '1200', height: '900' })
    expect(res.statusCode).toBe(201)
    expect(PhotoV2Schema.parse(res.json())).toMatchObject({ width: 1200, height: 900 })
  })

  it('a pending tag cannot upload (403); strangers get 404; signed out gets 401', async () => {
    const pending = await upload(V().pending, U().bob, TINY_PNG)
    expect(pending.statusCode).toBe(403)
    expect(code(pending)).toBe('forbidden')
    const stranger = await upload(V().together, U().carol, TINY_PNG)
    expect(stranger.statusCode).toBe(404)
    expect(code(stranger)).toBe('not_found')
    expect((await upload(V().together, undefined, TINY_PNG)).statusCode).toBe(401)
    expect((await upload('vis_nope', U().alice, TINY_PNG)).statusCode).toBe(404)
  })

  it('a declined tag cannot upload', async () => {
    await t.db.update(visitParticipants).set({ status: 'declined' }).where(eq(visitParticipants.id, t.fx.participants.bobPending))
    try {
      expect((await upload(V().pending, U().bob, TINY_PNG)).statusCode).toBe(404)
    } finally {
      await t.db.update(visitParticipants).set({ status: 'pending' }).where(eq(visitParticipants.id, t.fx.participants.bobPending))
    }
  })

  it('rejects files that are not JPEG, PNG or WebP (415), even with an image content type', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await upload(V().together, U().alice, svg)
    expect(res.statusCode).toBe(415)
    expect(code(res)).toBe('unsupported_media')
  })

  it('rejects photos over 1 MB (413 too_large)', async () => {
    const res = await upload(V().together, U().alice, pngHeader(1600, 1200, 1024 * 1024 + 1))
    expect(res.statusCode).toBe(413)
    expect(code(res)).toBe('too_large')
  })

  it('rejects photos that were not resized (over 4096 px)', async () => {
    const res = await upload(V().together, U().alice, pngHeader(6000, 4000))
    expect(res.statusCode).toBe(400)
    expect(code(res)).toBe('invalid')
  })

  it('rejects a missing file, a wrong field name, a long caption and JSON bodies', async () => {
    const none = await multipart({ caption: 'hi' })
    const r1 = await t.inject({ method: 'POST', url: `/api/visits/${V().together}/photos`, as: U().alice, payload: none.payload, headers: none.headers })
    expect(r1.statusCode).toBe(400)
    expect((await upload(V().together, U().alice, TINY_PNG, {}, 'image')).statusCode).toBe(400)
    expect((await upload(V().together, U().alice, TINY_PNG, { caption: 'x'.repeat(281) })).statusCode).toBe(400)
    const json = await t.inject({ method: 'POST', url: `/api/visits/${V().together}/photos`, as: U().alice, payload: { photo: 'abc' } })
    expect(json.statusCode).toBe(400)
  })

  it(`caps a visit at ${MAX_PHOTOS_PER_VISIT} photos`, async () => {
    const existing = (await t.db.select({ id: visitPhotos.id }).from(visitPhotos).where(eq(visitPhotos.visitId, V().solo))).length
    const rows = Array.from({ length: MAX_PHOTOS_PER_VISIT - existing }, () => ({ visitId: V().solo, uploaderId: U().alice, mime: 'image/png', bytes: TINY_PNG, sizeBytes: TINY_PNG.length }))
    const inserted = await t.db.insert(visitPhotos).values(rows).returning({ id: visitPhotos.id })
    try {
      const res = await upload(V().solo, U().alice, TINY_PNG)
      expect(res.statusCode).toBe(409)
      expect(code(res)).toBe('conflict')
    } finally {
      for (const r of inserted) await t.db.delete(visitPhotos).where(eq(visitPhotos.id, r.id))
    }
  })
})

describe('serving', () => {
  it('serves the bytes with the stored type, nosniff and a private cache header', async () => {
    const res = await get(t.fx.photos.bobTogether, U().alice)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toContain('private')
    expect(new Uint8Array(res.rawPayload)).toEqual(TINY_PNG)
  })

  it('anyone can see photos of a visit with a public review', async () => {
    expect((await get(t.fx.photos.bobTogether)).statusCode).toBe(200)
    expect((await get(t.fx.photos.bobTogether, U().carol)).statusCode).toBe(200)
  })

  it('photos of a visit with only private reviews are for participants only', async () => {
    const up = await upload(V().solo, U().alice, TINY_PNG)
    const id = PhotoV2Schema.parse(up.json()).id
    expect((await get(id, U().alice)).statusCode).toBe(200)
    expect((await get(id, U().carol)).statusCode).toBe(404)
    expect((await get(id, U().bob)).statusCode).toBe(404)
    expect((await get(id)).statusCode).toBe(404)
  })

  it('friends-only reviews do not make a visit public', async () => {
    // Make alice's review on `together` private: bob's is friends-only, so the visit is no longer public.
    await t.db.update(reviews).set({ visibility: 'private' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    try {
      expect((await get(t.fx.photos.bobTogether)).statusCode).toBe(404)
      expect((await get(t.fx.photos.bobTogether, U().carol)).statusCode).toBe(404)
      expect((await get(t.fx.photos.bobTogether, U().bob)).statusCode).toBe(200)
    } finally {
      await t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    }
  })

  it('a pending tag can see the photos (to decide "that was me")', async () => {
    await t.db.update(reviews).set({ visibility: 'private' }).where(eq(reviews.id, t.fx.reviews.alicePending))
    try {
      const up = await upload(V().pending, U().alice, TINY_PNG)
      const id = PhotoV2Schema.parse(up.json()).id
      expect((await get(id, U().bob)).statusCode).toBe(200)
      expect((await get(id, U().carol)).statusCode).toBe(404)
    } finally {
      await t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.id, t.fx.reviews.alicePending))
    }
  })

  it('hidden photos, hidden reviews and hidden games are not public; participants still see the photo', async () => {
    const id = t.fx.photos.bobTogether
    await t.db.update(visitPhotos).set({ hiddenAt: new Date() }).where(eq(visitPhotos.id, id))
    expect((await get(id)).statusCode).toBe(404)
    expect((await get(id, U().alice)).statusCode).toBe(200)
    await t.db.update(visitPhotos).set({ hiddenAt: null }).where(eq(visitPhotos.id, id))

    await t.db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    expect((await get(id)).statusCode).toBe(404)
    await t.db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, t.fx.reviews.aliceTogether))

    await t.db.update(games).set({ status: 'hidden' }).where(eq(games.id, t.fx.games.observatory))
    expect((await get(id)).statusCode).toBe(404)
    await t.db.update(games).set({ status: 'active' }).where(eq(games.id, t.fx.games.observatory))
    expect((await get(id)).statusCode).toBe(200)
  })

  it('a public review only makes photos public when its author has a public name and the venue is not hidden', async () => {
    const id = t.fx.photos.bobTogether
    const alice = (await t.db.select().from(users).where(eq(users.id, U().alice)))[0]!
    await t.db.update(users).set({ handle: null }).where(eq(users.id, U().alice))
    try {
      expect((await get(id)).statusCode).toBe(404)
      expect((await get(id, U().carol)).statusCode).toBe(404)
      expect((await get(id, U().bob)).statusCode).toBe(200)
    } finally {
      await t.db.update(users).set({ handle: alice.handle }).where(eq(users.id, U().alice))
    }
    expect((await get(id)).statusCode).toBe(200)

    const game = (await t.db.select().from(games).where(eq(games.id, t.fx.games.observatory)))[0]!
    const venue = (await t.db.select().from(venues).where(eq(venues.id, game.venueId)))[0]!
    await t.db.update(venues).set({ status: 'hidden' }).where(eq(venues.id, venue.id))
    try {
      expect((await get(id)).statusCode).toBe(404)
      expect((await get(id, U().alice)).statusCode).toBe(200)
    } finally {
      await t.db.update(venues).set({ status: venue.status }).where(eq(venues.id, venue.id))
    }
    expect((await get(id)).statusCode).toBe(200)
  })

  it('unknown ids are 404', async () => {
    expect((await get('pho_nope')).statusCode).toBe(404)
  })
})

describe('delete', () => {
  it('only the uploader can remove a photo', async () => {
    const id = t.fx.photos.bobTogether
    const alice = await del(id, U().alice)
    expect(alice.statusCode).toBe(403)
    expect(code(alice)).toBe('forbidden')
    // Carol can see it (public visit) but it isn't hers.
    expect((await del(id, U().carol)).statusCode).toBe(403)
    expect((await del(id)).statusCode).toBe(401)
    expect((await get(id, U().bob)).statusCode).toBe(200)

    const bob = await del(id, U().bob)
    expect(bob.statusCode).toBe(200)
    expect(bob.json()).toEqual({ ok: true })
    expect((await get(id, U().bob)).statusCode).toBe(404)
    expect((await del(id, U().bob)).statusCode).toBe(404)
  })

  it('strangers get 404 for photos they cannot see', async () => {
    const up = await upload(V().solo, U().alice, TINY_PNG)
    const id = PhotoV2Schema.parse(up.json()).id
    expect((await del(id, U().carol)).statusCode).toBe(404)
    expect((await del(id, U().alice)).statusCode).toBe(200)
  })
})
