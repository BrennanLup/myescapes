import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FriendSchema, GuestClaimSchema, InviteSchema, NotificationSchema, PendingTagSchema, VisitDetailSchema } from '../contracts/models'
import { ALICE, BOB, MIA, apiError, claim, fakeApi, friend, invite, notification, pendingTag, user, visit } from './testing/fakeApi'
import { FriendsPanel, Inbox, InvitePage, NotificationsBadge, activeInvites } from './index'

const session = vi.hoisted(() => ({ status: 'signed-out' as 'signed-out' | 'signed-in' | 'loading' }))
const signIn = vi.hoisted(() => vi.fn(async (_cb?: string) => undefined))
vi.mock('../auth', () => ({
  useSession: () =>
    session.status === 'signed-in'
      ? { status: 'signed-in', user: { id: 'usr_mia', handle: 'mia', displayName: 'Mia', image: null, email: 'm@example.com', onboarded: true, isAdmin: false, createdAt: 'x' } }
      : { status: session.status, user: null },
  signInWithGoogle: signIn,
  signOut: vi.fn(async () => undefined),
}))

beforeEach(() => {
  session.status = 'signed-out'
  signIn.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function serve(handlers: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(handlers)
  vi.stubGlobal('fetch', api.fetch)
  return api
}

describe('fake api builders', () => {
  it('produce contract-valid shapes', () => {
    expect(VisitDetailSchema.safeParse(visit()).success).toBe(true)
    expect(PendingTagSchema.safeParse(pendingTag()).success).toBe(true)
    expect(GuestClaimSchema.safeParse(claim()).success).toBe(true)
    expect(NotificationSchema.safeParse(notification()).success).toBe(true)
    expect(FriendSchema.safeParse(friend(BOB)).success).toBe(true)
    expect(InviteSchema.safeParse(invite()).success).toBe(true)
  })

  it('answers 501 for routes without a handler, like the server stubs', async () => {
    const api = fakeApi({})
    const res = await api.fetch('/api/visits/merge-candidates?gameId=g&date=2026-01-01')
    expect(res.status).toBe(501)
    expect(api.log[0].name).toBe('mergeCandidates')
  })
})

describe('activeInvites', () => {
  it('drops used and expired invites, newest first', () => {
    const now = Date.parse('2026-10-26T00:00:00Z')
    const list = [
      invite({ code: 'old', createdAt: '2026-10-01T00:00:00Z' }),
      invite({ code: 'new', createdAt: '2026-10-25T00:00:00Z' }),
      invite({ code: 'used', usedBy: MIA }),
      invite({ code: 'exp', expiresAt: '2026-10-20T00:00:00Z' }),
    ]
    expect(activeInvites(list, now).map((i) => i.code)).toEqual(['new', 'old'])
  })
})

describe('FriendsPanel', () => {
  const base = () => ({
    friends: () => ({ friends: [friend(BOB), friend(MIA, { autoAccept: true, visitsTogether: 1 })] }),
    friendRequests: () => ({ requests: [{ user: user('usr_dave', 'Dave'), direction: 'incoming', createdAt: '2026-10-01T00:00:00Z' }, { user: user('usr_zed', 'Zed'), direction: 'outgoing', createdAt: '2026-10-01T00:00:00Z' }] }),
    myInvites: () => ({ invites: [] }),
  })

  it('makes an invite link with a guest name, shows share options and a local QR code', async () => {
    const api = serve({ ...base(), createInvite: (req) => invite({ code: 'NEW1', url: 'https://x.test/invite/NEW1', guestName: (req.body as { guestName?: string }).guestName ?? null }) })
    render(<FriendsPanel inviterName="Alice" />)
    fireEvent.change(await screen.findByTestId('invite-guest-name'), { target: { value: '  Mia ' } })
    fireEvent.click(screen.getByTestId('invite-create'))
    expect((await screen.findByTestId('invite-url')).textContent).toBe('https://x.test/invite/NEW1')
    expect(api.calls('createInvite')[0].body).toEqual({ guestName: 'Mia' })
    expect(screen.getByTestId('invite-link').textContent).toContain('For "Mia"')
    const sms = screen.getByTestId('invite-sms').getAttribute('href') ?? ''
    expect(sms.startsWith('sms:?&body=')).toBe(true)
    expect(decodeURIComponent(sms.slice('sms:?&body='.length))).toContain('Alice invited you to My Escapes')
    fireEvent.click(screen.getByTestId('invite-qr-toggle'))
    const img = (await screen.findByTestId('invite-qr')) as HTMLImageElement
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(img.src)).toContain('<svg')
  })

  it('reuses an active invite and can copy and revoke it', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    let invites = [invite()]
    const api = serve({
      ...base(),
      myInvites: () => ({ invites }),
      revokeInvite: () => {
        invites = []
        return { ok: true }
      },
    })
    render(<FriendsPanel />)
    expect((await screen.findByTestId('invite-url')).textContent).toBe('http://localhost/invite/INV1')
    fireEvent.click(screen.getByTestId('invite-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost/invite/INV1'))
    expect(await screen.findByText('Copied!')).toBeTruthy()
    fireEvent.click(screen.getByTestId('invite-revoke'))
    await waitFor(() => expect(screen.queryByTestId('invite-link')).toBeNull())
    expect(api.calls('revokeInvite')[0].params).toEqual({ code: 'INV1' })
    expect(screen.getByTestId('invite-create').textContent).toBe('Make an invite link')
  })

  it('searches by @handle and sends a request', async () => {
    const api = serve({
      ...base(),
      userSearch: (req) => (req.query.q === '@carol' ? { users: [{ ...user('usr_carol', 'Carol'), relation: 'none' }] } : { users: [] }),
      sendFriendRequest: () => ({ relation: 'request_sent', user: user('usr_carol', 'Carol') }),
    })
    render(<FriendsPanel />)
    fireEvent.change(await screen.findByTestId('friend-search-input'), { target: { value: ' Carol ' } })
    fireEvent.click(screen.getByTestId('friend-search-submit'))
    const result = await screen.findByTestId('friend-search-result')
    expect(result.textContent).toContain('Carol (@carol)')
    fireEvent.click(within(result).getByTestId('friend-add'))
    expect((await screen.findByTestId('friend-relation')).textContent).toBe('Request sent')
    expect(api.calls('sendFriendRequest')[0].body).toEqual({ userId: 'usr_carol' })

    fireEvent.change(screen.getByTestId('friend-search-input'), { target: { value: 'nobody@example.com' } })
    fireEvent.click(screen.getByTestId('friend-search-submit'))
    expect(await screen.findByTestId('friend-search-none')).toBeTruthy()
    expect(api.calls('userSearch')[1].query.q).toBe('nobody@example.com')
  })

  it('accepts and declines requests', async () => {
    const api = serve({ ...base(), acceptFriend: () => friend(user('usr_dave', 'Dave')), declineFriend: () => ({ ok: true }) })
    render(<FriendsPanel />)
    fireEvent.click(await screen.findByTestId('request-accept'))
    await waitFor(() => expect(api.calls('acceptFriend')[0]?.params).toEqual({ userId: 'usr_dave' }))
    fireEvent.click(screen.getByTestId('request-cancel'))
    await waitFor(() => expect(api.calls('declineFriend')[0]?.params).toEqual({ userId: 'usr_zed' }))
  })

  it('toggles auto-accept per friend, reverting when the API fails', async () => {
    let fail = false
    const api = serve({ ...base(), setAutoAccept: (req) => (fail ? apiError(500, 'internal', 'Nope') : friend(BOB, { autoAccept: (req.body as { autoAccept: boolean }).autoAccept })) })
    render(<FriendsPanel />)
    const rows = await screen.findAllByTestId('friend-row')
    expect(rows[0].textContent).toContain('Always add Bob')
    const bobBox = within(rows[0]).getByTestId('friend-auto-accept') as HTMLInputElement
    const miaBox = within(rows[1]).getByTestId('friend-auto-accept') as HTMLInputElement
    expect(bobBox.checked).toBe(false)
    expect(miaBox.checked).toBe(true)
    expect(rows[1].textContent).toContain('1 room together')
    fireEvent.click(bobBox)
    await waitFor(() => expect(api.calls('setAutoAccept')).toHaveLength(1))
    expect(api.calls('setAutoAccept')[0]).toMatchObject({ params: { userId: 'usr_bob' }, body: { autoAccept: true } })
    await waitFor(() => expect(bobBox.checked).toBe(true))
    fail = true
    fireEvent.click(bobBox)
    expect(await within(rows[0]).findByText('Nope')).toBeTruthy()
    expect(bobBox.checked).toBe(true)
  })

  it('unfriends and blocks after confirming', async () => {
    const api = serve({ ...base(), unfriend: () => ({ ok: true }), blockUser: () => ({ ok: true }) })
    render(<FriendsPanel />)
    const rows = await screen.findAllByTestId('friend-row')
    fireEvent.click(within(rows[0]).getByTestId('friend-unfriend'))
    expect(rows[0].textContent).toContain('Past shared visits stay')
    fireEvent.click(within(rows[0]).getByTestId('friend-remove-confirm'))
    await waitFor(() => expect(api.calls('unfriend')[0]?.params).toEqual({ userId: 'usr_bob' }))
    const again = await screen.findAllByTestId('friend-row')
    fireEvent.click(within(again[1]).getByTestId('friend-block'))
    fireEvent.click(within(again[1]).getByTestId('friend-remove-confirm'))
    await waitFor(() => expect(api.calls('blockUser')[0]?.params).toEqual({ userId: 'usr_mia' }))
  })

  it('shows an empty friends list and section errors without blanking the panel', async () => {
    serve({ friends: () => ({ friends: [] }), myInvites: () => ({ invites: [] }) })
    render(<FriendsPanel />)
    expect(await screen.findByTestId('friends-empty')).toBeTruthy()
    // friendRequests has no handler -> 501, shown as an error line in its card.
    expect(screen.getByTestId('friend-requests').textContent).toContain("isn't ready yet")
    expect(screen.getByTestId('invite-card')).toBeTruthy()
  })
})

