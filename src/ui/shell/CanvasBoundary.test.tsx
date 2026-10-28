import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasBoundary } from './CanvasBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

describe('CanvasBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <CanvasBoundary>
        <p>the room</p>
      </CanvasBoundary>,
    )
    expect(screen.getByText('the room')).toBeTruthy()
    expect(screen.queryByTestId('canvas-failed')).toBeNull()
  })

  it('a WebGL failure shows a friendly alert with Reload and the light version, not a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <CanvasBoundary>
        <Boom message="Error creating WebGL context." />
      </CanvasBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("The room couldn't light up")
    expect(alert.textContent).toContain('hardware acceleration')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the light version' }).getAttribute('href')).toBe('/m')
  })

  it('any other 3D crash gets the generic reload copy', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <CanvasBoundary>
        <Boom message="Cannot read properties of undefined" />
      </CanvasBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Reloading usually fixes it')
  })
})
