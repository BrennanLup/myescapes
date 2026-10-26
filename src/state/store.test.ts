import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { bus } from '@/contracts/events'
import type { LogRow } from '@/contracts/models'
import type { Dataset, Entry } from '@/contracts/types'
import { LAST_SEEN_KEY } from './arrivals'
import { useStore } from './store'
import { friend, guest, logRow, user } from './testRows'

const initial = useStore.getState()

const mine: Dataset = { ...FIXTURE_DATASET, source: 'postgres' }
const firstReview = mine.reviews[0]
const mia = user('usr_mia', 'Mia', 'https://lh3.googleusercontent.com/a/mia')

interface Server {
  data: Dataset
  logs: LogRow[] | number
  calls: string[]
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockServer(server: Server) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    server.calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.startsWith('/api/data')) return json(server.data)
    if (url.startsWith('/api/logs')) return typeof server.logs === 'number' ? json({ error: 'nope' }, server.logs) : json({ rows: server.logs })
    if (url.startsWith('/api/entries')) {
      const entry = JSON.parse(String(init?.body)) as Entry
      return json(entry)
    }
    return json({ error: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', f)
  return f
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('store: the 3D room on the signed-in user data', () => {
  let server: Server
  beforeEach(() => {
    useStore.setState(initial, true)
    localStorage.clear()
    server = { data: mine, logs: [], calls: [] }
    mockServer(server)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('signed out (seed demo): loads the dataset with name stickers and never asks for /api/logs', async () => {
    server.data = { ...FIXTURE_DATASET, source: 'seed' }
    await useStore.getState().loadData()
    await flush()
    const s = useStore.getState()
    expect(s.dataStatus).toBe('ready')
    expect(s.dataSource).toBe('seed')
    expect(server.calls.some((c) => c.includes('/api/logs'))).toBe(false)
    expect(s.crewIndex[firstReview.id].map((c) => c.name)).toEqual(firstReview.crew)
  })

  it('signed in: crew stickers come from /api/logs (pictures, pending tags)', async () => {
    server.logs = [logRow(firstReview.id, firstReview.roomId, [friend(mia), friend(user('usr_bob', 'Bob'), 'pending'), guest('Sam')])]
    await useStore.getState().loadData()
    await flush()
    const s = useStore.getState()
    expect(s.dataSource).toBe('postgres')
    expect(s.logRows).toHaveLength(1)
    expect(s.crewIndex[firstReview.id].map((c) => [c.name, c.image, c.pending])).toEqual([
      ['Mia', mia.image, false],
      ['Bob', null, true],
      ['Sam', null, false],
    ])
    // Reviews the rows don't cover keep their names.
    const other = mine.reviews[1]
    expect(s.crewIndex[other.id].map((c) => c.name)).toEqual(other.crew)
  })

  it('signed in, /api/logs unavailable: keeps the name stickers and stays ready', async () => {
    server.logs = 501
    await useStore.getState().loadData()
    await flush()
    const s = useStore.getState()
    expect(s.dataStatus).toBe('ready')
    expect(s.logRows).toBeNull()
    expect(s.crewIndex[firstReview.id].map((c) => c.name)).toEqual(firstReview.crew)
  })

  it('an empty personal room is ready with no rooms, no crew and a last-seen mark', async () => {
    server.data = { rooms: [], reviews: [], wishlist: [], crew: [], source: 'postgres' }
    await useStore.getState().loadData()
    await flush()
    const s = useStore.getState()
    expect(s.dataStatus).toBe('ready')
    expect(s.rooms).toEqual([])
    expect(s.crewIndex).toEqual({})
    expect(s.pendingArrivals).toEqual([])
    expect(localStorage.getItem(LAST_SEEN_KEY)).not.toBeNull()
  })

  it('a load error shows on the loading screen (dataStatus error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'database unavailable' }, 503)))
    await useStore.getState().loadData()
    expect(useStore.getState()).toMatchObject({ dataStatus: 'error', dataError: 'database unavailable' })
  })

  it('rooms logged since the last visit are queued to fly in', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '2026-10-25T00:00:00.000Z')
    const [r0, r1] = mine.reviews
    server.logs = [logRow(r0.id, r0.roomId, [], '2026-10-01T00:00:00.000Z'), logRow(r1.id, r1.roomId, [], '2026-10-26T06:00:00.000Z')]
    await useStore.getState().loadData()
    await flush()
    expect(useStore.getState().pendingArrivals).toEqual([r1.roomId])
    // takeArrival hands it to the board.
    expect(useStore.getState().takeArrival()).toBe(r1.roomId)
    expect(useStore.getState()).toMatchObject({ lastAddedRoomId: r1.roomId, pendingArrivals: [] })
    expect(useStore.getState().takeArrival()).toBeNull()
  })

  it('refreshData picks up a room logged on another device and queues it', async () => {
    const base: Dataset = { ...mine, rooms: mine.rooms.slice(0, 1), reviews: mine.reviews.filter((r) => r.roomId === mine.rooms[0].id) }
    server.data = base
    await useStore.getState().loadData()
    await flush()
    expect(useStore.getState().pendingArrivals).toEqual([])
    const newRoom = mine.rooms[1]
    server.data = { ...base, rooms: [...base.rooms, newRoom], reviews: [...base.reviews, ...mine.reviews.filter((r) => r.roomId === newRoom.id)] }
    await useStore.getState().refreshData()
    const s = useStore.getState()
    expect(s.rooms.map((r) => r.id)).toContain(newRoom.id)
    expect(s.pendingArrivals).toEqual([newRoom.id])
    expect(s.dataStatus).toBe('ready')
  })

  it('refreshData keeps the room when the network fails', async () => {
    await useStore.getState().loadData()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'offline' }, 503)))
    await useStore.getState().refreshData()
    expect(useStore.getState()).toMatchObject({ dataStatus: 'ready', rooms: mine.rooms })
  })

  it('addEntry pins the new room and gives it name stickers right away', async () => {
    await useStore.getState().loadData()
    await flush()
    const entry: Entry = {
      room: { ...mine.rooms[0], id: 'gam_new', name: 'New Room' },
      review: { ...firstReview, id: 'vis_new', roomId: 'gam_new', crew: ['Mia'] },
    }
    const saved = vi.fn()
    const off = bus.on('entry:saved', saved)
    await useStore.getState().addEntry(entry)
    off()
    const s = useStore.getState()
    expect(saved).toHaveBeenCalled()
    expect(s.lastAddedRoomId).toBe('gam_new')
    expect(s.crewIndex.vis_new.map((c) => c.name)).toEqual(['Mia'])
  })
})

describe('store: board sort', () => {
  beforeEach(() => useStore.setState(initial, true))

  it('setSort moves the HUD sort and the board together and emits sort:changed', () => {
    const fn = vi.fn()
    const off = bus.on('sort:changed', fn)
    useStore.getState().setSort('genre')
    off()
    expect(useStore.getState()).toMatchObject({ sort: 'genre', boardSort: 'genre' })
    expect(fn).toHaveBeenCalledWith({ sort: 'genre', previous: 'city' })
  })

  it('crew groups the board without touching the Phase 1 sort key', () => {
    const changed = vi.fn()
    const off = bus.on('sort:changed', changed)
    useStore.getState().setBoardSort('crew')
    expect(useStore.getState()).toMatchObject({ sort: 'city', boardSort: 'crew' })
    // Back to the same Phase 1 key: the board follows, no sort:changed (the key did not change).
    useStore.getState().setSort('city')
    expect(useStore.getState().boardSort).toBe('city')
    expect(changed).not.toHaveBeenCalled()
    useStore.getState().setBoardSort('rating')
    off()
    expect(useStore.getState()).toMatchObject({ sort: 'rating', boardSort: 'rating' })
    expect(changed).toHaveBeenCalledTimes(1)
  })
})
