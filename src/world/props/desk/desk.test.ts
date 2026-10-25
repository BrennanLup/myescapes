import { describe, expect, it } from 'vitest'
import { HALF_D, HALF_W, LAMPS, PLAYER, ROOM } from '@/contracts/scene'
import { deskColliders, deskLocalToWorld, deskWorldToLocal, LAMP_BULB_LOCAL } from './layout'
import { terminalFrame, TERMINAL_FPS } from './terminal'

describe('terminalFrame', () => {
  it('types the prompt out, then blinks the cursor', () => {
    const start = terminalFrame(0, false, 3)
    expect(start.prompt).toBe('')
    const typed = terminalFrame(3, false, 3)
    expect(typed.prompt).toBe('LOG A NEW ESCAPE ROOM')
    expect(typed.lines[typed.promptIndex]).toBe('> LOG A NEW ESCAPE ROOM')
    expect(typed.button).toMatch(/click to record a voice note/)
    const states = new Set([3, 3.25, 3.5, 3.75].map((t) => terminalFrame(t, false, 3).cursorOn))
    expect(states).toEqual(new Set([true, false]))
  })

  it('switches to the armed state on hover', () => {
    const f = terminalFrame(0, true, 3)
    expect(f.hovered).toBe(true)
    expect(f.prompt).toBe('READY TO RECORD')
    expect(f.button).toMatch(/voice note/)
    expect(f.key).not.toBe(terminalFrame(0, false, 3).key)
    expect(Math.max(...f.bars)).toBeGreaterThan(Math.max(...terminalFrame(0, false, 3).bars))
  })

  it('pluralises the room count and handles 0..200', () => {
    expect(terminalFrame(5, false, 0).lines[1]).toBe('0 rooms escaped so far')
    expect(terminalFrame(5, false, 1).lines[1]).toBe('1 room escaped so far')
    expect(terminalFrame(5, false, 200).lines[1]).toBe('200 rooms escaped so far')
  })

  it('is deterministic and quantised to TERMINAL_FPS', () => {
    const a = terminalFrame(4.01, false, 2)
    const b = terminalFrame(4.01 + 0.5 / TERMINAL_FPS, false, 2)
    expect(a).toEqual(terminalFrame(4.01, false, 2))
    expect(a.key).toBe(b.key)
    for (const v of a.bars) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('desk layout', () => {
  it('round-trips local <-> world and puts the bulb exactly at LAMPS.deskLamp', () => {
    const w = deskLocalToWorld(LAMP_BULB_LOCAL)
    w.forEach((v, i) => expect(v).toBeCloseTo(LAMPS.deskLamp[i], 9))
    const p = deskWorldToLocal(deskLocalToWorld([0.3, 1, -0.2]))
    expect(p[0]).toBeCloseTo(0.3)
    expect(p[2]).toBeCloseTo(-0.2)
  })

  it('colliders are well-formed, named desk:*, and inside the room', () => {
    const boxes = deskColliders()
    expect(boxes.map((b) => b.id)).toEqual(['desk:desk', 'desk:chair'])
    for (const b of boxes) {
      for (let i = 0; i < 3; i++) expect(b.max[i]).toBeGreaterThan(b.min[i])
      expect(b.min[0]).toBeGreaterThanOrEqual(-HALF_W)
      expect(b.max[0]).toBeLessThanOrEqual(HALF_W)
      expect(b.min[2]).toBeGreaterThanOrEqual(-HALF_D)
      expect(b.max[2]).toBeLessThanOrEqual(HALF_D)
      expect(b.min[1]).toBeGreaterThanOrEqual(0)
      expect(b.max[1]).toBeLessThanOrEqual(ROOM.height)
    }
  })

  it('leaves the screenshot spot in front of the desk walkable', () => {
    for (const b of deskColliders()) expect(-6.5 - PLAYER.radius).toBeGreaterThan(b.max[0])
  })
})
