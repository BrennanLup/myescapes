import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CrewSuggestion, CrewTag } from '../../../contracts/models'
import { CrewPicker } from './index'
import { findFriend, sortSuggestions, tagForName, tagKey, tagLabel, tagsFromNames, toggleTag } from './logic'

const user = (id: string, displayName: string, handle: string | null = null) => ({ id, displayName, handle, image: null })
const SUGG: CrewSuggestion[] = [
  { kind: 'guest', guestName: 'Leo', visitsTogether: 9 },
  { kind: 'friend', user: user('usr_bob', 'Bob Stone', 'bob'), visitsTogether: 2 },
  { kind: 'friend', user: user('usr_mia', 'Mia Chen', 'mia'), visitsTogether: 23 },
  { kind: 'guest', guestName: 'Ana', visitsTogether: 9 },
  { kind: 'friend', user: user('usr_max', 'Max', 'maxx'), visitsTogether: 2 },
]

afterEach(cleanup)

describe('crew logic', () => {
  it('orders friends by visits together, then guests', () => {
    const order = sortSuggestions(SUGG).map((s) => (s.kind === 'friend' ? s.user.id : s.guestName))
    expect(order).toEqual(['usr_mia', 'usr_bob', 'usr_max', 'Ana', 'Leo'])
  })

  it('matches typed names to friends by display name, first name or @handle', () => {
    expect(findFriend('mia', SUGG)?.user.id).toBe('usr_mia')
    expect(findFriend('@BOB', SUGG)?.user.id).toBe('usr_bob')
    expect(findFriend('Mia Chen', SUGG)?.user.id).toBe('usr_mia')
    expect(findFriend('Priya', SUGG)).toBeNull()
    expect(tagForName('  Priya  Rao ', SUGG)).toEqual({ guestName: 'Priya Rao' })
    expect(tagForName('Mia', SUGG)).toEqual({ userId: 'usr_mia' })
    expect(tagForName('   ', SUGG)).toBeNull()
  })

  it('maps the draft crew to tags, leaving out the logger and duplicates', () => {
    const tags = tagsFromNames(['me', 'Brennan', 'Mia', 'mia', 'Priya', 'I'], SUGG, user('usr_brennan', 'Brennan Lup', 'brennan'))
    expect(tags).toEqual([{ userId: 'usr_mia' }, { guestName: 'Priya' }])
  })

  it('toggles tags by identity and labels them', () => {
    let v: CrewTag[] = []
    v = toggleTag(v, { guestName: 'Leo' })
    v = toggleTag(v, { userId: 'usr_mia' })
    v = toggleTag(v, { guestName: 'leo ' })
    expect(v).toEqual([{ userId: 'usr_mia' }])
    expect(tagKey({ guestName: ' Leo  Smith' })).toBe('g:leo smith')
    expect(tagLabel({ userId: 'usr_mia' }, SUGG)).toBe('Mia Chen')
    expect(tagLabel({ guestName: 'Zed' }, SUGG)).toBe('Zed')
  })
})

function Harness({ initial = [] as CrewTag[], suggestions }: { initial?: CrewTag[]; suggestions?: CrewSuggestion[] }) {
  const [v, setV] = useState<CrewTag[]>(initial)
  return (
    <>
      <CrewPicker value={v} onChange={setV} suggestions={suggestions} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </>
  )
}

describe('CrewPicker', () => {
  it('shows friend chips most-frequent first and toggles them', async () => {
    render(<Harness suggestions={SUGG} />)
    const chips = screen.getAllByRole('button', { pressed: false })
    expect(chips[0].textContent).toContain('Mia Chen')
    await userEvent.click(screen.getByTestId('crew-friend-usr_mia'))
    expect(screen.getByTestId('crew-friend-usr_mia').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('value').textContent).toBe('[{"userId":"usr_mia"}]')
  })

  it('adds anyone else as a guest by name (or the friend when the name matches)', async () => {
    render(<Harness suggestions={SUGG} />)
    await userEvent.type(screen.getByTestId('crew-guest-input'), 'Priya{Enter}')
    await userEvent.type(screen.getByTestId('crew-guest-input'), 'bob')
    await userEvent.click(screen.getByTestId('crew-guest-add'))
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual([{ guestName: 'Priya' }, { userId: 'usr_bob' }])
    expect(screen.getByTestId('crew-tag-Priya')).toBeTruthy()
    await userEvent.click(screen.getByTestId('crew-tag-Priya'))
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual([{ userId: 'usr_bob' }])
  })

  it('loads suggestions itself when none are given', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ suggestions: SUGG }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<Harness />)
      await waitFor(() => expect(screen.getByTestId('crew-friend-usr_mia')).toBeTruthy())
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/crew/suggestions')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
