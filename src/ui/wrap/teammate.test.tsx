import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import type { Review } from '@/contracts/types'
import { buildCrewIndex } from '@/state/crew'
import { useStore } from '@/state/store'
import { friend, guest, logRow, user } from '@/state/testRows'
import { computeWrap } from './computeWrap'
import { WrapOverlay } from './WrapOverlay'

const { rooms, reviews } = FIXTURE_DATASET
const room = rooms[0]
const mk = (id: string, date: string, crew: string[], escaped = true): Review => ({ ...reviews[0], id, roomId: room.id, date, crew, escaped })

describe('wrap: your #1 teammate', () => {
  it('is the person you played with most, with rooms together and the escape rate on them', () => {
    const rs = [mk('a', '2026-01-01', ['Mia']), mk('b', '2026-02-01', ['Mia', 'Bob'], false), mk('c', '2026-03-01', ['Mia', 'Bob']), mk('d', '2026-04-01', [])]
    const w = computeWrap([room], rs, 2026)
    expect(w.topTeammate).toMatchObject({ name: 'Mia', count: 3, escapes: 2 })
    expect(w.topTeammate!.escapeRate).toBeCloseTo(2 / 3)
    expect(w.teammates.map((t) => [t.name, t.count])).toEqual([
      ['Mia', 3],
      ['Bob', 2],
    ])
  })

  it('only counts the selected year', () => {
    const rs = [mk('a', '2025-01-01', ['Mia']), mk('b', '2026-01-01', ['Bob'])]
    expect(computeWrap([room], rs, 2026).topTeammate?.name).toBe('Bob')
    expect(computeWrap([room], rs, 'all').teammates).toHaveLength(2)
  })

  it('uses account identities and pictures from the crew index', () => {
    const rs = [mk('a', '2026-01-01', ['Mia']), mk('b', '2026-02-01', ['Mia'])]
    const mia = user('usr_mia', 'Mia', 'https://lh3.googleusercontent.com/a/mia')
    const idx = buildCrewIndex(rs, [logRow('a', room.id, [friend(mia)]), logRow('b', room.id, [friend(mia), guest('Sam')])])
    const w = computeWrap([room], rs, 'all', idx)
    expect(w.topTeammate).toMatchObject({ key: 'u:usr_mia', name: 'Mia', count: 2, image: mia.image })
    expect(w.teammates[1]).toMatchObject({ name: 'Sam', count: 1 })
  })

  it('reviews missing from the index fall back to their names', () => {
    const rs = [mk('a', '2026-01-01', ['Mia']), mk('new', '2026-02-01', ['Mia'])]
    const idx = buildCrewIndex([rs[0]])
    expect(computeWrap([room], rs, 'all', idx).topTeammate?.count).toBe(2)
  })

  it('is null when you always play solo', () => {
    expect(computeWrap([room], [mk('a', '2026-01-01', [])], 'all').topTeammate).toBeNull()
  })
})

describe('wrap overlay: teammate card', () => {
  beforeEach(() => useStore.getState().setDataset({ ...FIXTURE_DATASET, reviews: [mk('a', '2026-01-01', ['Mia']), mk('b', '2026-02-01', ['Mia'], false), mk('c', '2026-03-01', ['Mia', 'Jules'])], rooms: [room] }))
  afterEach(() => {
    cleanup()
    useStore.setState({ rooms: [], reviews: [], crewIndex: {} })
  })

  const goTo = (key: string) => {
    for (let i = 0; i < 12 && screen.getByTestId('wrap-stage').getAttribute('data-card') !== key; i++) fireEvent.click(screen.getByTestId('wrap-next'))
  }

  it('shows "Your #1 teammate: Mia, 3 rooms together, 67% escape rate"', () => {
    render(<WrapOverlay />)
    goTo('crew')
    expect(screen.getByText('Your #1 teammate')).toBeTruthy()
    expect(screen.getAllByText('Mia').length).toBeGreaterThan(0)
    expect(screen.getByTestId('wrap-teammate-line').textContent).toBe('3 rooms together, 67% escape rate')
    // No picture for a guest name: initials.
    expect(screen.getByTestId('wrap-teammate-avatar').textContent).toBe('M')
  })

  it('shows the friend picture when the crew index has one', () => {
    const mia = user('usr_mia', 'Mia', 'https://lh3.googleusercontent.com/a/mia')
    const s = useStore.getState()
    useStore.setState({ crewIndex: buildCrewIndex(s.reviews, s.reviews.map((r) => logRow(r.id, room.id, [friend(mia)]))) })
    render(<WrapOverlay />)
    goTo('crew')
    const img = screen.getByTestId('wrap-teammate-avatar').querySelector('img')
    expect(img?.getAttribute('src')).toBe(mia.image)
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.error(img!)
    expect(screen.getByTestId('wrap-teammate-avatar').textContent).toBe('M')
  })
})
