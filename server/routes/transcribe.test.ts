// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ApiErrorSchema, SpendingCapErrorSchema } from '../../src/contracts/errors'
import { ROUTES } from '../../src/contracts/routes'
import { UsageSummarySchema } from '../../src/contracts/models'
import { FX, loadFixtures } from '../db/fixtures'
import { createTestDb, resetDb, type TestDb } from '../db/testing'
import { usageSummary } from '../db/usage'
import { buildVoiceTestApp, multipartBody, type VoiceTestAppOptions } from '../extract/test-app'
import { buildTestApp } from '../testing'
import { audioKind, minPlausibleSeconds, RecentResults, secondsToReserve, transcriptionMode, type TranscribeResult } from './transcribe'
import {
  durationFromResponse,
  MOCK_TRANSCRIPT,
  openaiTranscriber,
  TRANSCRIBE_PROMPT,
  type TranscribeInput,
  type Transcriber,
} from './transcribe.provider'

const TranscribeResponse = ROUTES.transcribe.response
const NOW = new Date('2026-10-25T12:00:00Z')

function fakeProvider(answers: Array<{ text: string; durationSeconds: number | null } | Error> = []) {
  const calls: TranscribeInput[] = []
  const transcriber: Transcriber = {
    mode: 'openai',
    async transcribe(input) {
      calls.push(input)
      const next = answers.length ? answers.shift()! : { text: 'we did the vault', durationSeconds: null }
      if (next instanceof Error) throw next
      return next
    },
  }
  return { transcriber, calls }
}

function upload(opts: { bytes?: number; data?: Buffer; type?: string; filename?: string; durationSeconds?: number | string; clientId?: string; field?: string } = {}) {
  const data = opts.data ?? Buffer.alloc(opts.bytes ?? 2000, 7)
  const parts: Parameters<typeof multipartBody>[0] = []
  if (opts.durationSeconds !== undefined) parts.push({ name: 'durationSeconds', value: String(opts.durationSeconds) })
  if (opts.clientId !== undefined) parts.push({ name: 'clientId', value: opts.clientId })
  parts.push({ name: opts.field ?? 'audio', filename: opts.filename ?? 'note.webm', contentType: opts.type ?? 'audio/webm;codecs=opus', data })
  return multipartBody(parts)
}

let tdb: TestDb
beforeAll(async () => {
  tdb = await createTestDb()
  await loadFixtures(tdb.db)
})
afterAll(async () => {
  await tdb?.close()
})
afterEach(async () => {
  await resetDb(tdb.db)
  await loadFixtures(tdb.db)
})

async function app(opts: VoiceTestAppOptions = {}) {
  return buildVoiceTestApp({ testDb: tdb, now: () => NOW, ...opts })
}

/** Signed in as alice unless `as` says otherwise (`null`: signed out). */
const send = (a: Awaited<ReturnType<typeof app>>, body: ReturnType<typeof multipartBody>, as: string | null = FX.users.alice) =>
  a.inject({ method: 'POST', url: ROUTES.transcribe.path, payload: body.payload, headers: body.headers, as: as ?? undefined })

const usedSeconds = async (userId: string = FX.users.alice) => (await usageSummary(tdb.db, userId, NOW)).transcriptionSeconds.used

