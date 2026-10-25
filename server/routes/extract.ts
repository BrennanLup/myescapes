// Owned by workstream 12: Extraction API.
import type { FastifyInstance } from 'fastify'
import { API, ExtractRequestSchema } from '../../src/contracts/api'
import type { ReviewDraft } from '../../src/contracts/types'
import { anthropicClientFactory, claudeExtract, type ClientFactory } from '../extract/claude'
import { mockExtract } from '../extract/mock'

export function extractionMode(): 'claude' | 'mock' {
  return process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock'
}

export interface ExtractRoutesOptions {
  /** Inject a client (tests). When given, the Claude path runs regardless of the env key. */
  clientFactory?: ClientFactory
  /** Clock override for date resolution (tests). */
  now?: () => Date
  /** Warning sink (defaults to console.warn). Messages never include the API key. */
  log?: (msg: string) => void
}

export async function extractRoutes(app: FastifyInstance, opts: ExtractRoutesOptions = {}) {
  app.post(API.extract, async (req, reply) => {
    const body = ExtractRequestSchema.safeParse(req.body)
    if (!body.success) {
      const tooLong = body.error.issues.some((i) => i.code === 'too_big')
      return reply.code(400).send({ error: tooLong ? 'transcript too long (max 50000 characters)' : 'transcript required' })
    }
    const transcript = body.data.transcript
    if (!transcript.trim()) return reply.code(400).send({ error: 'transcript required' })
    const now = opts.now?.() ?? new Date()

    const useClaude = Boolean(opts.clientFactory) || extractionMode() === 'claude'
    if (!useClaude) return mockExtract(transcript, { now }) satisfies ReviewDraft

    const factory = opts.clientFactory ?? anthropicClientFactory
    return (await claudeExtract(transcript, { client: factory(), now, log: opts.log })) satisfies ReviewDraft
  })
}
