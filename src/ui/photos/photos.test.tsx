import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhotoV2 } from '@/contracts/models'
import { PhotoGrid, PhotoUploader } from './index'
import { encodeUnderBudget, fitWithin } from './resize'

afterEach(cleanup)

const photo = (id: string, uploaderId: string): PhotoV2 => ({
  id,
  visitId: 'vis_1',
  url: `/api/photos/${id}`,
  uploaderId,
  caption: '',
  width: 10,
  height: 10,
  createdAt: '2026-10-26T00:00:00.000Z',
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(4000, 1000, 800)).toEqual({ width: 800, height: 200 })
  })
  it('never scales up and guards against zero sizes', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('encodeUnderBudget', () => {
  it('lowers quality until the blob fits', async () => {
    const seen: number[] = []
    const out = await encodeUnderBudget(async (q) => {
      seen.push(q)
      return new Blob([new Uint8Array(Math.round(q * 1000))])
    }, 700)
    expect(out.size).toBeLessThanOrEqual(700)
    expect(seen).toEqual([0.85, 0.75, 0.65])
  })
  it('returns the smallest attempt when nothing fits', async () => {
    const out = await encodeUnderBudget(async (q) => new Blob([new Uint8Array(Math.round(q * 1000))]), 10)
    expect(out.size).toBe(450)
  })
})

describe('PhotoUploader', () => {
  it('resizes each picked file and uploads it as multipart `photo` with its size', async () => {
    const resize = vi.fn(async () => ({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 1600, height: 1200 }))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const fd = init!.body as FormData
      expect(fd.get('photo')).toBeInstanceOf(Blob)
      expect(fd.get('width')).toBe('1600')
      expect(fd.get('height')).toBe('1200')
      return json(201, photo('pho_new', 'usr_me'))
    })
    const onUploaded = vi.fn()
    render(<PhotoUploader visitId="vis_1" onUploaded={onUploaded} resize={resize} fetch={fetchMock as unknown as typeof fetch} />)
    await userEvent.upload(screen.getByTestId('photo-input'), new File(['raw'], 'a.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('pho_new', expect.objectContaining({ id: 'pho_new' })))
    expect(fetchMock).toHaveBeenCalledWith('/api/visits/vis_1/photos', expect.objectContaining({ method: 'POST' }))
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('shows the server error', async () => {
    const resize = async () => ({ blob: new Blob(['x']), width: 1, height: 1 })
    const fetchMock = async () => json(403, { error: 'Accept the tag first to add photos to this visit.', code: 'forbidden' })
    render(<PhotoUploader visitId="vis_1" resize={resize} fetch={fetchMock as unknown as typeof fetch} />)
    await userEvent.upload(screen.getByTestId('photo-input'), new File(['raw'], 'a.png', { type: 'image/png' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Accept the tag first')
  })
})

describe('PhotoGrid', () => {
  it('offers remove only on my own photos and calls DELETE', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }))
    const onDeleted = vi.fn()
    render(<PhotoGrid photos={[photo('pho_mine', 'usr_me'), photo('pho_theirs', 'usr_them')]} meId="usr_me" onDeleted={onDeleted} fetch={fetchMock as unknown as typeof fetch} />)
    const buttons = screen.getAllByRole('button', { name: 'Remove photo' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('pho_mine'))
    expect(fetchMock).toHaveBeenCalledWith('/api/photos/pho_mine', expect.objectContaining({ method: 'DELETE' }))
  })

  it('renders nothing without photos, and no remove buttons when signed out', () => {
    const { container } = render(<PhotoGrid photos={[]} />)
    expect(container.innerHTML).toBe('')
    render(<PhotoGrid photos={[photo('pho_1', 'usr_me')]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
