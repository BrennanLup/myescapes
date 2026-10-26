import { describe, expect, it } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { SORT_KEYS, type Review } from '@/contracts/types'
import {
  BOARD_SORT_KEYS,
  BOARD_SORT_LABELS,
  buildCrewIndex,
  crewFrequency,
  crewLabel,
  guestSticker,
  initialsOf,
  participantSticker,
  rankTeammates,
  safeImageUrl,
  SOLO_LABEL,
  STICKER_COLORS,
  stickerColor,
} from './crew'
import { friend, guest, logRow, user } from './testRows'

const base = FIXTURE_DATASET.reviews[0]
const rv = (id: string, crew: string[], escaped = true): Review => ({ ...base, id, roomId: 'room_' + id, crew, escaped })

const mia = user('usr_mia', 'Mia', 'https://lh3.googleusercontent.com/a/mia=s96-c')
const bob = user('usr_bob', 'Bob')

describe('board sort keys', () => {
  it('keeps the six Phase 1 keys in order and adds crew last', () => {
    expect(BOARD_SORT_KEYS.slice(0, 6)).toEqual([...SORT_KEYS])
    expect(BOARD_SORT_KEYS[6]).toBe('crew')
    expect(BOARD_SORT_LABELS.crew).toBe('Crew')
    expect(BOARD_SORT_LABELS.city).toBe('City')
  })
})

describe('initialsOf', () => {
  it('uses one letter for one word and first+last for more', () => {
    expect(initialsOf('Mia')).toBe('M')
    expect(initialsOf('mia wong')).toBe('MW')
    expect(initialsOf('Anna Maria Lopez')).toBe('AL')
    expect(initialsOf('@bob_smith')).toBe('BS')
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf('élodie')).toBe('É')
    expect(initialsOf('😀 Party')).toBe('😀P')
  })
})

describe('stickers', () => {
  it('colours are stable and from the palette', () => {
    expect(stickerColor('g:mia')).toBe(stickerColor('g:mia'))
    expect(STICKER_COLORS).toContain(stickerColor('u:usr_bob'))
  })

  it('guest stickers normalise whitespace and key by lowercase name', () => {
    const s = guestSticker('  Mia   Wong ')
    expect(s).toMatchObject({ key: 'g:mia wong', name: 'Mia Wong', initials: 'MW', image: null, userId: null, pending: false })
    expect(guestSticker('').name).toBe('Guest')
  })

  it('maps participants: friends with pictures, guests, pending faded, declined dropped', () => {
    expect(participantSticker(friend(mia))).toMatchObject({ key: 'u:usr_mia', name: 'Mia', userId: 'usr_mia', handle: 'mia', image: mia.image, pending: false })
    expect(participantSticker(friend(bob, 'pending'))?.pending).toBe(true)
    expect(participantSticker(guest('Sam'))).toMatchObject({ key: 'g:sam', name: 'Sam' })
    expect(participantSticker(friend(mia, 'declined'))).toBeNull()
    // No display name: fall back to the handle.
    expect(participantSticker(friend(user('usr_x', ' ', null, 'xavier')))?.name).toBe('@xavier')
  })

  it('only draws https (or same-origin) pictures', () => {
    expect(safeImageUrl('https://lh3.googleusercontent.com/a/x')).toBe('https://lh3.googleusercontent.com/a/x')
    expect(safeImageUrl('/api/photos/1')).toBe('/api/photos/1')
    expect(safeImageUrl('http://localhost:3000/a.png')).toBe('http://localhost:3000/a.png')
    expect(safeImageUrl('javascript:alert(1)')).toBeNull()
    expect(safeImageUrl('http://evil.example/a.png')).toBeNull()
    expect(safeImageUrl('//evil.example/a.png')).toBeNull()
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(safeImageUrl(null)).toBeNull()
  })
})

describe('buildCrewIndex', () => {
  it('uses /api/logs rows for the visits they cover and names for the rest', () => {
    const reviews = [rv('vis_a', ['Mia']), rv('vis_b', ['Sam', 'Priya'])]
    const rows = [logRow('vis_a', 'room_vis_a', [friend(mia), guest('Mia'), friend(bob, 'declined')])]
    const idx = buildCrewIndex(reviews, rows)
    expect(idx.vis_a.map((s) => s.key)).toEqual(['u:usr_mia', 'g:mia'])
    expect(idx.vis_a[0].image).toBe(mia.image)
    expect(idx.vis_b.map((s) => s.name)).toEqual(['Sam', 'Priya'])
  })

  it('drops duplicates, empty names and the viewer', () => {
    const idx = buildCrewIndex([rv('v', ['Ana', 'ana ', '', 'Brennan', 'Bo'])], null, ['brennan'])
    expect(idx.v.map((s) => s.name)).toEqual(['Ana', 'Bo'])
  })

  it('gives every review an entry (empty = solo)', () => {
    expect(buildCrewIndex([rv('solo', [])])).toEqual({ solo: [] })
  })
})

describe('crewLabel', () => {
  const s = (n: string) => guestSticker(n)
  it('labels solo, pairs, trios and bigger crews', () => {
    expect(crewLabel([])).toBe(SOLO_LABEL)
    expect(crewLabel([s('Mia')])).toBe('With Mia')
    expect(crewLabel([s('Mia'), s('Bob')])).toBe('With Bob & Mia')
    expect(crewLabel([s('Mia'), s('Bob'), s('Sam')])).toBe('With Bob, Mia & Sam')
    expect(crewLabel([s('Mia'), s('Bob'), s('Sam'), s('Ana')])).toBe('With Ana, Bob & 2 more')
  })
  it('lists the most frequent teammate first, so the same crew always gets one label', () => {
    const freq = new Map([
      ['g:mia', 5],
      ['g:bob', 1],
    ])
    expect(crewLabel([s('Bob'), s('Mia')], freq)).toBe('With Mia & Bob')
    expect(crewLabel([s('Mia'), s('Bob')], freq)).toBe('With Mia & Bob')
  })
})

describe('crewFrequency and rankTeammates', () => {
  const reviews = [rv('1', ['Mia']), rv('2', ['Mia', 'Bob'], false), rv('3', ['Mia']), rv('4', ['Bob'])]
  const idx = buildCrewIndex(reviews)

  it('counts each person once per visit', () => {
    expect(Object.fromEntries(crewFrequency(reviews, idx))).toEqual({ 'g:mia': 3, 'g:bob': 2 })
  })

  it('ranks by rooms together with the escape rate on those rooms', () => {
    const [top, second] = rankTeammates(reviews, idx)
    expect(top).toMatchObject({ name: 'Mia', count: 3, escapes: 2 })
    expect(top.escapeRate).toBeCloseTo(2 / 3)
    expect(second).toMatchObject({ name: 'Bob', count: 2, escapes: 1, escapeRate: 0.5 })
  })

  it('skips pending tags and keeps a picture when any visit has one', () => {
    const rows = [logRow('1', 'r1', [friend(user('usr_mia', 'Mia'))]), logRow('2', 'r2', [friend(mia), friend(bob, 'pending')])]
    const ranked = rankTeammates([rv('1', []), rv('2', [])], buildCrewIndex([rv('1', []), rv('2', [])], rows))
    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({ key: 'u:usr_mia', count: 2, image: mia.image })
  })

  it('is empty for solo players', () => {
    expect(rankTeammates([rv('x', [])], buildCrewIndex([rv('x', [])]))).toEqual([])
  })
})
