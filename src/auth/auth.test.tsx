import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Me } from '../contracts/models'
import { IDBFactory } from 'fake-indexeddb'
import { countAllRecordings, enqueueRecording, resetQueueStoreForTests } from '../mobile/log/queue'
import { deleteAccount, localHandleProblem, needsOnboarding, Onboarding, OnboardingGate, refreshSession, signInErrorURL, signInWithGoogle, signOut, suggestHandle, useSession } from './index'
import { resetSessionForTests } from './session'

const me = (over: Partial<Me> = {}): Me => ({
  id: 'usr_1',
  handle: null,
  displayName: 'Brennan Lup',
  image: null,
  email: 'brennan@example.com',
  onboarded: false,
  isAdmin: false,
  createdAt: '2026-10-26T00:00:00.000Z',
  ...over,
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetSessionForTests()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('handle helpers', () => {
  it('suggests a handle from the Google name, else the email', () => {
    expect(suggestHandle('Brennan Lup')).toBe('brennanlup')
    expect(suggestHandle('José Núñez')).toBe('josenunez')
    expect(suggestHandle('李', 'mia.w@example.com')).toBe('miaw')
    expect(suggestHandle('', '42@example.com')).toBe('escaper')
    expect(suggestHandle('Admin')).toBe('admin_1')
    expect(localHandleProblem(suggestHandle('A very long name that keeps going on'))).toBeNull()
  })

  it('pre-checks typed handles', () => {
    expect(localHandleProblem('@ok_name')).toBeNull()
    expect(localHandleProblem('ab')).toMatch(/3/)
    expect(localHandleProblem('9lives')).toMatch(/letter/)
    expect(localHandleProblem('bad-dash')).toMatch(/Letters/)
    expect(localHandleProblem('privacy')).toMatch(/reserved/)
  })
})

describe('session', () => {
  it('401 from /api/me means signed out; 200 means signed in', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Please sign in first.', code: 'unauthorized' }))
    expect((await refreshSession()).status).toBe('signed-out')
    fetchMock.mockResolvedValueOnce(json(200, me({ onboarded: true, handle: 'b' })))
    const s = await refreshSession()
    expect(s.status).toBe('signed-in')
    expect(needsOnboarding(s)).toBe(false)
  })

  it('useSession loads once and updates subscribers', async () => {
    fetchMock.mockResolvedValue(json(200, me()))
    function Probe() {
      const s = useSession()
      return <p data-testid="s">{s.status}</p>
    }
    render(<Probe />)
    expect(screen.getByTestId('s').textContent).toBe('loading')
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('signed-in'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/me')
  })

  it('signInWithGoogle posts to Better Auth and follows the Google URL', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    fetchMock.mockResolvedValueOnce(json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirect: true }))
    await signInWithGoogle('/m')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/sign-in/social')
    expect(JSON.parse(init.body)).toMatchObject({ provider: 'google', callbackURL: '/m', errorCallbackURL: '/m?signin=failed' })
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
  })

  it('a failed sign-in returns to the phone app, or to /welcome keeping where the visitor was heading', () => {
    expect(signInErrorURL('/m')).toBe('/m?signin=failed')
    expect(signInErrorURL('/m/log')).toBe('/m?signin=failed')
    expect(signInErrorURL('/')).toBe('/welcome?signin=failed')
    expect(signInErrorURL('/invite/AbC')).toBe('/welcome?signin=failed&next=%2Finvite%2FAbC')
    expect(signInErrorURL('/mia')).toBe('/welcome?signin=failed&next=%2Fmia')
  })

  it('signOut deletes the recording queue on this device, even if the request fails', async () => {
    globalThis.indexedDB = new IDBFactory()
    resetQueueStoreForTests()
    await enqueueRecording({ ownerId: 'usr_a', audio: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }), durationSeconds: 2 })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(signOut()).rejects.toThrow('offline')
    expect(await countAllRecordings()).toBe(0)
  })

  it('deleteAccount deletes the recording queue on this device', async () => {
    globalThis.indexedDB = new IDBFactory()
    resetQueueStoreForTests()
    await enqueueRecording({ ownerId: 'usr_a', audio: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }), durationSeconds: 2 })
    fetchMock.mockResolvedValueOnce(json(200, { deleted: true }))
    await deleteAccount()
    expect(await countAllRecordings()).toBe(0)
  })

  it('signOut clears the session even if the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(signOut()).rejects.toThrow('offline')
    fetchMock.mockResolvedValueOnce(json(401, {}))
    expect((await refreshSession()).status).toBe('signed-out')
  })
})

describe('onboarding', () => {
  it('prefills from Google, checks the handle, and saves both', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/handles/')) {
        const h = decodeURIComponent(url.split('/').pop()!)
        return json(200, { handle: h, available: h !== 'brennanlup', reason: h === 'brennanlup' ? 'taken' : null })
      }
      if (url === '/api/me' && init?.method === 'PATCH') {
        const b = JSON.parse(String(init.body))
        return json(200, me({ ...b, onboarded: true }))
      }
      return json(404, {})
    })
    const done = vi.fn()
    const user = userEvent.setup()
    render(<Onboarding user={me()} onDone={done} />)
    const name = screen.getByTestId('onboarding-name') as HTMLInputElement
    const handle = screen.getByTestId('onboarding-handle') as HTMLInputElement
    expect(name.value).toBe('Brennan Lup')
    expect(handle.value).toBe('brennanlup')
    await waitFor(() => expect(screen.getByTestId('onboarding-handle-status').textContent).toMatch(/taken/))
    expect((screen.getByTestId('onboarding-save') as HTMLButtonElement).disabled).toBe(true)

    await user.clear(handle)
    await user.type(handle, 'brennan_l')
    await waitFor(() => expect(screen.getByTestId('onboarding-handle-status').textContent).toMatch(/free/))
    await user.clear(name)
    await user.type(name, 'Brennan')
    await act(async () => {
      await user.click(screen.getByTestId('onboarding-save'))
    })
    await waitFor(() => expect(done).toHaveBeenCalled())
    const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/me' && i?.method === 'PATCH')!
    expect(JSON.parse(String(patch[1].body))).toEqual({ displayName: 'Brennan', handle: 'brennan_l' })
  })

  it('the gate shows onboarding to a new user and the app to an onboarded one', async () => {
    fetchMock.mockImplementation(async (url: string) => (url === '/api/me' ? json(200, me()) : json(200, { handle: 'brennanlup', available: true, reason: null })))
    render(
      <OnboardingGate>
        <p data-testid="app">app</p>
      </OnboardingGate>,
    )
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeTruthy())
    expect(screen.queryByTestId('app')).toBeNull()
    cleanup()
    resetSessionForTests()
    fetchMock.mockImplementation(async () => json(200, me({ onboarded: true, handle: 'b' })))
    render(
      <OnboardingGate>
        <p data-testid="app">app</p>
      </OnboardingGate>,
    )
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy())
  })
})
