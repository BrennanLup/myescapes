// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { HomeViewSchema, PresenceListSchema, SPOILER_PLACEHOLDER } from '../../src/contracts/realtime'
import { friendships, reviews } from '../db/schema'
import { hubFor } from '../realtime'
import type { Peer } from '../realtime/hub'
import { buildTestApp, type TestApp } from '../testing'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

const home = async (handle: string, as?: string, query = '') => t.inject({ method: 'GET', url: `/api/homes/${encodeURIComponent(handle)}${query}`, as })

const silentPeer = (): Peer => ({ send() {}, close() {}, terminate() {}, ping() {}, bufferedAmount: () => 0 })

describe('GET /api/homes/:handle', () => {
  it('needs a signed-in user', async () => {
    expect((await home('alice')).statusCode).toBe(401)
  })

  it('is friends-only: strangers and pending requests get 403, blocked and unknown handles 404', async () => {
    const carol = await home('alice', t.fx.users.carol)
    expect(carol.statusCode).toBe(403)
    expect(carol.json().code).toBe('forbidden')
    expect((await home('alice', t.fx.users.dave)).statusCode).toBe(403)
    expect((await home('alice', t.fx.users.eve)).statusCode).toBe(404)
    expect((await home('eve', t.fx.users.alice)).statusCode).toBe(404)
    expect((await home('no-such-person', t.fx.users.alice)).statusCode).toBe(404)
  })

  it('gives the owner their full room, editable', async () => {
    const res = await home('alice', t.fx.users.alice)
    expect(res.statusCode).toBe(200)
    const view = HomeViewSchema.parse(res.json())
    expect(view.isOwner).toBe(true)
    expect(view.readOnly).toBe(false)
    expect(view.dataset.reviews.map((r) => r.id)).toContain(t.fx.visits.solo)
    expect(JSON.stringify(view)).toContain('Alice private transcript')
  })

  it('gives a friend a read-only room with only what they may see', async () => {
    const res = await home('@Alice', t.fx.users.bob)
    expect(res.statusCode).toBe(200)
    const view = HomeViewSchema.parse(res.json())
    expect(view.owner).toEqual({ id: t.fx.users.alice, handle: 'alice', displayName: 'Alice', image: null })
    expect(view.isOwner).toBe(false)
    expect(view.readOnly).toBe(true)
    expect(view.spoilersHidden).toBe(true)
    const ids = view.dataset.reviews.map((r) => r.id)
    // The private review's visit is left out; the others are there.
    expect(ids).not.toContain(t.fx.visits.solo)
    expect(ids).toEqual(expect.arrayContaining([t.fx.visits.together, t.fx.visits.guest, t.fx.visits.pending, t.fx.visits.copy]))
    // Rooms only for the visits shown.
    expect(new Set(view.dataset.rooms.map((r) => r.id))).toEqual(new Set(view.dataset.reviews.map((r) => r.roomId)))
    const json = JSON.stringify(view)
    expect(json).not.toContain('private transcript')
    expect(json).not.toContain('@example.com')
    for (const r of view.dataset.reviews) expect(r.voiceTranscript).toBe('')

    const together = view.dataset.reviews.find((r) => r.id === t.fx.visits.together)!
    expect(together.crew).toEqual(['Bob'])
    expect(together.ratings.overall.score).toBe(88)
    // Puzzle text is a spoiler until asked for.
    expect(together.puzzles.map((p) => p.description)).toEqual([SPOILER_PLACEHOLDER, SPOILER_PLACEHOLDER])
    expect(together.puzzles.find((p) => p.memorable)).toBeTruthy()
    // Bob is on that visit, so he can open its photo.
    expect(together.photos).toHaveLength(1)
    // Guest names stay private.
    expect(view.dataset.reviews.find((r) => r.id === t.fx.visits.guest)!.crew).toEqual(['Guest'])
    // A pending tag is not crew yet.
    expect(view.dataset.reviews.find((r) => r.id === t.fx.visits.pending)!.crew).toEqual([])
    expect(view.dataset.wishlist.map((w) => w.name)).toEqual(['Sky Pirates', 'The Vault'])
  })

  it('reveals puzzle text and spoiler comments with ?spoilers=1', async () => {
    await t.db.update(reviews).set({ containsSpoilers: true, overallComment: 'The twist: it was the butler.' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    try {
      const hidden = HomeViewSchema.parse((await home('alice', t.fx.users.bob)).json())
      expect(JSON.stringify(hidden)).not.toContain('butler')
      const shown = HomeViewSchema.parse((await home('alice', t.fx.users.bob, '?spoilers=1')).json())
      expect(shown.spoilersHidden).toBe(false)
      const together = shown.dataset.reviews.find((r) => r.id === t.fx.visits.together)!
      expect(together.ratings.overall.comment).toContain('butler')
      expect(together.puzzles[0].description).toBe('Set the telescope clock to 4:35')
    } finally {
      await t.db.update(reviews).set({ containsSpoilers: false, overallComment: '' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    }
  })

  it('shows friends-only reviews to friends, and photos only where the friend may open them', async () => {
    await t.db.update(reviews).set({ visibility: 'friends' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    try {
      const mia = HomeViewSchema.parse((await home('alice', t.fx.users.mia)).json())
      const together = mia.dataset.reviews.find((r) => r.id === t.fx.visits.together)!
      expect(together).toBeTruthy()
      // Not public any more (Bob's review is friends-only too), and Mia was not there.
      expect(together.photos).toEqual([])
      const photo = await t.inject({ method: 'GET', url: `/api/photos/${t.fx.photos.bobTogether}`, as: t.fx.users.mia })
      expect(photo.statusCode).toBe(404)
      const bob = HomeViewSchema.parse((await home('alice', t.fx.users.bob)).json())
      expect(bob.dataset.reviews.find((r) => r.id === t.fx.visits.together)!.photos).toHaveLength(1)
    } finally {
      await t.db.update(reviews).set({ visibility: 'public' }).where(eq(reviews.id, t.fx.reviews.aliceTogether))
    }
  })

  it('hides a hidden review from visitors', async () => {
    await t.db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, t.fx.reviews.aliceGuest))
    try {
      const view = HomeViewSchema.parse((await home('alice', t.fx.users.bob)).json())
      expect(view.dataset.reviews.map((r) => r.id)).not.toContain(t.fx.visits.guest)
    } finally {
      await t.db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, t.fx.reviews.aliceGuest))
    }
  })

  it('says whether the owner is online and who is there', async () => {
    const hub = hubFor(t.ctx)
    const alice = hub.connect({ id: t.fx.users.alice, handle: 'alice', displayName: 'Alice', image: null }, silentPeer())
    const mia = hub.connect({ id: t.fx.users.mia, handle: 'mia', displayName: 'Mia', image: null }, silentPeer())
    await Promise.all([alice.ready, mia.ready])
    await hub.message(mia, JSON.stringify({ type: 'join', home: 'alice' }))
    try {
      const view = HomeViewSchema.parse((await home('alice', t.fx.users.bob)).json())
      expect(view.presence.ownerOnline).toBe(true)
      expect(view.presence.visitors.map((u) => u.handle)).toEqual(['mia'])
      // Mia does not see herself in the list.
      const asMia = HomeViewSchema.parse((await home('alice', t.fx.users.mia)).json())
      expect(asMia.presence.visitors).toEqual([])
    } finally {
      hub.disconnect(alice)
      hub.disconnect(mia)
    }
  })

  it('leaves out a visitor who has a block with the viewer', async () => {
    const hub = hubFor(t.ctx)
    const mia = hub.connect({ id: t.fx.users.mia, handle: 'mia', displayName: 'Mia', image: null }, silentPeer())
    await mia.ready
    await hub.message(mia, JSON.stringify({ type: 'join', home: 'alice' }))
    const [userA, userB] = [t.fx.users.bob, t.fx.users.mia].sort()
    await t.db.insert(friendships).values({ userA, userB, status: 'blocked', requestedBy: t.fx.users.mia, blockedBy: t.fx.users.mia })
    try {
      const view = HomeViewSchema.parse((await home('alice', t.fx.users.bob)).json())
      expect(view.presence.visitors).toEqual([])
    } finally {
      await t.db.delete(friendships).where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
      hub.disconnect(mia)
    }
  })
})

describe('GET /api/presence', () => {
  it('needs a signed-in user', async () => {
    expect((await t.inject({ method: 'GET', url: '/api/presence' })).statusCode).toBe(401)
  })

  it('lists my friends (only), online first, with where they are relative to me', async () => {
    const hub = hubFor(t.ctx)
    const bob = hub.connect({ id: t.fx.users.bob, handle: 'bob', displayName: 'Bob', image: null }, silentPeer())
    const carol = hub.connect({ id: t.fx.users.carol, handle: 'carol', displayName: 'Carol', image: null }, silentPeer())
    await Promise.all([bob.ready, carol.ready])
    await hub.message(bob, JSON.stringify({ type: 'join', home: 'alice' }))
    try {
      const res = await t.inject({ method: 'GET', url: '/api/presence', as: t.fx.users.alice })
      expect(res.statusCode).toBe(200)
      const list = PresenceListSchema.parse(res.json())
      expect(list.realtime).toBe(true)
      expect(list.friends.map((f) => [f.user.handle, f.online, f.where])).toEqual([
        ['bob', true, 'your_home'],
        ['mia', false, 'offline'],
      ])
      expect(list.here.map((u) => u.handle)).toEqual(['bob'])
      // Mia's only friend in the fixtures is Alice: she sees Alice offline, with one person in her home.
      const mia = PresenceListSchema.parse((await t.inject({ method: 'GET', url: '/api/presence', as: t.fx.users.mia })).json())
      expect(mia.friends.map((f) => f.user.handle)).toEqual(['alice'])
      expect(mia.friends[0]).toMatchObject({ online: false, where: 'offline', homeCount: 1 })
      expect(JSON.stringify(list)).not.toContain('@example.com')
    } finally {
      hub.disconnect(bob)
      hub.disconnect(carol)
    }
  })
})
