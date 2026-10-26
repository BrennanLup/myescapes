// @vitest-environment node
/**
 * API tests for the 3D room on the Phase 2 server (workstream 20): the full server on PGlite
 * with the foundation fixtures, driven through the real store (its fetch calls go to
 * `app.inject` as the chosen user).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetSchema, type Dataset, type Entry } from '@/contracts/types'
import { buildTestApp, type TestApp } from '../../server/testing'
import { FX } from '../../server/db/fixtures'
import { useStore } from './store'
import { layoutBoard } from '@/world/board/layout'

const initial = useStore.getState()
let t: TestApp

/** Routes the store's fetch calls to the in-process server, signed in as `as` (or signed out). */
function signInAs(as: string | undefined) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await t.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: String(input),
      payload: init?.body ? String(init.body) : undefined,
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      as,
    })
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
  })
}

async function getData(as?: string): Promise<Dataset> {
  const res = await t.inject({ method: 'GET', url: '/api/data', as })
  expect(res.statusCode).toBe(200)
  return DatasetSchema.parse(res.json())
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await t?.close()
})
beforeEach(() => {
  useStore.setState(initial, true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('GET /api/data for the 3D room', () => {
  it('signed in: only my visits (owned or accepted), one room per game, crew without me', async () => {
    const d = await getData(FX.users.alice)
    expect(d.source).toBe('postgres')
    expect(d.rooms.map((r) => r.id).sort()).toEqual([FX.games.lighthouse, FX.games.observatory, FX.games.vault].sort())
    const byVisit = Object.fromEntries(d.reviews.map((r) => [r.id, r]))
    expect(Object.keys(byVisit).sort()).toEqual([FX.visits.copy, FX.visits.guest, FX.visits.pending, FX.visits.solo, FX.visits.together].sort())
    expect(byVisit[FX.visits.carol]).toBeUndefined()
    expect(byVisit[FX.visits.together].crew).toEqual(['Bob'])
    expect(byVisit[FX.visits.guest].crew).toEqual(['Mia'])
    expect(byVisit[FX.visits.solo].crew).toEqual([])
    for (const r of d.reviews) expect(r.crew).not.toContain('Alice')
  })

  it("another user's room never includes my private visits", async () => {
    const bob = await getData(FX.users.bob)
    const ids = bob.reviews.map((r) => r.id)
    expect(ids).toContain(FX.visits.together) // accepted
    expect(ids).not.toContain(FX.visits.solo)
    expect(ids).not.toContain(FX.visits.pending) // still pending: not in his room yet
    const carol = await getData(FX.users.carol)
    expect(carol.reviews.map((r) => r.id)).toEqual([FX.visits.carol])
  })

  it('a brand-new account gets an empty personal room', async () => {
    const d = await getData(FX.users.newbie)
    expect(d).toMatchObject({ source: 'postgres', rooms: [], reviews: [], wishlist: [] })
  })

  it('signed out: the read-only seed demo', async () => {
    const d = await getData()
    expect(d.source).toBe('seed')
    expect(d.rooms.length).toBeGreaterThan(0)
  })
})

describe('the store against the real server', () => {
  it('signed in: loads my room and crew stickers (from /api/logs, or names while it is unavailable)', async () => {
    signInAs(FX.users.alice)
    await useStore.getState().loadData()
    await settle()
    const s = useStore.getState()
    expect(s.dataStatus).toBe('ready')
    expect(s.dataSource).toBe('postgres')
    expect(s.rooms).toHaveLength(3)
    expect(s.crewIndex[FX.visits.together].map((c) => c.name)).toEqual(['Bob'])
    expect(s.crewIndex[FX.visits.guest].map((c) => c.name)).toEqual(['Mia'])
    expect(s.crewIndex[FX.visits.solo]).toEqual([])
    // The crew sort groups the board by who played.
    const layout = layoutBoard(s.rooms, s.reviews, 'crew', 8.5, 2.36, s.crewIndex)
    expect(layout.slots).toHaveLength(3)
    expect(layout.groups.length).toBeGreaterThan(0)
  })

  it('new account: an empty, ready room', async () => {
    signInAs(FX.users.newbie)
    await useStore.getState().loadData()
    await settle()
    expect(useStore.getState()).toMatchObject({ dataStatus: 'ready', dataSource: 'postgres', rooms: [], reviews: [], pendingArrivals: [] })
    expect(layoutBoard([], [], 'city', 8.5, 2.36)).toMatchObject({ slots: [] })
  })

  it('morning test: a room logged on the phone appears on the laptop and flies onto the board', async () => {
    signInAs(FX.users.newbie)
    await useStore.getState().loadData()
    await settle()
    expect(useStore.getState().rooms).toHaveLength(0)

    // The phone saves a room (same account, another device).
    const entry: Entry = {
      room: { id: 'tmp_room', name: 'Clockwork Heist', company: 'Gearbox Escapes', city: 'Toronto', genre: 'heist', address: '', website: '', photos: [] },
      review: {
        id: 'tmp_review',
        roomId: 'tmp_room',
        date: '2026-10-20',
        crew: ['Mia'],
        ratings: { overall: { score: 91, comment: 'Loved it' }, puzzles: { score: 90, comment: '' }, setting: { score: 85, comment: '' }, storyline: { score: 80, comment: '' }, difficulty: { score: 70, comment: '' } },
        puzzles: [],
        escaped: true,
        escapeTimeMinutes: 52,
        visibleTimer: true,
        multiRoom: false,
        flashlights: false,
        liveActors: false,
        toolsUsed: [],
        voiceTranscript: '',
        photos: [],
      },
    }
    const saved = await t.inject({ method: 'POST', url: '/api/entries', payload: entry, as: FX.users.newbie })
    expect(saved.statusCode).toBe(200)
    const savedRoomId = (saved.json() as Entry).room.id

    // The laptop comes back into view and refreshes quietly.
    await useStore.getState().refreshData()
    await settle()
    const s = useStore.getState()
    expect(s.dataStatus).toBe('ready')
    expect(s.rooms.map((r) => r.name)).toEqual(['Clockwork Heist'])
    expect(s.pendingArrivals).toEqual([savedRoomId])
    expect(s.crewIndex[s.reviews[0].id].map((c) => c.name)).toEqual(['Mia'])

    // Another user never sees it.
    expect((await getData(FX.users.carol)).rooms.map((r) => r.name)).not.toContain('Clockwork Heist')
  })

  it('signed out: the seed demo, and the store never asks for /api/logs', async () => {
    const calls: string[] = []
    signInAs(undefined)
    const f = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      return f(input, init)
    })
    await useStore.getState().loadData()
    await settle()
    expect(useStore.getState()).toMatchObject({ dataStatus: 'ready', dataSource: 'seed' })
    expect(calls.some((c) => c.startsWith('/api/logs'))).toBe(false)
  })
})
