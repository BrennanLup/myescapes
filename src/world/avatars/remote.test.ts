import { describe, expect, it } from 'vitest'
import { blobShadowMaterial, G } from './kit'
import { DETAIL_DISTANCE, remoteShadows } from './RemotePlayers'

describe('other players stay cheap to draw', () => {
  it('cast real shadows only on High quality with a mouse', () => {
    expect(remoteShadows('high', false)).toBe(true)
    expect(remoteShadows('high', true)).toBe(false)
    expect(remoteShadows('medium', false)).toBe(false)
    expect(remoteShadows('low', false)).toBe(false)
  })

  it('drop details at a sensible distance', () => {
    expect(DETAIL_DISTANCE).toBeGreaterThanOrEqual(6)
    expect(DETAIL_DISTANCE).toBeLessThanOrEqual(10)
  })

  it('share one blob shadow material and quad', () => {
    const m = blobShadowMaterial()
    expect(blobShadowMaterial()).toBe(m)
    expect(m.depthWrite).toBe(false)
    expect(m.transparent).toBe(true)
    expect(G.floorQuad(0.9)).toBe(G.floorQuad(0.9))
    // Lies flat on the floor, facing up.
    G.floorQuad(0.9).computeBoundingBox()
    expect(G.floorQuad(0.9).boundingBox!.max.y).toBeCloseTo(0)
  })
})
