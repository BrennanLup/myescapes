// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TINY_PNG } from '../db/fixtures'
import { sniffImage } from './photos.image'
import { jpegHeader, pngHeader, webpHeader } from './photos.testutil'

describe('sniffImage', () => {
  it('reads PNG type and size', () => {
    expect(sniffImage(TINY_PNG)).toEqual({ mime: 'image/png', width: 1, height: 1 })
    expect(sniffImage(pngHeader(1600, 1200))).toEqual({ mime: 'image/png', width: 1600, height: 1200 })
  })

  it('reads JPEG type and size from the SOF frame header', () => {
    expect(sniffImage(jpegHeader(1600, 900))).toEqual({ mime: 'image/jpeg', width: 1600, height: 900 })
  })

  it('reads WebP (VP8X) type and size', () => {
    expect(sniffImage(webpHeader(1200, 1600))).toEqual({ mime: 'image/webp', width: 1200, height: 1600 })
  })

  it('reads lossy VP8 and lossless VP8L WebP sizes', () => {
    const vp8 = webpHeader(1, 1)
    vp8.set([...'VP8 '].map((c) => c.charCodeAt(0)), 12)
    vp8.set([0x9d, 0x01, 0x2a, 640 & 0xff, 640 >> 8, 480 & 0xff, 480 >> 8], 23)
    expect(sniffImage(vp8)).toEqual({ mime: 'image/webp', width: 640, height: 480 })

    const vp8l = webpHeader(1, 1)
    vp8l.set([...'VP8L'].map((c) => c.charCodeAt(0)), 12)
    const bits = (300 - 1) | ((200 - 1) << 14)
    vp8l.set([0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff], 20)
    expect(sniffImage(vp8l)).toEqual({ mime: 'image/webp', width: 300, height: 200 })
  })

  it('keeps the type but no size when the header is truncated', () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: 'image/jpeg', width: null, height: null })
  })

  it('rejects anything that is not JPEG, PNG or WebP', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
    // A RIFF that isn't WebP (e.g. WAV).
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBeNull()
  })
})
