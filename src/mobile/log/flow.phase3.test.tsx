// Phase 3 (A) on the phone: photos while reviewing, the room search on the form, keyboard-safe layout.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSummary, Me, PhotoV2, VenueSummary, VisitDetail } from '../../contracts/models'
import { configurePhotoQueue, resetPhotoQueueForTests } from '../../ui/photos'
import { LogFlow } from './index'
import { resetQueueStoreForTests } from './queue'

const VENUE: VenueSummary = {
  id: 'ven_starlight', slug: 'starlight-escapes-san-francisco', name: 'Starlight Escapes', brand: null, address: '1420 Valencia St', city: 'San Francisco',
  citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 2,
}
const GAME: GameSummary = {
  id: 'gam_observatory', slug: 'the-lost-observatory', name: 'The Lost Observatory', genre: 'sci-fi', status: 'active',
  venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 0, avgOverall: null,
}
const VAULT: GameSummary = { ...GAME, id: 'gam_vault', slug: 'the-vault', name: 'The Vault', genre: 'heist' }
const ME: Me = { id: 'usr_alice', handle: 'alice', displayName: 'Alice', image: null, email: 'a@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' }
const r = (score: number) => ({ score, comment: '' })
const DRAFT = {
  room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: '2026-10-12', crew: [], ratings: { overall: r(87), puzzles: r(90), setting: r(92), storyline: r(80), difficulty: r(70) }, puzzles: [],
    escaped: true, escapeTimeMinutes: 48, visibleTimer: true, multiRoom: false, flashlights: false, liveActors: true, toolsUsed: [], voiceTranscript: '',
  },
  flags: [], mode: 'mock', hints: { venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' }, notice: null,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function server() {
  const calls: { url: string; method: string; body: unknown }[] = []
  const handler = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
    if (url === '/api/extract') return json(DRAFT)
    if (url === '/api/crew/suggestions') return json({ suggestions: [] })
    if (url.startsWith('/api/directory/match')) return json({ venues: [{ venue: VENUE, score: 0.95 }], games: [{ game: GAME, score: 0.95 }] })
    if (url.startsWith('/api/directory/search')) return json({ games: [VAULT], venues: [VENUE] })
    if (url === '/api/visits' && method === 'POST') {
      const b = JSON.parse(String(init.body)) as { gameId: string; facts: VisitDetail['facts'] }
      return json({ id: 'vis_new', game: b.gameId === VAULT.id ? VAULT : GAME, venue: VENUE, facts: b.facts, puzzles: [], participants: [], photos: [], reviews: [], createdBy: ME.id, myStatus: 'owner', createdAt: 'x', updatedAt: 'x' } satisfies VisitDetail, 201)
    }
    return json({ error: `unexpected ${method} ${url}`, code: 'not_found' }, 404)
  }
  const fetchMock = vi.fn(handler)
  // The room search uses the global fetch (src/ui/roompicker/search.ts).
  vi.stubGlobal('fetch', fetchMock)
  return { fetch: fetchMock as unknown as typeof fetch, calls }
}

const photo = (id: string): PhotoV2 => ({ id, visitId: 'vis_new', url: `/api/photos/${id}`, uploaderId: ME.id, caption: '', width: 4, height: 3, createdAt: '2026-10-28T00:00:00.000Z' })

async function toConfirm() {
  await userEvent.click(screen.getByTestId('record-type-instead'))
  await userEvent.type(screen.getByTestId('transcript-input'), 'We did the lost observatory')
  await userEvent.click(screen.getByTestId('transcript-submit'))
  await userEvent.click(await screen.findByTestId('match-game-gam_observatory'))
  await screen.findByTestId('log-confirm')
}

let uploads: string[]
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetQueueStoreForTests()
  localStorage.clear()
  uploads = []
  configurePhotoQueue({
    resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
    upload: async (visitId) => {
      uploads.push(visitId)
      return photo(`pho_${uploads.length}`)
    },
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetPhotoQueueForTests()
  delete (window as { visualViewport?: unknown }).visualViewport
})

describe('phone review form (Phase 3)', () => {
  it('adds photos while writing and uploads them as soon as the visit is saved', async () => {
    const s = server()
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await toConfirm()
    await userEvent.upload(screen.getByTestId('photo-input'), [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })])
    await waitFor(() => expect(screen.getByTestId('photo-status').textContent).toMatch(/2 photos will upload when you save/))
    expect(uploads).toEqual([])

    await userEvent.click(screen.getByTestId('confirm-save'))
    await screen.findByTestId('log-done')
    await waitFor(() => expect(uploads).toEqual(['vis_new', 'vis_new']))
    await waitFor(() => expect(screen.getByTestId('log-done-photos').textContent).toMatch(/2 photos added/))
  })

  it('changes the room from the form with the directory search', async () => {
    const s = server()
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await toConfirm()
    await userEvent.click(screen.getByTestId('confirm-change-game'))
    const input = screen.getByTestId('confirm-room-search')
    await userEvent.type(input, 'Vault')
    fireEvent.click(await screen.findByTestId('roompicker-option-game', {}, { timeout: 2000 }))
    await waitFor(() => expect(screen.getByTestId('confirm-game').textContent).toBe('The Vault'))
    await userEvent.click(screen.getByTestId('confirm-save'))
    await screen.findByTestId('log-done')
    expect(s.calls.find((c) => c.url === '/api/visits' && c.method === 'POST')?.body).toMatchObject({ gameId: 'gam_vault' })
  })

  it('"Add" a room that is not listed opens the new venue form with the name kept', async () => {
    const s = server()
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await toConfirm()
    await userEvent.click(screen.getByTestId('confirm-change-game'))
    await userEvent.type(screen.getByTestId('confirm-room-search'), 'Moon Base')
    fireEvent.click(await screen.findByTestId('roompicker-option-create', {}, { timeout: 2000 }))
    expect(await screen.findByTestId('new-venue-form')).toBeTruthy()
  })

  it('drops the Save bar into the page while the keyboard is up', async () => {
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: 400, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    const s = server()
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await toConfirm()
    expect(screen.getByTestId('confirm-footer').className).toContain('fixed')
    act(() => {
      vv.height = window.innerHeight - 320
      vv.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('log-confirm').dataset.keyboard).toBe('open')
    expect(screen.getByTestId('confirm-footer').className).not.toContain('fixed')
  })
})
