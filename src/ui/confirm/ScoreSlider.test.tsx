import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScoreSlider } from './ScoreSlider'

afterEach(cleanup)

describe('ScoreSlider', () => {
  it('shows an empty track with "Tap to rate" and no visible thumb while unset', () => {
    render(<ScoreSlider value={null} onChange={() => {}} label="Overall slider" testId="s" />)
    const input = screen.getByLabelText('Overall slider')
    expect(input.getAttribute('aria-valuetext')).toBe('Not rated yet')
    expect(input.className).toContain('opacity-0')
    expect(screen.getByTestId('s-hint').textContent).toBe('Tap to rate')
  })

  it('sets the score on the first drag, on a tap on the hidden thumb, and on Enter', () => {
    const onChange = vi.fn()
    render(<ScoreSlider value={null} onChange={onChange} label="Setting slider" />)
    const input = screen.getByLabelText('Setting slider')
    fireEvent.change(input, { target: { value: '72' } })
    expect(onChange).toHaveBeenLastCalledWith(72)
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.pointerUp(input)
    expect(onChange).toHaveBeenLastCalledWith(50)
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(50)
  })

  it('is a normal slider once a score is set', () => {
    const onChange = vi.fn()
    render(<ScoreSlider value={80} onChange={onChange} label="Puzzles slider" testId="s" />)
    const input = screen.getByLabelText('Puzzles slider') as HTMLInputElement
    expect(input.value).toBe('80')
    expect(input.className).not.toContain('opacity-0')
    expect(input.getAttribute('aria-valuetext')).toBeNull()
    expect(screen.queryByTestId('s-hint')).toBeNull()
    fireEvent.pointerUp(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