describe('Inbox', () => {
  it('accepts a pending tag', async () => {
    const api = serve({
      pendingTags: () => ({ tags: [pendingTag()] }),
      claims: () => ({ claims: [] }),
      notifications: () => ({ items: [], unread: 0, nextCursor: null }),
      respondToTag: () => ({ visit: null, status: 'accepted' }),
    })
    const onOpenVisit = vi.fn()
    render(<Inbox onOpenVisit={onOpenVisit} />)
    const tag = await screen.findByTestId('inbox-tag')
    expect(tag.textContent).toContain('Bob says you played The Lost Observatory together on Oct 12, 2026')
    fireEvent.click(within(tag).getByTestId('inbox-tag-accept'))
    expect((await screen.findByTestId('inbox-tag-done')).textContent).toContain('Added to your room')
    expect(api.calls('respondToTag')[0]).toMatchObject({ params: { id: 'vis_tag' }, body: { accept: true } })
  })

  it('declines a pending tag', async () => {
    const api = serve({ pendingTags: () => ({ tags: [pendingTag()] }), claims: () => ({ claims: [] }), notifications: () => ({ items: [], unread: 0, nextCursor: null }), respondToTag: () => ({ visit: null, status: 'declined' }) })
    render(<Inbox />)
    fireEvent.click(await screen.findByTestId('inbox-tag-decline'))
    await waitFor(() => expect(api.calls('respondToTag')[0]?.body).toEqual({ accept: false }))
  })

  it('claims all guest visits, or a picked subset', async () => {
    const api = serve({ pendingTags: () => ({ tags: [] }), claims: () => ({ claims: [claim()] }), notifications: () => ({ items: [], unread: 0, nextCursor: null }), claim: (req) => ({ claimed: (req.body as { participantIds?: string[] }).participantIds?.length ?? 2 }) })
    render(<Inbox />)
    const c = await screen.findByTestId('inbox-claim')
    expect(c.textContent).toContain('Bob has 2 visits with a guest named "Mia". Is that you?')
    fireEvent.click(within(c).getByTestId('inbox-claim-pick'))
    const boxes = within(c).getAllByRole('checkbox')
    fireEvent.click(boxes[1])
    fireEvent.click(within(c).getByTestId('inbox-claim-picked'))
    expect((await screen.findByTestId('inbox-claim-done')).textContent).toContain('Claimed 1 visit')
    expect(api.calls('claim')[0].body).toEqual({ inviterId: 'usr_bob', guestName: 'Mia', participantIds: ['par_g1'] })
  })

  it('claims all in one tap and can dismiss "not me"', async () => {
    const api = serve({ pendingTags: () => ({ tags: [] }), claims: () => ({ claims: [claim(), claim({ inviter: MIA, guestName: 'Al' })] }), notifications: () => ({ items: [], unread: 0, nextCursor: null }), claim: () => ({ claimed: 2 }) })
    render(<Inbox />)
    const [first, second] = await screen.findAllByTestId('inbox-claim')
    fireEvent.click(within(second).getByTestId('inbox-claim-dismiss'))
    expect(screen.getAllByTestId('inbox-claim')).toHaveLength(1)
    fireEvent.click(within(first).getByTestId('inbox-claim-all'))
    await waitFor(() => expect(api.calls('claim')[0]?.body).toEqual({ inviterId: 'usr_bob', guestName: 'Mia' }))
  })

  it('lists notifications and marks all read', async () => {
    let unread = 1
    const api = serve({
      pendingTags: () => ({ tags: [] }),
      claims: () => ({ claims: [] }),
      notifications: () => ({ items: [notification({ readAt: unread ? null : '2026-10-21T00:00:00Z' }), notification({ id: 'n2', text: 'Mia logged The Vault with you', visitId: 'vis_2', readAt: '2026-10-21T00:00:00Z' })], unread, nextCursor: null }),
      readNotifications: () => {
        unread = 0
        return { unread: 0 }
      },
    })
    const onOpenVisit = vi.fn()
    render(<Inbox onOpenVisit={onOpenVisit} />)
    const items = await screen.findAllByTestId('notification')
    expect(items[0].getAttribute('data-unread')).toBe('true')
    expect(items[1].getAttribute('data-unread')).toBeNull()
    fireEvent.click(within(items[1]).getByText('Mia logged The Vault with you'))
    expect(onOpenVisit).toHaveBeenCalledWith('vis_2')
    fireEvent.click(screen.getByTestId('notifications-read-all'))
    await waitFor(() => expect(screen.queryByTestId('notifications-read-all')).toBeNull())
    expect(api.calls('readNotifications')[0].body).toEqual({ all: true })
  })

  it('shows an empty state', async () => {
    serve({ pendingTags: () => ({ tags: [] }), claims: () => ({ claims: [] }), notifications: () => ({ items: [], unread: 0, nextCursor: null }) })
    render(<Inbox />)
    expect(await screen.findByTestId('inbox-empty')).toBeTruthy()
  })
})

