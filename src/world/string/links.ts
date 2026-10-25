/** Pure: which pins get tied together by red string. */

export interface PinLike {
  roomId: string
  group: string
  order: number
}

export type LinkKind = 'group' | 'timeline'

export interface StringLink {
  /** Stable identity used to diff link sets between pin updates. */
  key: string
  a: string
  b: string
  kind: LinkKind
  group: string
  /** Position in draw order (0..n-1); used for the staggered draw-out. */
  index: number
}

/** 200 pins -> at most 199 group links + 199 timeline links. */
export const MAX_PINS = 200
export const MAX_LINKS = 400

export interface LinkOptions {
  /** Also tie the first pin of each group together in sequence (thinner thread). */
  timeline?: boolean
  max?: number
}

export function linkKey(kind: LinkKind, a: string, b: string) {
  return `${kind}:${a}>${b}`
}

/**
 * Chains pins that share a group in `order`, never linking across groups.
 * Groups appear in the order of their first pin. With `timeline`, the first pin of
 * each group is also linked to the first pin of the next group.
 */
export function computeLinks(pins: readonly PinLike[], opts: LinkOptions = {}): StringLink[] {
  const { timeline = true, max = MAX_LINKS } = opts
  const seen = new Set<string>()
  const unique: PinLike[] = []
  for (const p of pins) {
    if (seen.has(p.roomId)) continue
    seen.add(p.roomId)
    unique.push(p)
  }
  unique.sort((x, y) => x.order - y.order || (x.roomId < y.roomId ? -1 : x.roomId > y.roomId ? 1 : 0))

  const groups = new Map<string, PinLike[]>()
  for (const p of unique) {
    let g = groups.get(p.group)
    if (!g) groups.set(p.group, (g = []))
    g.push(p)
  }

  const out: StringLink[] = []
  const push = (kind: LinkKind, a: string, b: string, group: string) => {
    if (out.length < max) out.push({ key: linkKey(kind, a, b), a, b, kind, group, index: out.length })
  }
  for (const [group, members] of groups) {
    for (let i = 1; i < members.length; i++) push('group', members[i - 1].roomId, members[i].roomId, group)
  }
  if (timeline && groups.size > 1) {
    let prev: PinLike | null = null
    for (const members of groups.values()) {
      if (prev) push('timeline', prev.roomId, members[0].roomId, '')
      prev = members[0]
    }
  }
  return out
}
