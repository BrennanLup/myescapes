// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '../../src/contracts/routes'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { ReviewDraftSchema, type ReviewDraft } from '../../src/contracts/types'
import { FX } from '../db/fixtures'
import { createTestDb, resetDb, type TestDb } from '../db/testing'
import { loadFixtures } from '../db/fixtures'
import { usageSummary } from '../db/usage'
import { extractionMode } from '../routes/extract'
import { buildTestApp } from '../testing'
import type { ExtractClient } from './claude'
import { FALLBACK_FLAG } from './draft'
import { SAMPLE_TRANSCRIPT } from './fixtures'
import { ANONYMOUS_SUBJECT, NOTICES } from './service'
import { buildVoiceTestApp, type VoiceTestAppOptions } from './test-app'

const ExtractResponse = ROUTES.extract.response
const NOW = new Date('2026-10-25T12:00:00Z')
const SF = { lat: 37.7899, lng: -122.3945 }

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
    hints: { venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'us' },
    ...overrides,
  }
}

type Response = string | Error | { text: string; stopReason: string }

function fakeClient(responses: Response[]) {
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

/** A client that always answers with a valid draft. */
function goodClient() {
  const calls: unknown[] = []
  const client: ExtractClient = {
    async createMessage(params) {
      calls.push(params)
      return { text: JSON.stringify(claudeAnswer()), stopReason: 'end_turn' }
    },
  }
  return { client, calls }
}

// One migrated database for the file; each app shares it and the counters are reset per test.
let tdb: TestDb
beforeAll(async () => {
  tdb = await createTestDb()
  await loadFixtures(tdb.db)
})
afterAll(async () => {
  await tdb?.close()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await resetDb(tdb.db)
  await loadFixtures(tdb.db)
})

async function app(opts: VoiceTestAppOptions = {}) {
  return buildVoiceTestApp({ testDb: tdb, now: () => NOW, ...opts })
}

const post = (a: Awaited<ReturnType<typeof app>>, payload: unknown, as?: string) =>
  a.inject({ method: 'POST', url: ROUTES.extract.path, payload: payload as object, as })

describe('POST /api/extract input validation', () => {
  it('400s on missing, empty, whitespace, non-string or oversized transcripts', async () => {
    const a = await app()
    for (const payload of [{}, { transcript: '' }, { transcript: '   ' }, { transcript: 42 }, { transcript: 'x'.repeat(50_001) }]) {
      const res = await post(a, payload)
      expect(res.statusCode).toBe(400)
      expect(ApiErrorSchema.parse(res.json()).code).toBe('invalid')
    }
    expect((await post(a, { transcript: 'x'.repeat(50_001) })).json().error).toMatch(/transcript/)
    await a.close()
  })

  it('rejects non-numeric coordinates', async () => {
    const a = await app()
    expect((await post(a, { transcript: 'hi', lat: 'north' })).statusCode).toBe(400)
    await a.close()
  })
})

describe('POST /api/extract mock mode (no ANTHROPIC_API_KEY)', () => {
  it('reports mock mode without a key and claude with one', () => {
    expect(extractionMode({})).toBe('mock')
    expect(extractionMode({ ANTHROPIC_API_KEY: 'sk-test' })).toBe('claude')
  })

  it('extracts the sample with directory hints and no notice', async () => {
    const a = await app({ env: { ANTHROPIC_API_KEY: '' } })
    const res = await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)
    expect(res.statusCode).toBe(200)
    const d = ExtractResponse.parse(res.json())
    expect(d.mode).toBe('mock')
    expect(d.room.name).toBe('The Lost Observatory')
    expect(d.review.ratings.overall.score).toBe(87)
    expect(d.review.voiceTranscript).toBe(SAMPLE_TRANSCRIPT)
    expect(d.hints).toEqual({ venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' })
    expect(d.notice).toBeNull()
    await a.close()
  })

  it('costs nothing: mock drafts never touch the usage counters', async () => {
    const a = await app({ env: { ANTHROPIC_API_KEY: '', CAP_EXTRACT_CALLS_PER_USER: '0' } })
    for (let i = 0; i < 3; i++) {
      const d = ExtractResponse.parse((await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)).json())
      expect(d.notice).toBeNull()
    }
    expect((await usageSummary(tdb.db, FX.users.alice, NOW)).extractionCalls.used).toBe(0)
    await a.close()
  })

  it('works signed out and with the database down (Phase 1 3D room)', async () => {
    const a = await app({ env: { ANTHROPIC_API_KEY: '' }, dbDown: true })
    const res = await post(a, { transcript: SAMPLE_TRANSCRIPT, ...SF })
    expect(res.statusCode).toBe(200)
    const d = ExtractResponse.parse(res.json())
    expect(d.mode).toBe('mock')
    expect(d.notice).toBeNull()
    await a.close()
  })

  it('snaps a misheard venue to the nearby directory spelling', async () => {
    const a = await app({ env: { ANTHROPIC_API_KEY: '' } })
    const transcript = 'We did a room called The Lost Observatry by Star Light Escape yesterday. Overall 80 out of 100.'
    const withLocation = ExtractResponse.parse((await post(a, { transcript, ...SF }, FX.users.alice)).json())
    expect(withLocation.hints).toMatchObject({ venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' })
    // Without a location there is nothing to snap to: the spoken names are passed on.
    const without = ExtractResponse.parse((await post(a, { transcript }, FX.users.alice)).json())
    expect(without.hints?.venue).toBe('Star Light Escape')
    await a.close()
  })
})

describe('POST /api/extract claude mode (fake SDK client)', () => {
  it('returns the validated Claude draft with mode claude, nulls flagged and the model hints', async () => {
    const { client, calls } = fakeClient([JSON.stringify(claudeAnswer())])
    const a = await app({ extract: { clientFactory: () => client } })
    const res = await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)
    const d = ExtractResponse.parse(res.json())
    const draft: ReviewDraft = ReviewDraftSchema.parse(res.json())
    expect(draft.mode).toBe('claude')
    expect(d.room.company).toBe('Starlight Escapes')
    expect(d.review.voiceTranscript).toBe(SAMPLE_TRANSCRIPT)
    expect(d.flags).toEqual(expect.arrayContaining(['review.date', 'room.address', 'room.website', 'review.multiRoom', 'review.ratings.storyline.score']))
    expect(d.hints).toEqual({ venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' })
    expect(d.notice).toBeNull()
    expect(calls).toHaveLength(1)
    const params = calls[0] as { model: string; output_config: { format: { type: string; schema: { required: string[] } } }; system: string; messages: { content: string }[] }
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.output_config.format.schema.required).toContain('hints')
    expect(params.system).toMatch(/2026-10-25/)
    expect(params.system).toMatch(/lock-and-key/)
    expect(params.system).toMatch(/writing boards/)
    expect(params.messages[0].content).toContain('The Lost Observatory')
    expect(params.messages[0].content).not.toContain('<nearby_directory>')
    await a.close()
  })

  it('puts nearby directory venues and games into the prompt when a location is sent', async () => {
    const { client, calls } = goodClient()
    const a = await app({ extract: { clientFactory: () => client } })
    await post(a, { transcript: SAMPLE_TRANSCRIPT, ...SF }, FX.users.alice)
    const content = (calls[0] as { messages: { content: string }[] }).messages[0].content
    expect(content).toContain('<nearby_directory>')
    expect(content).toContain('"Starlight Escapes"')
    expect(content).toContain('"The Lost Observatory"')
    expect(content).not.toContain('Maple & Key') // Toronto is far away
    await a.close()
  })

  it('honours ANTHROPIC_MODEL', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    const { client, calls } = goodClient()
    const a = await app({ extract: { clientFactory: () => client } })
    await post(a, { transcript: 'hello' }, FX.users.alice)
    expect((calls[0] as { model: string }).model).toBe('claude-sonnet-5-5')
    await a.close()
  })

  it('clamps out-of-range scores instead of failing', async () => {
    const answer = claudeAnswer()
    answer.review.ratings.overall.score = 87.6
    answer.review.ratings.puzzles.score = 140
    const { client } = fakeClient([JSON.stringify(answer)])
    const a = await app({ extract: { clientFactory: () => client } })
    const d = (await post(a, { transcript: 'x' }, FX.users.alice)).json()
    expect(d.review.ratings.overall.score).toBe(88)
    expect(d.review.ratings.puzzles.score).toBe(100)
    await a.close()
  })

  it('ignores junk model hints and falls back to the draft fields', async () => {
    const { client } = fakeClient([JSON.stringify(claudeAnswer({ hints: { venue: 42, game: null, city: null, country: 'Narnia' } }))])
    const a = await app({ extract: { clientFactory: () => client } })
    const d = ExtractResponse.parse((await post(a, { transcript: 'x' }, FX.users.alice)).json())
    expect(d.hints).toEqual({ venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' })
    await a.close()
  })

  it('retries once on invalid output, then succeeds (one unit counted)', async () => {
    const { client, calls } = fakeClient(['not json at all', JSON.stringify(claudeAnswer())])
    const a = await app({ extract: { clientFactory: () => client } })
    const d = (await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)).json()
    expect(d.mode).toBe('claude')
    expect(calls).toHaveLength(2)
    expect((calls[1] as { messages: { content: string }[] }).messages[0].content).toMatch(/rejected: output was not valid JSON/)
    expect((await usageSummary(tdb.db, FX.users.alice, NOW)).extractionCalls.used).toBe(1)
    await a.close()
  })

  it('falls back to the mock extractor with a flag after two invalid outputs, and gives the unit back', async () => {
    const { client, calls } = fakeClient([JSON.stringify({ room: {} }), JSON.stringify(claudeAnswer({ flags: 'nope' }))])
    const a = await app({ extract: { clientFactory: () => client } })
    const res = await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)
    expect(res.statusCode).toBe(200)
    const d = ExtractResponse.parse(res.json())
    expect(calls).toHaveLength(2)
    expect(d.mode).toBe('mock')
    expect(d.flags).toContain(FALLBACK_FLAG)
    expect(d.room.name).toBe('The Lost Observatory')
    expect(d.hints?.venue).toBe('Starlight Escapes')
    expect((await usageSummary(tdb.db, FX.users.alice, NOW)).extractionCalls.used).toBe(0)
    await a.close()
  })

  it('falls back immediately on API errors and refusals, without leaking the key', async () => {
    const logs: string[] = []
    const err = new Error('timeout sk-secret-key')
    err.name = 'APIConnectionTimeoutError'
    const { client, calls } = fakeClient([err, { text: '', stopReason: 'refusal' }])
    const a = await app({ env: { ANTHROPIC_API_KEY: 'sk-secret-key' }, extract: { clientFactory: () => client, log: (m) => logs.push(m) } })
    for (let i = 0; i < 2; i++) {
      const res = await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)
      const d = res.json()
      expect(d.mode).toBe('mock')
      expect(d.flags).toContain(FALLBACK_FLAG)
      expect(res.body).not.toContain('sk-secret-key')
    }
    expect(calls).toHaveLength(2)
    expect(logs.join('\n')).not.toContain('sk-secret-key')
    expect(logs.join('\n')).toMatch(/APIConnectionTimeoutError/)
    await a.close()
  })
})

describe('extraction spending caps', () => {
  it('counts one call per Claude draft; over the per-user cap it returns a mock draft with a notice', async () => {
    const { client, calls } = goodClient()
    const a = await app({ env: { CAP_EXTRACT_CALLS_PER_USER: '2' }, extract: { clientFactory: () => client } })
    for (let i = 0; i < 2; i++) {
      const d = ExtractResponse.parse((await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)).json())
      expect(d.mode).toBe('claude')
      expect(d.notice).toBeNull()
    }
    const res = await post(a, { transcript: SAMPLE_TRANSCRIPT }, FX.users.alice)
    expect(res.statusCode).toBe(200)
    const over = ExtractResponse.parse(res.json())
    expect(over.mode).toBe('mock')
    expect(over.notice).toMatch(/today's 2 AI-drafted reviews/)
    expect(over.notice).toMatch(/midnight UTC/)
    expect(over.room.name).toBe('The Lost Observatory')
    expect(over.hints?.venue).toBe('Starlight Escapes')
    expect(calls).toHaveLength(2)
    // The meter shows it, and another user is unaffected.
    const meter = await a.inject({ method: 'GET', url: ROUTES.usage.path, as: FX.users.alice })
    expect(meter.json().extractionCalls).toEqual({ used: 2, limit: 2 })
    expect(ExtractResponse.parse((await post(a, { transcript: 'x' }, FX.users.bob)).json()).mode).toBe('claude')
    await a.close()
  })

  it('resets the next UTC day', async () => {
    const { client } = goodClient()
    let now = NOW
    const a = await app({ now: () => now, env: { CAP_EXTRACT_CALLS_PER_USER: '1' }, extract: { clientFactory: () => client } })
    expect((await post(a, { transcript: 'x' }, FX.users.alice)).json().mode).toBe('claude')
    expect((await post(a, { transcript: 'x' }, FX.users.alice)).json().mode).toBe('mock')
    now = new Date('2026-10-26T00:00:01Z')
    expect((await post(a, { transcript: 'x' }, FX.users.alice)).json().mode).toBe('claude')
    await a.close()
  })

  it('enforces the global ceiling across users with its own message', async () => {
    const { client, calls } = goodClient()
    const a = await app({ env: { CAP_EXTRACT_CALLS_GLOBAL: '1' }, extract: { clientFactory: () => client } })
    expect((await post(a, { transcript: 'x' }, FX.users.alice)).json().mode).toBe('claude')
    const d = ExtractResponse.parse((await post(a, { transcript: 'x' }, FX.users.bob)).json())
    expect(d.mode).toBe('mock')
    expect(d.notice).toMatch(/My Escapes has reached today's AI drafting limit/)
    expect(calls).toHaveLength(1)
    // Bob was not charged for the refused call.
    expect((await usageSummary(tdb.db, FX.users.bob, NOW)).extractionCalls.used).toBe(0)
    await a.close()
  })

  it('signed-out callers share one anonymous bucket with the per-user limit', async () => {
    const { client, calls } = goodClient()
    const a = await app({ env: { CAP_EXTRACT_CALLS_PER_USER: '1' }, extract: { clientFactory: () => client } })
    expect((await post(a, { transcript: 'x' })).json().mode).toBe('claude')
    const d = ExtractResponse.parse((await post(a, { transcript: 'x' })).json())
    expect(d.mode).toBe('mock')
    expect(d.notice).toBe(NOTICES.signedOutCap)
    expect((await usageSummary(tdb.db, ANONYMOUS_SUBJECT, NOW)).extractionCalls.used).toBe(1)
    // A signed-in user still has their own allowance.
    expect((await post(a, { transcript: 'x' }, FX.users.alice)).json().mode).toBe('claude')
    expect(calls).toHaveLength(2)
    await a.close()
  })

  it('fails closed when the usage counter cannot be written (database down)', async () => {
    const { client, calls } = goodClient()
    const a = await app({ dbDown: true, extract: { clientFactory: () => client } })
    const d = ExtractResponse.parse((await post(a, { transcript: SAMPLE_TRANSCRIPT })).json())
    expect(d.mode).toBe('mock')
    expect(d.notice).toBe(NOTICES.dbUnavailable)
    expect(calls).toHaveLength(0)
    await a.close()
  })
})

describe('POST /api/extract on the full server', () => {
  it('is registered by the route registry and answers in mock mode', async () => {
    const t = await buildTestApp({ fixtures: true, env: { ANTHROPIC_API_KEY: '' }, now: () => NOW })
    try {
      const res = await t.inject({ method: 'POST', url: '/api/extract', payload: { transcript: SAMPLE_TRANSCRIPT }, as: t.fx.users.alice })
      expect(res.statusCode).toBe(200)
      const d = ExtractResponse.parse(res.json())
      expect(d.mode).toBe('mock')
      expect(d.hints?.game).toBe('The Lost Observatory')
      // The Phase 1 client parses the same body with ReviewDraftSchema.
      expect(ReviewDraftSchema.parse(res.json()).room.company).toBe('Starlight Escapes')
      const anon = await t.inject({ method: 'POST', url: '/api/extract', payload: { transcript: SAMPLE_TRANSCRIPT } })
      expect(anon.statusCode).toBe(200)
    } finally {
      await t.close()
    }
  })
})
