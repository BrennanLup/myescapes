import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyResult, DailyToday, LeaderboardEntry, Streak } from '../../contracts/models'
import { useGateSession } from '../../gate/session'
import { useStore } from '../../state/store'
import { generateDaily, type DailyChallenge } from '../engine'
import { DailyCard, DailyPage } from './index'
import { DailyOverlay } from './overlay'
import { storageKey } from './state'

const PUZZLE = { day: '2026-10-27', number: 2, kind: 'combination' as const, seed: 'ui-test-seed', maxGuesses: 6, theme: { gameName: 'The Lost Observatory', venueName: 'Starlight Escapes', city: 'San Francisco', gameSlug: 'the-lost-observatory' } }
const challenge = generateDaily(PUZZLE) as DailyChallenge
const EMPTY_STREAK: Streak = { current: 0, best: 0, played: 0, solved: 0, lastSolvedDay: null, bestTimeMs: null }

function todayBody(over: Partial<DailyToday> = {}): DailyToday {
  return { serverDay: PUZZLE.day, timeZone: 'UTC', puzzle: PUZZLE, result: null, streak: null, nextAt: '2026-10-28T00:00:00.000Z', ...over }
}
function startedResult(over: Partial<DailyResult> = {}): DailyResult {
  return { day: PUZZLE.day, number: 2, solved: false, guesses: 0, hintsUsed: 0, timeMs: 0, grid: [], score: 0, timeZone: 'UTC', startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: null, ...over }
}

