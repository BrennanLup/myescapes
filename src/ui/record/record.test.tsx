import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bus } from '@/contracts/events'
import { apiClient } from '@/contracts/api'
import type { ReviewDraft } from '@/contracts/types'
import { RecordOverlay, SAMPLE_TRANSCRIPT } from './index'
import { RECORD_PROMPTS, formatElapsed, nextPromptIndex } from './prompts'
import { foldResults, type SpeechRecognitionEventLike } from './speech'

// --- browser API mocks -------------------------------------------------------

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

class FakeRecognition {
  static last: FakeRecognition | null = null
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: SpeechRecognitionEventLike) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    this.started = true
  }
  stop() {
    this.started = false
  }
  abort() {
    this.started = false
  }
  emit(items: Array<[string, boolean]>, resultIndex = 0) {
    const results = items.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }))
    this.onresult?.({ resultIndex, results } as unknown as SpeechRecognitionEventLike)
  }
}

const stopTrack = vi.fn()
const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream

function installMic(opts: { deny?: boolean } = {}) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        opts.deny ? Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) : Promise.resolve(fakeStream),
      ),
    },
  })
  ;(window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder
}

function removeMic() {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
}

function installSpeech() {
  ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition
}
function removeSpeech() {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
}

const fakeDraft = {
  room: { name: 'The Lost Observatory', company: 'Starlight Escapes', city: 'San Francisco', genre: 'sci-fi', address: null, website: null },
  review: {
    date: null,
    crew: [],
    ratings: {
      overall: { score: 87, comment: '' },
      puzzles: { score: null, comment: '' },
      setting: { score: null, comment: '' },
      storyline: { score: null, comment: '' },
      difficulty: { score: null, comment: '' },
    },
    puzzles: [],
    escaped: true,
    escapeTimeMinutes: 48,
    visibleTimer: true,
    multiRoom: false,
    flashlights: false,
    liveActors: true,
    toolsUsed: [],
    voiceTranscript: SAMPLE_TRANSCRIPT,
  },
  flags: [],
  mode: 'mock',
} as unknown as ReviewDraft

beforeEach(() => {
  FakeMediaRecorder.instances = []
  FakeRecognition.last = null
  stopTrack.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  removeMic()
  removeSpeech()
})

// --- pure helpers ------------------------------------------------------------

describe('prompt helpers', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(75.9)).toBe('01:15')
  })
  it('highlights the next unticked prompt over time', () => {
    expect(nextPromptIndex(0, new Set())).toBe(0)
    expect(nextPromptIndex(85, new Set())).toBe(2)
    expect(nextPromptIndex(85, new Set(['setting']))).toBe(3)
    expect(nextPromptIndex(999, new Set(['tools']))).toBe(0)
    expect(nextPromptIndex(0, new Set(RECORD_PROMPTS.map((p) => p.id)))).toBe(-1)
  })
  it('folds interim and final speech results', () => {
    const ev = {
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'hello there' }], { isFinal: true }), Object.assign([{ transcript: ' gene' }], { isFinal: false })],
    } as unknown as SpeechRecognitionEventLike
    expect(foldResults('we did', ev)).toEqual({ final: 'we did hello there', interim: 'gene' })
  })
  it('sample transcript covers every prompt', () => {
    for (const needle of ['The Lost Observatory', 'Starlight Escapes', 'San Francisco', 'sci-fi', '87 out of 100', '48 minutes', 'visible timer', 'flashlights', 'live actor', 'UV light', 'magnets', 'writing board', 'lock and key', 'logic', 'math', 'search', 'Storyline', 'setting']) {
      expect(SAMPLE_TRANSCRIPT.toLowerCase()).toContain(needle.toLowerCase())
    }
  })
})

// --- component ---------------------------------------------------------------

