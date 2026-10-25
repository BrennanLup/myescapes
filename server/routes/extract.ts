// PLACEHOLDER (orchestrator). Owned by workstream 12: Extraction API.
import type { FastifyInstance } from 'fastify'
import { API, ExtractRequestSchema } from '../../src/contracts/api'
import type { ReviewDraft } from '../../src/contracts/types'

export function extractionMode(): 'claude' | 'mock' {
  return process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock'
}

export async function extractRoutes(app: FastifyInstance) {
  app.post(API.extract, async (req, reply) => {
    const body = ExtractRequestSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'transcript required' })
    const empty = { score: null, comment: '' }
    const draft: ReviewDraft = {
      room: { name: null, company: null, city: null, genre: null, address: null, website: null },
      review: {
        date: null, crew: [], ratings: { overall: empty, puzzles: empty, setting: empty, storyline: empty, difficulty: empty },
        puzzles: [], escaped: null, escapeTimeMinutes: null, visibleTimer: null, multiRoom: null, flashlights: null,
        liveActors: null, toolsUsed: [], voiceTranscript: body.data.transcript,
      },
      flags: ['room.name'],
      mode: 'mock',
    }
    return draft
  })
}
