import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { REVIEWS, fetchStub } from '../shared/fixtures'
import { ReviewsFeedPage, cityFromSearch, cityLabel } from '.'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('ReviewsFeedPage', () => {
  it('loads the feed', async () => {
    window.history.replaceState(null, '', '/reviews')
    const stub = fetchStub({ '/api/reviews': { body: { reviews: REVIEWS, nextCursor: null } } })
    vi.stubGlobal('fetch', stub.fn)
    render(<ReviewsFeedPage params={{}} rest="/" />)
    await waitFor(() => expect(screen.getAllByTestId('review-card')).toHaveLength(REVIEWS.length))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Escape room reviews')
  })

  it('narrows to a city from ?city=', async () => {
    window.history.replaceState(null, '', '/reviews?city=san-francisco-ca-us')
    const stub = fetchStub({ '/api/reviews?city=san-francisco-ca-us': { body: { reviews: [], nextCursor: null } } })
    vi.stubGlobal('fetch', stub.fn)
    render(<ReviewsFeedPage params={{}} rest="/" />)
    await waitFor(() => expect(screen.getByTestId('review-list').textContent).toContain('No public reviews yet.'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reviews in San Francisco')
    expect(stub.calls[0].url).toBe('/api/reviews?city=san-francisco-ca-us')
  })

  it('parses and labels city slugs', () => {
    expect(cityFromSearch('?city=tokyo-13-jp')).toBe('tokyo-13-jp')
    expect(cityFromSearch('?city=<script>')).toBeNull()
    expect(cityLabel('new-york-ny-us')).toBe('New York')
  })
})
