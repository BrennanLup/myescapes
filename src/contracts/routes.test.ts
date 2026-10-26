import { describe, expect, it, vi } from 'vitest'
import { ApiCallError } from './errors'
import { HandleSchema, ReviewV2Schema, VisitFactsSchema } from './models'
import { buildPath, callApi, ROUTE_LIST, ROUTES } from './routes'

describe('route contract', () => {
  it('has unique method + path pairs and only /api or /health paths', () => {
    const keys = ROUTE_LIST.map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of ROUTE_LIST) expect(r.path === '/health' || r.path.startsWith('/api/'), r.path).toBe(true)
  })

  it('names a workstream for every route', () => {
    for (const r of ROUTE_LIST) expect(r.ws, r.name).toBeGreaterThan(0)
  })

  it('buildPath fills and encodes params and drops empty query values', () => {
    expect(buildPath(ROUTES.gamePage.path, { slug: 'a b/c' })).toBe('/api/games/a%20b%2Fc')
    expect(buildPath(ROUTES.directorySearch.path, undefined, { q: 'star', lat: 1, lng: undefined, country: '' })).toBe('/api/directory/search?q=star&lat=1')
    expect(() => buildPath('/api/visits/:id')).toThrow(/missing path param id/)
  })

  it('callApi validates responses and throws ApiCallError with the code', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ handle: 'mia', available: true, reason: null }), { status: 200 }))
    await expect(callApi(ROUTES.handleAvailable, { params: { handle: 'mia' } }, { fetch: ok as unknown as typeof fetch })).resolves.toEqual({ handle: 'mia', available: true, reason: null })
    expect(ok).toHaveBeenCalledWith('/api/handles/mia', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))

    const capped = vi.fn(async () => new Response(JSON.stringify({ error: 'limit', code: 'spending_cap', fallback: 'typing' }), { status: 429 }))
    const err = await callApi(ROUTES.me, {}, { fetch: capped as unknown as typeof fetch }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiCallError)
    expect((err as ApiCallError).code).toBe('spending_cap')
    expect((err as ApiCallError).status).toBe(429)
  })
})

describe('model schemas', () => {
  it('handles are normalised and validated', () => {
    expect(HandleSchema.parse(' @Mia_88 ')).toBe('mia_88')
    expect(HandleSchema.safeParse('ab').success).toBe(false)
    expect(HandleSchema.safeParse('9lives').success).toBe(false)
  })

  it('visit facts require an ISO date', () => {
    const base = { escaped: true, escapeTimeMinutes: 50, visibleTimer: null, multiRoom: null, flashlights: null, liveActors: null, toolsUsed: [] }
    expect(VisitFactsSchema.safeParse({ ...base, date: '2026-10-12' }).success).toBe(true)
    expect(VisitFactsSchema.safeParse({ ...base, date: '12/10/2026' }).success).toBe(false)
  })

  it('public user shapes strip unknown fields such as email', () => {
    const r = { score: 50, comment: '' }
    const parsed = ReviewV2Schema.parse({
      id: 'r', visitId: 'v', author: { id: 'u', handle: 'h', displayName: 'H', image: null, email: 'leak@example.com' },
      ratings: { overall: r, puzzles: r, setting: r, storyline: r, difficulty: r }, transcript: null, memorablePuzzleIds: [],
      visibility: 'public', containsSpoilers: false, scoresCopied: false, copiedFromReviewId: null, hidden: false, createdAt: 'x', updatedAt: 'x',
    })
    expect(parsed.author).not.toHaveProperty('email')
  })
})
