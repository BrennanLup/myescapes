/**
 * The API calls the mobile log flow makes, as thin typed wrappers over `callApi` so tests can
 * swap `fetch` (unit tests stub it; API tests route it into the real server with PGlite).
 */
import { callApi, ROUTES, type RouteInput, type RouteOutput } from '../../contracts/routes'
import { audioBlob, type QueuedRecording, type TranscribeResult } from './queue'

export interface ApiOptions {
  fetch?: typeof fetch
}

export type ExtractResult = RouteOutput<typeof ROUTES.extract>
export type CreateVisitBody = RouteInput<typeof ROUTES.createVisit>['body']

const ext = (mime: string) => {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

/** The multipart form `POST /api/transcribe` expects: `audio`, `durationSeconds`, `clientId`. */
export function transcribeForm(item: QueuedRecording): FormData {
  const blob = audioBlob(item)
  if (!blob) throw new Error('No audio to upload.')
  const fd = new FormData()
  fd.append('durationSeconds', String(item.durationSeconds))
  fd.append('clientId', item.id)
  // The file goes last so the server can read the text fields first while streaming.
  fd.append('audio', blob, `${item.id}.${ext(item.mimeType)}`)
  return fd
}

export async function transcribe(item: QueuedRecording, opts: ApiOptions = {}): Promise<TranscribeResult & RouteOutput<typeof ROUTES.transcribe>> {
  return callApi(ROUTES.transcribe, { body: transcribeForm(item) }, opts)
}

export async function extract(transcript: string, opts: ApiOptions & { lat?: number; lng?: number } = {}): Promise<ExtractResult> {
  return callApi(ROUTES.extract, { body: { transcript, lat: opts.lat, lng: opts.lng } }, opts)
}

export async function createVisit(body: CreateVisitBody, opts: ApiOptions = {}) {
  return callApi(ROUTES.createVisit, { body }, opts)
}

export async function crewSuggestions(opts: ApiOptions = {}) {
  return callApi(ROUTES.crewSuggestions, {}, opts)
}
