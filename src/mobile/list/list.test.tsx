import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ALICE, BOB, MIA, apiError, claim, fakeApi, game, logRow, participant, pendingTag, ratings, review, venue, visit } from '../../social/testing/fakeApi'
import { ReviewDetail, RoomsTable, VisitsToConfirm } from './index'

vi.mock('../../auth', () => ({
  useSession: () => ({ status: 'signed-in', user: { ...ALICE, email: 'a@example.com', onboarded: true, isAdmin: false, createdAt: 'x' } }),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function serve(handlers: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(handlers)
  vi.stubGlobal('fetch', api.fetch)
  return api
}

const ROWS = [
  logRow({ visitId: 'v1', date: '2026-10-12', crew: [participant('p1', MIA)] }),
  logRow({ visitId: 'v2', date: '2026-09-01', game: game({ name: 'The Vault' }), myReview: review({ ratings: ratings(70) }) }),
  logRow({ visitId: 'v3', date: '2025-05-01', game: game({ name: 'Haunted Lighthouse' }), venue: venue({ name: 'Maple & Key', city: 'Toronto' }), escaped: false, myReview: null, crew: [participant('p2', MIA)] }),
]

const visibleIds = () => screen.getAllByTestId('rooms-row').map((r) => r.getAttribute('data-visit-id'))

describe('RoomsTable', () => {
  it('shows my rooms newest first with score, venue, city and crew', async () => {
    serve({ logs: () => ({ rows: ROWS }) })
    render(<RoomsTable onOpen={() => undefined} />)
    await screen.findAllByTestId('rooms-row')
    expect(visibleIds()).toEqual(['v1', 'v2', 'v3'])
    const first = screen.getAllByTestId('rooms-row')[0]
    expect(within(first).getByText('The Lost Observatory')).toBeTruthy()
    expect(within(first).getByText(/Starlight Escapes · San Francisco/)).toBeTruthy()
    expect(within(first).getByTestId('rooms-crew').textContent).toContain('Mia')
    expect(within(first).getByTestId('rooms-score').textContent).toBe('88')
    expect(within(screen.getAllByTestId('rooms-row')[2]).getByTestId('rooms-score').textContent).toBe('–')
    expect(screen.getByTestId('rooms-summary').textContent).toBe('3 rooms · 67% escaped')
  })

  it('searches, filters by crew, sorts and opens a row', async () => {
    const onOpen = vi.fn()
    serve({ logs: () => ({ rows: ROWS }) })
    render(<RoomsTable onOpen={onOpen} />)
    await screen.findAllByTestId('rooms-row')

    fireEvent.change(screen.getByTestId('rooms-search'), { target: { value: 'toronto' } })
    expect(visibleIds()).toEqual(['v3'])
    fireEvent.change(screen.getByTestId('rooms-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('rooms-no-match')).toBeTruthy()
    fireEvent.change(screen.getByTestId('rooms-search'), { target: { value: '' } })

    const filter = screen.getByTestId('rooms-crew-filter') as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toEqual(['Everyone', 'With Mia', 'Without Mia'])
    fireEvent.change(filter, { target: { value: filter.options[2].value } })
    expect(visibleIds()).toEqual(['v2'])
    fireEvent.change(filter, { target: { value: filter.options[1].value } })
    expect(visibleIds()).toEqual(['v1', 'v3'])
    fireEvent.change(filter, { target: { value: 'all' } })

    fireEvent.click(screen.getByTestId('rooms-sort-name'))
    expect(visibleIds()).toEqual(['v3', 'v1', 'v2'])
    fireEvent.click(screen.getByTestId('rooms-sort-score'))
    expect(visibleIds()).toEqual(['v1', 'v2', 'v3'])

    fireEvent.click(screen.getAllByTestId('rooms-row')[1])
    expect(onOpen).toHaveBeenCalledWith('v2')
    fireEvent.keyDown(screen.getAllByTestId('rooms-row')[0], { key: 'Enter' })
    expect(onOpen).toHaveBeenLastCalledWith('v1')
  })

  it('shows an empty state', async () => {
    serve({ logs: () => ({ rows: [] }) })
    render(<RoomsTable onOpen={() => undefined} />)
    expect(await screen.findByTestId('rooms-empty')).toBeTruthy()
  })

  it('shows errors with a retry, and no retry when signed out', async () => {
    let fail = true
    serve({ logs: () => (fail ? apiError(503, 'db_unavailable') : { rows: ROWS }) })
    render(<RoomsTable onOpen={() => undefined} />)
    expect((await screen.findByTestId('rooms-error')).textContent).toMatch(/waking up/)
    fail = false
    fireEvent.click(screen.getByTestId('rooms-retry'))
    expect(await screen.findAllByTestId('rooms-row')).toHaveLength(3)
    cleanup()

    serve({ logs: () => apiError(401, 'unauthorized') })
    render(<RoomsTable onOpen={() => undefined} />)
    expect((await screen.findByTestId('rooms-error')).textContent).toMatch(/Sign in/)
    expect(screen.queryByTestId('rooms-retry')).toBeNull()
  })
})

describe('VisitsToConfirm', () => {
  it('counts pending tags and claimable guest visits', async () => {
    const onOpen = vi.fn()
    serve({ pendingTags: () => ({ tags: [pendingTag()] }), claims: () => ({ claims: [claim()] }), notifications: () => ({ items: [], unread: 0, nextCursor: null }) })
    render(<VisitsToConfirm onOpen={onOpen} />)
    const b = await screen.findByTestId('visits-to-confirm')
    expect(b.textContent).toContain('3 visits to confirm')
    fireEvent.click(b)
    expect(onOpen).toHaveBeenCalled()
  })

  it('says "1 visit" and renders nothing when empty or signed out', async () => {
    serve({ pendingTags: () => ({ tags: [pendingTag()] }), claims: () => ({ claims: [] }) })
    render(<VisitsToConfirm />)
    expect((await screen.findByTestId('visits-to-confirm')).textContent).toContain('1 visit to confirm')
    expect(screen.getByTestId('visits-to-confirm').getAttribute('href')).toBe('/settings#inbox')
    cleanup()

    const api = serve({ pendingTags: () => apiError(401, 'unauthorized'), claims: () => apiError(401, 'unauthorized') })
    const { container } = render(<VisitsToConfirm />)
    await waitFor(() => expect(api.calls('claims')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(container.innerHTML).toBe('')
  })
})

describe('ReviewDetail', () => {
  it('shows facts, crew, my review, friends reviews, puzzles and the public link', async () => {
    const v = visit({
      participants: [participant('pa', ALICE, 'owner'), participant('pb', BOB, 'accepted'), participant('pg', 'Jules', 'accepted'), participant('pm', MIA, 'pending')],
      reviews: [review({ memorablePuzzleIds: ['pzl_1'] }), review({ id: 'rev_bob', author: BOB, transcript: null, ratings: ratings(91, 'Great stars'), containsSpoilers: true, visibility: 'friends' })],
    })
    serve({ visit: (req) => (req.params.id === 'vis_1' ? v : apiError(404, 'not_found')) })
    render(<ReviewDetail visitId="vis_1" onBack={() => undefined} />)
    expect((await screen.findByTestId('review-title')).textContent).toBe('The Lost Observatory')
    expect(screen.getByTestId('review-escaped').textContent).toBe('Yes · 52m')
    expect(screen.getByTestId('review-crew').textContent).toBe('Bob, Jules, Mia (pending)')
    expect(screen.getByTestId('review-features').textContent).toContain('Visible timer')
    expect(screen.getByTestId('review-features').textContent).toContain('UV light')
    expect(screen.getByTestId('review-public-link').getAttribute('href')).toBe('/games/the-lost-observatory')
    const mine = screen.getByTestId('review-mine')
    expect(within(mine).getByTestId('score-overall').textContent).toBe('88')
    expect(screen.getByTestId('review-puzzles').textContent).toContain('★')
    // Bob's review has spoilers: hidden until revealed.
    const other = screen.getByTestId('review-other')
    expect(within(other).queryByText('Great stars')).toBeNull()
    fireEvent.click(within(other).getByTestId('review-reveal'))
    expect(within(other).getByText('Great stars')).toBeTruthy()
    // Transcript is mine only, behind a toggle.
    fireEvent.click(screen.getByTestId('review-transcript-toggle'))
    expect(screen.getByTestId('review-transcript').textContent).toBe('We did the observatory.')
    // Others accepted: I can only leave, not delete.
    expect(screen.getByTestId('visit-remove').textContent).toBe('Remove me from this visit')
  })

  it('changes visibility and the spoiler flag through the API', async () => {
    let r = review()
    const api = serve({
      visit: () => visit({ reviews: [r] }),
      updateReview: (req) => {
        r = { ...r, ...(req.body as object) }
        return r
      },
    })
    render(<ReviewDetail visitId="vis_1" onBack={() => undefined} />)
    const sel = (await screen.findByTestId('review-visibility')) as HTMLSelectElement
    expect(sel.value).toBe('public')
    fireEvent.change(sel, { target: { value: 'private' } })
    await waitFor(() => expect((screen.getByTestId('review-visibility') as HTMLSelectElement).value).toBe('private'))
    expect(api.calls('updateReview')[0]).toMatchObject({ params: { id: 'rev_1' }, body: { visibility: 'private' } })
    fireEvent.click(screen.getByTestId('review-spoilers'))
    await waitFor(() => expect(api.calls('updateReview')).toHaveLength(2))
    expect(api.calls('updateReview')[1].body).toEqual({ containsSpoilers: true })
  })

  it('flags copied scores', async () => {
    serve({ visit: () => visit({ reviews: [review({ scoresCopied: true, copiedFromReviewId: 'rev_x' })] }) })
    render(<ReviewDetail visitId="vis_1" onBack={() => undefined} />)
    expect(await screen.findByTestId('review-copied')).toBeTruthy()
  })

  it('lets a tagged friend accept or decline', async () => {
    let status: 'pending' | 'accepted' = 'pending'
    const api = serve({
      visit: () =>
        visit({
          myStatus: status,
          participants: [participant('pb', BOB, 'owner'), participant('pa', ALICE, status)],
          reviews: status === 'accepted' ? [review({ author: BOB, transcript: null, id: 'rev_b' }), review({ scoresCopied: true })] : [review({ author: BOB, transcript: null, id: 'rev_b' })],
        }),
      respondToTag: (req) => {
        status = 'accepted'
        return { visit: null, status: (req.body as { accept: boolean }).accept ? 'accepted' : 'declined' }
      },
    })
    render(<ReviewDetail visitId="vis_1" onBack={() => undefined} />)
    expect((await screen.findByTestId('review-tag-answer')).textContent).toContain('Bob says you played this together')
    expect(screen.queryByTestId('review-actions')).toBeNull()
    fireEvent.click(screen.getByTestId('tag-accept'))
    expect(await screen.findByTestId('review-copied')).toBeTruthy()
    expect(api.calls('respondToTag')[0].body).toEqual({ accept: true })
    expect(screen.queryByTestId('review-tag-answer')).toBeNull()
  })

  it('declining goes back', async () => {
    const onBack = vi.fn()
    serve({
      visit: () => visit({ myStatus: 'pending', participants: [participant('pb', BOB, 'owner'), participant('pa', ALICE, 'pending')], reviews: [] }),
      respondToTag: () => ({ visit: null, status: 'declined' }),
    })
    render(<ReviewDetail visitId="vis_1" onBack={onBack} />)
    fireEvent.click(await screen.findByTestId('tag-decline'))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
  })

  it('deletes a solo visit after confirming, and shows API errors', async () => {
    const onBack = vi.fn()
    let allow = false
    const api = serve({ visit: () => visit(), deleteVisit: () => (allow ? { deleted: true } : apiError(409, 'conflict', 'Someone accepted this visit.')) })
    render(<ReviewDetail visitId="vis_1" onBack={onBack} />)
    fireEvent.click(await screen.findByTestId('visit-remove'))
    fireEvent.click(screen.getByTestId('visit-remove-confirm'))
    expect((await screen.findByRole('alert')).textContent).toBe('Someone accepted this visit.')
    expect(onBack).not.toHaveBeenCalled()
    allow = true
    fireEvent.click(screen.getByTestId('visit-remove-confirm'))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(api.calls('deleteVisit')).toHaveLength(2)
    expect(api.calls('leaveVisit')).toHaveLength(0)
  })

  it('shows a not-found error and a back button', async () => {
    const onBack = vi.fn()
    serve({ visit: () => apiError(404, 'not_found', 'Visit not found.') })
    render(<ReviewDetail visitId="nope" onBack={onBack} />)
    expect((await screen.findByTestId('review-error')).textContent).toBe('Visit not found.')
    fireEvent.click(screen.getByTestId('review-back'))
    expect(onBack).toHaveBeenCalled()
  })
})
