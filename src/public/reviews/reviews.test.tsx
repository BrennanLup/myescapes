import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionState } from '../../auth'
import { ALICE, BOB, MIA, REVIEWS, fetchStub, review } from '../shared/fixtures'
import { AggregateScores, AuthorCard, ReportButton, ReviewCard, ReviewList } from '.'

const session = vi.hoisted(() => ({ current: { status: 'signed-in', user: null } as unknown }))
vi.mock('../../auth', () => ({
  useSession: () => session.current as SessionState,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}))

beforeEach(() => {
  session.current = { status: 'signed-in', user: { ...ALICE, email: 'alice@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' } }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AuthorCard', () => {
  it('shows display name and @handle', () => {
    render(<AuthorCard user={ALICE} />)
    const card = screen.getByTestId('author-card')
    expect(card.textContent).toContain('Alice A.')
    expect(card.textContent).toContain('@alice')
  })

  it('shows the profile picture when there is one, initials otherwise', () => {
    const { container } = render(
      <>
        <AuthorCard user={BOB} />
        <AuthorCard user={MIA} />
      </>,
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe(BOB.image)
    expect(imgs[0].getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(container.textContent).toContain('MI')
  })

  it('never renders an email, even if a server leaked one into the object', () => {
    const leaky = { ...ALICE, email: 'alice@example.com' } as typeof ALICE
    const { container } = render(<ReviewCard review={review({ id: 'r', author: leaky, playedWith: [{ reviewId: 'r2', author: leaky }] })} />)
    expect(container.textContent).not.toContain('@example.com')
    expect(container.innerHTML).not.toContain('alice@example.com')
  })
})

describe('ReviewCard', () => {
  it('shows scores, the escape result and the comment', () => {
    render(<ReviewCard review={REVIEWS[0]} />)
    const card = screen.getByTestId('review-card')
    expect(card.textContent).toContain('88')
    expect(card.textContent).toContain('Escaped in 52 min')
    expect(card.textContent).toContain('Loved the telescope room.')
    expect(card.id).toBe('review-rev_alice')
  })

  it('hides spoiler comments until "Show spoilers"', () => {
    render(<ReviewCard review={REVIEWS[1]} />)
    expect(screen.queryByText(/astronomer was the thief/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show spoilers' }))
    expect(screen.getByText(/astronomer was the thief/)).toBeTruthy()
  })

  it('links "played together" reviews by anchor', () => {
    render(<ReviewCard review={REVIEWS[0]} />)
    const pw = screen.getByTestId('played-with')
    expect(pw.textContent).toContain('Bob')
    expect(pw.querySelector('a')?.getAttribute('href')).toBe('#review-rev_bob')
  })

  it('marks copied scores as not counted', () => {
    render(<ReviewCard review={REVIEWS[2]} />)
    expect(screen.getByTestId('copied-scores-note').textContent).toMatch(/aren't counted/)
  })

  it("says when the crew didn't escape", () => {
    render(<ReviewCard review={review({ id: 'x', author: ALICE, escaped: false, escapeTimeMinutes: 60 })} />)
    expect(screen.getByTestId('review-card').textContent).toContain("Didn't escape (60 min)")
  })
})

describe('AggregateScores', () => {
  it('shows averages and explains that copies are excluded', () => {
    render(<AggregateScores aggregate={{ reviewCount: 2, visitCount: 3, escapeRate: 2 / 3, avgEscapeMinutes: 51.5, avg: { overall: 84.4, puzzles: 80, setting: null, storyline: 70, difficulty: 60 } }} />)
    expect(screen.getByTestId('aggregate-overall').textContent).toContain('84')
    expect(screen.getByTestId('aggregate-escape-rate').textContent).toBe('67%')
    expect(screen.getByTestId('aggregate-review-count').textContent).toBe('2')
    expect(screen.getByTestId('aggregate-scores').textContent).toMatch(/copied from a teammate's review aren't counted/)
  })

  it('has an empty state', () => {
    render(<AggregateScores aggregate={{ reviewCount: 0, visitCount: 0, escapeRate: null, avgEscapeMinutes: null, avg: { overall: null, puzzles: null, setting: null, storyline: null, difficulty: null } }} />)
    expect(screen.getByTestId('aggregate-scores').textContent).toContain('No public reviews yet')
  })
})

describe('ReportButton', () => {
  it('sends a report with the chosen reason and note', async () => {
    const stub = fetchStub({ '/api/reports': { status: 201, body: { id: 'rpt_1' } } })
    vi.stubGlobal('fetch', stub.fn)
    render(<ReportButton targetType="review" targetId="rev_bob" />)
    fireEvent.click(screen.getByTestId('report-button'))
    fireEvent.click(screen.getByLabelText('Offensive or abusive'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rude' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await screen.findByTestId('report-sent')
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(stub.calls[0].init?.body))).toEqual({ targetType: 'review', targetId: 'rev_bob', reason: 'offensive', note: 'rude' })
  })

  it('asks a signed-out visitor to sign in instead of opening the form', () => {
    session.current = { status: 'signed-out', user: null }
    render(<ReportButton targetType="game" targetId="gam_1" />)
    fireEvent.click(screen.getByTestId('report-button'))
    const prompt = screen.getByTestId('report-sign-in')
    expect(prompt.querySelector('a')?.getAttribute('href')).toMatch(/^\/welcome\?next=/)
    expect(screen.queryByTestId('report-form')).toBeNull()
  })

  it('falls back to the sign-in prompt on a 401', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/reports': { status: 401, body: { error: 'Sign in first', code: 'unauthorized' } } }).fn)
    render(<ReportButton targetType="review" targetId="rev_bob" />)
    fireEvent.click(screen.getByTestId('report-button'))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await screen.findByTestId('report-sign-in')
  })

  it('shows the server message on other errors', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/reports': { status: 429, body: { error: 'Too many reports', code: 'rate_limited' } } }).fn)
    render(<ReportButton targetType="review" targetId="rev_bob" />)
    fireEvent.click(screen.getByTestId('report-button'))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Too many reports')
  })
})

describe('ReviewList', () => {
  it('loads more pages and drops duplicates', async () => {
    const fetchPage = vi.fn(async () => ({ reviews: [REVIEWS[2], review({ id: 'rev_new', author: MIA, ratings: { ...REVIEWS[0].ratings, overall: { score: 40, comment: 'Meh' } } })], nextCursor: null }))
    render(<ReviewList gameSlug="g" initial={{ reviews: REVIEWS, nextCursor: 'c2' }} fetchPage={fetchPage} />)
    expect(screen.getAllByTestId('review-card')).toHaveLength(3)
    await act(async () => {
      fireEvent.click(screen.getByTestId('more-reviews'))
    })
    expect(fetchPage).toHaveBeenCalledWith('c2')
    await waitFor(() => expect(screen.getAllByTestId('review-card')).toHaveLength(4))
    expect(screen.queryByTestId('more-reviews')).toBeNull()
  })

  it('uses the gameReviews route by default', async () => {
    const stub = fetchStub({ '/api/games/the-game/reviews?cursor=c2': { body: { reviews: [], nextCursor: null } } })
    vi.stubGlobal('fetch', stub.fn)
    render(<ReviewList gameSlug="the-game" initial={{ reviews: [], nextCursor: 'c2' }} />)
    expect(screen.getByTestId('review-list').textContent).toContain('No public reviews yet')
    fireEvent.click(screen.getByTestId('more-reviews'))
    await waitFor(() => expect(screen.queryByTestId('more-reviews')).toBeNull())
    expect(stub.calls[0].url).toBe('/api/games/the-game/reviews?cursor=c2')
  })

  it('shows an error when a page fails', async () => {
    render(<ReviewList gameSlug="g" initial={{ reviews: [], nextCursor: 'c2' }} fetchPage={() => Promise.reject(new Error('x'))} />)
    fireEvent.click(screen.getByTestId('more-reviews'))
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load more")
  })
})
