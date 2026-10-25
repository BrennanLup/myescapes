// @vitest-environment node
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API } from '../../src/contracts/api'
import { ReviewDraftSchema, type ReviewDraft } from '../../src/contracts/types'
import { extractRoutes, extractionMode, type ExtractRoutesOptions } from '../routes/extract'
import type { ExtractClient } from './claude'
import { FALLBACK_FLAG } from './draft'
import { SAMPLE_TRANSCRIPT } from './fixtures'

async function makeApp(opts: ExtractRoutesOptions = {}) {
  const app = Fastify()
  await app.register(extractRoutes, { log: () => {}, ...opts })
  return app
}

const post = (app: Awaited<ReturnType<typeof makeApp>>, payload: unknown) =>
  app.inject({ method: 'POST', url: API.extract, payload: payload as object })

/** A valid model answer (no mode / voiceTranscript: the server adds them). */
function claudeAnswer(overrides: Record<string, unknown> = {}) {
  const rating = (score: number | null, comment = '') => ({ score, comment })
  return {
    room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
    review: {
      date: null,
      crew: ['Maya', 'Jordan', 'Priya'],
      ratings: { overall: rating(87, 'great'), puzzles: rating(90), setting: rating(90), storyline: rating(null), difficulty: rating(70) },
      puzzles: [{ description: 'Telescope mirrors', type: 'physical', memorable: true }],
      escaped: true,
      escapeTimeMinutes: 48,
      visibleTimer: true,
      multiRoom: null,
      flashlights: null,
      liveActors: true,
      toolsUsed: ['UV light'],
    },
    flags: ['review.date'],
    ...overrides,
  }
}

function fakeClient(responses: Array<string | Error | { text: string; stopReason: string }>) {
  const calls: unknown[] = []
  const client: ExtractClient = {
    async createMessage(params) {
      calls.push(params)
      const next = responses.shift()
      if (next === undefined) throw new Error('no more responses')
      if (next instanceof Error) throw next
      if (typeof next === 'string') return { text: next, stopReason: 'end_turn' }
      return next
    },
  }
  return { client, calls }
}

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/extract input validation', () => {
  it('400s on missing, empty, whitespace or oversized transcripts', async () => {
    const app = await makeApp()
    for (const payload of [{}, { transcript: '' }, { transcript: '   ' }, { transcript: 42 }, { transcript: 'x'.repeat(50_001) }]) {
      const res = await post(app, payload)
      expect(res.statusCode).toBe(400)
      expect(typeof res.json().error).toBe('string')
    }
    expect((await post(app, { transcript: 'x'.repeat(50_001) })).json().error).toMatch(/too long/)
  })
})

describe('POST /api/extract mock mode', () => {
  it('reports mock mode without a key and extracts the sample', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(extractionMode()).toBe('mock')
    const app = await makeApp()
    const res = await post(app, { transcript: SAMPLE_TRANSCRIPT })
    expect(res.statusCode).toBe(200)
    const d = ReviewDraftSchema.parse(res.json())
    expect(d.mode).toBe('mock')
    expect(d.room.name).toBe('The Lost Observatory')
    expect(d.review.ratings.overall.score).toBe(87)
    expect(d.review.voiceTranscript).toBe(SAMPLE_TRANSCRIPT)
  })

  it('reports claude mode when a key is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    expect(extractionMode()).toBe('claude')
  })
})

describe('POST /api/extract claude mode (mocked SDK)', () => {
  it('returns the validated Claude draft with mode claude and nulls flagged', async () => {
    const { client, calls } = fakeClient([JSON.stringify(claudeAnswer())])
    const app = await makeApp({ clientFactory: () => client, now: () => new Date('2026-10-25T00:00:00Z') })
    const res = await post(app, { transcript: SAMPLE_TRANSCRIPT })
    const d: ReviewDraft = ReviewDraftSchema.parse(res.json())
    expect(d.mode).toBe('claude')
    expect(d.room.company).toBe('Starlight Escapes')
    expect(d.review.voiceTranscript).toBe(SAMPLE_TRANSCRIPT)
    // Model flagged only the date; the server adds every other null path.
    expect(d.flags).toEqual(
      expect.arrayContaining(['review.date', 'room.address', 'room.website', 'review.multiRoom', 'review.ratings.storyline.score']),
    )
    expect(calls).toHaveLength(1)
    const params = calls[0] as { model: string; output_config: { format: { type: string } }; system: string; messages: { content: string }[] }
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.system).toMatch(/2026-10-25/)
    expect(params.system).toMatch(/lock-and-key/)
    expect(params.system).toMatch(/writing boards/)
    expect(params.messages[0].content).toContain('The Lost Observatory')
  })

  it('honours ANTHROPIC_MODEL', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    const { client, calls } = fakeClient([JSON.stringify(claudeAnswer())])
    const app = await makeApp({ clientFactory: () => client })
    await post(app, { transcript: 'hello' })
    expect((calls[0] as { model: string }).model).toBe('claude-sonnet-5-5')
  })

  it('clamps out-of-range scores instead of failing', async () => {
    const answer = claudeAnswer()
    answer.review.ratings.overall.score = 87.6
    answer.review.ratings.puzzles.score = 140
    const { client } = fakeClient([JSON.stringify(answer)])
    const d = (await post(await makeApp({ clientFactory: () => client }), { transcript: 'x' })).json()
    expect(d.review.ratings.overall.score).toBe(88)
    expect(d.review.ratings.puzzles.score).toBe(100)
  })

  it('retries once on invalid output, then succeeds', async () => {
    const { client, calls } = fakeClient(['not json at all', JSON.stringify(claudeAnswer())])
    const app = await makeApp({ clientFactory: () => client })
    const d = (await post(app, { transcript: SAMPLE_TRANSCRIPT })).json()
    expect(d.mode).toBe('claude')
    expect(calls).toHaveLength(2)
    expect((calls[1] as { messages: { content: string }[] }).messages[0].content).toMatch(/rejected: output was not valid JSON/)
  })

  it('falls back to the mock extractor with a flag after two invalid outputs', async () => {
    const { client, calls } = fakeClient([JSON.stringify({ room: {} }), JSON.stringify(claudeAnswer({ flags: 'nope' }))])
    const app = await makeApp({ clientFactory: () => client })
    const res = await post(app, { transcript: SAMPLE_TRANSCRIPT })
    expect(res.statusCode).toBe(200)
    const d = ReviewDraftSchema.parse(res.json())
    expect(calls).toHaveLength(2)
    expect(d.mode).toBe('mock')
    expect(d.flags).toContain(FALLBACK_FLAG)
    expect(d.room.name).toBe('The Lost Observatory')
  })

  it('falls back immediately on API errors and refusals, without leaking the key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret-key')
    const logs: string[] = []
    const err = new Error('timeout sk-secret-key')
    err.name = 'APIConnectionTimeoutError'
    const { client, calls } = fakeClient([err, { text: '', stopReason: 'refusal' }])
    const app = await makeApp({ clientFactory: () => client, log: (m) => logs.push(m) })
    for (let i = 0; i < 2; i++) {
      const d = (await post(app, { transcript: SAMPLE_TRANSCRIPT })).json()
      expect(d.mode).toBe('mock')
      expect(d.flags).toContain(FALLBACK_FLAG)
    }
    expect(calls).toHaveLength(2)
    expect(logs.join('\n')).not.toContain('sk-secret-key')
    expect(logs.join('\n')).toMatch(/APIConnectionTimeoutError/)
  })
})