type Handler = (body: unknown) => { status?: number; json: unknown }
let routes: Record<string, Handler>
let calls: Array<{ method: string; path: string; body: unknown }>

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/daily')
  calls = []
  routes = {}
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = String(url).split('?')[0]
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: String(url), body })
    const h = routes[`${method} ${path}`]
    if (!h) return new Response(JSON.stringify({ error: 'nope', code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    const r = h(body)
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function wrongGuess(): string {
  // Same length, different digits from the answer in every place.
  return challenge.answer.map((d) => String((Number(d) + 1) % 10)).join('')
}

async function type(value: string) {
  fireEvent.change(screen.getByTestId('daily-input'), { target: { value } })
  fireEvent.click(screen.getByTestId('daily-submit'))
}

describe('DailyPage, signed out', () => {
  it('plays to a solve locally: marks, hint, share grid, sign-in nudge, nothing posted', async () => {
    routes['GET /api/daily/today'] = () => ({ json: todayBody() })
    render(<DailyPage />)
    await screen.findByTestId('daily-start')
    expect(screen.getByTestId('daily-number').textContent).toBe('Escape #2')
    expect(screen.getByTestId('daily-theme').textContent).toContain('The Lost Observatory')
    expect(calls[0].path).toMatch(/^\/api\/daily\/today\?tz=/)
    // The start screen explains the rules, then they make way for the game.
    const rules = screen.getByRole('region', { name: 'How it works' })
    expect(rules.textContent).toContain('You get 6 guesses')
    expect(rules.textContent).toContain('scores 1,000')

    fireEvent.click(screen.getByTestId('daily-start'))
    expect(screen.queryByTestId('daily-rules')).toBeNull()
    expect(screen.getByTestId('daily-game').dataset.status).toBe('playing')
    await type(wrongGuess())
    const row = screen.getByTestId('daily-row-0')
    expect([...row.querySelectorAll('[data-mark]')].map((c) => c.getAttribute('data-mark'))).toEqual(challenge.check(wrongGuess().split('')))
    fireEvent.click(screen.getByTestId('daily-hint'))
    expect(screen.getByTestId('daily-hints').textContent).toContain(challenge.hints[0])
    await type(challenge.answer.join(''))

    await screen.findByTestId('daily-finished')
    expect(screen.getByTestId('daily-outcome').textContent).toBe('Escaped in 2/6')
    const share = screen.getByTestId('daily-share-text').textContent ?? ''
    expect(share).toMatch(/^My Escapes · Escape #2 🔓 2\/6 · \d:\d\d · 1 hint\n/)
    expect(share).toContain('💡')
    expect(share).not.toContain(challenge.answer.join(''))
    expect(share).not.toContain('Observatory')
    expect(screen.getByTestId('daily-signin-nudge')).toBeTruthy()
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
    // Progress is kept for a reload.
    expect(JSON.parse(window.localStorage.getItem(storageKey(PUZZLE.day)) ?? '{}').status).toBe('solved')
  })

  it('copies the share text to the clipboard', async () => {
    routes['GET /api/daily/today'] = () => ({ json: todayBody() })
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<DailyPage />)
    fireEvent.click(await screen.findByTestId('daily-start'))
    await type(challenge.answer.join(''))
    fireEvent.click(await screen.findByTestId('daily-share'))
    await screen.findByText(/Copied!/)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('🟩'))
  })

  it('shows a retry when today cannot load', async () => {
    routes['GET /api/daily/today'] = () => ({ status: 503, json: { error: 'The database is not available right now.', code: 'db_unavailable' } })
    render(<DailyPage />)
    expect((await screen.findByTestId('daily-error')).textContent).toContain('not available')
    routes['GET /api/daily/today'] = () => ({ json: todayBody() })
    fireEvent.click(screen.getByText('Try again'))
    await screen.findByTestId('daily-start')
  })
})

describe('DailyPage, signed in', () => {
  it('starts on the server, posts the result, then shows the streak and the friends leaderboard', async () => {
    let started = false
    routes['GET /api/daily/today'] = () => ({ json: todayBody({ streak: EMPTY_STREAK }) })
    routes['POST /api/daily/start'] = (body) => {
      started = true
      expect(body).toEqual({ tz: expect.any(String) })
      return { json: todayBody({ streak: EMPTY_STREAK, result: startedResult() }) }
    }
    const streak: Streak = { current: 4, best: 9, played: 12, solved: 11, lastSolvedDay: PUZZLE.day, bestTimeMs: 42_000 }
    routes['POST /api/daily/results'] = (body) => {
      const b = body as { solved: boolean; guesses: number; grid: unknown[] }
      return { json: { result: { ...startedResult(), ...b, score: 1000, finishedAt: new Date().toISOString() }, streak } }
    }
    const entries: LeaderboardEntry[] = [
      { user: { id: 'u1', handle: 'mia', displayName: 'Mia', image: null }, solved: true, guesses: 1, timeMs: 30_000, score: 1000 },
      { user: { id: 'u2', handle: 'me', displayName: 'Me', image: null }, solved: true, guesses: 1, timeMs: 40_000, score: 990 },
    ]
    routes['GET /api/daily/leaderboard'] = () => ({ json: { day: PUZZLE.day, entries } })

    render(<DailyPage />)
    fireEvent.click(await screen.findByTestId('daily-start'))
    await waitFor(() => expect(started).toBe(true))
    await type(challenge.answer.join(''))

    const stats = await screen.findByTestId('daily-streak')
    expect(stats.textContent).toContain('4')
    expect(stats.textContent).toContain('92%')
    const submit = calls.find((c) => c.path === '/api/daily/results')!
    expect(submit.body).toMatchObject({ day: PUZZLE.day, number: 2, solved: true, guesses: 1, hintsUsed: 0, grid: [challenge.answer.map(() => 'hit')] })
    const rows = await screen.findAllByTestId('daily-leaderboard-row')
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Mia'), expect.stringContaining('Me')])
    expect(calls.find((c) => c.path.startsWith('/api/daily/leaderboard'))!.path).toBe(`/api/daily/leaderboard?day=${PUZZLE.day}`)
    expect(screen.queryByTestId('daily-signin-nudge')).toBeNull()
  })

  it('shows a result already finished on another device straight away, without posting', async () => {
    const result = startedResult({ solved: true, guesses: 2, timeMs: 95_000, grid: [challenge.answer.map(() => 'miss'), challenge.answer.map(() => 'hit')], score: 785, finishedAt: new Date().toISOString() })
    routes['GET /api/daily/today'] = () => ({ json: todayBody({ streak: { ...EMPTY_STREAK, current: 1, best: 1, played: 1, solved: 1 }, result }) })
    routes['GET /api/daily/leaderboard'] = () => ({ json: { day: PUZZLE.day, entries: [] } })
    render(<DailyPage />)
    expect((await screen.findByTestId('daily-outcome')).textContent).toBe('Escaped in 2/6')
    expect(screen.getByTestId('daily-share-text').textContent).toContain('1:35')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('keeps the result and offers a retry when saving fails', async () => {
    routes['GET /api/daily/today'] = () => ({ json: todayBody({ streak: EMPTY_STREAK, result: startedResult() }) })
    routes['POST /api/daily/results'] = () => ({ status: 503, json: { error: 'The database is not available right now.', code: 'db_unavailable' } })
    routes['GET /api/daily/leaderboard'] = () => ({ json: { day: PUZZLE.day, entries: [] } })
    render(<DailyPage />)
    fireEvent.click(await screen.findByTestId('daily-start'))
    await type(challenge.answer.join(''))
    expect((await screen.findByTestId('daily-save-error')).textContent).toContain('not available')
    routes['POST /api/daily/results'] = (body) => ({ json: { result: { ...startedResult(), ...(body as object), score: 1000, finishedAt: new Date().toISOString() }, streak: { ...EMPTY_STREAK, current: 1 } } })
    fireEvent.click(screen.getByText('Retry'))
    await screen.findByTestId('daily-streak')
    expect(screen.queryByTestId('daily-save-error')).toBeNull()
  })
})

describe('DailyCard', () => {
  it('links to /daily and summarises today', async () => {
    routes['GET /api/daily/today'] = () => ({ json: todayBody({ streak: { ...EMPTY_STREAK, current: 3 } }) })
    render(<DailyCard />)
    const card = screen.getByTestId('daily-card')
    expect(card.getAttribute('href')).toBe('/daily')
    await waitFor(() => expect(screen.getByTestId('daily-card-line').textContent).toContain('The Lost Observatory'))
    expect(card.textContent).toContain('#2')
    expect(card.textContent).toContain('🔥 3')
  })

  it('still links to /daily when loading fails', async () => {
    routes['GET /api/daily/today'] = () => ({ status: 500, json: { error: 'x', code: 'internal' } })
    render(<DailyCard />)
    expect(screen.getByTestId('daily-card').getAttribute('href')).toBe('/daily')
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.getByTestId('daily-card-line').textContent).toContain('A new puzzle every day')
  })
})

describe('DailyOverlay (3D room door)', () => {
  it('never blocks: Esc closes it before playing; a solve swings the door open', async () => {
    routes['GET /api/daily/today'] = () => ({ json: todayBody() })
    useGateSession.setState({ solvedToday: false })
    act(() => useStore.getState().openOverlay({ kind: 'gate' }))
    render(<DailyOverlay />)
    await screen.findByTestId('daily-start')
    // The compact door overlay skips the page's "How it works" rules.
    expect(screen.queryByTestId('daily-rules')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useStore.getState().overlay).toBeNull()

    act(() => useStore.getState().openOverlay({ kind: 'gate' }))
    fireEvent.click(screen.getByTestId('daily-start'))
    await type(challenge.answer.join(''))
    await screen.findByTestId('daily-finished')
    expect(useGateSession.getState().solvedToday).toBe(true)
    fireEvent.click(screen.getByTestId('daily-close'))
    expect(useStore.getState().overlay).toBeNull()
  })
})
