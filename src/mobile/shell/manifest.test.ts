// @vitest-environment node
/**
 * Add to home screen: the mobile manifest must be installable (Chrome's criteria: name, icons of
 * 192 and 512 px, a start_url inside the scope, standalone display) and start at /m.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MANIFEST, MOBILE_MANIFEST } from './device'

const pub = path.resolve(__dirname, '../../../public')
const read = (url: string) => JSON.parse(readFileSync(path.join(pub, url), 'utf8'))

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(path.join(pub, file))
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('web app manifests', () => {
  it('the mobile manifest starts at /m and is installable', () => {
    const m = read(MOBILE_MANIFEST)
    expect(m.start_url).toBe('/m')
    expect(m.scope).toBe('/')
    expect(new URL(m.start_url, 'https://x.test').pathname.startsWith(new URL(m.scope, 'https://x.test').pathname)).toBe(true)
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(m.display)
    expect(m.name).toBeTruthy()
    expect(m.short_name.length).toBeLessThanOrEqual(12)
    const sizes = new Set<string>()
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      expect(icon.type).toBe('image/png')
      const { w, h } = pngSize(icon.src)
      expect(`${w}x${h}`).toBe(icon.sizes)
      sizes.add(icon.sizes)
    }
    expect(sizes.has('192x192') && sizes.has('512x512')).toBe(true)
  })

  it('both manifests share an id, so swapping them never makes a second app', () => {
    const desktop = read(DEFAULT_MANIFEST)
    const mobile = read(MOBILE_MANIFEST)
    expect(mobile.id ?? mobile.start_url).toBe(desktop.id ?? '/')
    expect(desktop.start_url).toBe('/')
  })

  it('index.html links the default manifest (the mobile shell swaps it on /m)', () => {
    const html = readFileSync(path.resolve(pub, '../index.html'), 'utf8')
    expect(html).toContain(`<link rel="manifest" href="${DEFAULT_MANIFEST}"`)
  })
})
