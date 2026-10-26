/**
 * Test helpers for photo uploads (workstream 24): multipart bodies for `app.inject` and tiny
 * hand-made image headers. Test-only; nothing in the server imports this.
 */

export interface MultipartBody {
  payload: Buffer
  headers: Record<string, string>
}

/** Serialises fields and one optional file the way a browser's FormData would. */
export async function multipart(fields: Record<string, string>, file?: { field?: string; bytes: Uint8Array; type?: string; name?: string }): Promise<MultipartBody> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append(file.field ?? 'photo', new Blob([new Uint8Array(file.bytes)], { type: file.type ?? 'application/octet-stream' }), file.name ?? 'photo.bin')
  const req = new Request('http://local/upload', { method: 'POST', body: fd })
  return { payload: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type')! } }
}

/** A PNG signature + IHDR with the given size (CRC not checked by the server). */
export function pngHeader(width: number, height: number, padTo = 0): Uint8Array {
  const b = new Uint8Array(Math.max(33, padTo))
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  b.set([8, 2, 0, 0, 0], 24)
  return b
}

/** SOI, an APP0 segment, then a baseline SOF0 frame header, then EOI. */
export function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9])
}

/** RIFF/WEBP with a VP8X chunk (extended format) of the given canvas size. */
export function webpHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30)
  const ascii = (s: string, at: number) => b.set([...s].map((c) => c.charCodeAt(0)), at)
  ascii('RIFF', 0)
  new DataView(b.buffer).setUint32(4, 22, true)
  ascii('WEBP', 8)
  ascii('VP8X', 12)
  new DataView(b.buffer).setUint32(16, 10, true)
  const w = width - 1
  const h = height - 1
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24)
  return b
}
