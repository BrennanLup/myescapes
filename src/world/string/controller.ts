/**
 * Non-React state machine for the red string. It owns two preallocated meshes:
 * `live` (current links: drawing, hanging, twanging) and `old` (links untying and
 * fading after a re-sort or removal). `update()` runs every frame and allocates nothing.
 */
import type { Vec3 } from '@/contracts/scene'
import type { BoardPin } from '@/state/store'
import { computeLinks, MAX_LINKS, type StringLink } from './links'
import { sagDrop } from './sag'
import { TAUT, TIMING, easeOutCubic, fadeAlpha, retractProgress, staggerDelay, twangFactor } from './timing'
import type { StringGeometry } from './geometry'

/** The string passes just under the pin head... */
export const PIN_UNDER = 0.012
/** ...and sits this far behind the head (towards the cork, -Z), a few mm in front of the cork. */
export const PIN_BACK = 0.012
/** A pin counts as landed when its live head is this close to its target (metres). */
export const LAND_EPS = 0.015
/** The timeline thread is thinner than the group string. */
export const TIMELINE_WIDTH = 0.6

interface LinkState {
  link: StringLink
  /** Time drawing starts (Infinity while waiting for a pin to land). */
  start: number
  duration: number
  waitLand: boolean
  landDeadline: number
  /** Time the string went tight (NaN while drawing). */
  tightAt: number
  /** Current draw progress (0..1). */
  p: number
  /** Untie: started at, and the progress it started from. */
  retractStart: number
  retractFrom: number
  /** Last known endpoints (ax, ay, az, bx, by, bz), kept when a pin disappears. */
  ends: Float64Array
  width: number
}

function makeState(link: StringLink, start: number, duration: number): LinkState {
  return {
    link,
    start,
    duration,
    waitLand: false,
    landDeadline: Infinity,
    tightAt: NaN,
    p: 0,
    retractStart: 0,
    retractFrom: 1,
    ends: new Float64Array(6),
    width: link.kind === 'timeline' ? TIMELINE_WIDTH : 1,
  }
}

export interface ControllerOptions {
  timeline?: boolean
  emitSfx?: () => void
}

export class StringController {
  private live: LinkState[] = []
  private old: LinkState[] = []
  private sort: string
  private targets = new Map<string, Vec3>()
  private lastPins: readonly BoardPin[] = []
  private hadPins = false
  /** A re-sort began and we are waiting for the board to publish the new layout. */
  private awaiting = false
  private resortStart = -Infinity
  private fadeStart = -Infinity
  private sfxAt = Infinity
  private fresh = new Set<string>()
  private readonly opts: ControllerOptions
  private readonly liveGeo: StringGeometry
  private readonly oldGeo: StringGeometry

  constructor(liveGeo: StringGeometry, oldGeo: StringGeometry, sort: string, opts: ControllerOptions = {}) {
    this.liveGeo = liveGeo
    this.oldGeo = oldGeo
    this.sort = sort
    this.opts = opts
  }

  /** Opacity of the untying layer. */
  oldAlpha(now: number) {
    // Outside a re-sort, removed strings simply untie without fading.
    const t = now - this.fadeStart
    return t < TIMING.retract ? fadeAlpha(t) : 1
  }

  get liveCount() {
    return this.live.length
  }
  get oldCount() {
    return this.old.length
  }

  /** A photo was just added; its string waits until its pin has landed. */
  markFresh(roomId: string) {
    this.fresh.add(roomId)
  }

  sortChanged(sort: string, now: number) {
    if (sort === this.sort) return
    this.sort = sort
    this.awaiting = true
    this.resortStart = now
    this.fadeStart = now
    // Everything currently tied unties (from wherever it is) and fades.
    this.old = this.old.filter((s) => retractProgress(now - s.retractStart) * s.retractFrom > 0.001)
    for (const s of this.live) {
      if (s.p <= 0.001) continue
      s.retractStart = now
      s.retractFrom = s.p
      if (this.old.length < MAX_LINKS) this.old.push(s)
    }
    this.live = []
  }

