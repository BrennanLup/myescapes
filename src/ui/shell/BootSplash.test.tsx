/**
 * The boot splash: index.html paints it before any JavaScript, React's fallbacks render the same
 * markup, so a full page swap (visit, Back to my room, home from the puzzle room) never goes blank.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BOOT_SHIMMER_MS, BootSplash, headingToRoom, shimmerDelay } from './BootSplash'

afterEach(cleanup)

const indexHtml = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8')

describe('index.html boot splash', () => {
  it('paints the logo, name and shimmer inside #root before the bundle loads', () => {
    const root = indexHtml.slice(indexHtml.indexOf('<div id="root">'), indexHtml.indexOf('<script type="module"'))
    expect(root).toContain('class="boot-splash"')
    expect(root).toContain('class="boot-logo"')
    expect(root).toContain('My Escapes')
    expect(root).toContain('class="boot-shimmer"')
  })

  it('styles it inline in the head (no stylesheet needed), with reduced motion respected', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'))
    for (const cls of ['.boot-splash', '.boot-logo', '.boot-name', '.boot-track', '.boot-shimmer', '.boot-label']) expect(head).toContain(cls)
    expect(head).toMatch(/prefers-reduced-motion: reduce/)
    expect(head).toContain(`animation: boot-shimmer ${BOOT_SHIMMER_MS / 1000}s`)
    // Same background as the theme colour and the room loader, so nothing flashes.
    expect(head).toContain('#2a1f2d')
  })

  it('keeps one <title> in the head (the SEO injector replaces it)', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'))
    expect(head.match(/<title\b/g)).toHaveLength(1)
  })
})

describe('BootSplash', () => {
  it('renders the same structure as index.html, with the page-loading test id', () => {
    const { container } = render(<BootSplash />)
    const el = screen.getByTestId('page-loading')
    expect(el.className).toBe('boot-splash')
    expect(el.getAttribute('role')).toBe('status')
    expect(el.getAttribute('aria-label')).toBe('Loading My Escapes')
    for (const cls of ['boot-logo', 'boot-name', 'boot-track', 'boot-shimmer', 'boot-label']) expect(container.querySelector(`.${cls}`)).toBeTruthy()
  })

  it('shows and announces a label', () => {
    render(<BootSplash label="Heading to Vera's room…" testId="x" />)
    expect(screen.getByTestId('x').getAttribute('aria-label')).toBe("Heading to Vera's room…")
    expect(screen.getByTestId('x').textContent).toContain("Heading to Vera's room…")
  })

  it('keeps the shimmer in step with the one started at page load', () => {
    expect(shimmerDelay(0)).toBe('-0ms')
    expect(shimmerDelay(BOOT_SHIMMER_MS * 3 + 250)).toBe('-250ms')
    expect(shimmerDelay(BOOT_SHIMMER_MS - 0.2)).toMatch(/^-\d+ms$/)
  })
})

describe('headingToRoom', () => {
  it("uses the owner's first name", () => {
    expect(headingToRoom({ displayName: '  Vera  Lynn ', handle: 'vera' })).toBe("Heading to Vera's room…")
  })
  it('falls back to the @handle, then to nothing', () => {
    expect(headingToRoom({ displayName: ' ', handle: 'pa_x' })).toBe("Heading to @pa_x's room…")
    expect(headingToRoom({ handle: null })).toBeNull()
    expect(headingToRoom(null)).toBeNull()
  })
})
