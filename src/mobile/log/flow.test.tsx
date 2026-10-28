import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSummary, Me, VenueSummary, VisitDetail } from '../../contracts/models'
import { LogFlow } from './index'
import { listRecordings, resetQueueStoreForTests } from './queue'

const VENUE: VenueSummary = {
  id: 'ven_starlight', slug: 'starlight-escapes-san-francisco', name: 'Starlight Escapes', brand: null, address: '1420 Valencia St', city: 'San Francisco',
  citySlug: 'san-francisco-ca-us', region: 'CA', country: 'US', lat: null, lng: null, status: 'active', gameCount: 2,
}
const GAME: GameSummary = {
  id: 'gam_observatory', slug: 'the-lost-observatory-starlight-escapes-san-francisco', name: 'The Lost Observatory', genre: 'sci-fi', status: 'active',
  venueId: 'ven_starlight', venueName: 'Starlight Escapes', venueSlug: 'starlight-escapes-san-francisco', city: 'San Francisco', country: 'US', reviewCount: 0, avgOverall: null,
}
const ME: Me = { id: 'usr_alice', handle: 'alice', displayName: 'Alice', image: null, email: 'a@example.com', onboarded: true, isAdmin: false, createdAt: '2026-10-01T00:00:00Z' }

const rating = (score: number | null) => ({ score, comment: '' })
const DRAFT = {
  room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: '2026-10-12',
    crew: ['me', 'Mia', 'Leo'],
    ratings: { overall: rating(87), puzzles: rating(90), setting: rating(92), storyline: rating(null), difficulty: rating(70) },
    puzzles: [{ description: 'Star chart dome', type: 'lock-and-key', memorable: true }],
    escaped: true,
    escapeTimeMinutes: 48,
    visibleTimer: true,
    multiRoom: false,
    flashlights: false,
    liveActors: true,
    toolsUsed: ['UV light'],
    voiceTranscript: '',
  },
  flags: ['review.ratings.storyline.score'],
  mode: 'mock',
  hints: { venue: 'Starlight Escapes', game: 'The Lost Observatory', city: 'San Francisco', country: 'US' },
  notice: null,
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// --- browser media mocks -----------------------------------------------------
class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus'
  state = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm'
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array([7, 7, 7])], { type: this.mimeType }) })
    this.onstop?.()
  }
}
let recognition: { onresult: ((e: unknown) => void) | null } | null = null
let recognitionsCreated = 0
class FakeRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror = null
  onend = null
  constructor() {
    // The flow creates one per recording; the test drives the latest.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    recognition = this
    recognitionsCreated++
  }
  start() {}
  stop() {}
  abort() {}
}
function speak(text: string) {
  act(() => recognition?.onresult?.({ resultIndex: 0, results: { length: 1, 0: Object.assign([{ transcript: text }], { isFinal: true }) } }))
}

