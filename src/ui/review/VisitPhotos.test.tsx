// Phase 3 (A): add photos to a visit from the 3D room's review overlay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { bus } from '@/contracts/events'
import type { Me, PhotoV2, VisitDetail } from '@/contracts/models'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { resetSessionForTests, setSessionUser } from '@/auth/session'
import { useStore } from '@/state/store'
import { configurePhotoQueue, resetPhotoQueueForTests } from '@/ui/photos'
import { ReviewOverlay } from './ReviewOverlay'

const ME: Me = { id: 'usr_me', handle: 'me', displayName: 'Me', image: null, email: 'me@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const photo = (id: string, uploaderId = ME.id, visitId = 'x'): PhotoV2 => ({ id, visitId, url: `/api/photos/${id}`, uploaderId, caption: '', width: 4, height: 3, createdAt: '2026-10-28T00:00:00.000Z' })

const review = FIXTURE_DATASET.reviews[0]
const room = FIXTURE_DATASET.rooms.find((r) => r.id === review.roomId)!
const visit = (): VisitDetail => ({
  id: review.id,
  game: { id: 'gam_1', slug: 'g', name: room.name, genre: null, status: 'active', venueId: 'ven_1', venueName: room.company, venueSlug: 'v', city: room.city, country: 'US', reviewCount: 0, avgOverall: null },
  venue: { id: 'ven_1', slug: 'v', name: room.company, brand: null, address: '', city: room.city, citySlug: 'c', region: '', country: 'US', lat: null, lng: null, status: 'active', gameCount: 1 },
  facts: { date: review.date, escaped: true, escapeTimeMinutes: null, visibleTimer: null, multiRoom: null, flashlights: null, liveActors: null, toolsUsed: [] },
  puzzles: [],
  participants: [],
  photos: [photo('pho_mine', ME.id, review.id), photo('pho_friend', 'usr_friend', review.id)],
  reviews: [],
  createdBy: ME.id,
  myStatus: 'owner',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

beforeEach(() => {
  useStore.getState().setDataset({ ...FIXTURE_DATASET, source: 'postgres' })
  setSessionUser(ME)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === `/api/visits/${encodeURIComponent(review.id)}`) return json(visit())
      if (url === '/api/photos/pho_mine' && init.method === 'DELETE') return json({ ok: true })
      return json({ error: 'nope', code: 'not_found' }, 404)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetPhotoQueueForTests()
  resetSessionForTests()
})

describe('review overlay photos', () => {
  it('is hidden in the signed-out demo', () => {
    useStore.getState().setDataset(FIXTURE_DATASET)
    render(<ReviewOverlay roomId={room.id} />)
    expect(screen.queryByTestId('review-photos')).toBeNull()
  })

  it('adds a photo to the visit and shows it on the review', async () => {
    const user = userEvent.setup()
    configurePhotoQueue({
      resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
      upload: async (visitId) => photo('pho_new', ME.id, visitId),
      createUrl: () => 'blob:x',
      revokeUrl: () => {},
    })
    render(<ReviewOverlay roomId={room.id} />)
    await screen.findByTestId('review-photo-attach')
    // Both existing photos are listed. Removing is behind "Edit photos", and only mine can be removed.
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(2)
    expect(screen.queryAllByRole('button', { name: /Remove photo/ })).toHaveLength(0)
    await user.click(screen.getByTestId('photo-edit-toggle'))
    expect(screen.getByTestId('photo-edit-toggle').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('button', { name: /Remove photo/ })).toHaveLength(1)
    await user.upload(await screen.findByTestId('photo-input'), [new File(['a'], 'a.jpg', { type: 'image/jpeg' })])
    await waitFor(() => expect(useStore.getState().reviews.find((r) => r.id === review.id)?.photos.some((p) => p.url === '/api/photos/pho_new')).toBe(true))
  })
})

describe('review overlay photo removal', () => {
  it('removes my photo from the visit and from the board', async () => {
    const user = userEvent.setup()
    useStore.setState((st) => ({ reviews: st.reviews.map((r) => (r.id === review.id ? { ...r, photos: [{ url: '/api/photos/pho_mine' }] } : r)) }))
    render(<ReviewOverlay roomId={room.id} />)
    await screen.findByTestId('review-photo-attach')
    configurePhotoQueue({ undoMs: 20 })
    await user.click(screen.getByRole('button', { name: 'Edit photos' }))
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await waitFor(() => expect(screen.getAllByTestId('photo-tile')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('photo-undo')).toBeNull())
    expect(useStore.getState().reviews.find((r) => r.id === review.id)?.photos).toEqual([])
  })
})

describe('review overlay full-size photos', () => {
  it('opens a photo full size; Esc and the arrows then belong to the photo, not the overlay', async () => {
    const user = userEvent.setup()
    const closed = vi.fn()
    const off = bus.on('overlay:close', closed)
    render(<ReviewOverlay roomId={room.id} />)
    await screen.findByTestId('review-photo-attach')
    await user.click(screen.getByRole('button', { name: 'Open photo 1' }))
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeTruthy()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 2' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('photo-lightbox')).toBeNull()
    expect(closed).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(closed).toHaveBeenCalledTimes(1)
    off()
  })
})
