/**
 * Phone recorder for the log flow: MediaRecorder audio (the thing we upload) plus the browser's
 * live captions as a preview and fallback. Unlike the Phase 1 overlay's hook this hands back the
 * recorded Blob so it can be queued in IndexedDB and uploaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { foldResults, getSpeechRecognition, hasMicrophoneApi, joinSentence, type SpeechRecognitionLike } from '../../ui/record/speech'

export type RecorderStatus = 'idle' | 'requesting' | 'recording'

export interface Recording {
  blob: Blob
  mimeType: string
  durationSeconds: number
  liveTranscript: string
}

/** Preferred containers, best first. iPhones record audio/mp4; Chrome and Firefox webm/ogg with Opus. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

/** Requested recorder bitrate (speech). */
export const VOICE_BITS_PER_SECOND = 20_000

export function pickMimeType(isSupported: ((t: string) => boolean) | undefined): string | undefined {
  if (!isSupported) return undefined
  for (const t of MIME_CANDIDATES) {
    try {
      if (isSupported(t)) return t
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. You can type your notes instead.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. You can type your notes instead.'
  return 'The microphone could not be started. You can type your notes instead.'
}

export interface PhoneRecorder {
  status: RecorderStatus
  supported: boolean
  error: string | null
  elapsed: number
  liveText: string
  start(): Promise<boolean>
  /** Stop and hand back the recording (null if nothing was captured). */
  stop(): Promise<Recording | null>
  /** Throw the take away. */
  cancel(): void
}

export function usePhoneRecorder(): PhoneRecorder {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [liveText, setLiveText] = useState('')
  const supported = hasMicrophoneApi()

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const recording = useRef(false)
  const finalText = useRef('')
  const interimText = useRef('')
  const t0 = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopRecognition = useCallback(() => {
    const rec = recognition.current
    recognition.current = null
    if (!rec) return
    rec.onend = null
    rec.onresult = null
    rec.onerror = null
    try {
      rec.stop()
    } catch {
      /* already stopped */
    }
  }, [])

  const teardown = useCallback(() => {
    recording.current = false
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stopRecognition()
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [stopRecognition])

  useEffect(
    () => () => {
      const mr = recorder.current
      recorder.current = null
      if (mr && mr.state !== 'inactive') {
        mr.ondataavailable = null
        mr.onstop = null
        try {
          mr.stop()
        } catch {
          /* ignore */
        }
      }
      teardown()
    },
    [teardown],
  )

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) return
    let rec: SpeechRecognitionLike
    try {
      rec = new Ctor()
    } catch {
      return
    }
    rec.continuous = true
    rec.interimResults = true
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.onresult = (e) => {
      const { final, interim } = foldResults(finalText.current, e)
      finalText.current = final
      interimText.current = interim
      setLiveText(joinSentence(final, interim))
    }
    rec.onerror = () => {
      /* captions are only a preview; the recording carries on */
    }
    rec.onend = () => {
      if (!recording.current || recognition.current !== rec) return
      finalText.current = joinSentence(finalText.current, interimText.current)
      interimText.current = ''
      try {
        rec.start()
      } catch {
        /* give up quietly */
      }
    }
    recognition.current = rec
    try {
      rec.start()
    } catch {
      /* no captions */
    }
  }, [])

  const start = useCallback(async () => {
    if (!hasMicrophoneApi()) {
      setError('This browser cannot record audio. You can type your notes instead.')
      return false
    }
    setError(null)
    setStatus('requesting')
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setError(micErrorMessage(err))
      setStatus('idle')
      return false
    }
    stream.current = s
    chunks.current = []
    try {
      const MR = window.MediaRecorder
      const mimeType = pickMimeType(MR.isTypeSupported?.bind(MR))
      // Speech needs little: a low bitrate keeps uploads small on basement signal, and keeps the
      // file under the server's size floor for counting seconds (3 kB/s, server/routes/transcribe.ts).
      const mr = new MR(s, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: VOICE_BITS_PER_SECOND })
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data)
      }
      recorder.current = mr
      mr.start(1000)
    } catch {
      s.getTracks().forEach((t) => t.stop())
      stream.current = null
      setError('The recorder could not start in this browser. You can type your notes instead.')
      setStatus('idle')
      return false
    }
    recording.current = true
    finalText.current = ''
    interimText.current = ''
    setLiveText('')
    t0.current = Date.now()
    setElapsed(0)
    timer.current = setInterval(() => setElapsed((Date.now() - t0.current) / 1000), 250)
    startRecognition()
    setStatus('recording')
    return true
  }, [startRecognition])

  const stop = useCallback(async (): Promise<Recording | null> => {
    const mr = recorder.current
    const durationSeconds = (Date.now() - t0.current) / 1000
    const liveTranscript = joinSentence(finalText.current, interimText.current).trim()
    recorder.current = null
    const done = new Promise<void>((resolve) => {
      if (!mr || mr.state === 'inactive') return resolve()
      mr.onstop = () => resolve()
      try {
        mr.stop()
      } catch {
        resolve()
      }
    })
    await done
    teardown()
    setStatus('idle')
    setLiveText(liveTranscript)
    if (chunks.current.length === 0) return null
    const mimeType = (mr?.mimeType || chunks.current[0]?.type || 'audio/webm').split(';')[0]
    const blob = new Blob(chunks.current, { type: mimeType })
    chunks.current = []
    return { blob, mimeType, durationSeconds, liveTranscript }
  }, [teardown])

  const cancel = useCallback(() => {
    const mr = recorder.current
    recorder.current = null
    if (mr && mr.state !== 'inactive') {
      mr.ondataavailable = null
      try {
        mr.stop()
      } catch {
        /* ignore */
      }
    }
    chunks.current = []
    teardown()
    setStatus('idle')
    setLiveText('')
  }, [teardown])

  return { status, supported, error, elapsed, liveText, start, stop, cancel }
}
