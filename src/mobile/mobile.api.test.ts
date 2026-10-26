// @vitest-environment node
/**
 * API tests for the mobile app's requests, against the real server (every route module, real
 * validation, auth and error handling) on an in-process PGlite database with fixtures.
 *
 * The mobile client's own code builds each request (the same functions the screens call), and a
 * fetch shim routes it into `app.inject`. The server routes belong to other workstreams, so a
 * route may still be a 501 stub here; the tests then check what holds either way: the request
 * passes the contract's validation (never 400 `invalid`), user routes refuse anonymous callers,
 * and when a route is built, its answer parses and the flow's state follows it.
 */
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiCallError } from '../contracts/errors'
import { callApi, ROUTES } from '../contracts/routes'
import type { ReviewDraft } from '../contracts/types'
import { buildTestApp, type TestApp } from '../../server/testing'
import { createVisit, crewSuggestions, extract, transcribe } from './log/api'
import { draftToForm, toCreateVisitBody } from './log/form'
import { enqueueRecording, getRecording, uploadRecording } from './log/queue'
import { SAMPLE_TRANSCRIPT } from '../ui/record/prompts'

let t: TestApp

/** fetch() -> app.inject(), optionally signed in as a fixture user. */
function injectFetch(as?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = { ...((init.headers as Record<string, string>) ?? {}) }
    const res = await t.inject({ method: (init.method ?? 'GET') as 'GET', url: String(input), headers, payload: init.body as never, as })
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'text/plain') } })
  }) as typeof fetch
}

/** Run a client call. Returns its value when the route is built, or 'stub' for a 501. Fails on 400 invalid. */
async function contractOk<T>(p: Promise<T>): Promise<T | 'stub'> {
  try {
    return await p
  } catch (err) {
    if (err instanceof ApiCallError) {
      expect(err.code, `request rejected by the contract: ${err.message}`).not.toBe('invalid')
      if (err.status === 501) return 'stub'
    }
    throw err
  }
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p
    return 200
  } catch (err) {
    if (err instanceof ApiCallError) return err.status
    throw err
  }
}

const DRAFT: ReviewDraft = {
  room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: '2026-10-20',
    crew: ['Bob', 'Priya'],
    ratings: { overall: { score: 80, comment: 'Fun' }, puzzles: { score: 75, comment: '' }, setting: { score: 90, comment: '' }, storyline: { score: 70, comment: '' }, difficulty: { score: 60, comment: '' } },
    puzzles: [{ description: 'Star chart dome', type: 'lock-and-key', memorable: true }],
    escaped: true,
    escapeTimeMinutes: 51,
    visibleTimer: true,
    multiRoom: false,
    flashlights: null,
    liveActors: false,
    toolsUsed: ['UV light'],
    voiceTranscript: '',
  },
  flags: [],
  mode: 'mock',
}

beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

