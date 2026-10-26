/**
 * Image sniffing for photo uploads (workstream 24). The type comes from the file's magic bytes,
 * never from the client's Content-Type, and the dimensions are read from the header when possible.
 * No image library: JPEG, PNG and WebP headers are simple enough to parse here.
 */

export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PhotoMime = (typeof PHOTO_MIMES)[number]

export interface ImageInfo {
  mime: PhotoMime
  /** Null when the header could not be read (the client's values are used instead). */
  width: number | null
  height: number | null
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

function pngSize(b: Uint8Array): [number, number] | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
  return [u32be(b, 16), u32be(b, 20)]
}

/** Walks the JPEG markers to the first SOFn frame header. */
function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++ // fill byte
      continue
    }
    // Markers without a length: RSTn, SOI, TEM.
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // EOI / SOS before a frame header
    const len = u16be(b, i + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return [u16be(b, i + 7), u16be(b, i + 5)]
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30) return null
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes) + start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff]
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
  }
  if (chunk === 'VP8X') return [u24le(b, 24) + 1, u24le(b, 27) + 1]
  return null
}

/** The image type and size, or null when the bytes are not a JPEG, PNG or WebP. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes
  let mime: PhotoMime | null = null
  let size: [number, number] | null = null
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    mime = 'image/png'
    size = pngSize(b)
  } else if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    mime = 'image/jpeg'
    size = jpegSize(b)
  } else if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    mime = 'image/webp'
    size = webpSize(b)
  }
  if (!mime) return null
  const ok = size && size[0] > 0 && size[1] > 0
  return { mime, width: ok ? size![0] : null, height: ok ? size![1] : null }
}
