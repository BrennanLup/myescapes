import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../contracts/models'
import { enqueueRecording, markTranscribed, resetQueueStoreForTests } from '../log/queue'

const session = vi.hoisted(() => ({ current: { status: 'signed-out', user: null } as { status: string; user: unknown } }))
const signIn = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../auth', () => ({
  useSession: () => session.current,
  signInWithGoogle: signIn,
  signOut: vi.fn(async () => {}),
  setSessionUser: vi.fn(),
}))

const { MobileApp, mobileScreen } = await import('./index')
const { handleProblem, suggestHandle } = await import('./onboarding')

const ME: Me = { id: 'usr_alice', handle: 'alice', displayName: 'Alice', image: null, email: 'alice@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  window.scrollTo = () => {}
  globalThis.indexedDB = new IDBFactory()
  resetQueueStoreForTests()
  window.history.replaceState(null, '', '/m')
})
afterEach(() => {
  cleanup()
  session.current = { status: 'signed-out', user: null }
})

describe('mobile routing', () => {
  it('maps /m sub-paths to screens', () => {
    expect(mobileScreen('/')).toEqual({ name: 'home' })
    expect(mobileScreen('/log', '?resume=rec_1')).toEqual({ name: 'log', resume: 'rec_1' })
    expect(mobileScreen('/log')).toEqual({ name: 'log', resume: null })
    expect(mobileScreen('/rooms/vis_1')).toEqual({ name: 'room', visitId: 'vis_1' })
    expect(mobileScreen('/inbox')).toEqual({ name: 'inbox' })
    expect(mobileScreen('/nope')).toEqual({ name: 'unknown' })
  })
})

describe('onboarding helpers', () => {
  it('suggests a valid handle from the Google name or email', () => {
    expect(suggestHandle({ displayName: 'Brennan Lup', email: 'b@x.com', handle: null })).toBe('brennan_lup')
    expect(suggestHandle({ displayName: 'Zoë', email: 'z@x.com', handle: null })).toBe('zoe')
    expect(suggestHandle({ displayName: '', email: '42jo@x.com', handle: null })).toBe('jo_escaper')
    expect(suggestHandle({ displayName: 'x', email: '', handle: 'kept' })).toBe('kept')
    for (const n of ['Brennan Lup', 'Zoë', '李', '12345']) expect(handleProblem(suggestHandle({ displayName: n, email: 'q@x.com', handle: null }))).toBeNull()
    expect(handleProblem('admin')).toMatch(/reserved/)
    expect(handleProblem('a')).toBeTruthy()
  })
})

