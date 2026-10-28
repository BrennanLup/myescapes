import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchStub } from '../shared/fixtures'
import { CrawlerAdminPage } from './crawler'

const STATUS = { model: 'claude-opus-5-5', running: null, runs: [], venuesTried: 40, venuesWithRooms: 31, venuesLeft: 3300, rooms: 120, spentUsd: 2.1, estimatedUsdForRest: 173.25 }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CrawlerAdminPage', () => {
  it('shows totals and starts a run', async () => {
    const stub = fetchStub({ '/api/admin/enrich': (init) => (init?.method === 'POST' ? { status: 202, body: { id: 'enr_1' } } : { body: STATUS }) })
    vi.stubGlobal('fetch', stub.fn)
    render(<CrawlerAdminPage params={{}} rest="/" />)
    await waitFor(() => expect(screen.getByTestId('crawler-totals').textContent).toContain('3300'))
    expect(screen.getByTestId('crawler-totals').textContent).toContain('$173.25')
    fireEvent.click(screen.getByRole('button', { name: 'Start a run' }))
    await waitFor(() => expect(stub.calls.some((c) => c.init?.method === 'POST')).toBe(true))
    expect(JSON.parse(String(stub.calls.find((c) => c.init?.method === 'POST')!.init!.body))).toEqual({ limit: 500, budgetUsd: 25 })
  })

  it('says admins only on 403', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/admin/enrich': { status: 403, body: { error: 'Admins only.', code: 'forbidden' } } }).fn)
    render(<CrawlerAdminPage params={{}} rest="/" />)
    expect((await screen.findByRole('alert')).textContent).toBe('Admins only.')
  })
})
