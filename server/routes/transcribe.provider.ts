/**
 * Speech-to-text providers for POST /api/transcribe (workstream 10).
 *
 * - `openaiTranscriber()`: OpenAI's transcription API (`OPENAI_TRANSCRIBE_MODEL`, default
 *   `gpt-4o-transcribe`). The audio goes straight from memory to OpenAI; nothing touches disk.
 * - `mockTranscriber()`: used when OPENAI_API_KEY is missing. It returns a fixed sample voice note
 *   so the rest of the logging flow (extraction, matching, confirm) can be exercised end to end.
 *
 * Logs name only the error class and status, never the key or the transcript.
 */
import OpenAI, { toFile, type ClientOptions } from 'openai'
import { SAMPLE_TRANSCRIPT } from '../extract/fixtures'

export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-transcribe'
export const TRANSCRIBE_TIMEOUT_MS = 90_000

/** Vocabulary hint for the speech model: escape-room words it would otherwise misspell. */
export const TRANSCRIBE_PROMPT =
  'A voice note reviewing an escape room: the room name, the company, the city, who played, ' +
  'whether we escaped and the time, scores out of 100 or out of 10, puzzles, padlocks, combination locks, ' +
  'UV light, black light, magnets, cipher, game master, hints.'

export interface TranscribeInput {
  audio: Buffer
  filename: string
  mimeType: string
  /** BCP-47 / ISO-639-1 hint, e.g. `en`. Optional. */
  language?: string
}

export interface TranscribeOutput {
  text: string
  /** Seconds of audio as the provider measured them, when it says so. */
  durationSeconds: number | null
}

export interface Transcriber {
  readonly mode: 'openai' | 'mock'
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>
}

export function transcribeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL
}

/** Pulls a provider-measured duration out of the different response shapes. */
export function durationFromResponse(res: unknown): number | null {
  if (!res || typeof res !== 'object') return null
  const r = res as { duration?: unknown; usage?: { type?: unknown; seconds?: unknown } }
  if (typeof r.duration === 'number' && Number.isFinite(r.duration) && r.duration >= 0) return r.duration
  if (r.usage && r.usage.type === 'duration' && typeof r.usage.seconds === 'number' && Number.isFinite(r.usage.seconds)) return r.usage.seconds
  return null
}

/** `clientOptions` is for tests (e.g. a fake `fetch`). */
export function openaiTranscriber(env: NodeJS.ProcessEnv = process.env, clientOptions: Partial<ClientOptions> = {}): Transcriber {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: TRANSCRIBE_TIMEOUT_MS, maxRetries: 1, ...clientOptions })
  const model = transcribeModel(env)
  return {
    mode: 'openai',
    async transcribe(input) {
      const file = await toFile(input.audio, input.filename, { type: input.mimeType })
      const res = await client.audio.transcriptions.create({
        file,
        model,
        response_format: 'json',
        ...(model.startsWith('whisper') ? {} : { prompt: TRANSCRIBE_PROMPT }),
        ...(input.language ? { language: input.language } : {}),
      })
      return { text: typeof res.text === 'string' ? res.text.trim() : '', durationSeconds: durationFromResponse(res) }
    },
  }
}

export const MOCK_TRANSCRIPT = SAMPLE_TRANSCRIPT

export function mockTranscriber(): Transcriber {
  return {
    mode: 'mock',
    async transcribe() {
      return { text: MOCK_TRANSCRIPT, durationSeconds: null }
    },
  }
}

/** Short, key-free description of a provider error for logs. */
export function describeProviderError(err: unknown): string {
  if (err instanceof OpenAI.APIError) return `${err.constructor.name} status=${err.status ?? 'n/a'}`
  if (err instanceof Error) return err.name
  return 'unknown error'
}
