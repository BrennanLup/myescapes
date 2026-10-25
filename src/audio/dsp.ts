/**
 * Pure DSP helpers (no AudioContext), unit-tested.
 */

/** Master gain for the store's volume (0..1) and muted flag. Squared for a perceptual curve. */
export function masterLevel(volume: number, muted: boolean): number {
  if (muted || !Number.isFinite(volume)) return 0
  const v = Math.min(1, Math.max(0, volume))
  return v * v
}

/** A small deterministic PRNG (mulberry32) so generated buffers are stable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Karplus-Strong plucked string. Returns mono samples in [-1, 1].
 * `damping` close to 1 rings longer; `brightness` (0..1) mixes in less averaging.
 */
export function karplusStrong(
  sampleRate: number,
  freq: number,
  durationS: number,
  { damping = 0.996, brightness = 0.35, rand = seededRandom(7) }: { damping?: number; brightness?: number; rand?: () => number } = {},
): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * durationS))
  const period = Math.max(2, Math.round(sampleRate / freq))
  const ring = new Float32Array(period)
  for (let i = 0; i < period; i++) ring[i] = rand() * 2 - 1
  const out = new Float32Array(n)
  let idx = 0
  for (let i = 0; i < n; i++) {
    const cur = ring[idx]
    const next = ring[(idx + 1) % period]
    out[i] = cur
    const avg = 0.5 * (cur + next)
    ring[idx] = damping * (brightness * cur + (1 - brightness) * avg)
    idx = (idx + 1) % period
  }
  // Soft fade-out over the last 30 ms so the buffer never clicks.
  const fade = Math.min(n, Math.floor(sampleRate * 0.03))
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade
  return out
}

/** White-ish noise. */
export function noiseSamples(length: number, rand: () => number = seededRandom(1)): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1
  return out
}

/**
 * Vinyl crackle: mostly silence with sparse tiny pops, designed to loop.
 * `density` = pops per second.
 */
export function crackleSamples(sampleRate: number, durationS: number, density = 9, rand: () => number = seededRandom(3)): Float32Array {
  const n = Math.floor(sampleRate * durationS)
  const out = new Float32Array(n)
  const pops = Math.round(density * durationS)
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(rand() * (n - 64))
    const amp = 0.25 + rand() * 0.75
    const len = 4 + Math.floor(rand() * 28)
    for (let i = 0; i < len; i++) out[at + i] += amp * (rand() * 2 - 1) * (1 - i / len)
  }
  return out
}

/** Equal-tempered frequency of a MIDI note. */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** The slow lo-fi chord loop (MIDI notes): Fmaj9, Em7, Dm9, Cmaj7(add 9). */
export const PAD_CHORDS: readonly (readonly number[])[] = [
  [53, 57, 60, 64, 67],
  [52, 55, 59, 62],
  [50, 57, 60, 64],
  [48, 55, 59, 62, 64],
]