describe('upload helpers', () => {
  it('accepts the recorder formats by MIME type (ignoring codecs) or by extension', () => {
    expect(audioKind('audio/webm;codecs=opus', 'x')).toEqual({ mime: 'audio/webm', ext: 'webm' })
    expect(audioKind('audio/mp4', 'voice.mp4')).toEqual({ mime: 'audio/mp4', ext: 'm4a' })
    expect(audioKind('audio/x-m4a', '')?.ext).toBe('m4a')
    expect(audioKind('application/octet-stream', 'memo.M4A')?.ext).toBe('m4a')
    expect(audioKind('', 'memo.opus')?.ext).toBe('ogg')
    expect(audioKind('text/plain', 'notes.txt')).toBeNull()
    expect(audioKind('image/png', 'x.webm')).toBeNull()
    expect(audioKind('application/octet-stream', 'x.exe')).toBeNull()
  })

  it('never reserves less than the file size allows', () => {
    expect(minPlausibleSeconds(30_000, 'webm')).toBe(10)
    expect(minPlausibleSeconds(80_000, 'wav')).toBe(10)
    expect(minPlausibleSeconds(40_000, 'flac')).toBe(10)
    expect(secondsToReserve(1, 30_000, 'webm')).toBe(10)
    expect(secondsToReserve(42.2, 1000, 'webm')).toBe(43)
    expect(secondsToReserve(null, 10, 'webm')).toBe(1)
  })

  it('reads a provider-measured duration from either response shape', () => {
    expect(durationFromResponse({ text: 'x', duration: 12.5 })).toBe(12.5)
    expect(durationFromResponse({ text: 'x', usage: { type: 'duration', seconds: 31 } })).toBe(31)
    expect(durationFromResponse({ text: 'x', usage: { type: 'tokens', input_tokens: 9 } })).toBeNull()
    expect(durationFromResponse(null)).toBeNull()
  })

  it('remembers recent results for retries, with expiry and a size bound', () => {
    const r = new RecentResults(1000, 2)
    const v = (t: string): TranscribeResult => ({ transcript: t, durationSeconds: 1, mode: 'mock', clientId: t, audioDeleted: true })
    r.set('a', v('a'), 0)
    expect(r.get('a', 500)?.transcript).toBe('a')
    expect(r.get('a', 1500)).toBeNull()
    r.set('a', v('a'), 2000)
    r.set('b', v('b'), 2000)
    r.set('c', v('c'), 2000)
    expect(r.get('a', 2000)).toBeNull()
    expect(r.get('c', 2000)?.transcript).toBe('c')
  })

  it('picks the mode from OPENAI_API_KEY', () => {
    expect(transcriptionMode({})).toBe('mock')
    expect(transcriptionMode({ OPENAI_API_KEY: 'sk-x' })).toBe('openai')
  })
})

