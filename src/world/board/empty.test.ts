import { describe, expect, it } from 'vitest'
import { emptyBoardLines } from './index'

describe('emptyBoardLines', () => {
  it('invites you to log your first escape in your own room', () => {
    expect(emptyBoardLines(true).join(' ')).toMatch(/Your board is empty/)
  })

  it("never tells a visitor to log anything in a friend's room", () => {
    const text = emptyBoardLines(true, 'Vera').join(' ')
    expect(text).toMatch(/^Vera hasn't pinned any escapes yet/)
    expect(text).not.toMatch(/Your board|Log/)
  })
})
