/**
 * Browser-side photo resizing (workstream 24): fit the long side to ~1600 px and re-encode as JPEG,
 * lowering quality (then size) until the file is under the byte budget. The server accepts at most
 * 1 MB; we aim for 400 KB so uploads are quick on weak signal.
 */

export const TARGET_MAX_PX = 1600
export const TARGET_MAX_BYTES = 400 * 1024
/** Server ceiling (server/routes/photos.ts MAX_PHOTO_BYTES). */
export const SERVER_MAX_BYTES = 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const

/** Scale (w, h) down so the long side is at most `maxPx`. Never scales up. */
export function fitWithin(width: number, height: number, maxPx = TARGET_MAX_PX): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Encode at decreasing quality until the result fits `maxBytes`. Returns the smallest attempt when
 * none fits (the caller then shrinks the pixels).
 */
export async function encodeUnderBudget(encode: (quality: number) => Promise<Blob>, maxBytes = TARGET_MAX_BYTES, qualities = [0.85, 0.75, 0.65, 0.55, 0.45]): Promise<Blob> {
  let best: Blob | null = null
  for (const q of qualities) {
    const blob = await encode(q)
    if (!best || blob.size < best.size) best = blob
    if (blob.size <= maxBytes) return blob
  }
  return best!
}

export interface DecodedImage {
  width: number
  height: number
  /** Draws the image onto a canvas context at the given size. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void
  close(): void
}

async function decode(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation: 'from-image'` applies EXIF rotation (phone photos).
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    return { width: bmp.width, height: bmp.height, draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser could not encode the photo.'))), type, quality)
  })
}

export interface ResizedPhoto {
  blob: Blob
  width: number
  height: number
}

/**
 * Resize to fit `maxPx` on the long side and re-encode as JPEG under `maxBytes`. If quality alone
 * isn't enough, the long side shrinks by 20% at a time (down to 640 px).
 */
export async function resizePhoto(file: Blob, maxPx = TARGET_MAX_PX, maxBytes = TARGET_MAX_BYTES): Promise<ResizedPhoto> {
  const img = await decode(file)
  try {
    let px = maxPx
    for (;;) {
      const size = fitWithin(img.width, img.height, px)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not resize the photo.')
      ctx.fillStyle = '#fff' // transparent PNGs become white, not black, as JPEG
      ctx.fillRect(0, 0, size.width, size.height)
      img.draw(ctx, size.width, size.height)
      const blob = await encodeUnderBudget((q) => canvasToBlob(canvas, 'image/jpeg', q), maxBytes)
      if (blob.size <= maxBytes || px <= 640) {
        if (blob.size > SERVER_MAX_BYTES) throw new Error('That photo is too large even after resizing.')
        return { blob, width: size.width, height: size.height }
      }
      px = Math.round(px * 0.8)
    }
  } finally {
    img.close()
  }
}