  setPins(pins: readonly BoardPin[], sort: string, now: number) {
    this.lastPins = pins
    this.targets = new Map(pins.map((p) => [p.roomId, p.target]))
    if (sort !== this.sort) this.sortChanged(sort, now)
    const links = computeLinks(pins, { timeline: this.opts.timeline ?? true })

    if (this.awaiting) {
      this.awaiting = false
      const begin = Math.max(now, this.resortStart + TIMING.drawDelay)
      this.live = links.map((l) => makeState(l, begin + staggerDelay(l.index, links.length), TIMING.segment))
      if (links.length) this.sfxAt = begin
      this.hadPins = pins.length > 0
      return
    }

    if (!this.hadPins) {
      // First layout: tie everything in with the same staggered draw.
      this.live = links.map((l) => makeState(l, now + staggerDelay(l.index, links.length), TIMING.segment))
      if (links.length) this.sfxAt = now
      this.hadPins = pins.length > 0
      return
    }

    // Same sort, layout changed (new or removed photo): keep existing strings, draw new
    // ones once their pins land, untie removed ones.
    const byKey = new Map(this.live.map((s) => [s.link.key, s]))
    const next: LinkState[] = []
    for (const l of links) {
      const prev = byKey.get(l.key)
      if (prev) {
        prev.link = l
        byKey.delete(l.key)
        next.push(prev)
      } else {
        const s = makeState(l, Infinity, TIMING.single)
        s.waitLand = true
        s.landDeadline = now + TIMING.landTimeout
        next.push(s)
      }
    }
    for (const s of byKey.values()) {
      s.retractStart = now
      s.retractFrom = s.p
      if (this.old.length < MAX_LINKS) this.old.push(s)
    }
    this.live = next
    this.hadPins = pins.length > 0
  }

  private landed(id: string, live: ReadonlyMap<string, Vec3>) {
    const t = this.targets.get(id)
    const p = live.get(id)
    if (!p) return !this.fresh.has(id)
    if (!t) return true
    return Math.abs(p[0] - t[0]) < LAND_EPS && Math.abs(p[1] - t[1]) < LAND_EPS && Math.abs(p[2] - t[2]) < LAND_EPS
  }

  private readEnds(s: LinkState, live: ReadonlyMap<string, Vec3>) {
    const a = live.get(s.link.a) ?? this.targets.get(s.link.a)
    const b = live.get(s.link.b) ?? this.targets.get(s.link.b)
    const e = s.ends
    if (a) {
      e[0] = a[0]
      e[1] = a[1] - PIN_UNDER
      e[2] = a[2] - PIN_BACK
    }
    if (b) {
      e[3] = b[0]
      e[4] = b[1] - PIN_UNDER
      e[5] = b[2] - PIN_BACK
    }
  }

  /** Advances animations and rewrites both meshes. `radius` is the string radius in metres. */
  update(now: number, live: ReadonlyMap<string, Vec3>, radius: number) {
    if (this.awaiting && now - this.resortStart > TIMING.pinsTimeout) {
      // The board did not publish a new layout for this sort: redraw the current one.
      this.setPins(this.lastPins, this.sort, now)
    }
    if (now >= this.sfxAt) {
      this.sfxAt = Infinity
      this.opts.emitSfx?.()
    }

    let n = 0
    for (let i = 0; i < this.live.length; i++) {
      const s = this.live[i]
      if (s.waitLand) {
        if ((this.landed(s.link.a, live) && this.landed(s.link.b, live)) || now > s.landDeadline) {
          s.waitLand = false
          s.start = now + 0.08
          this.fresh.delete(s.link.a)
          this.fresh.delete(s.link.b)
          if (this.sfxAt === Infinity) this.sfxAt = s.start
        }
      }
      s.p = s.start === Infinity ? 0 : easeOutCubic((now - s.start) / s.duration)
      if (s.p >= 1 && Number.isNaN(s.tightAt)) s.tightAt = now
      if (s.p <= 0) continue
      this.readEnds(s, live)
      const e = s.ends
      const len = Math.hypot(e[3] - e[0], e[4] - e[1], e[5] - e[2])
      const factor = s.p < 1 ? TAUT : twangFactor(now - s.tightAt)
      const drop = sagDrop(len, factor * (s.link.kind === 'timeline' ? 1.4 : 1))
      const p = s.p
      this.liveGeo.writeLink(n++, e[0], e[1], e[2], e[3], e[4], e[5], drop, 0, Math.min(p, 0.5), 0.5, Math.max(p, 0.5), radius * s.width)
    }
    this.liveGeo.commit(n)

    let m = 0
    let alive = 0
    for (let i = 0; i < this.old.length; i++) {
      const s = this.old[i]
      const p = retractProgress(now - s.retractStart) * s.retractFrom
      if (p <= 0.001) continue
      this.old[alive++] = s
      this.readEnds(s, live)
      const e = s.ends
      const len = Math.hypot(e[3] - e[0], e[4] - e[1], e[5] - e[2])
      // Untied string goes slack as it pulls back towards its pins.
      const drop = sagDrop(len, 1 + (1 - p) * 1.2)
      this.oldGeo.writeLink(m++, e[0], e[1], e[2], e[3], e[4], e[5], drop, 0, p / 2, 1 - p / 2, 1, radius * s.width)
    }
    this.old.length = alive
    this.oldGeo.commit(m)
  }
}
