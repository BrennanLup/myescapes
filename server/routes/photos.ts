/**
 * Photo upload (multipart), serving and deletion. Owned by workstream 24 (server/routes/photos*, src/ui/photos).
 *
 * Photos are resized in the browser (~1600 px, < 400 KB) and stored in Postgres (`visit_photos.bytes`).
 * The server trusts nothing from the client about the file: the type comes from the magic bytes
 * (JPEG, PNG or WebP only), the size is capped at MAX_PHOTO_BYTES, and dimensions are read from the
 * image header. Access rules live in photos.access.ts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, count, eq } from 'drizzle-orm'
import { ROUTES } from '../../src/contracts/routes'
import type { PhotoV2 } from '../../src/contracts/models'
import type { AppContext } from '../context'
import { visitPhotos, visits } from '../db/schema'
import { defineRoute, HttpError } from '../http'
import { canAddPhotos, participantStatus, viewablePhoto, type PhotoRow } from './photos.access'
import { sniffImage } from './photos.image'

/** Contract ceiling for one photo (the browser aims for < 400 KB). */
export const MAX_PHOTO_BYTES = 1024 * 1024
/** Longest side we accept; the browser resizes to ~1600 px. */
export const MAX_PHOTO_PX = 4096
export const MAX_PHOTOS_PER_VISIT = 30
export const MAX_CAPTION = 280

export function photoToApi(p: Pick<PhotoRow, 'id' | 'visitId' | 'uploaderId' | 'caption' | 'width' | 'height' | 'createdAt'>): PhotoV2 {
  return {
    id: p.id,
    visitId: p.visitId,
    url: `/api/photos/${encodeURIComponent(p.id)}`,
    uploaderId: p.uploaderId,
    caption: p.caption,
    width: p.width && p.width > 0 ? p.width : null,
    height: p.height && p.height > 0 ? p.height : null,
    createdAt: p.createdAt.toISOString(),
  }
}

interface ParsedUpload {
  bytes: Buffer
  caption: string
  width: number | null
  height: number | null
}

const posInt = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null
}

async function readUpload(req: FastifyRequest): Promise<ParsedUpload> {
  if (!req.isMultipart()) throw new HttpError('invalid', 'Send the photo as multipart/form-data with a `photo` file.')
  const fields: Record<string, string> = {}
  let bytes: Buffer | null = null
  for await (const part of req.parts({ limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } })) {
    if (part.type === 'file') {
      // toBuffer throws a 413 when the file is over the limit (mapped to `too_large`).
      const buf = await part.toBuffer()
      if (part.fieldname === 'photo') bytes = buf
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value
    }
  }
  if (!bytes || bytes.length === 0) throw new HttpError('invalid', 'Choose a photo to upload (field `photo`).')
  const caption = (fields.caption ?? '').trim()
  if (caption.length > MAX_CAPTION) throw new HttpError('invalid', `Captions can be at most ${MAX_CAPTION} characters.`)
  return { bytes, caption, width: posInt(fields.width), height: posInt(fields.height) }
}

export async function photosRoutes(app: FastifyInstance, ctx: AppContext) {
  defineRoute(
    app,
    ctx,
    ROUTES.uploadPhoto,
    async ({ params, user, req }) => {
      const db = ctx.db()
      const status = await participantStatus(db, params.id, user.id)
      // Not on the visit at all: 404, so a stranger can't learn the visit exists.
      if (!status || status === 'declined') throw new HttpError('not_found', 'Visit not found.')
      if (!canAddPhotos(status)) throw new HttpError('forbidden', 'Accept the tag first to add photos to this visit.')

      const upload = await readUpload(req)
      const info = sniffImage(upload.bytes)
      if (!info) throw new HttpError('unsupported_media', 'Photos must be JPEG, PNG or WebP images.')
      const width = info.width ?? upload.width
      const height = info.height ?? upload.height
      if ((width ?? 0) > MAX_PHOTO_PX || (height ?? 0) > MAX_PHOTO_PX) {
        throw new HttpError('invalid', `Photos can be at most ${MAX_PHOTO_PX} px on the long side. Resize it first.`)
      }

      const [{ n }] = await db.select({ n: count() }).from(visitPhotos).where(eq(visitPhotos.visitId, params.id))
      if (n >= MAX_PHOTOS_PER_VISIT) throw new HttpError('conflict', `A visit can hold at most ${MAX_PHOTOS_PER_VISIT} photos.`)

      const [row] = await db
        .insert(visitPhotos)
        .values({
          visitId: params.id,
          uploaderId: user.id,
          mime: info.mime,
          bytes: new Uint8Array(upload.bytes),
          sizeBytes: upload.bytes.length,
          width,
          height,
          caption: upload.caption,
        })
        .returning()
      await db.update(visits).set({ updatedAt: new Date() }).where(eq(visits.id, params.id))
      return photoToApi(row)
    },
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
  )

  defineRoute(app, ctx, ROUTES.photo, async ({ params, user, reply }) => {
    const photo = await viewablePhoto(ctx.db(), params.id, user?.id ?? null)
    if (!photo) throw new HttpError('not_found', 'Photo not found.')
    const body = Buffer.from(photo.bytes.buffer, photo.bytes.byteOffset, photo.bytes.byteLength)
    return reply
      .header('content-type', photo.mime)
      .header('content-length', String(body.length))
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      // Private: access depends on the viewer and on visibility, which can change.
      .header('cache-control', 'private, max-age=300')
      .send(body)
  })

  defineRoute(app, ctx, ROUTES.deletePhoto, async ({ params, user }) => {
    const db = ctx.db()
    const photo = await viewablePhoto(db, params.id, user.id)
    if (!photo) throw new HttpError('not_found', 'Photo not found.')
    if (photo.uploaderId !== user.id) throw new HttpError('forbidden', 'Only the person who added a photo can remove it.')
    await db.delete(visitPhotos).where(and(eq(visitPhotos.id, photo.id), eq(visitPhotos.uploaderId, user.id)))
    return { ok: true as const }
  })
}