describe('mobile app API calls', () => {
  it('every signed-in route the phone uses refuses anonymous callers', async () => {
    const anon = { fetch: injectFetch() }
    const audio = await enqueueRecording({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), durationSeconds: 3 })
    const { form } = draftToForm(DRAFT)
    const checks = {
      transcribe: () => transcribe(audio, anon),
      createVisit: () => createVisit(toCreateVisitBody(form, t.fx.games.observatory, []), anon),
      crewSuggestions: () => crewSuggestions(anon),
      pendingTags: () => callApi(ROUTES.pendingTags, {}, anon),
      createVenue: () => callApi(ROUTES.createVenue, { body: { name: 'X', city: 'Y', country: 'US' } }, anon),
      createGame: () => callApi(ROUTES.createGame, { body: { venueId: t.fx.venues.starlight, name: 'Z' } }, anon),
      updateMe: () => callApi(ROUTES.updateMe, { body: { displayName: 'A', handle: 'abc' } }, anon),
      putMyReview: () => callApi(ROUTES.putMyReview, { params: { id: t.fx.visits.solo }, body: { ratings: form.ratings as never } }, anon),
    }
    for (const [name, call] of Object.entries(checks)) expect(await status(call()), name).toBe(401)
  })

  it('upload: the multipart form passes validation; the queue follows the answer', async () => {
    const item = await enqueueRecording({ audio: new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), durationSeconds: 4.2, liveTranscript: 'live' })
    const as = { fetch: injectFetch(t.fx.users.alice) }
    let failure: unknown = null
    try {
      await uploadRecording(item.id, (it) => transcribe(it, as))
    } catch (err) {
      failure = err
      expect(err instanceof ApiCallError ? err.code : null).not.toBe('invalid')
    }
    const after = await getRecording(item.id)
    if (after?.status === 'transcribed') {
      // Built: the transcript is saved and the audio is gone from the phone.
      expect(after.audio).toBeNull()
      expect(typeof after.transcript).toBe('string')
      expect(failure).toBeNull()
    } else {
      // Not built yet, or failed: the audio stays queued for a retry.
      expect(failure).not.toBeNull()
      expect(after?.status).toBe('pending')
      expect(after?.audio?.byteLength).toBe(2048)
      expect(after?.attempts).toBe(1)
    }
  })

  it('extract and the directory matcher accept what the phone sends', async () => {
    const as = { fetch: injectFetch(t.fx.users.alice) }
    const draft = await contractOk(extract(SAMPLE_TRANSCRIPT, as))
    if (draft !== 'stub') expect(draft.mode).toMatch(/claude|mock/)
    const m = await contractOk(callApi(ROUTES.directoryMatch, { query: { venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' } }, as))
    if (m !== 'stub') expect(Array.isArray(m.games)).toBe(true)
    await contractOk(callApi(ROUTES.directorySearch, { query: { q: 'starlight', limit: 20 } }, as))
    await contractOk(callApi(ROUTES.venuePage, { params: { slug: t.fx.venueSlugs.starlight } }, as))
  })

  it('pick-or-create: new venue and game bodies pass validation', async () => {
    const as = { fetch: injectFetch(t.fx.users.alice) }
    const v = await contractOk(callApi(ROUTES.createVenue, { body: { name: 'Tiny Rooms', city: 'Austin', region: 'TX', country: 'US', address: '', website: null } }, as))
    const venueId = v === 'stub' ? t.fx.venues.starlight : v.id
    const g = await contractOk(callApi(ROUTES.createGame, { body: { venueId, name: 'The Attic', genre: 'horror' } }, as))
    if (g !== 'stub') expect(g.venueId).toBe(venueId)
  })

  it('save: the confirm form becomes a valid POST /api/visits with crew tags', async () => {
    const as = { fetch: injectFetch(t.fx.users.alice) }
    const { form } = draftToForm(DRAFT)
    const sugg = await contractOk(crewSuggestions(as))
    if (sugg !== 'stub') expect(Array.isArray(sugg.suggestions)).toBe(true)
    const body = toCreateVisitBody(form, t.fx.games.observatory, [{ userId: t.fx.users.bob }, { guestName: 'Priya' }])
    const visit = await contractOk(createVisit(body, as))
    if (visit !== 'stub') {
      expect(visit.game.id).toBe(t.fx.games.observatory)
      expect(visit.facts).toMatchObject({ date: '2026-10-20', escaped: true, escapeTimeMinutes: 51 })
      const logs = await contractOk(callApi(ROUTES.logs, {}, as))
      if (logs !== 'stub') expect(logs.rows.some((r) => r.visitId === visit.id)).toBe(true)
    }
  })

  it('crew: tagging a stranger as a user is refused (friends only), guests are fine', async () => {
    const as = { fetch: injectFetch(t.fx.users.alice) }
    const { form } = draftToForm(DRAFT)
    const code = await status(createVisit(toCreateVisitBody(form, t.fx.games.vault, [{ userId: t.fx.users.carol }]), as))
    expect([403, 501]).toContain(code)
  })

  it('onboarding: the name and @handle request passes validation', async () => {
    const as = { fetch: injectFetch(t.fx.users.newbie) }
    const avail = await contractOk(callApi(ROUTES.handleAvailable, { params: { handle: 'newbie_one' } }, as))
    if (avail !== 'stub') expect(avail.available).toBe(true)
    const me = await contractOk(callApi(ROUTES.updateMe, { body: { displayName: 'New Person', handle: 'newbie_one' } }, as))
    if (me !== 'stub') expect(me).toMatchObject({ handle: 'newbie_one', displayName: 'New Person', onboarded: true })
  })
})
