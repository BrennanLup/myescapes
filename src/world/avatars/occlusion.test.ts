import { describe, expect, it } from 'vitest'
import { blocksPlayer, blocksView, segmentDistance } from './occlusion'

describe('segmentDistance', () => {
  it('measures crossing, parallel and end-point cases', () => {
    expect(segmentDistance([-1, 0, 0], [1, 0, 0], [0, -1, 1], [0, 1, 1]).dist).toBeCloseTo(1)
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]).dist).toBeCloseTo(1)
    const end = segmentDistance([0, 0, 0], [1, 0, 0], [3, 0, 0], [4, 0, 0])
    expect(end.dist).toBeCloseTo(2)
    expect(end.s).toBeCloseTo(1)
    expect(end.t).toBeCloseTo(0)
    expect(segmentDistance([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 2, 0]).dist).toBeCloseTo(0)
  })
})

describe('your character in the way', () => {
  // Phone rig: camera 3.5 m behind the feet and about 2.7 m up, you stand at the origin facing -Z.
  const camera = [0, 2.7, 3.5] as const
  const feet = [0, 0, 0] as const

  it('blocks the view when you aim down through yourself, not when you aim over your head', () => {
    const down = Math.atan2(2.7 - 1, 3.5)
    expect(blocksView(camera, [0, -Math.sin(down), -Math.cos(down)], feet)).toBe(true)
    expect(blocksView(camera, [0, 0, -1], feet)).toBe(false)
    expect(blocksView(camera, [Math.sin(0.4), -0.2, -Math.cos(0.4)], feet)).toBe(false)
  })

  it('blocks a friend standing in front of you, not one beside or behind the camera', () => {
    expect(blocksPlayer(camera, feet, [0, 0, -1.5])).toBe(true)
    expect(blocksPlayer(camera, feet, [2, 0, -1.5])).toBe(false)
    expect(blocksPlayer(camera, feet, [0, 0, 5])).toBe(false)
    // Right next to you (shoulder to shoulder) is not "behind".
    expect(blocksPlayer(camera, feet, [0.35, 0, 0])).toBe(false)
  })
})
