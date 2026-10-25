/**
 * Minimal Web Speech API typings (not in lib.dom) and feature detection helpers.
 */

export interface SpeechRecognitionAlternativeLike {
  transcript: string
}
export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
export interface SpeechRecognitionResultListLike {
  readonly length: number
  [index: number]: SpeechRecognitionResultLike
}
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}
export interface SpeechRecognitionErrorEventLike {
  readonly error: string
}
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function hasMicrophoneApi(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'function'
  )
}

/**
 * Fold a recognition result event into the running final text, returning the
 * new final text and the current interim (not yet final) text.
 */
export function foldResults(finalSoFar: string, e: SpeechRecognitionEventLike): { final: string; interim: string } {
  let final = finalSoFar
  let interim = ''
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i]
    const text = r[0]?.transcript ?? ''
    if (r.isFinal) final = joinSentence(final, text)
    else interim += text
  }
  return { final, interim: interim.trim() }
}

export function joinSentence(a: string, b: string): string {
  const t = b.trim()
  if (!t) return a
  if (!a.trim()) return t
  return `${a.trimEnd()} ${t}`
}
