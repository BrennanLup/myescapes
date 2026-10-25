/**
 * Web Audio synth engine: ambient lo-fi pad + rain/crackle bed, and one-shot cues.
 * Everything is synthesized; no audio files. Safe to construct anywhere: when
 * there is no AudioContext (jsdom, old browsers) every method is a no-op.
 */
import type { CueName } from './cues'
import { PAD_CHORDS, crackleSamples, karplusStrong, masterLevel, midiToHz, noiseSamples, seededRandom } from './dsp'
import { stepPitch } from './footsteps'

type Ctor = typeof AudioContext

export function getAudioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

const CHORD_S = 9
const PAD_ATTACK_S = 3.5
const PAD_RELEASE_S = 4.5
const AMBIENT_LEVEL = 0.55
const SFX_LEVEL = 0.9

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private ambientBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private padIn: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private stringBufs = new Map<number, AudioBuffer>()
  private chordIdx = 0
  private nextChordAt = 0
  private padTimer: ReturnType<typeof setInterval> | null = null
  private level = 0
  private onVisibility = () => this.handleVisibility()
  private rand = Math.random

  /** True once the context exists (after the first gesture, if supported). */
  get started() {
    return this.ctx !== null
  }

  get context() {
    return this.ctx
  }

  /** Create or resume the context. Call only from a user gesture. Returns false if unsupported. */
  unlock(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
      return true
    }
    const C = getAudioContextCtor()
    if (!C) return false
    try {
      this.ctx = new C({ latencyHint: 'interactive' })
    } catch {
      this.ctx = null
      return false
    }
    const ctx = this.ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.25
    comp.connect(ctx.destination)

    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(comp)
    this.master.gain.setTargetAtTime(this.level, ctx.currentTime, 0.25)

    this.ambientBus = ctx.createGain()
    this.ambientBus.gain.value = 0
    this.ambientBus.connect(this.master)
    // Long, gentle fade-in of the whole ambient bed.
    this.ambientBus.gain.setTargetAtTime(AMBIENT_LEVEL, ctx.currentTime + 0.3, 2.5)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = SFX_LEVEL
    this.sfxBus.connect(this.master)

    const noise = noiseSamples(ctx.sampleRate * 2)
    this.noiseBuf = ctx.createBuffer(1, noise.length, ctx.sampleRate)
    this.noiseBuf.getChannelData(0).set(noise)

    this.startAmbient()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
    return true
  }

  /** Smoothly apply store volume/mute. Works before unlock (remembered). */
  setVolume(volume: number, muted: boolean) {
    this.level = masterLevel(volume, muted)
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.12)
  }

  dispose() {
    if (this.padTimer) clearInterval(this.padTimer)
    this.padTimer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    const ctx = this.ctx
    this.ctx = null
    this.master = this.ambientBus = this.sfxBus = this.padIn = null
    if (ctx) void ctx.close().catch(() => {})
  }

  play(cue: CueName, opts: { pitch?: number } = {}) {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.005
    try {
      switch (cue) {
        case 'footstep':
          return this.footstep(t, opts.pitch ?? stepPitch(this.rand))
        case 'pin':
          return this.pin(t)
        case 'paper':
          return this.paper(t)
        case 'string':
          return this.string(t)
        case 'unlock':
          return this.unlockCue(t)
        case 'click':
          return this.click(t, 1)
        case 'error':
          return this.error(t)
        case 'chalk':
          return this.chalk(t)
        case 'whoosh':
          return this.whoosh(t)
      }
    } catch (err) {
      console.warn('[audio] cue failed', cue, err)
    }
  }

  // ---------- ambient ----------

  private startAmbient() {
    const ctx = this.ctx!
    const bus = this.ambientBus!

    // Pad: voices -> lowpass (slow LFO) -> pad gain.
    const padFilter = ctx.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.value = 820
    padFilter.Q.value = 0.6
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.045
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 260
    lfo.connect(lfoDepth).connect(padFilter.frequency)
    lfo.start()
    const padGain = ctx.createGain()
    padGain.gain.value = 0.07
    padFilter.connect(padGain).connect(bus)
    this.padIn = ctx.createGain()
    this.padIn.connect(padFilter)

    // Rain: looped noise, band-limited, with a very slow swell.
    const rain = this.loopSource(this.noiseBuf!)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 400
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    const rainGain = ctx.createGain()
    rainGain.gain.value = 0.016
    const swell = ctx.createOscillator()
    swell.frequency.value = 0.07
    const swellDepth = ctx.createGain()
    swellDepth.gain.value = 0.005
    swell.connect(swellDepth).connect(rainGain.gain)
    swell.start()
    rain.connect(hp).connect(lp).connect(rainGain).connect(bus)
    rain.start()

    // Vinyl crackle: a 7 s buffer of sparse pops, looped.
    const crackle = crackleSamples(ctx.sampleRate, 7, 7)
    const crackleBuf = ctx.createBuffer(1, crackle.length, ctx.sampleRate)
    crackleBuf.getChannelData(0).set(crackle)
    const cr = this.loopSource(crackleBuf)
    const crHp = ctx.createBiquadFilter()
    crHp.type = 'highpass'
    crHp.frequency.value = 900
    const crGain = ctx.createGain()
    crGain.gain.value = 0.05
    cr.connect(crHp).connect(crGain).connect(bus)
    cr.start()

    this.nextChordAt = ctx.currentTime + 0.1
    this.schedulePad()
    this.padTimer = setInterval(() => this.schedulePad(), 1000)
  }

  private schedulePad() {
    const ctx = this.ctx
    if (!ctx || !this.padIn || ctx.state !== 'running') return
    // Lookahead: queue the next chord a few seconds early.
    while (this.nextChordAt < ctx.currentTime + 3) {
      // If we fell behind (suspended), restart from now instead of stacking chords.
      if (this.nextChordAt < ctx.currentTime - 1) this.nextChordAt = ctx.currentTime + 0.1
      this.playChord(PAD_CHORDS[this.chordIdx % PAD_CHORDS.length], this.nextChordAt, CHORD_S)
      this.chordIdx++
      this.nextChordAt += CHORD_S
    }
  }

  private playChord(notes: readonly number[], t: number, dur: number) {
    const ctx = this.ctx!
    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0, t)
    voiceGain.gain.linearRampToValueAtTime(1 / notes.length, t + PAD_ATTACK_S)
    voiceGain.gain.setValueAtTime(1 / notes.length, t + dur)
    voiceGain.gain.linearRampToValueAtTime(0, t + dur + PAD_RELEASE_S)
    voiceGain.connect(this.padIn!)
    const end = t + dur + PAD_RELEASE_S + 0.1
    notes.forEach((note, i) => {
      const f = midiToHz(note)
      for (const detune of [-9, 7]) {
        const o = ctx.createOscillator()
        o.type = i === 0 ? 'sine' : 'triangle'
        o.frequency.value = f
        o.detune.value = detune + (this.rand() - 0.5) * 4
        o.connect(voiceGain)
        o.start(t)
        o.stop(end)
      }
    })
    // Disconnect the envelope once the voices end.
    setTimeout(() => voiceGain.disconnect(), (end - ctx.currentTime + 0.2) * 1000)
  }

  private loopSource(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.loop = true
    return s
  }

  private handleVisibility() {
    const ctx = this.ctx
    if (!ctx || typeof document === 'undefined') return
    if (document.hidden) void ctx.suspend().catch(() => {})
    else void ctx.resume().catch(() => {})
  }

  // ---------- cue building blocks ----------

  /** A decaying envelope gain into the sfx bus. */
  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode = this.sfxBus!) {
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    g.connect(dest)
    return g
  }

  private noise(t: number, dur: number, offset = this.rand() * 1.5) {
    const s = this.ctx!.createBufferSource()
    s.buffer = this.noiseBuf
    s.start(t, offset, dur + 0.05)
    return s
  }

  private filter(type: BiquadFilterType, freq: number, q = 1) {
    const f = this.ctx!.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, glide: number, dur: number, dest: AudioNode) {
    const o = this.ctx!.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + glide)
    o.connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    return o
  }

  // ---------- cues ----------

  /** Soft wooden thud: low sine knock + muffled noise. */
  private footstep(t: number, pitch: number) {
    const body = this.env(t, 0.22, 0.004, 0.11)
    this.tone(t, 'sine', 115 * pitch, 62 * pitch, 0.09, 0.14, body)
    const scuff = this.env(t, 0.06, 0.002, 0.07)
    this.noise(t, 0.09).connect(this.filter('lowpass', 520 * pitch, 0.7)).connect(scuff)
  }

  /** Little "tock": pin pushed into cork. */
  private pin(t: number) {
    const g = this.env(t, 0.35, 0.002, 0.09)
    this.tone(t, 'triangle', 1250, 760, 0.05, 0.1, g)
    const knock = this.env(t, 0.2, 0.002, 0.06)
    this.tone(t, 'sine', 320, 180, 0.05, 0.08, knock)
    const tick = this.env(t, 0.08, 0.001, 0.025)
    this.noise(t, 0.03).connect(this.filter('bandpass', 4000, 1.2)).connect(tick)
  }

  /** Paper rustle: a few crinkly band-passed noise bursts. */
  private paper(t: number) {
    for (let i = 0; i < 5; i++) {
      const at = t + i * 0.045 + this.rand() * 0.03
      const g = this.env(at, 0.07 + this.rand() * 0.06, 0.008, 0.06 + this.rand() * 0.07)
      this.noise(at, 0.16).connect(this.filter('bandpass', 2200 + this.rand() * 2600, 0.9)).connect(g)
    }
    const hush = this.env(t, 0.05, 0.05, 0.28)
    this.noise(t, 0.4).connect(this.filter('highpass', 1800, 0.5)).connect(hush)
  }

  /** Plucked string twang (Karplus-Strong) with a tiny pitch bend. */
  private string(t: number) {
    const ctx = this.ctx!
    const freq = 196 * (1 + (this.rand() - 0.5) * 0.06)
    const key = Math.round(freq)
    let buf = this.stringBufs.get(key)
    if (!buf) {
      const data = karplusStrong(ctx.sampleRate, freq, 1.4, { damping: 0.995, rand: seededRandom(key) })
      buf = ctx.createBuffer(1, data.length, ctx.sampleRate)
      buf.getChannelData(0).set(data)
      if (this.stringBufs.size > 16) this.stringBufs.clear()
      this.stringBufs.set(key, buf)
    }
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.playbackRate.setValueAtTime(1.03, t)
    s.playbackRate.exponentialRampToValueAtTime(1, t + 0.12)
    const g = ctx.createGain()
    g.gain.value = 0.32
    s.connect(this.filter('lowpass', 3200, 0.5)).connect(g).connect(this.sfxBus!)
    s.start(t)
  }

  /** Small UI click. */
  private click(t: number, gain: number) {
    const g = this.env(t, 0.16 * gain, 0.001, 0.035)
    this.tone(t, 'triangle', 1900, 1300, 0.03, 0.05, g)
    const n = this.env(t, 0.05 * gain, 0.001, 0.02)
    this.noise(t, 0.03).connect(this.filter('highpass', 3000)).connect(n)
  }

  /** Gate unlock: click-clack of a latch, then a happy chime arpeggio. */
  private unlockCue(t: number) {
    const latch = (at: number, f: number) => {
      const g = this.env(at, 0.3, 0.001, 0.05)
      this.noise(at, 0.07).connect(this.filter('bandpass', f, 2.5)).connect(g)
      const k = this.env(at, 0.18, 0.001, 0.06)
      const lp = this.filter('lowpass', 900)
      lp.connect(k)
      this.tone(at, 'square', f / 6, f / 9, 0.04, 0.07, lp)
    }
    latch(t, 1900)
    latch(t + 0.11, 1300)
    // C major arpeggio, C5 E5 G5 C6, bell-ish (sine + soft octave triangle).
    ;[72, 76, 79, 84].forEach((n, i) => {
      const at = t + 0.28 + i * 0.09
      const f = midiToHz(n)
      const g = this.env(at, 0.16, 0.004, 0.9 - i * 0.1)
      this.tone(at, 'sine', f, f, 0.01, 1, g)
      const h = this.env(at, 0.04, 0.004, 0.35)
      this.tone(at, 'triangle', f * 2, f * 2, 0.01, 0.4, h)
    })
  }

  /** Soft low "boop" (two quick descending notes). */
  private error(t: number) {
    ;[
      [262, 220],
      [196, 165],
    ].forEach(([a, b], i) => {
      const at = t + i * 0.16
      const g = this.env(at, 0.22, 0.01, 0.22)
      const lp = this.filter('lowpass', 900)
      lp.connect(g)
      this.tone(at, 'sine', a, b, 0.18, 0.26, lp)
    })
  }

  /** Chalk scratch: high band-passed noise with a jittery amplitude. */
  private chalk(t: number) {
    const ctx = this.ctx!
    const dur = 0.32 + this.rand() * 0.12
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    const steps = 9
    for (let i = 1; i <= steps; i++) {
      const v = (0.05 + this.rand() * 0.07) * Math.sin((Math.PI * i) / (steps + 1))
      g.gain.linearRampToValueAtTime(v, t + (dur * i) / (steps + 1))
    }
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    g.connect(this.sfxBus!)
    this.noise(t, dur).connect(this.filter('bandpass', 3300, 3)).connect(this.filter('highpass', 1500)).connect(g)
  }

  /** Airy whoosh: noise through a sweeping band-pass with a swell. */
  private whoosh(t: number) {
    const ctx = this.ctx!
    const dur = 0.5
    const bp = this.filter('bandpass', 350, 0.9)
    bp.frequency.setValueAtTime(350, t)
    bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.45)
    bp.frequency.exponentialRampToValueAtTime(500, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.4)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g.connect(this.sfxBus!)
    this.noise(t, dur).connect(bp).connect(g)
  }
}
