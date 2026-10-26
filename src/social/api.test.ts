// @vitest-environment node
/**
 * The friends UI, settings and the mobile rooms table against the real server (every route
 * module, real auth checks and validation) on PGlite with the foundation fixtures.
 *
 * Written to hold both while the API workstreams (4, 31-34) are stubs (501) and once they land:
 * every response is either `not_implemented` or must parse with its contract schema, which
 * `callApi` checks. Auth rules (401 signed out, public preview routes) hold either way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiCallError } from '../contracts/errors'
import { callApi, ROUTES, type RouteSpec } from '../contracts/routes'
import { buildTestApp, type TestApp } from '../../server/testing'
import { fetchExport, isNotBuilt, isUnauthorized, loadBadge, loadFriends, loadInbox, checkHandle, type Fetch, type Section } from './client'

let t: TestApp

/** A `fetch` that goes through `app.inject`, signed in as `as` (or signed out). */
function injectFetch(as?: string): Fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const res = await t.inject({
      method: (init.method ?? 'GET') as 'GET',
      url,
      headers: init.headers as Record<string, string> | undefined,
      payload: typeof init.body === 'string' ? init.body : undefined,
      as,
    })
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
  }) as Fetch
}

beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

/** Every user-only route the social UI, settings and rooms table call, with sample input. */
const USER_ROUTES: [RouteSpec, Record<string, unknown>][] = [
  [ROUTES.me, {}],
  [ROUTES.updateMe, { body: { displayName: 'X' } }],
  [ROUTES.exportMe, {}],
  [ROUTES.deleteMe, { body: { confirm: 'DELETE' } }],
  [ROUTES.logs, {}],
  [ROUTES.visit, { params: { id: 'vis_together' } }],
  [ROUTES.deleteVisit, { params: { id: 'vis_solo' } }],
  [ROUTES.leaveVisit, { params: { id: 'vis_together' } }],
  [ROUTES.respondToTag, { params: { id: 'vis_pending' }, body: { accept: true } }],
  [ROUTES.pendingTags, {}],
  [ROUTES.updateReview, { params: { id: 'rev_alice_solo' }, body: { visibility: 'private' } }],
  [ROUTES.claims, {}],
  [ROUTES.claim, { body: { inviterId: 'usr_alice', guestName: 'Mia' } }],
  [ROUTES.friends, {}],
  [ROUTES.friendRequests, {}],
  [ROUTES.sendFriendRequest, { body: { handle: 'carol' } }],
  [ROUTES.acceptFriend, { params: { userId: 'usr_dave' } }],
  [ROUTES.declineFriend, { params: { userId: 'usr_dave' } }],
  [ROUTES.unfriend, { params: { userId: 'usr_bob' } }],
  [ROUTES.blockUser, { params: { userId: 'usr_carol' } }],
  [ROUTES.setAutoAccept, { params: { userId: 'usr_bob' }, body: { autoAccept: true } }],
  [ROUTES.userSearch, { query: { q: '@bob' } }],
  [ROUTES.createInvite, { body: {} }],
  [ROUTES.myInvites, {}],
  [ROUTES.acceptInvite, { params: { code: 'INVITEMIA01' } }],
  [ROUTES.revokeInvite, { params: { code: 'INVITEMIA01' } }],
  [ROUTES.notifications, {}],
  [ROUTES.readNotifications, { body: { all: true } }],
]

function expectBuiltOrValid<T>(s: Section<T>) {
  // Either the route works (and callApi validated it against the contract), or it is still a stub.
  if (!s.ok) {
    expect(isNotBuilt(s.error), String(s.error)).toBe(true)
  }
}

describe('social UI routes on the real server', () => {
  it('every user route the UI calls rejects signed-out callers with 401, and none of them is missing', async () => {
    const f = injectFetch()
    for (const [spec, input] of USER_ROUTES) {
      const err = await callApi(spec, input as never, { fetch: f }).then(
        () => null,
        (e) => e,
      )
      expect(err, `${spec.method} ${spec.path}`).toBeInstanceOf(ApiCallError)
      expect(err.status, `${spec.method} ${spec.path}`).toBe(401)
      expect(err.code).toBe('unauthorized')
      expect(isUnauthorized(err)).toBe(true)
    }
  })

  it('signed out: the inbox reports 401 for every section and the badge renders nothing', async () => {
    const inbox = await loadInbox({ fetch: injectFetch() })
    for (const s of [inbox.tags, inbox.claims, inbox.notifications]) {
      expect(s.ok).toBe(false)
      if (!s.ok) expect(isUnauthorized(s.error)).toBe(true)
    }
    expect(await loadBadge({ fetch: injectFetch() })).toBeNull()
    const exp = await fetchExport({ fetch: injectFetch() }).catch((e) => e)
    expect(exp).toBeInstanceOf(ApiCallError)
    expect(exp.status).toBe(401)
  })

  it('the invite landing and handle check are public (never 401)', async () => {
    const f = injectFetch()
    const preview = await callApi(ROUTES.invitePreview, { params: { code: 'INVITEMIA01' } }, { fetch: f }).then(
      (data) => ({ ok: true as const, data }),
      (error) => ({ ok: false as const, error }),
    )
    if (preview.ok) {
      expect(preview.data.inviter.id).toBe(t.fx.users.alice)
      // The public preview never carries an email.
      expect(JSON.stringify(preview.data)).not.toContain('@example.com')
    } else expect(isNotBuilt(preview.error)).toBe(true)

    const check = await checkHandle('somebody_new', null, { fetch: f })
    if (check.state === 'error') expect(check.message).toBe("This part isn't ready yet.")
    else expect(check).toEqual({ state: 'available' })
  })

  it('signed in: inbox, friends and rooms load (or are still stubs) and parse with the contracts', async () => {
    const f = injectFetch(t.fx.users.alice)
    const inbox = await loadInbox({ fetch: f })
    expectBuiltOrValid(inbox.tags)
    expectBuiltOrValid(inbox.claims)
    expectBuiltOrValid(inbox.notifications)

    const friends = await loadFriends({ fetch: f })
    expectBuiltOrValid(friends.friends)
    expectBuiltOrValid(friends.requests)
    expectBuiltOrValid(friends.invites)
    if (friends.friends.ok) {
      const ids = friends.friends.data.map((x) => x.user.id)
      expect(ids).toEqual(expect.arrayContaining([t.fx.users.bob, t.fx.users.mia]))
      // Public user shapes only: no email leaks into the friends list.
      expect(JSON.stringify(friends.friends.data)).not.toContain('@example.com')
    }

    const logs = await callApi(ROUTES.logs, {}, { fetch: f }).then(
      (data) => ({ ok: true as const, data }),
      (error) => ({ ok: false as const, error }),
    )
    expectBuiltOrValid(logs)
    if (logs.ok) expect(logs.data.rows.map((r) => r.visitId)).toContain(t.fx.visits.together)

    const badge = await loadBadge({ fetch: f })
    // Stubs: both sections fail -> null; built: a non-negative count.
    if (badge !== null) expect(badge).toBeGreaterThanOrEqual(0)
  })

  it("signed in: another user's private visit is never shown in the review detail", async () => {
    const f = injectFetch(t.fx.users.carol)
    const err = await callApi(ROUTES.visit, { params: { id: t.fx.visits.solo } }, { fetch: f }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiCallError)
    expect([404, 501]).toContain(err.status)
  })
})