describe('POST /api/transcribe', () => {
  it('requires sign-in', async () => {
    const a = await app()
    const res = await send(a, upload(), null)
    expect(res.statusCode).toBe(401)
    expect(ApiErrorSchema.parse(res.json()).code).toBe('unauthorized')
    await a.close()
  })

  it('rejects non-multipart bodies, missing or empty audio, unsupported types and bad fields', async () => {
    const { transcriber, calls } = fakeProvider()
    const a = await app({ transcribe: { transcriber } })
    const json = await a.inject({ method: 'POST', url: ROUTES.transcribe.path, payload: { audio: 'base64?' }, as: FX.users.alice })
    expect(json.statusCode).toBe(415)
    expect(json.json().code).toBe('unsupported_media')

    const noAudio = await send(a, multipartBody([{ name: 'durationSeconds', value: '3' }]))
    expect(noAudio.statusCode).toBe(400)
    expect(noAudio.json().code).toBe('invalid')

    expect((await send(a, upload({ data: Buffer.alloc(0) }))).statusCode).toBe(400)
    expect((await send(a, upload({ field: 'file' }))).statusCode).toBe(400)

    const txt = await send(a, upload({ type: 'text/plain', filename: 'notes.txt' }))
    expect(txt.statusCode).toBe(415)
    expect(txt.json().error).toMatch(/format is not supported/)

    const badDuration = await send(a, upload({ durationSeconds: 'abc' }))
    expect(badDuration.statusCode).toBe(400)
    expect(badDuration.json().details[0].path).toBe('durationSeconds')
    expect((await send(a, upload({ clientId: 'has spaces' }))).statusCode).toBe(400)

    expect(calls).toHaveLength(0)
    expect(await usedSeconds()).toBe(0)
    await a.close()
  })

  it('mock mode (no OPENAI_API_KEY) returns the sample transcript and counts the seconds', async () => {
    const a = await app({ env: { OPENAI_API_KEY: '' } })
    const res = await send(a, upload({ durationSeconds: 42.4, clientId: 'rec-1' }))
    expect(res.statusCode).toBe(200)
    const body = TranscribeResponse.parse(res.json())
    expect(body).toEqual({ transcript: MOCK_TRANSCRIPT, durationSeconds: 42.4, mode: 'mock', clientId: 'rec-1', audioDeleted: true })
    expect(await usedSeconds()).toBe(43)
    await a.close()
  })

  it('sends the audio to the provider from memory, then wipes it', async () => {
    const { transcriber, calls } = fakeProvider([{ text: 'We escaped The Vault in 50 minutes.', durationSeconds: 12.3 }])
    const a = await app({ transcribe: { transcriber } })
    const res = await send(a, upload({ bytes: 3000, type: 'application/octet-stream', filename: 'memo.m4a', durationSeconds: 20 }))
    expect(res.statusCode).toBe(200)
    expect(TranscribeResponse.parse(res.json())).toEqual({ transcript: 'We escaped The Vault in 50 minutes.', durationSeconds: 12.3, mode: 'openai', clientId: null, audioDeleted: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].filename).toBe('voice-note.m4a')
    expect(calls[0].mimeType).toBe('audio/mp4')
    expect(calls[0].audio.length).toBe(3000)
    // The buffer the provider saw is zero-filled once the response is built.
    expect(calls[0].audio.every((b) => b === 0)).toBe(true)
    // Reserved 20, trimmed to the measured 12.3 -> 13.
    expect(await usedSeconds()).toBe(13)
    await a.close()
  })

  it('counts by file size when the claimed duration is too small, and by the provider when it measures more', async () => {
    const { transcriber } = fakeProvider([{ text: 'a', durationSeconds: null }, { text: 'b', durationSeconds: 50 }])
    const a = await app({ transcribe: { transcriber } })
    await send(a, upload({ bytes: 30_000, durationSeconds: 1 })) // >= 10 s of compressed audio
    expect(await usedSeconds()).toBe(10)
    await send(a, upload({ bytes: 1000, durationSeconds: 5 }))
    expect(await usedSeconds()).toBe(60)
    await a.close()
  })

  it('a 20-minute voice note claimed as 0 s is counted as about 20 minutes (realistic size floor)', async () => {
    // About 3.6 MB: 20 minutes of opus at 24 kbit/s; the provider (gpt-4o-transcribe) reports no duration.
    const { transcriber } = fakeProvider([{ text: 'long', durationSeconds: null }, { text: 'again', durationSeconds: null }])
    const a = await app({ env: { CAP_TRANSCRIBE_SECONDS_PER_USER: '1200' }, transcribe: { transcriber } })
    expect((await send(a, upload({ bytes: 3_600_000, durationSeconds: 0 }))).statusCode).toBe(200)
    expect(await usedSeconds()).toBe(1200)
    // The daily cap is now used up: the next one is refused.
    expect((await send(a, upload({ bytes: 3_600_000, durationSeconds: 0 }))).statusCode).toBe(429)
    await a.close()
  })

  it('when the provider measures more than was reserved, the overrun is counted up to the caps', async () => {
    const { transcriber, calls } = fakeProvider([{ text: 'long', durationSeconds: 500 }])
    const a = await app({ env: { CAP_TRANSCRIBE_SECONDS_PER_USER: '60', CAP_TRANSCRIBE_SECONDS_GLOBAL: '300' }, transcribe: { transcriber } })
    expect((await send(a, upload({ bytes: 1000, durationSeconds: 5 }))).statusCode).toBe(200)
    expect(await usedSeconds()).toBe(60)
    expect((await send(a, upload({ bytes: 1000, durationSeconds: 1 }))).statusCode).toBe(429)
    // The global counter got all 500 s, clamped to its own limit of 300: nobody else fits today.
    const res = await send(a, upload({ bytes: 1000, durationSeconds: 1 }), FX.users.bob)
    expect(res.statusCode).toBe(429)
    expect(SpendingCapErrorSchema.parse(res.json()).cap).toMatchObject({ scope: 'global', used: 300 })
    expect(calls).toHaveLength(1)
    await a.close()
  })

  it('returns the same transcript for a retried clientId without calling or counting again', async () => {
    const { transcriber, calls } = fakeProvider([{ text: 'first', durationSeconds: 30 }, { text: 'second', durationSeconds: 30 }, { text: 'bob', durationSeconds: 30 }])
    const a = await app({ transcribe: { transcriber } })
    const one = TranscribeResponse.parse((await send(a, upload({ clientId: 'rec-9', durationSeconds: 30 }))).json())
    const two = TranscribeResponse.parse((await send(a, upload({ clientId: 'rec-9', durationSeconds: 30 }))).json())
    expect(two).toEqual(one)
    expect(calls).toHaveLength(1)
    expect(await usedSeconds()).toBe(30)
    // Another user's identical clientId is a different recording.
    const bob = TranscribeResponse.parse((await send(a, upload({ clientId: 'rec-9', durationSeconds: 30 }), FX.users.bob)).json())
    expect(bob.transcript).toBe('second')
    await a.close()
  })

  it('over the per-user cap: 429 spending_cap with fallback typing, nothing sent to the provider', async () => {
    const { transcriber, calls } = fakeProvider([{ text: 'ok', durationSeconds: 50 }])
    const a = await app({ env: { CAP_TRANSCRIBE_SECONDS_PER_USER: '60' }, transcribe: { transcriber } })
    expect((await send(a, upload({ durationSeconds: 50 }))).statusCode).toBe(200)
    const res = await send(a, upload({ durationSeconds: 20 }))
    expect(res.statusCode).toBe(429)
    const err = SpendingCapErrorSchema.parse(res.json())
    expect(err.fallback).toBe('typing')
    expect(err.cap).toMatchObject({ kind: 'transcription', scope: 'user', unit: 'seconds', limit: 60, used: 50, resetsAt: '2026-10-26T00:00:00.000Z' })
    expect(err.error).toMatch(/You've reached today's limit for voice transcription\. You can keep going by typing/)
    expect(calls).toHaveLength(1)
    // A shorter note still fits.
    expect((await send(a, upload({ durationSeconds: 9 }))).statusCode).toBe(200)
    // The meter shows it.
    const meter = UsageSummarySchema.parse((await a.inject({ method: 'GET', url: ROUTES.usage.path, as: FX.users.alice })).json())
    expect(meter.transcriptionSeconds.limit).toBe(60)
    expect(meter.day).toBe('2026-10-25')
    await a.close()
  })

  it('over the global ceiling: 429 with scope global for everyone', async () => {
    const { transcriber } = fakeProvider([{ text: 'ok', durationSeconds: 100 }])
    const a = await app({ env: { CAP_TRANSCRIBE_SECONDS_GLOBAL: '120' }, transcribe: { transcriber } })
    expect((await send(a, upload({ durationSeconds: 100 }))).statusCode).toBe(200)
    const res = await send(a, upload({ durationSeconds: 30 }), FX.users.bob)
    expect(res.statusCode).toBe(429)
    const err = SpendingCapErrorSchema.parse(res.json())
    expect(err.cap.scope).toBe('global')
    expect(err.error).toMatch(/My Escapes has reached today's limit/)
    expect(await usedSeconds(FX.users.bob)).toBe(0)
    await a.close()
  })

  it('provider failure: 502 upstream with fallback typing, the reservation is given back, the key never logged', async () => {
    const logs: string[] = []
    const boom = new Error('connect failed sk-openai-secret')
    boom.name = 'APIConnectionError'
    const { transcriber } = fakeProvider([boom])
    const a = await app({ env: { OPENAI_API_KEY: 'sk-openai-secret' }, transcribe: { transcriber, log: (m) => logs.push(m) } })
    const res = await send(a, upload({ durationSeconds: 30 }))
    expect(res.statusCode).toBe(502)
    const err = ApiErrorSchema.parse(res.json())
    expect(err).toMatchObject({ code: 'upstream', fallback: 'typing' })
    expect(res.body).not.toContain('sk-openai-secret')
    expect(logs.join('\n')).toMatch(/APIConnectionError/)
    expect(logs.join('\n')).not.toContain('sk-openai-secret')
    expect(await usedSeconds()).toBe(0)
    await a.close()
  })

  it('answers 503 when the database is down (caps cannot be checked)', async () => {
    const { transcriber, calls } = fakeProvider()
    const a = await app({ dbDown: true, transcribe: { transcriber }, testDb: tdb })
    // Sign-in resolves from the test DB, but the context says the database is unavailable.
    const res = await send(a, upload())
    expect(res.statusCode).toBe(503)
    expect(calls).toHaveLength(0)
    await a.close()
  })

  it('rejects uploads over 25 MB with 413', async () => {
    const { transcriber, calls } = fakeProvider()
    const a = await app({ transcribe: { transcriber } })
    const res = await send(a, upload({ bytes: 25 * 1024 * 1024 + 10 }))
    expect(res.statusCode).toBe(413)
    expect(res.json().code).toBe('too_large')
    expect(calls).toHaveLength(0)
    await a.close()
  })
})

describe('OpenAI provider request', () => {
  it('posts the file, model and vocabulary prompt to the transcription endpoint', async () => {
    const seen: { url: string; form: FormData | null; auth: string | null }[] = []
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      // The SDK probes `data:` URLs to check FormData support; only record real requests.
      if (String(url).startsWith('data:')) return new Response('')
      const headers = new Headers(init?.headers)
      seen.push({ url: String(url), form: init?.body instanceof FormData ? init.body : null, auth: headers.get('authorization') })
      return new Response(JSON.stringify({ text: ' Hello there. ', usage: { type: 'duration', seconds: 4 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const p = openaiTranscriber({ OPENAI_API_KEY: 'sk-test-key' }, { fetch: fakeFetch, maxRetries: 0 })
    const out = await p.transcribe({ audio: Buffer.from('abc'), filename: 'voice-note.webm', mimeType: 'audio/webm', language: 'en' })
    expect(out).toEqual({ text: 'Hello there.', durationSeconds: 4 })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toMatch(/\/audio\/transcriptions$/)
    expect(seen[0].auth).toBe('Bearer sk-test-key')
    const form = seen[0].form!
    expect(form.get('model')).toBe('gpt-4o-transcribe')
    expect(form.get('prompt')).toBe(TRANSCRIBE_PROMPT)
    expect(form.get('language')).toBe('en')
    const file = form.get('file') as File
    expect(file.name).toBe('voice-note.webm')
    expect(file.size).toBe(3)
  })

  it('honours OPENAI_TRANSCRIBE_MODEL and skips the prompt for whisper', async () => {
    let form: FormData | null = null
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (_url.toString().startsWith('data:')) return new Response('')
      form = init?.body as FormData
      return new Response(JSON.stringify({ text: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const p = openaiTranscriber({ OPENAI_API_KEY: 'k', OPENAI_TRANSCRIBE_MODEL: 'whisper-1' }, { fetch: fakeFetch, maxRetries: 0 })
    expect(await p.transcribe({ audio: Buffer.from('a'), filename: 'v.mp3', mimeType: 'audio/mpeg' })).toEqual({ text: 'x', durationSeconds: null })
    expect(form!.get('model')).toBe('whisper-1')
    expect(form!.get('prompt')).toBeNull()
  })
})

describe('POST /api/transcribe on the full server', () => {
  it('is registered and works in mock mode, and the usage meter follows', async () => {
    const t = await buildTestApp({ fixtures: true, env: { OPENAI_API_KEY: '' }, now: () => NOW })
    try {
      const body = upload({ durationSeconds: 15 })
      const res = await t.inject({ method: 'POST', url: '/api/transcribe', payload: body.payload, headers: body.headers, as: t.fx.users.alice })
      expect(res.statusCode).toBe(200)
      expect(TranscribeResponse.parse(res.json()).mode).toBe('mock')
      const meter = UsageSummarySchema.parse((await t.inject({ method: 'GET', url: '/api/me/usage', as: t.fx.users.alice })).json())
      expect(meter.transcriptionSeconds.used).toBe(15)
      expect((await t.inject({ method: 'GET', url: '/api/me/usage' })).statusCode).toBe(401)
    } finally {
      await t.close()
    }
  })
})
