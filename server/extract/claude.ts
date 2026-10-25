/**
 * Claude extraction path: one structured-output Messages call, validated with Zod,
 * retried once on invalid output, falling back to the mock extractor on any failure.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ReviewDraftSchema, type ReviewDraft } from '../../src/contracts/types'
import { FALLBACK_FLAG, finalizeDraft } from './draft'
import { mockExtract } from './mock'
import { DRAFT_JSON_SCHEMA, systemPrompt } from './prompt'

export const DEFAULT_MODEL = 'claude-opus-5-5'
export const TIMEOUT_MS = 30_000

/** What the extractor needs from the SDK. Tests inject a fake; production wraps the real client. */
export interface ExtractClient {
  createMessage(params: MessageCreateParamsNonStreaming): Promise<{ text: string; stopReason: string | null }>
}

export type ClientFactory = () => ExtractClient

/** Real client. Reads ANTHROPIC_API_KEY from the environment; never logs it. */
export const anthropicClientFactory: ClientFactory = () => {
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 })
  return {
    async createMessage(params) {
      const msg = await client.beta.messages.create(params, { timeout: TIMEOUT_MS })
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      return { text, stopReason: msg.stop_reason }
    },
  }
}

export function modelId(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL
}

export function buildParams(transcript: string, today: string, retryNote?: string): MessageCreateParamsNonStreaming {
  const content = retryNote
    ? `${wrap(transcript)}\n\nYour previous answer was rejected: ${retryNote}. Return JSON that matches the schema exactly.`
    : wrap(transcript)
  return {
    model: modelId(),
    max_tokens: 16000,
    system: systemPrompt(today),
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: DRAFT_JSON_SCHEMA } },
    // Server-side refusal fallback: if the model declines, the API reroutes in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }
}

function wrap(transcript: string): string {
  return `Here is the voice note transcript:\n<transcript>\n${transcript}\n</transcript>`
}

/** Clamp/round scores the JSON schema cannot constrain, so near-misses still validate. */
function sanitize(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as { review?: { ratings?: Record<string, { score?: unknown }> } }
  const ratings = r.review?.ratings
  if (ratings && typeof ratings === 'object') {
    for (const v of Object.values(ratings)) {
      if (v && typeof v.score === 'number' && Number.isFinite(v.score)) v.score = Math.min(100, Math.max(1, Math.round(v.score)))
    }
  }
  return raw
}

export type ParseResult = { ok: true; draft: ReviewDraft } | { ok: false; error: string }

export function parseClaudeOutput(text: string, transcript: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'output was not valid JSON' }
  }
  if (json && typeof json === 'object') (json as Record<string, unknown>).mode = 'claude'
  const result = ReviewDraftSchema.safeParse(sanitize(json))
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `schema validation failed (${issues})` }
  }
  return { ok: true, draft: finalizeDraft({ ...result.data, mode: 'claude' }, transcript) }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.constructor.name} status=${err.status ?? 'n/a'}`
  if (err instanceof Error) return err.name
  return 'unknown error'
}

export interface ClaudeExtractOptions {
  client: ExtractClient
  now?: Date
  log?: (msg: string) => void
}

export async function claudeExtract(transcript: string, opts: ClaudeExtractOptions): Promise<ReviewDraft> {
  const now = opts.now ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const log = opts.log ?? ((m: string) => console.warn(`[extract] ${m}`))
  let retryNote: string | undefined
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: { text: string; stopReason: string | null }
    try {
      res = await opts.client.createMessage(buildParams(transcript, today, retryNote))
    } catch (err) {
      // Transport/API errors are already retried by the SDK; fall back right away.
      log(`Claude request failed (${describeError(err)}); using mock extractor`)
      break
    }
    if (res.stopReason === 'refusal') {
      log('Claude declined the request; using mock extractor')
      break
    }
    const parsed = parseClaudeOutput(res.text, transcript)
    if (parsed.ok) return parsed.draft
    retryNote = res.stopReason === 'max_tokens' ? 'output was cut off' : parsed.error
    log(`attempt ${attempt} invalid: ${retryNote}`)
  }
  const fallback = mockExtract(transcript, { now })
  return finalizeDraft(fallback, transcript, [FALLBACK_FLAG])
}
