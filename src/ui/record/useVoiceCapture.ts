/**
 * Microphone + MediaRecorder + AnalyserNode level meter + Web Speech live transcript.
 * Everything is torn down on stop and on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { foldResults, getSpeechRecognition, hasMicrophoneApi, type SpeechRecognitionLike } from './speech'

export type CaptureStatus = 'idle' | 'requesting' | 'recording' | 'stopped'

export interface VoiceCapture {
  status: CaptureStatus
  micAvailable: boolean
  speechAvailable: boolean
  /** Human readable reason the mic could not be used (denied, missing...). */
  micError: string | null
  /** Speech recognition stopped working mid-session (e.g. network or permission). */
  speechError: string | null
  finalText: string
  interimText: string
  elapsed: number
  audioUrl: string | null
  /** Attach to an element; its `--level` CSS variable (0..1) and width follow the mic input. */
  meterRef: React.RefObject<HTMLDivElement | null>
  /** Start recording; `seed` is existing transcript text that new speech is appended to. */
  start(seed?: string): Promise<boolean>
  /** Stops and returns the transcript gathered so far. */
  stop(): string
}

function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.'
  return 'The microphone could not be started.'
}

export function useVoiceCapture(): VoiceCapture {
  const [micAvailable, setMicAvailable] = useState(hasMicrophoneApi)
  const [speechAvailable, setSpeechAvailable] = useState(() => getSpeechRecognition() !== null)
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [micError, setMicError] = useState<string | null>(null)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const [finalText, setFinalText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const meterRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recordingRef = useRef(false)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  const teardown = useCallback(() => {
    recordingRef.current = false
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      rec.onend = null
      rec.onresult = null
      rec.onerror = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') {
      try {
        mr.stop()
      } catch {
        /* ignore */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
    if (meterRef.current) meterRef.current.style.setProperty('--level', '0')
  }, [])

  useEffect(
    () => () => {
      teardown()
      if (audioUrlRef.current) URL.revokeObjectURL?.(audioUrlRef.current)
      audioUrlRef.current = null
    },
    [teardown],
  )

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined
    if (!Ctx || typeof requestAnimationFrame !== 'function') return
    try {
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      let smooth = 0
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        const level = Math.min(1, rms * 4)
        smooth = Math.max(level, smooth * 0.85)
        meterRef.current?.style.setProperty('--level', smooth.toFixed(3))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      /* the meter is decorative; recording still works */
    }
  }, [])

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) return
    let rec: SpeechRecognitionLike
    try {
      rec = new Ctor()
    } catch {
      setSpeechAvailable(false)
      return
    }
    rec.continuous = true
    rec.interimResults = true
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.onresult = (e) => {
      const { final, interim } = foldResults(finalRef.current, e)
      finalRef.current = final
      interimRef.current = interim
      setFinalText(final)
      setInterimText(interim)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setSpeechAvailable(false)
        setSpeechError('Speech recognition is blocked in this browser.')
      } else {
        setSpeechError(`Live transcript paused (${e.error}).`)
      }
    }
    // Browsers end "continuous" sessions after silence; keep it going while recording.
    rec.onend = () => {
      if (!recordingRef.current || recognitionRef.current !== rec) return
      if (interimRef.current) {
        finalRef.current = finalRef.current ? `${finalRef.current} ${interimRef.current}` : interimRef.current
        interimRef.current = ''
        setFinalText(finalRef.current)
        setInterimText('')
      }
      try {
        rec.start()
      } catch {
        /* give up quietly */
      }
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      setSpeechError('Live transcript could not start.')
    }
  }, [])

  const start = useCallback(async (seed = '') => {
    if (!hasMicrophoneApi()) {
      setMicAvailable(false)
      setMicError('This browser cannot record audio.')
      return false
    }
    setStatus('requesting')
    setMicError(null)
    setSpeechError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setMicAvailable(false)
      setMicError(micErrorMessage(err))
      setStatus('idle')
      return false
    }
    streamRef.current = stream
    chunksRef.current = []
    try {
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        if (chunksRef.current.length === 0) return
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        if (audioUrlRef.current) URL.revokeObjectURL?.(audioUrlRef.current)
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
        audioUrlRef.current = url
        setAudioUrl(url)
      }
      recorderRef.current = mr
      mr.start(1000)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setMicAvailable(false)
      setMicError('The recorder could not start in this browser.')
      setStatus('idle')
      return false
    }
    recordingRef.current = true
    // Continue an earlier take (or edited text) instead of wiping it.
    finalRef.current = seed.trim()
    interimRef.current = ''
    setFinalText(finalRef.current)
    setInterimText('')
    const t0 = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    startMeter(stream)
    startRecognition()
    setStatus('recording')
    return true
  }, [startMeter, startRecognition])

  const stop = useCallback(() => {
    const transcript = (interimRef.current ? `${finalRef.current} ${interimRef.current}` : finalRef.current).trim()
    finalRef.current = transcript
    interimRef.current = ''
    setFinalText(transcript)
    setInterimText('')
    teardown()
    setStatus('stopped')
    return transcript
  }, [teardown])

  return {
    status,
    micAvailable,
    speechAvailable,
    micError,
    speechError,
    finalText,
    interimText,
    elapsed,
    audioUrl,
    meterRef,
    start,
    stop,
  }
}
