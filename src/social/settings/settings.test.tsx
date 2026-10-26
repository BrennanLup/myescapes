import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiError, fakeApi, me } from '../testing/fakeApi'
import { countAllRecordings, enqueueRecording, resetQueueStoreForTests } from '../../mobile/log/queue'
import { SettingsPage, settingsNav } from './index'

const auth = vi.hoisted(() => ({ signIn: vi.fn(async (_cb?: string) => undefined), signOut: vi.fn(async () => undefined) }))
vi.mock('../../auth', async () => ({
  // The real one: it clears this device's recording queue.
  clearLocalAccountData: (await vi.importActual<typeof import('../../auth/api')>('../../auth/api')).clearLocalAccountData,
  useSession: () => ({ status: 'signed-in', user: null }),
  signInWithGoogle: auth.signIn,
  signOut: auth.signOut,
}))

let leave: ReturnType<typeof vi.fn>
beforeEach(() => {
  leave = vi.fn()
  settingsNav.leave = leave as unknown as (to: string) => void
  auth.signIn.mockClear()
  auth.signOut.mockClear()
  globalThis.indexedDB = new IDBFactory()
  resetQueueStoreForTests()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Every other section answers 501 (not built) unless given; settings must still render. */
function serve(handlers: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi({ me: () => me(), ...handlers })
  vi.stubGlobal('fetch', api.fetch)
  return api
}

describe('SettingsPage', () => {
  it('renders profile, inbox, friends, data, account and the static page links', async () => {
    serve({})
    render(<SettingsPage />)
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
    expect((screen.getByTestId('profile-display-name') as HTMLInputElement).value).toBe('Alice')
    expect((screen.getByTestId('profile-handle') as HTMLInputElement).value).toBe('alice')
    expect(screen.getByTestId('settings-inbox')).toBeTruthy()
    expect(screen.getByTestId('friends-panel')).toBeTruthy()
    expect(screen.getByTestId('data-card')).toBeTruthy()
    expect(screen.getByTestId('account-card')).toBeTruthy()
    const links = screen.getByTestId('legal-links')
    for (const p of ['/about', '/privacy', '/terms']) expect(links.querySelector(`a[href="${p}"]`)).toBeTruthy()
    // The email is shown to its owner only, with the promise that it never goes public.
    expect(screen.getByTestId('profile-card').textContent).toContain('never your email (alice@example.com)')
  })

  it('offers sign-in when signed out, and still links the static pages', async () => {
    serve({ me: () => apiError(401, 'unauthorized') })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('settings-sign-in'))
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('/settings'))
    expect(screen.getByTestId('legal-links').querySelector('a[href="/privacy"]')).toBeTruthy()
  })

  it('shows a retryable error when /api/me fails', async () => {
    let fail = true
    serve({ me: () => (fail ? apiError(503, 'db_unavailable') : me()) })
    render(<SettingsPage />)
    expect(await screen.findByTestId('settings-error')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
  })
})

describe('profile', () => {
  it('checks handle availability and saves name and handle', async () => {
    let current = me()
    const api = serve({
      me: () => current,
      handleAvailable: (req) => ({ handle: req.params.handle, available: req.params.handle !== 'bob', reason: req.params.handle === 'bob' ? 'taken' : null }),
      updateMe: (req) => {
        const b = req.body as { displayName?: string; handle?: string }
        current = { ...current, ...(b.displayName ? { displayName: b.displayName } : {}), ...(b.handle ? { handle: b.handle } : {}) }
        return current
      },
    })
    render(<SettingsPage />)
    const handle = (await screen.findByTestId('profile-handle')) as HTMLInputElement
    const save = screen.getByTestId('profile-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(handle, { target: { value: '1x' } })
    expect(screen.getByTestId('profile-handle-status').textContent).toMatch(/starting with a letter/)
    expect(save.disabled).toBe(true)

    fireEvent.change(handle, { target: { value: 'bob' } })
    await waitFor(() => expect(screen.getByTestId('profile-handle-status').textContent).toBe('That handle is taken.'), { timeout: 2000 })
    expect(save.disabled).toBe(true)

    fireEvent.change(handle, { target: { value: '@Ally_2' } })
    await waitFor(() => expect(screen.getByTestId('profile-handle-status').textContent).toBe('Available'), { timeout: 2000 })
    expect(api.calls('handleAvailable').at(-1)?.params.handle).toBe('ally_2')
    fireEvent.change(screen.getByTestId('profile-display-name'), { target: { value: ' Ally ' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(await screen.findByTestId('profile-saved')).toBeTruthy()
    expect(api.calls('updateMe')[0].body).toEqual({ displayName: 'Ally', handle: 'ally_2' })
    await waitFor(() => expect((screen.getByTestId('profile-handle') as HTMLInputElement).value).toBe('ally_2'))
  })

  it('asks a new user to pick a name and handle (onboarding) and shows a 409', async () => {
    const api = serve({
      me: () => me({ onboarded: false, handle: null, displayName: 'Google Name' }),
      handleAvailable: (req) => ({ handle: req.params.handle, available: true, reason: null }),
      updateMe: () => apiError(409, 'handle_taken', 'That handle was just taken.'),
    })
    render(<SettingsPage />)
    expect(await screen.findByTestId('profile-onboarding')).toBeTruthy()
    fireEvent.change(screen.getByTestId('profile-handle'), { target: { value: 'newbie' } })
    await waitFor(() => expect((screen.getByTestId('profile-save') as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 })
    fireEvent.click(screen.getByTestId('profile-save'))
    expect((await screen.findByTestId('profile-error')).textContent).toBe('That handle was just taken.')
    expect(api.calls('updateMe')[0].body).toEqual({ displayName: 'Google Name', handle: 'newbie' })
  })
})

describe('data export', () => {
  it('downloads the raw JSON export as a file', async () => {
    const exported = { exportedAt: 'x', format: 'myescapes-export-v1', extraFieldKept: true }
    serve({ exportMe: () => exported })
    const created: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), 'blob:x'), revokeObjectURL: () => undefined }))
    const clicks: HTMLAnchorElement[] = []
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this)
    }
    try {
      render(<SettingsPage />)
      fireEvent.click(await screen.findByTestId('export-download'))
      expect(await screen.findByTestId('export-done')).toBeTruthy()
      expect(clicks).toHaveLength(1)
      expect(clicks[0].download).toMatch(/^myescapes-export-\d{4}-\d{2}-\d{2}\.json$/)
      expect(JSON.parse(await created[0].text())).toEqual(exported)
    } finally {
      HTMLAnchorElement.prototype.click = origClick
    }
  })

  it('shows an error when the export fails', async () => {
    serve({ exportMe: () => apiError(500, 'internal', 'Export failed.') })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('export-download'))
    expect((await screen.findByTestId('export-error')).textContent).toBe('Export failed.')
  })
})