describe('RecordOverlay', () => {
  it('renders all prompts', () => {
    render(<RecordOverlay />)
    for (const p of RECORD_PROMPTS) expect(screen.getByText(p.title)).toBeTruthy()
    expect(screen.getByText('Tools and features')).toBeTruthy()
  })

  it('shows the type/paste fallback when mic and speech recognition are unavailable', () => {
    removeMic()
    removeSpeech()
    render(<RecordOverlay />)
    expect(screen.getByTestId('transcript-input')).toBeTruthy()
    expect(screen.getByTestId('record-fallback').textContent).toMatch(/speech recognition/i)
    expect(screen.queryByTestId('record-toggle')).toBeNull()
    expect(screen.getByText('Upload a .txt transcript')).toBeTruthy()
  })

  it('switches to the fallback when the microphone is denied', async () => {
    installMic({ deny: true })
    installSpeech()
    render(<RecordOverlay />)
    expect(screen.queryByTestId('record-fallback')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-toggle'))
    })
    expect(screen.getByText(/permission was denied/i)).toBeTruthy()
    expect(screen.getByTestId('record-fallback')).toBeTruthy()
    expect(screen.getByTestId('transcript-input')).toBeTruthy()
  })

  it('sample button fills the transcript', () => {
    render(<RecordOverlay />)
    fireEvent.click(screen.getByTestId('sample-transcript'))
    expect((screen.getByTestId('transcript-input') as HTMLTextAreaElement).value).toBe(SAMPLE_TRANSCRIPT)
  })

  it('submit calls extract and emits draft:ready', async () => {
    const extract = vi.spyOn(apiClient, 'extract').mockResolvedValue(fakeDraft)
    const onReady = vi.fn()
    const off = bus.on('draft:ready', onReady)
    render(<RecordOverlay />)
    fireEvent.click(screen.getByTestId('sample-transcript'))
    fireEvent.click(screen.getByTestId('extract-submit'))
    expect(screen.getByText('Reading your notes...')).toBeTruthy()
    await waitFor(() => expect(onReady).toHaveBeenCalledWith({ draft: fakeDraft }))
    expect(extract).toHaveBeenCalledWith(SAMPLE_TRANSCRIPT.trim())
    off()
  })

  it('shows extraction errors inline and retries', async () => {
    const extract = vi.spyOn(apiClient, 'extract').mockRejectedValueOnce(new Error('server down')).mockResolvedValueOnce(fakeDraft)
    const onReady = vi.fn()
    const off = bus.on('draft:ready', onReady)
    render(<RecordOverlay />)
    fireEvent.change(screen.getByTestId('transcript-input'), { target: { value: 'We did a room.' } })
    fireEvent.click(screen.getByTestId('extract-submit'))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('server down')
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(onReady).toHaveBeenCalled())
    expect(extract).toHaveBeenCalledTimes(2)
    off()
  })

  it('submit is disabled with an empty transcript', () => {
    render(<RecordOverlay />)
    expect((screen.getByTestId('extract-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it("tells you before recording that the browser's speech recognition may process your voice", () => {
    installMic()
    installSpeech()
    render(<RecordOverlay />)
    expect(screen.getByTestId('speech-notice').textContent).toMatch(/browser's speech recognition \(Google in Chrome, Apple in Safari/)
  })

  it('records with live transcript, emits start/stop and stops tracks', async () => {
    installMic()
    installSpeech()
    const events: string[] = []
    const offAny = bus.onAny((e) => events.push(e.type))
    const onStop = vi.fn()
    const offStop = bus.on('record:stop', onStop)
    render(<RecordOverlay />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-toggle'))
    })
    expect(events).toContain('record:start')
    expect(FakeRecognition.last?.continuous).toBe(true)
    expect(FakeRecognition.last?.interimResults).toBe(true)
    expect(screen.getByText('now')).toBeTruthy()
    act(() => FakeRecognition.last!.emit([['We did the lost observatory', true], [' in San', false]]))
    expect(screen.getByTestId('record-live').textContent).toContain('We did the lost observatory')
    expect(screen.getByTestId('record-live').textContent).toContain('in San')
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-toggle'))
    })
    expect(onStop).toHaveBeenCalledWith({ transcript: 'We did the lost observatory in San' })
    expect(stopTrack).toHaveBeenCalled()
    expect((screen.getByTestId('transcript-input') as HTMLTextAreaElement).value).toBe('We did the lost observatory in San')
    offAny()
    offStop()
  })

  it('stops tracks on unmount', async () => {
    installMic()
    installSpeech()
    const { unmount } = render(<RecordOverlay />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-toggle'))
    })
    unmount()
    expect(stopTrack).toHaveBeenCalled()
    expect(FakeRecognition.last?.started).toBe(false)
  })

  it('Esc closes directly when empty, and confirms first when a transcript exists', () => {
    const onClose = vi.fn()
    const off = bus.on('overlay:close', onClose)
    const { unmount } = render(<RecordOverlay />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    render(<RecordOverlay />)
    fireEvent.click(screen.getByTestId('sample-transcript'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Throw away these notes?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('record-discard'))
    expect(onClose).toHaveBeenCalledTimes(2)
    off()
  })
})