function server(opts: { transcribe: 'offline' | 'ok' | 'cap'; createStatus?: number }) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${(v as File).name} ${(v as File).type}>`])) : init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    if (url === '/api/transcribe') {
      if (opts.transcribe === 'offline') throw new TypeError('Failed to fetch')
      if (opts.transcribe === 'cap')
        return json({ error: 'cap', code: 'spending_cap', fallback: 'typing', cap: { kind: 'transcription', scope: 'user', unit: 'seconds', limit: 1200, used: 1200, resetsAt: '2026-10-27T00:00:00Z' } }, 429)
      return json({ transcript: 'Server transcript about The Lost Observatory.', durationSeconds: 4, mode: 'mock', clientId: (body as { clientId: string }).clientId, audioDeleted: true })
    }
    if (url === '/api/extract') return json(DRAFT)
    if (url === '/api/crew/suggestions') return json({ suggestions: [{ kind: 'friend', user: { id: 'usr_mia', handle: 'mia', displayName: 'Mia', image: null }, visitsTogether: 12 }] })
    if (url.startsWith('/api/directory/match')) return json({ venues: [{ venue: VENUE, score: 0.95 }], games: [{ game: GAME, score: 0.95 }] })
    if (url === '/api/visits' && method === 'POST') {
      if (opts.createStatus && opts.createStatus !== 201) return json({ error: 'Choose a public name first', code: 'onboarding_required' }, opts.createStatus)
      const b = body as { facts: VisitDetail['facts']; puzzles: { description: string; type: string }[] }
      const visit: VisitDetail = {
        id: 'vis_new', game: GAME, venue: VENUE, facts: b.facts, puzzles: b.puzzles.map((p, i) => ({ id: `pzl_${i}`, description: p.description, type: p.type as 'logic', notes: '', position: i })),
        participants: [], photos: [], reviews: [], createdBy: 'usr_alice', myStatus: 'owner', createdAt: 'x', updatedAt: 'x',
      }
      return json(visit, 201)
    }
    if (url === '/api/visits/vis_new/review' && method === 'PUT') return json({ error: 'later', code: 'not_implemented' }, 501)
    return json({ error: `unexpected ${method} ${url}`, code: 'not_found' }, 404)
  })
  return { fetch: fetchMock as unknown as typeof fetch, calls }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetQueueStoreForTests()
  recognition = null
  recognitionsCreated = 0
  localStorage.clear()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) } })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
})

/** `text`: speak it with live captions turned on (they are opt-in). */
async function recordAndStop(text: string) {
  if (text) await userEvent.click(screen.getByTestId('record-captions'))
  await userEvent.click(screen.getByTestId('record-start'))
  await screen.findByTestId('record-stop')
  if (text) {
    speak(text)
    expect(screen.getByTestId('record-live').textContent).toBe(text)
  }
  await userEvent.click(screen.getByTestId('record-stop'))
}

async function matchAndConfirm() {
  await userEvent.click(screen.getByTestId('transcript-submit'))
  await userEvent.click(await screen.findByTestId('match-game-gam_observatory'))
  expect((await screen.findByTestId('confirm-game')).textContent).toBe('The Lost Observatory')
}

describe('mobile log flow', () => {
  it("live captions are off by default, so the browser's speech service never gets the audio", async () => {
    const s = server({ transcribe: 'ok' })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    expect((screen.getByTestId('record-captions') as HTMLInputElement).checked).toBe(false)
    await userEvent.click(screen.getByTestId('record-start'))
    await screen.findByTestId('record-stop')
    expect(recognitionsCreated).toBe(0)
    await userEvent.click(screen.getByTestId('record-stop'))
    expect((await screen.findByTestId('transcript-input') as HTMLTextAreaElement).value).toBe('Server transcript about The Lost Observatory.')
    expect(recognitionsCreated).toBe(0)
    expect(s.calls.some((c) => c.url === '/api/transcribe')).toBe(true)
  })

  it('turning live captions on is remembered on this device', async () => {
    const s = server({ transcribe: 'ok' })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await userEvent.click(screen.getByTestId('record-captions'))
    cleanup()
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    expect((screen.getByTestId('record-captions') as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByTestId('record-start'))
    await screen.findByTestId('record-stop')
    expect(recognitionsCreated).toBe(1)
  })

  it('offline: keeps the recording on the phone, carries on with live captions, saves, then forgets the recording', async () => {
    const s = server({ transcribe: 'offline' })
    const onDone = vi.fn()
    render(<LogFlow onDone={onDone} me={ME} fetch={s.fetch} />)
    await recordAndStop('We did the lost observatory')

    const note = await screen.findByTestId('upload-note')
    expect(note.textContent).toContain('1 recording waiting to upload')
    expect((screen.getByTestId('transcript-input') as HTMLTextAreaElement).value).toBe('We did the lost observatory')
    const queued = await listRecordings(ME.id)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ status: 'pending', mimeType: 'audio/webm', liveTranscript: 'We did the lost observatory' })
    expect(queued[0].audio?.byteLength).toBe(3)

    await matchAndConfirm()
    // The extractor wasn't sure about storyline: flagged, and saving is blocked until it's set.
    await userEvent.click(screen.getByTestId('confirm-save'))
    expect(screen.getByText('Set a storyline score')).toBeTruthy()
    await userEvent.type(screen.getByTestId('confirm-score-storyline'), '78')
    // Mia (a friend) is tagged from the draft's crew; Leo becomes a guest.
    expect(screen.getByTestId('crew-friend-usr_mia').getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByTestId('confirm-save'))

    expect(await screen.findByTestId('log-done')).toBeTruthy()
    const create = s.calls.find((c) => c.url === '/api/visits')!
    expect(create.body).toMatchObject({
      gameId: 'gam_observatory',
      facts: { date: '2026-10-12', escaped: true, escapeTimeMinutes: 48 },
      crew: [{ userId: 'usr_mia' }, { guestName: 'Leo' }],
      review: { visibility: 'public', transcript: 'We did the lost observatory', ratings: { storyline: { score: 78, comment: '' } } },
    })
    // Memorable puzzles are attached once their ids exist.
    expect(s.calls.find((c) => c.url === '/api/visits/vis_new/review')?.body).toMatchObject({ memorablePuzzleIds: ['pzl_0'] })
    expect(await listRecordings(ME.id)).toEqual([])
    expect(screen.getByTestId('log-done-public').getAttribute('href')).toBe(`/games/${GAME.slug}`)
    // The keys this room earned, and the way to the wardrobe.
    expect(screen.getByTestId('log-done-keys').textContent).toContain('+10 keys')
    expect(screen.getByTestId('log-done-wardrobe')).toBeTruthy()
    await userEvent.click(screen.getByTestId('log-done-home'))
    expect(onDone).toHaveBeenCalledWith('vis_new')
  })

  it('online: uploads, uses the server transcript and deletes the audio right away', async () => {
    const s = server({ transcribe: 'ok' })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await recordAndStop('live preview')
    await waitFor(() => expect((screen.getByTestId('transcript-input') as HTMLTextAreaElement).value).toBe('Server transcript about The Lost Observatory.'))
    expect(screen.queryByTestId('upload-note')).toBeNull()
    const up = s.calls.find((c) => c.url === '/api/transcribe')!.body as Record<string, string>
    expect(up.clientId).toMatch(/^rec_/)
    expect(up.audio).toMatch(/^<file rec_.*\.webm audio\/webm>$/)
    expect(Number(up.durationSeconds)).toBeGreaterThanOrEqual(0)
    const [item] = await listRecordings(ME.id)
    expect(item).toMatchObject({ status: 'transcribed', audio: null, transcript: 'Server transcript about The Lost Observatory.' })
  })

  it('spending cap: explains, keeps the recording for tomorrow and lets you type', async () => {
    const s = server({ transcribe: 'cap' })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await recordAndStop('')
    expect((await screen.findByTestId('upload-note')).textContent).toMatch(/allowance is used up/)
    expect((await listRecordings(ME.id))[0].status).toBe('pending')
  })

  it('a save the server refuses keeps everything on screen with a clear message', async () => {
    const s = server({ transcribe: 'ok', createStatus: 403 })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    await userEvent.click(screen.getByTestId('record-sample'))
    await matchAndConfirm()
    await userEvent.type(screen.getByTestId('confirm-score-storyline'), '60')
    await userEvent.click(screen.getByTestId('confirm-save'))
    expect((await screen.findByTestId('confirm-save-error')).textContent).toMatch(/display name and @handle/)
    expect(screen.getByTestId('log-confirm')).toBeTruthy()
  })

  it('a save blocked by a missing field scrolls to that field and focuses it', async () => {
    const scrolled: Element[] = []
    // jsdom has no scrollIntoView.
    const proto = Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const s = server({ transcribe: 'ok' })
      render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
      await userEvent.click(screen.getByTestId('record-sample'))
      await matchAndConfirm()
      // The draft has no storyline score: saving is blocked.
      await userEvent.click(screen.getByTestId('confirm-save'))
      const storyline = screen.getByTestId('confirm-score-storyline')
      await waitFor(() => expect(document.activeElement).toBe(storyline))
      expect(scrolled.some((el) => el.contains(storyline))).toBe(true)
      expect(s.calls.some((c) => c.url === '/api/visits')).toBe(false)
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('a puzzle without a type focuses and highlights its type select, not the description', async () => {
    const proto = Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function () {}
    try {
      const s = server({ transcribe: 'ok' })
      render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
      await userEvent.click(screen.getByTestId('record-sample'))
      await matchAndConfirm()
      for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
        const el = screen.getByTestId(`confirm-score-${k}`) as HTMLInputElement
        if (el.value === '') await userEvent.type(el, '80')
      }
      await userEvent.click(screen.getByTestId('confirm-add-puzzle'))
      const n = document.querySelectorAll('[data-testid^="confirm-puzzle-type-"]').length - 1
      await userEvent.type(screen.getByTestId(`confirm-puzzle-${n}`), 'The laser hallway')
      await userEvent.click(screen.getByTestId('confirm-save'))
      const select = screen.getByTestId(`confirm-puzzle-type-${n}`)
      await waitFor(() => expect(document.activeElement).toBe(select))
      expect(select.getAttribute('aria-invalid')).toBe('true')
      expect(select.className).toContain('border-bad')
      expect(s.calls.some((c) => c.url === '/api/visits')).toBe(false)
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('without a microphone you can type, and "fill it in by hand" skips extraction', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const s = server({ transcribe: 'ok' })
    render(<LogFlow onDone={vi.fn()} me={ME} fetch={s.fetch} />)
    expect(screen.queryByTestId('record-start')).toBeNull()
    await userEvent.click(screen.getByTestId('record-type-instead'))
    await userEvent.type(screen.getByTestId('transcript-input'), 'Typed notes')
    await userEvent.click(screen.getByTestId('draft-by-hand'))
    expect(await screen.findByTestId('venue-game-matcher')).toBeTruthy()
    expect(s.calls.some((c) => c.url === '/api/extract')).toBe(false)
  })
})