describe('account', () => {
  it('deletes the account only after typing DELETE, then leaves', async () => {
    const api = serve({ deleteMe: () => ({ deleted: true }) })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('delete-open'))
    const panel = screen.getByTestId('delete-panel')
    expect(panel.textContent).toContain('your tag becomes a plain name')
    const confirm = within(panel).getByTestId('delete-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(panel).getByTestId('delete-confirm-input'), { target: { value: 'delete' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(panel).getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/welcome?deleted=1'))
    expect(api.calls('deleteMe')[0].body).toEqual({ confirm: 'DELETE' })
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('deleting the account empties the voice-note queue on this device, after warning about it', async () => {
    serve({ deleteMe: () => ({ deleted: true }) })
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
    await enqueueRecording({ ownerId: me().id, audio, durationSeconds: 3 })
    await enqueueRecording({ ownerId: 'usr_someone_else', audio, durationSeconds: 3 })
    render(<SettingsPage />)
    expect((await screen.findByTestId('queued-warning')).textContent).toContain('1 voice note is still on this device')
    fireEvent.click(screen.getByTestId('delete-open'))
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/welcome?deleted=1'))
    expect(await countAllRecordings()).toBe(0)
  })

  it('keeps the user on the page when deletion fails', async () => {
    serve({ deleteMe: () => apiError(500, 'internal', 'Could not delete.') })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('delete-open'))
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByTestId('delete-confirm'))
    expect((await screen.findByTestId('account-error')).textContent).toBe('Could not delete.')
    expect(leave).not.toHaveBeenCalled()
  })

  it('signs out', async () => {
    serve({})
    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('sign-out'))
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/welcome'))
    expect(auth.signOut).toHaveBeenCalled()
  })
})
