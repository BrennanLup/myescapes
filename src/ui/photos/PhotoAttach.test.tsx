import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhotoV2 } from '@/contracts/models'
import { PhotoAttach } from './PhotoAttach'
import { configurePhotoQueue, resetPhotoQueueForTests, usePhotoQueue } from './queue'
import type { UploadOptions } from './upload'

const photo = (id: string, uploaderId = 'usr_me'): PhotoV2 => ({ id, visitId: 'vis_1', url: `/api/photos/${id}`, uploaderId, caption: '', width: 10, height: 10, createdAt: '2026-10-28T00:00:00.000Z' })
const file = (name = 'a.jpg') => new File([new Uint8Array(8)], name, { type: 'image/jpeg' })

let uploads: { opts: UploadOptions; resolve(p: PhotoV2): void; reject(e: unknown): void }[]
beforeEach(() => {
  uploads = []
  configurePhotoQueue({
    resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
    upload: (_v, _p, opts) => new Promise<PhotoV2>((resolve, reject) => uploads.push({ opts, resolve, reject })),
    createUrl: () => 'blob:preview',
    revokeUrl: () => {},
    undoMs: 30,
  })
})
afterEach(() => {
  cleanup()
  resetPhotoQueueForTests()
})

describe('PhotoAttach', () => {
  it('queues photos picked before the visit exists, then uploads them once it does', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PhotoAttach target="draft:t1" />)
    expect(screen.getByText('Add photos')).toBeTruthy()
    await user.upload(screen.getByTestId('photo-input'), [file('a.jpg'), file('b.jpg')])
    await waitFor(() => expect(screen.getByTestId('photo-status').textContent).toMatch(/2 photos will upload when you save/))
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(2)
    expect(screen.getAllByText('On save')).toHaveLength(2)
    expect(uploads).toHaveLength(0)

    rerender(<PhotoAttach target="draft:t1" visitId="vis_1" />)
    await waitFor(() => expect(uploads).toHaveLength(1))
    act(() => uploads[0].opts.onProgress?.(0.4))
    expect(screen.getByRole('progressbar', { name: 'Uploading photo 1' }).getAttribute('aria-valuenow')).toBe('40')
    await act(async () => uploads[0].resolve(photo('pho_1')))
    await waitFor(() => expect(uploads).toHaveLength(2))
    await act(async () => uploads[1].resolve(photo('pho_2')))
    await waitFor(() => expect(screen.getByTestId('photo-status').textContent).toBe('2 photos added.'))
  })

  it('removes a queued photo before it uploads', async () => {
    const user = userEvent.setup()
    render(<PhotoAttach target="draft:t2" />)
    await user.upload(screen.getByTestId('photo-input'), [file()])
    await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }))
    expect(screen.queryAllByTestId('photo-tile')).toHaveLength(0)
    expect(usePhotoQueue.getState().items).toHaveLength(0)
  })

  it('shows Retry on a failed upload and uploads again', async () => {
    const user = userEvent.setup()
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" />)
    await user.upload(screen.getByTestId('photo-input'), [file()])
    await waitFor(() => expect(uploads).toHaveLength(1))
    await act(async () => uploads[0].reject(new TypeError('Failed to fetch')))
    expect(await screen.findByText(/1 photo didn't upload/)).toBeTruthy()
    await user.click(screen.getByTestId('photo-retry'))
    await waitFor(() => expect(uploads).toHaveLength(2))
    await act(async () => uploads[1].resolve(photo('pho_3')))
    await waitFor(() => expect(screen.getByTestId('photo-status').textContent).toBe('1 photo added.'))
  })

  it('lists existing photos, lets me remove only mine, and stops at the limit', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const onDeleted = vi.fn()
    const existing = [photo('pho_a'), photo('pho_b', 'usr_friend')]
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={existing} meId="usr_me" onExistingDeleted={onDeleted} fetch={fetchMock as unknown as typeof fetch} />)
    expect(screen.getAllByRole('button', { name: /Remove photo/ })).toHaveLength(1)
    expect(screen.getByText('Add more photos')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    // Hidden at once with Undo; deleted on the server when the Undo window is over.
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(1)
    expect(screen.getByTestId('photo-undo').textContent).toMatch(/Photo removed/)
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('pho_a'))
    expect(screen.queryByTestId('photo-undo')).toBeNull()
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/photos/pho_a')

    cleanup()
    const full = Array.from({ length: 30 }, (_, i) => photo(`pho_${i}`))
    render(<PhotoAttach target="visit:vis_2" visitId="vis_2" existing={full} />)
    expect((screen.getByTestId('photo-input') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/limit of 30 photos/)).toBeTruthy()
  })

  it('shows why photos are off instead of the picker', () => {
    render(<PhotoAttach target="draft:t3" disabledReason="Sign in to add photos." />)
    expect(screen.queryByTestId('photo-input')).toBeNull()
    expect(screen.getByTestId('photo-disabled').textContent).toBe('Sign in to add photos.')
  })

  it('says which files were skipped, in the status line', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<PhotoAttach target="draft:t4" />)
    await user.upload(screen.getByTestId('photo-input'), [file('a.png'), new File(['hi'], 'notes.txt', { type: 'text/plain' })])
    const status = screen.getByTestId('photo-status')
    await waitFor(() => expect(status.textContent).toMatch(/1 photo will upload when you save/))
    expect(status.textContent).toContain("notes.txt isn't a photo, so it was skipped.")
    // The next pick starts a fresh list.
    await user.upload(screen.getByTestId('photo-input'), [file('b.png')])
    expect(screen.queryByTestId('photo-skipped')).toBeNull()
  })

  it('Undo brings back a removed uploaded photo and nothing is deleted', async () => {
    const user = userEvent.setup()
    configurePhotoQueue({ undoMs: 60_000 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { unmount } = render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_a'), photo('pho_b')]} meId="usr_me" fetch={fetchMock as unknown as typeof fetch} />)
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(1)
    await user.click(screen.getByTestId('photo-undo-button'))
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(2)
    expect(screen.queryByTestId('photo-undo')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    // Removing one more and closing the form makes that removal final at once.
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    unmount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/photos/pho_b')
  })

  it('removing a second photo makes the first removal final', async () => {
    const user = userEvent.setup()
    configurePhotoQueue({ undoMs: 60_000 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const onDeleted = vi.fn()
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_a'), photo('pho_b')]} meId="usr_me" onExistingDeleted={onDeleted} fetch={fetchMock as unknown as typeof fetch} />)
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('pho_a'))
    expect(onDeleted).not.toHaveBeenCalledWith('pho_b')
    expect(screen.queryAllByTestId('photo-tile')).toHaveLength(0)
  })

  it('shows a failed delete and puts the photo back', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Nope', code: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }))
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_a')]} meId="usr_me" fetch={fetchMock as unknown as typeof fetch} />)
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(await screen.findByTestId('photo-delete-error')).toBeTruthy()
    expect(screen.getAllByTestId('photo-tile')).toHaveLength(1)
  })

  it('leaves a photo in its Undo window out of "N of 30", and picking more makes the removal final', async () => {
    const user = userEvent.setup()
    configurePhotoQueue({ undoMs: 60_000 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_a'), photo('pho_b'), photo('pho_c')]} meId="usr_me" fetch={fetchMock as unknown as typeof fetch} />)
    expect(screen.getByText('3 of 30')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.getByTestId('photo-undo')).toBeTruthy()
    expect(screen.getByText('2 of 30')).toBeTruthy()
    await user.click(screen.getByTestId('photo-undo-button'))
    expect(screen.getByText('3 of 30')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await user.upload(screen.getByTestId('photo-input'), [file()])
    expect(screen.queryByTestId('photo-undo')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/photos/pho_a')
    await waitFor(() => expect(screen.getByText('3 of 30')).toBeTruthy())
  })
})
