// @vitest-environment node
/** Friends, search, invites and notifications (workstream 31). Fixture people: server/db/fixtures.ts. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { FriendSchema, InvitePreviewSchema, InviteSchema, NotificationSchema } from '../../src/contracts/models'
import { FX } from '../db/fixtures'
import { notifications, visitParticipants } from '../db/schema'
import { notificationText, shortDate } from './friends.lib'
import { newInviteCode } from './friends'
import { socialKit, text, U, type Kit } from './visits.testkit'

let k: Kit
beforeAll(async () => {
  k = await socialKit()
})
afterAll(async () => {
  await k?.close()
})
beforeEach(async () => {
  await k.reset()
})

describe('friends list and requests', () => {
  it('lists accepted friends with auto-accept flags and visits together', async () => {
    const r = await k.api(U.alice, 'GET', '/api/friends')
    expect(r.status).toBe(200)
    const friends = r.body.friends.map((f: unknown) => FriendSchema.parse(f))
    expect(friends.map((f: { user: { id: string } }) => f.user.id).sort()).toEqual([U.bob, U.mia].sort())
    const mia = friends.find((f: { user: { id: string } }) => f.user.id === U.mia)
    expect(mia).toMatchObject({ autoAccept: false, theyAutoAccept: true, visitsTogether: 1 })
    const bob = friends.find((f: { user: { id: string } }) => f.user.id === U.bob)
    // vis_together counts; vis_pending (bob still pending) does not.
    expect(bob.visitsTogether).toBe(1)
    expect(text(r)).not.toContain('@example.com')
    // Mia sees Alice the other way round.
    const m = await k.api(U.mia, 'GET', '/api/friends')
    expect(m.body.friends[0]).toMatchObject({ autoAccept: true, theyAutoAccept: false })
  })

  it('shows incoming and outgoing requests', async () => {
    const a = await k.api(U.alice, 'GET', '/api/friends/requests')
    expect(a.body.requests).toEqual([expect.objectContaining({ direction: 'incoming', user: expect.objectContaining({ id: U.dave }) })])
    const d = await k.api(U.dave, 'GET', '/api/friends/requests')
    expect(d.body.requests[0].direction).toBe('outgoing')
  })

  it('request by @handle, accept, and both sides get notified', async () => {
    const r = await k.api(U.alice, 'POST', '/api/friends/requests', { handle: '@Carol' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ relation: 'request_sent', user: { id: U.carol } })
    expect(text(r)).not.toContain('@example.com')
    // Asking twice is idempotent.
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'carol' })).body.relation).toBe('request_sent')
    const inbox = await k.api(U.carol, 'GET', '/api/notifications')
    expect(inbox.body.items[0]).toMatchObject({ type: 'friend_request', text: 'Alice sent you a friend request' })
    // Only the receiver can accept.
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.carol}/accept`)).status).toBe(404)
    const acc = await k.api(U.carol, 'POST', `/api/friends/${U.alice}/accept`)
    expect(acc.status).toBe(200)
    expect(FriendSchema.parse(acc.body)).toMatchObject({ user: { id: U.alice }, autoAccept: false, theyAutoAccept: false })
    const back = await k.api(U.alice, 'GET', '/api/notifications')
    expect(back.body.items[0]).toMatchObject({ type: 'friend_accepted', actor: { id: U.carol } })
  })

  it('request by exact email (case-insensitive) or user id', async () => {
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { email: 'CAROL@example.com' })).body.relation).toBe('request_sent')
    await k.reset()
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { userId: U.carol })).body.relation).toBe('request_sent')
  })

  it('asking someone who already asked you makes you friends', async () => {
    const r = await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'dave' })
    expect(r.body.relation).toBe('friends')
    expect((await k.api(U.dave, 'GET', '/api/friends')).body.friends[0].user.id).toBe(U.alice)
  })

  it('rejects bad requests: none or several targets, yourself, unknown users', async () => {
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', {})).status).toBe(400)
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'bob', userId: U.bob })).status).toBe(400)
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'alice' })).status).toBe(400)
    expect((await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'nobody_here' })).status).toBe(404)
  })

  it('blocked pairs get a generic 404 both ways', async () => {
    const a = await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'eve' })
    const e = await k.api(U.eve, 'POST', '/api/friends/requests', { handle: 'alice' })
    expect(a.status).toBe(404)
    expect(e.status).toBe(404)
    expect(e.body.error).not.toMatch(/block/i)
  })

  it('decline removes an incoming request, or cancels my outgoing one', async () => {
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.dave}/decline`)).status).toBe(200)
    expect((await k.api(U.alice, 'GET', '/api/friends/requests')).body.requests).toEqual([])
    expect((await k.api(U.dave, 'POST', `/api/friends/${U.alice}/accept`)).status).toBe(404)
    // Cancel an outgoing request.
    await k.api(U.alice, 'POST', '/api/friends/requests', { handle: 'carol' })
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.carol}/decline`)).status).toBe(200)
    expect((await k.api(U.carol, 'GET', '/api/friends/requests')).body.requests).toEqual([])
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.carol}/decline`)).status).toBe(404)
  })

  it('unfriend keeps past shared visits but stops new tags', async () => {
    expect((await k.api(U.bob, 'DELETE', `/api/friends/${U.alice}`)).status).toBe(200)
    expect((await k.api(U.alice, 'GET', '/api/friends')).body.friends.map((f: { user: { id: string } }) => f.user.id)).toEqual([U.mia])
    expect((await k.api(U.bob, 'GET', `/api/visits/${FX.visits.together}`)).status).toBe(200)
    const tag = await k.api(U.alice, 'POST', `/api/visits/${FX.visits.solo}/participants`, { crew: [{ userId: U.bob }] })
    expect(tag.status).toBe(403)
    expect((await k.api(U.bob, 'DELETE', `/api/friends/${U.alice}`)).status).toBe(404)
  })

  it('block: hides me from search and requests, withdraws pending tags; only the blocker can unblock', async () => {
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.bob}/block`)).status).toBe(200)
    expect((await k.api(U.alice, 'GET', '/api/friends')).body.friends.map((f: { user: { id: string } }) => f.user.id)).toEqual([U.mia])
    const pending = await k.t.db.select().from(visitParticipants).where(and(eq(visitParticipants.visitId, FX.visits.pending), eq(visitParticipants.userId, U.bob)))
    expect(pending[0].status).toBe('declined')
    expect((await k.api(U.bob, 'GET', '/api/tags/pending')).body.tags).toEqual([])
    expect((await k.api(U.bob, 'GET', '/api/users/search?q=alice')).body.users).toEqual([])
    expect((await k.api(U.bob, 'POST', '/api/friends/requests', { handle: 'alice' })).status).toBe(404)
    expect((await k.api(U.bob, 'POST', `/api/friends/${U.alice}/unblock`)).status).toBe(404)
    expect((await k.api(U.alice, 'GET', '/api/users/search?q=bob')).body.users[0].relation).toBe('blocked')
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.bob}/unblock`)).status).toBe(200)
    expect((await k.api(U.alice, 'GET', '/api/users/search?q=bob')).body.users[0].relation).toBe('none')
    expect((await k.api(U.alice, 'POST', `/api/friends/${U.alice}/block`)).status).toBe(400)
    expect((await k.api(U.alice, 'POST', '/api/friends/usr_nobody/block')).status).toBe(404)
  })

  it('auto-accept is per friend and only for friends', async () => {
    const r = await k.api(U.alice, 'PATCH', `/api/friends/${U.mia}`, { autoAccept: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ autoAccept: true, theyAutoAccept: true })
    const off = await k.api(U.mia, 'PATCH', `/api/friends/${U.alice}`, { autoAccept: false })
    expect(off.body).toMatchObject({ autoAccept: false, theyAutoAccept: true })
    expect((await k.api(U.alice, 'PATCH', `/api/friends/${U.carol}`, { autoAccept: true })).status).toBe(404)
    expect((await k.api(U.alice, 'PATCH', `/api/friends/${U.dave}`, { autoAccept: true })).status).toBe(404)
  })
})

describe('user search', () => {
  it('finds one user by exact handle or email, never echoing the email', async () => {
    const h = await k.api(U.alice, 'GET', '/api/users/search?q=%40BOB')
    expect(h.body.users).toEqual([{ id: U.bob, handle: 'bob', displayName: 'Bob', image: null, relation: 'friends' }])
    const e = await k.api(U.alice, 'GET', '/api/users/search?q=carol%40example.com')
    expect(e.body.users).toEqual([expect.objectContaining({ id: U.carol, relation: 'none' })])
    expect(text(e)).not.toContain('example.com')
    expect((await k.api(U.alice, 'GET', '/api/users/search?q=bo')).body.users).toEqual([])
    expect((await k.api(U.alice, 'GET', '/api/users/search?q=alice')).body.users).toEqual([])
    expect((await k.api(U.alice, 'GET', '/api/users/search?q=dave')).body.users[0].relation).toBe('request_received')
    expect((await k.api(U.dave, 'GET', '/api/users/search?q=alice')).body.users[0].relation).toBe('request_sent')
    // Eve was blocked by Alice and can't find her.
    expect((await k.api(U.eve, 'GET', '/api/users/search?q=alice')).body.users).toEqual([])
  })
})

describe('invites', () => {
  it('create, list, public preview, accept (friends + claimable count), single use', async () => {
    const c = await k.api(U.bob, 'POST', '/api/invites', { guestName: 'Sam' })
    expect(c.status).toBe(201)
    const inv = InviteSchema.parse(c.body)
    expect(inv.url).toMatch(new RegExp(`/invite/${inv.code}$`))
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000)
    expect((await k.api(U.bob, 'GET', '/api/invites')).body.invites.map((i: { code: string }) => i.code)).toContain(inv.code)
    const p = await k.api(null, 'GET', `/api/invites/${inv.code}`)
    expect(InvitePreviewSchema.parse(p.body)).toMatchObject({ valid: true, reason: null, guestName: 'Sam', inviter: { id: U.bob } })
    expect(text(p)).not.toContain('example.com')

    const a = await k.api(U.carol, 'POST', `/api/invites/${inv.code.toLowerCase()}/accept`)
    expect(a.status).toBe(200)
    expect(a.body).toMatchObject({ friend: { user: { id: U.bob } }, claimableVisits: 0 })
    expect((await k.api(U.bob, 'GET', '/api/friends')).body.friends.map((f: { user: { id: string } }) => f.user.id)).toContain(U.carol)
    expect((await k.api(U.bob, 'GET', '/api/notifications')).body.items[0]).toMatchObject({ type: 'invite_accepted', text: 'Carol accepted your invite' })
    // Accepting again is harmless for the same person; anyone else gets 410.
    expect((await k.api(U.carol, 'POST', `/api/invites/${inv.code}/accept`)).status).toBe(200)
    expect((await k.api(U.dave, 'POST', `/api/invites/${inv.code}/accept`)).status).toBe(410)
    expect((await k.api(null, 'GET', `/api/invites/${inv.code}`)).body).toMatchObject({ valid: false, reason: 'used' })
    expect((await k.api(U.bob, 'GET', '/api/invites')).body.invites[0].usedBy.id).toBe(U.carol)
  })

  it('an invite with a guest name reports the visits to claim', async () => {
    const a = await k.api(U.carol, 'POST', `/api/invites/${FX.invites.valid}/accept`)
    expect(a.status).toBe(200)
    expect(a.body.claimableVisits).toBe(1)
  })

  it('accepting an invite from an existing friend keeps the friendship', async () => {
    const a = await k.api(U.mia, 'POST', `/api/invites/${FX.invites.valid}/accept`)
    expect(a.status).toBe(200)
    expect(a.body.friend).toMatchObject({ user: { id: U.alice }, theyAutoAccept: false, autoAccept: true })
  })

  it('a pending request becomes a friendship through the invite', async () => {
    const a = await k.api(U.dave, 'POST', `/api/invites/${FX.invites.valid}/accept`)
    expect(a.status).toBe(200)
    expect((await k.api(U.alice, 'GET', '/api/friends/requests')).body.requests).toEqual([])
  })

  it('expired, revoked, own, unknown and blocked invites', async () => {
    expect((await k.api(U.carol, 'POST', `/api/invites/${FX.invites.expired}/accept`)).status).toBe(410)
    expect((await k.api(null, 'GET', `/api/invites/${FX.invites.expired}`)).body).toMatchObject({ valid: false, reason: 'expired' })
    expect((await k.api(U.alice, 'POST', `/api/invites/${FX.invites.valid}/accept`)).status).toBe(400)
    expect((await k.api(U.carol, 'POST', '/api/invites/NOPE123456/accept')).status).toBe(404)
    expect((await k.api(null, 'GET', '/api/invites/NOPE123456')).status).toBe(404)
    // Eve is blocked by Alice: no friendship, and the invite is not used up.
    expect((await k.api(U.eve, 'POST', `/api/invites/${FX.invites.valid}/accept`)).status).toBe(404)
    expect((await k.api(null, 'GET', `/api/invites/${FX.invites.valid}`)).body.valid).toBe(true)
    // Only the inviter can revoke.
    expect((await k.api(U.bob, 'DELETE', `/api/invites/${FX.invites.valid}`)).status).toBe(404)
    expect((await k.api(U.alice, 'DELETE', `/api/invites/${FX.invites.valid}`)).status).toBe(200)
    expect((await k.api(U.carol, 'POST', `/api/invites/${FX.invites.valid}/accept`)).status).toBe(410)
    expect((await k.api(null, 'GET', `/api/invites/${FX.invites.valid}`)).body.reason).toBe('revoked')
    expect((await k.api(U.alice, 'DELETE', `/api/invites/${FX.invites.used}`)).status).toBe(409)
  })

  it('invite codes use an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) expect(newInviteCode()).toMatch(/^[A-HJKMNP-Z2-9]{10}$/)
  })
})

describe('notifications', () => {
  it('lists newest first with text, unread count, paging and mark-as-read', async () => {
    const r = await k.api(U.bob, 'GET', '/api/notifications')
    expect(r.status).toBe(200)
    expect(r.body.unread).toBe(1)
    const n = NotificationSchema.parse(r.body.items[0])
    expect(n).toMatchObject({ type: 'tagged', text: 'Alice says you played The Vault together on Oct 20', visitId: FX.visits.pending, actor: { id: U.alice } })

    // Three more for Alice, then page through one at a time.
    await k.t.db.insert(notifications).values([
      { userId: U.alice, type: 'friend_accepted', actorId: U.bob, createdAt: new Date('2026-10-20T10:00:00Z') },
      { userId: U.alice, type: 'friend_accepted', actorId: U.mia, createdAt: new Date('2026-10-20T10:00:00Z') },
      { userId: U.alice, type: 'not_a_known_type', actorId: U.mia, createdAt: new Date('2026-10-19T10:00:00Z') },
    ])
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await k.api(U.alice, 'GET', `/api/notifications?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...page.body.items.map((x) => x.id))
      cursor = page.body.nextCursor
      if (!cursor) break
    }
    // friend_request (fixture) + 2 friend_accepted; the unknown type is skipped, never a 500.
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBe(3)

    // Marking someone else's ids does nothing.
    const bobsId = n.id
    expect((await k.api(U.alice, 'POST', '/api/notifications/read', { ids: [bobsId] })).body.unread).toBe(4)
    expect((await k.api(U.bob, 'GET', '/api/notifications')).body.unread).toBe(1)
    expect((await k.api(U.bob, 'POST', '/api/notifications/read', { ids: [bobsId] })).body.unread).toBe(0)
    expect((await k.api(U.alice, 'POST', '/api/notifications/read', { all: true })).body.unread).toBe(0)
  })

  it('bad cursors are ignored, not errors', async () => {
    expect((await k.api(U.bob, 'GET', '/api/notifications?cursor=garbage')).status).toBe(200)
    const evil = Buffer.from("x'); drop table users;--|id").toString('base64url')
    expect((await k.api(U.bob, 'GET', `/api/notifications?cursor=${evil}`)).status).toBe(200)
  })

  it('renders every notification type', () => {
    expect(notificationText('tag_auto_added', 'Brennan', { gameName: 'The Lost Observatory' })).toBe('Brennan logged The Lost Observatory with you')
    expect(notificationText('tag_accepted', 'Mia', { claimed: 23, guestName: 'Mia' })).toBe('Mia claimed 23 visits as "Mia"')
    expect(notificationText('tag_accepted', 'Mia', { gameName: 'X', joined: true, date: '2026-10-12' })).toBe('Mia joined your visit to X on Oct 12')
    expect(notificationText('visit_edited', 'Bob', { gameName: 'X' })).toBe('Bob edited your visit to X')
    expect(notificationText('review_hidden', null, { gameName: 'X' })).toBe('A moderator hid your review of X')
    expect(notificationText('review_hidden', null, { text: 'Custom' })).toBe('Custom')
    expect(shortDate('2025-05-01', 2026)).toBe('May 1, 2025')
  })
})

// Last: it uses up this client's lookup budget for the minute.
describe('rate limits', () => {
  it('user search is rate-limited per client', async () => {
    let last = 0
    for (let i = 0; i < 70 && last !== 429; i++) last = (await k.api(U.alice, 'GET', '/api/users/search?q=bob')).status
    expect(last).toBe(429)
  })
})
