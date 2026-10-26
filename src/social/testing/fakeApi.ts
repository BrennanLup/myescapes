/**
 * Test helpers for the friends UI, settings and the mobile rooms table: a fake `fetch` that
 * routes by the Phase 2 route table (src/contracts/routes.ts), plus contract-valid builders.
 *
 *   const api = fakeApi({ logs: () => ({ rows: [makeLogRow()] }) })
 *   vi.stubGlobal('fetch', api.fetch)
 *   ...
 *   expect(api.calls('respondToTag')[0].body).toEqual({ accept: true })
 *
 * Routes without a handler answer 501 not_implemented, like the server's stubs.
 * A handler may return a body (200), or `reply(status, body)`.
 */
import type {
  Friend,
  GameSummary,
  GuestClaim,
  Invite,
  LogRow,
  Me,
  Notification,
  Participant,
  PendingTag,
  PublicUser,
  ReviewV2,
  VenueSummary,
  VisitDetail,
} from '../../contracts/models'
import { ROUTE_LIST, type RouteName } from '../../contracts/routes'
import type { Ratings } from '../../contracts/types'

export interface FakeRequest {
  name: RouteName
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}

const REPLY = Symbol('reply')
export interface Reply {
  [REPLY]: true
  status: number
  body: unknown
}
export const reply = (status: number, body: unknown): Reply => ({ [REPLY]: true, status, body })
export const apiError = (status: number, code: string, error = code) => reply(status, { error, code })

export type Handler = (req: FakeRequest) => unknown | Reply | Promise<unknown | Reply>

function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = []
  const re = new RegExp(
    '^' +
      path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]+)/g, (_, k: string) => {
        keys.push(k)
        return '([^/]+)'
      }) +
      '$',
  )
  return { re, keys }
}

// Static paths first so `/api/visits/merge-candidates` wins over `/api/visits/:id`.
const COMPILED = [...ROUTE_LIST].sort((a, b) => Number(a.path.includes(':')) - Number(b.path.includes(':'))).map((r) => ({ r, ...compile(r.path) }))

export function fakeApi(handlers: Partial<Record<RouteName, Handler>> = {}) {
  const log: FakeRequest[] = []
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    for (const { r, re, keys } of COMPILED) {
      if (r.method !== method) continue
      const m = re.exec(url.pathname)
      if (!m) continue
      const params: Record<string, string> = {}
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      const req: FakeRequest = { name: r.name, method, path: url.pathname, params, query: Object.fromEntries(url.searchParams), body }
      log.push(req)
      const h = handlers[r.name]
      if (!h) return json(501, { error: `${method} ${r.path} not built`, code: 'not_implemented' })
      const out = await h(req)
      if (out && typeof out === 'object' && REPLY in out) return json((out as Reply).status, (out as Reply).body)
      return json(200, out ?? { ok: true })
    }
    return json(404, { error: 'no route', code: 'not_found' })
  }
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    log,
    calls: (name: RouteName) => log.filter((c) => c.name === name),
    set(name: RouteName, h: Handler) {
      handlers[name] = h
    },
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// ---------------------------------------------------------------------------
// Builders (every result parses with its contract schema)
// ---------------------------------------------------------------------------

const T = '2026-10-20T12:00:00.000Z'

export const user = (id: string, displayName: string, handle: string | null = displayName.toLowerCase()): PublicUser => ({ id, displayName, handle, image: null })
export const ALICE = user('usr_alice', 'Alice')
export const BOB = user('usr_bob', 'Bob')
export const MIA = user('usr_mia', 'Mia')

export const me = (over: Partial<Me> = {}): Me => ({ ...ALICE, email: 'alice@example.com', onboarded: true, isAdmin: false, createdAt: T, ...over })

export const ratings = (overall: number, comment = 'Loved it.'): Ratings => ({
  overall: { score: overall, comment },
  puzzles: { score: 80, comment: '' },
  setting: { score: 75, comment: '' },
  storyline: { score: 70, comment: '' },
  difficulty: { score: 60, comment: '' },
})

export function venue(over: Partial<VenueSummary> = {}): VenueSummary {
  return { id: 'ven_starlight', slug: 'starlight-escapes-san-francisco', name: 'Starlight Escapes', brand: null, address: '1 Main St', city: 'San Francisco', citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 2, ...over }
}

export function game(over: Partial<GameSummary> = {}): GameSummary {
  return { id: 'gam_observatory', slug: 'the-lost-observatory', name: 'The Lost Observatory', genre: 'mystery', status: 'active', venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 1, avgOverall: 88, ...over }
}

export const participant = (id: string, who: PublicUser | string, status: Participant['status'] = 'accepted'): Participant => ({
  id,
  user: typeof who === 'string' ? null : who,
  guestName: typeof who === 'string' ? who : null,
  status,
  addedBy: ALICE.id,
})

export function review(over: Partial<ReviewV2> = {}): ReviewV2 {
  return {
    id: 'rev_1', visitId: 'vis_1', author: ALICE, ratings: ratings(88), transcript: 'We did the observatory.', memorablePuzzleIds: [], visibility: 'public',
    containsSpoilers: false, scoresCopied: false, copiedFromReviewId: null, hidden: false, createdAt: T, updatedAt: T, ...over,
  }
}

export function logRow(over: Partial<LogRow> = {}): LogRow {
  const visitId = over.visitId ?? 'vis_1'
  return { visitId, date: '2026-10-12', game: game(), venue: venue(), escaped: true, escapeTimeMinutes: 52, myReview: review({ visitId }), crew: [], coverPhotoUrl: null, ...over }
}

export function visit(over: Partial<VisitDetail> = {}): VisitDetail {
  return {
    id: 'vis_1', game: game(), venue: venue(),
    facts: { date: '2026-10-12', escaped: true, escapeTimeMinutes: 52, visibleTimer: true, multiRoom: null, flashlights: false, liveActors: null, toolsUsed: ['UV light'] },
    puzzles: [{ id: 'pzl_1', description: 'Align the star chart', type: 'logic', notes: '', position: 0 }],
    participants: [participant('par_alice', ALICE, 'owner')],
    photos: [], reviews: [review()], createdBy: ALICE.id, myStatus: 'owner', createdAt: T, updatedAt: T, ...over,
  }
}

export const pendingTag = (over: Partial<PendingTag> = {}): PendingTag => ({ visitId: 'vis_tag', participantId: 'par_tag', game: game(), date: '2026-10-12', taggedBy: BOB, createdAt: T, ...over })

export const claim = (over: Partial<GuestClaim> = {}): GuestClaim => ({
  inviter: BOB,
  guestName: 'Mia',
  visits: [
    { visitId: 'vis_g1', participantId: 'par_g1', game: game(), date: '2025-05-01' },
    { visitId: 'vis_g2', participantId: 'par_g2', game: game({ id: 'gam_vault', slug: 'the-vault', name: 'The Vault' }), date: '2025-06-01' },
  ],
  ...over,
})

export const notification = (over: Partial<Notification> = {}): Notification => ({ id: 'ntf_1', type: 'friend_accepted', text: 'Bob accepted your friend request', actor: BOB, visitId: null, payload: {}, readAt: null, createdAt: T, ...over })

export const friend = (u: PublicUser, over: Partial<Friend> = {}): Friend => ({ user: u, since: T, autoAccept: false, theyAutoAccept: false, visitsTogether: 3, ...over })

export const invite = (over: Partial<Invite> = {}): Invite => ({ code: 'INV1', url: 'http://localhost/invite/INV1', guestName: null, expiresAt: '2099-01-01T00:00:00.000Z', usedBy: null, createdAt: T, ...over })