describe('MobileApp', () => {
  it('signed out: a Google sign-in that returns to /m, plus the static page links', async () => {
    render(<MobileApp rest="/" />)
    await userEvent.click(screen.getByTestId('mobile-signin-google'))
    expect(signIn).toHaveBeenCalledWith('/m')
    for (const p of ['/about', '/privacy', '/terms']) expect(document.querySelector(`a[href="${p}"]`)).toBeTruthy()
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest-mobile.webmanifest')
  })

  it('not onboarded: asks for a display name and @handle first', async () => {
    session.current = { status: 'signed-in', user: { ...ME, handle: null, displayName: 'Alice Smith', onboarded: false } }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/handles/')) return json({ handle: 'alice_smith', available: true, reason: null })
      if (url === '/api/me' && init?.method === 'PATCH') return json({ ...ME, ...JSON.parse(String(init.body)), onboarded: true })
      if (url === '/api/tags/pending') return json({ tags: [] })
      return json({ error: 'x', code: 'not_implemented' }, 501)
    })
    render(<MobileApp rest="/" fetch={fetchMock as unknown as typeof fetch} />)
    expect((screen.getByTestId('onboarding-handle') as HTMLInputElement).value).toBe('alice_smith')
    await waitFor(() => expect(screen.getByTestId('onboarding-handle-status').textContent).toBe('Available'))
    await userEvent.click(screen.getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('mobile-home')).toBeTruthy()
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ displayName: 'Alice Smith', handle: 'alice_smith' })
  })

  it('home: big log button, visits to confirm, recordings waiting, transcripts ready, view on desktop', async () => {
    session.current = { status: 'signed-in', user: ME }
    const waiting = await enqueueRecording({ ownerId: ME.id, audio: new Blob([new Uint8Array([1])], { type: 'audio/webm' }), durationSeconds: 3 })
    const ready = await enqueueRecording({ ownerId: ME.id, audio: new Blob([new Uint8Array([2])], { type: 'audio/webm' }), durationSeconds: 3 })
    await markTranscribed(ready.id, 'done already')
    let transcribeCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/tags/pending') return json({ tags: [{}, {}].map((_, i) => ({ visitId: `v${i}`, participantId: `p${i}`, date: '2026-10-12', createdAt: 'x', taggedBy: { id: 'usr_bob', handle: 'bob', displayName: 'Bob', image: null }, game: { id: 'g', slug: 'g', name: 'G', genre: null, status: 'active', venueId: 'v', venueName: 'V', venueSlug: 'v', city: 'C', country: 'US', reviewCount: 0, avgOverall: null } })) })
      if (url === '/api/transcribe') {
        transcribeCalls++
        return new Response('offline', { status: 503 })
      }
      return json({ error: 'x', code: 'not_implemented' }, 501)
    })
    render(<MobileApp rest="/" fetch={fetchMock as unknown as typeof fetch} />)
    expect(screen.getByTestId('log-room').textContent).toBe('Log an escape room')
    expect((await screen.findByTestId('pending-tags')).textContent).toContain('2 visits to confirm')
    expect((await screen.findByTestId('upload-queue')).textContent).toContain('1 recording waiting to upload')
    expect(screen.getByTestId('upload-ready').textContent).toContain('1 transcript ready to log')
    // Automatic retry on open, and again when the phone comes back online.
    await waitFor(() => expect(transcribeCalls).toBe(1))
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(transcribeCalls).toBe(2))
    await userEvent.click(screen.getByTestId('upload-queue-retry'))
    await waitFor(() => expect(transcribeCalls).toBe(3))
    expect(screen.getByTestId('upload-queue').textContent).toContain('1 recording waiting to upload')
    expect(waiting.id).toBeTruthy()

    await userEvent.click(screen.getByTestId('upload-ready'))
    expect(window.location.pathname + window.location.search).toBe(`/m/log?resume=${ready.id}`)
  })

  it("home: another account's recordings left on this phone are not shown or uploaded", async () => {
    session.current = { status: 'signed-in', user: ME }
    const other = await enqueueRecording({ ownerId: 'usr_previous', audio: new Blob([new Uint8Array([1])], { type: 'audio/webm' }), durationSeconds: 3 })
    const theirs = await enqueueRecording({ ownerId: 'usr_previous', audio: new Blob([new Uint8Array([2])], { type: 'audio/webm' }), durationSeconds: 3 })
    await markTranscribed(theirs.id, "someone else's transcript")
    let transcribeCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/transcribe') {
        transcribeCalls++
        return json({ transcript: 'x' })
      }
      return json({ error: 'x', code: 'not_implemented' }, 501)
    })
    render(<MobileApp rest="/" fetch={fetchMock as unknown as typeof fetch} />)
    expect(await screen.findByTestId('mobile-home')).toBeTruthy()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
      window.dispatchEvent(new Event('online'))
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(transcribeCalls).toBe(0)
    expect(screen.queryByTestId('upload-queue')).toBeNull()
    expect(screen.queryByTestId('upload-ready')).toBeNull()
    expect(other.id).toBeTruthy()
  })

  it('visits to confirm counts pending tags and guest-name claims once per visit', async () => {
    session.current = { status: 'signed-in', user: ME }
    const game = { id: 'g', slug: 'g', name: 'G', genre: null, status: 'active', venueId: 'v', venueName: 'V', venueSlug: 'v', city: 'C', country: 'US', reviewCount: 0, avgOverall: null }
    const bob = { id: 'usr_bob', handle: 'bob', displayName: 'Bob', image: null }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/tags/pending') return json({ tags: [{ visitId: 'v0', participantId: 'p0', date: '2026-10-12', createdAt: 'x', taggedBy: bob, game }] })
      if (url === '/api/claims')
        return json({
          claims: [
            {
              inviter: bob,
              guestName: 'Ali',
              visits: [
                { visitId: 'v0', participantId: 'p9', game, date: '2026-10-12' },
                { visitId: 'v1', participantId: 'p1', game, date: '2026-10-13' },
              ],
            },
          ],
        })
      return json({ error: 'x', code: 'not_implemented' }, 501)
    })
    render(<MobileApp rest="/" fetch={fetchMock as unknown as typeof fetch} />)
    expect((await screen.findByTestId('pending-tags')).textContent).toContain('2 visits to confirm')
  })

  it('"View on desktop" remembers the choice and opens the 3D room', async () => {
    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, assign, pathname: '/m', search: '' } })
    try {
      render(<MobileApp rest="/" />)
      await userEvent.click(screen.getByTestId('view-on-desktop'))
      expect(assign).toHaveBeenCalledWith('/?desktop=1')
      expect(localStorage.getItem('myescapes:view')).toBe('desktop')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: orig })
      localStorage.clear()
    }
  })
})
