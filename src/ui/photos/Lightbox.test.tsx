// QA r2: tap a photo to see it full size; Edit photos hides the remove buttons in read views.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhotoV2 } from '@/contracts/models'
import { isLightboxOpen, Lightbox, PhotoThumbs } from './Lightbox'
import { PhotoAttach } from './PhotoAttach'
import { configurePhotoQueue, resetPhotoQueueForTests } from './queue'

const photo = (id: string, uploaderId = 'usr_me'): PhotoV2 => ({ id, visitId: 'vis_1', url: `/api/photos/${id}`, uploaderId, caption: '', width: 10, height: 10, createdAt: '2026-10-28T00:00:00.000Z' })
const shown = () => (screen.getByTestId('photo-lightbox-image') as HTMLImageElement).getAttribute('src')

beforeEach(() => {
  configurePhotoQueue({
    resize: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 4, height: 3 }),
    upload: () => new Promise<PhotoV2>(() => {}),
    createUrl: () => 'blob:preview',
    revokeUrl: () => {},
    undoMs: 30,
  })
})
afterEach(() => {
  cleanup()
  resetPhotoQueueForTests()
})

describe('Lightbox', () => {
  const photos = [
    { src: '/a.jpg', alt: 'Photo 1' },
    { src: '/b.jpg', alt: 'Photo 2', caption: 'The finale' },
    { src: '/c.jpg', alt: 'Photo 3' },
  ]

  it('pages with the arrow keys, wraps around, and closes on Esc', () => {
    const onClose = vi.fn()
    const onIndex = vi.fn()
    const { rerender } = render(<Lightbox photos={photos} index={0} onIndex={onIndex} onClose={onClose} />)
    expect(isLightboxOpen()).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 3' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('photo-lightbox-close'))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onIndex).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onIndex).toHaveBeenLastCalledWith(2)
    rerender(<Lightbox photos={photos} index={1} onIndex={onIndex} onClose={onClose} />)
    expect(shown()).toBe('/b.jpg')
    expect(screen.getByText('The finale')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swipes between photos and closes on a tap beside the photo', () => {
    const onClose = vi.fn()
    const onIndex = vi.fn()
    render(<Lightbox photos={photos} index={1} onIndex={onIndex} onClose={onClose} />)
    const stage = screen.getByTestId('photo-lightbox-stage')
    fireEvent.pointerDown(stage, { clientX: 300, clientY: 200 })
    fireEvent.pointerUp(stage, { clientX: 200, clientY: 210 })
    expect(onIndex).toHaveBeenLastCalledWith(2)
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 200 })
    fireEvent.pointerUp(stage, { clientX: 200, clientY: 190 })
    expect(onIndex).toHaveBeenLastCalledWith(0)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(stage, { clientX: 10, clientY: 10 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives focus back when it closes', async () => {
    const user = userEvent.setup()
    render(<PhotoThumbs photos={photos} />)
    const second = screen.getByRole('button', { name: 'Open Photo 2' })
    await user.click(second)
    expect(shown()).toBe('/b.jpg')
    await user.click(screen.getByTestId('photo-lightbox-next'))
    expect(shown()).toBe('/c.jpg')
    await user.click(screen.getByTestId('photo-lightbox-close'))
    expect(screen.queryByTestId('photo-lightbox')).toBeNull()
    expect(isLightboxOpen()).toBe(false)
    expect(document.activeElement).toBe(second)
  })
})

describe('PhotoAttach thumbnails', () => {
  it('open full size, across saved and just-added photos', async () => {
    const user = userEvent.setup()
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_1'), photo('pho_2', 'usr_friend')]} meId="usr_me" />)
    await user.upload(screen.getByTestId('photo-input'), [new File([new Uint8Array(8)], 'a.jpg', { type: 'image/jpeg' })])
    await screen.findByRole('button', { name: 'Open photo 3' })
    await user.click(screen.getByRole('button', { name: 'Open photo 2' }))
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 3' })).toBeTruthy()
    expect(shown()).toBe('/api/photos/pho_2')
    await user.keyboard('{ArrowRight}')
    expect(shown()).toBe('blob:preview')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('photo-lightbox')).toBeNull()
  })

  it('without editToggle, my photos show their remove button straight away', () => {
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_1')]} meId="usr_me" />)
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeTruthy()
    expect(screen.queryByTestId('photo-edit-toggle')).toBeNull()
  })

  it('with editToggle, hides remove buttons until "Edit photos"', async () => {
    const user = userEvent.setup()
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_1'), photo('pho_2', 'usr_friend')]} meId="usr_me" editToggle />)
    expect(screen.queryByRole('button', { name: /Remove photo/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit photos' }))
    expect(screen.getAllByRole('button', { name: /Remove photo/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('button', { name: /Remove photo/ })).toBeNull()
    // An upload still in progress keeps its × (to cancel it).
    await user.upload(screen.getByTestId('photo-input'), [new File([new Uint8Array(8)], 'a.jpg', { type: 'image/jpeg' })])
    expect(await screen.findByRole('button', { name: 'Remove photo 3' })).toBeTruthy()
  })

  it('shows no Edit toggle when none of the photos are mine', () => {
    render(<PhotoAttach target="visit:vis_1" visitId="vis_1" existing={[photo('pho_2', 'usr_friend')]} meId="usr_me" editToggle />)
    expect(screen.queryByTestId('photo-edit-toggle')).toBeNull()
  })
})