describe('NotificationsBadge', () => {
  it('shows unread plus uncovered pending tags', async () => {
    serve({
      notifications: () => ({ items: [notification({ type: 'tagged', visitId: 'vis_tag' }), notification({ id: 'n2' })], unread: 2, nextCursor: null }),
      pendingTags: () => ({ tags: [pendingTag(), pendingTag({ visitId: 'vis_other', participantId: 'p2' })] }),
    })
    render(<NotificationsBadge />)
    expect((await screen.findByTestId('notifications-count')).textContent).toBe('3')
    expect(screen.getByTestId('notifications-badge').getAttribute('href')).toBe('/settings#inbox')
    expect(screen.getByTestId('notifications-badge').getAttribute('aria-label')).toBe('3 new')
  })

  it('shows a bare bell at zero and nothing when signed out', async () => {
    serve({ notifications: () => ({ items: [], unread: 0, nextCursor: null }), pendingTags: () => ({ tags: [] }) })
    render(<NotificationsBadge onOpen={() => undefined} />)
    expect(await screen.findByTestId('notifications-badge')).toBeTruthy()
    expect(screen.queryByTestId('notifications-count')).toBeNull()
    cleanup()
    const api = serve({ notifications: () => apiError(401, 'unauthorized'), pendingTags: () => apiError(401, 'unauthorized') })
    const { container } = render(<NotificationsBadge />)
    await waitFor(() => expect(api.calls('pendingTags')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(container.innerHTML).toBe('')
  })

  it('caps the number at 99+', async () => {
    serve({ notifications: () => ({ items: [], unread: 150, nextCursor: null }), pendingTags: () => ({ tags: [] }) })
    render(<NotificationsBadge />)
    expect((await screen.findByTestId('notifications-count')).textContent).toBe('99+')
  })
})

describe('InvitePage', () => {
  const preview = (over = {}) => ({ code: 'INVITEMIA01', inviter: ALICE, guestName: 'Mia', valid: true, reason: null, ...over })

  it('asks a signed-out visitor to continue with Google, returning to the invite', async () => {
    serve({ invitePreview: () => preview() })
    render(<InvitePage params={{ code: 'INVITEMIA01' }} rest="/" />)
    expect((await screen.findByTestId('invite-valid')).textContent).toContain('Alice (@alice) invited you')
    expect(screen.getByTestId('invite-valid').textContent).toContain('"Mia"')
    fireEvent.click(screen.getByTestId('invite-sign-in'))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('/invite/INVITEMIA01'))
    expect(screen.getByTestId('legal-links').querySelector('a[href="/privacy"]')).toBeTruthy()
  })

  it('explains expired or used links', async () => {
    serve({ invitePreview: () => preview({ valid: false, reason: 'expired' }) })
    render(<InvitePage params={{ code: 'X' }} />)
    expect((await screen.findByTestId('invite-invalid')).textContent).toContain('expired')
    expect(screen.getByTestId('invite-invalid').textContent).toContain('Ask Alice')
  })

  it('accepts when signed in and offers the guest-name claims', async () => {
    session.status = 'signed-in'
    const api = serve({
      invitePreview: () => preview(),
      acceptInvite: () => ({ friend: friend(ALICE), claimableVisits: 2 }),
      claims: () => ({ claims: [claim({ inviter: ALICE }), claim({ inviter: BOB, guestName: 'M' })] }),
      claim: () => ({ claimed: 2 }),
    })
    render(<InvitePage params={{ code: 'INVITEMIA01' }} />)
    fireEvent.click(await screen.findByTestId('invite-accept'))
    expect((await screen.findByTestId('invite-accepted')).textContent).toContain('You and Alice are friends now')
    const claims = await screen.findAllByTestId('inbox-claim')
    expect(claims).toHaveLength(1)
    fireEvent.click(within(claims[0]).getByTestId('inbox-claim-all'))
    expect(await screen.findByTestId('inbox-claim-done')).toBeTruthy()
    expect(api.calls('acceptInvite')[0].params).toEqual({ code: 'INVITEMIA01' })
  })

  it('shows the 410 message when accepting a dead link', async () => {
    session.status = 'signed-in'
    serve({ invitePreview: () => preview(), acceptInvite: () => apiError(410, 'gone', 'This invite was already used.') })
    render(<InvitePage params={{ code: 'INVITEMIA01' }} />)
    fireEvent.click(await screen.findByTestId('invite-accept'))
    expect((await screen.findByRole('alert')).textContent).toBe('This invite was already used.')
  })

  it('shows not found for an unknown code', async () => {
    serve({ invitePreview: () => apiError(404, 'not_found', 'Invite not found.') })
    render(<InvitePage params={{ code: 'NOPE' }} />)
    expect((await screen.findByTestId('invite-error')).textContent).toBe('Invite not found.')
  })
})
