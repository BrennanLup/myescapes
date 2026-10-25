import { describe, expect, it } from 'vitest'
import { ANCHORS, HALF_D, HALF_W, LAMPS, LED_STRIPS, ROOM } from '@/contracts/scene'
import { lightRig, shadowCasterCount, type PointLightSpec, type SpotLightSpec } from './rig'
import { stripTransforms, STRIP_THICKNESS } from './strips'

const presets = ['low', 'medium', 'high'] as const

describe('lightRig', () => {
  it('has fewer lights at low than medium, and more at high', () => {
    const n = presets.map((q) => lightRig(q).lights.length)
    expect(n[0]).toBeLessThan(n[1])
    expect(n[1]).toBeLessThan(n[2])
    expect(n[1]).toBeLessThanOrEqual(8)
  })

  it('has unique light ids', () => {
    for (const q of presets) {
      const ids = lightRig(q).lights.map((l) => l.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('casts exactly one shadow at medium/high and none at low', () => {
    expect(shadowCasterCount(lightRig('low'))).toBe(0)
    expect(shadowCasterCount(lightRig('medium'))).toBe(1)
    expect(shadowCasterCount(lightRig('high'))).toBe(1)
  })

  it('puts a warm lamp at every LAMPS point', () => {
    for (const q of presets) {
      const lights = lightRig(q).lights
      for (const [id, pos] of Object.entries(LAMPS)) {
        const l = lights.find((x) => x.id === id) as PointLightSpec | SpotLightSpec | undefined
        expect(l, `${q}:${id}`).toBeDefined()
        expect(l!.position).toEqual(pos)
      }
    }
  })

  it('aims the board spot at the bulletin board centre', () => {
    const spot = lightRig('medium').lights.find((l) => l.id === 'boardSpot') as SpotLightSpec
    expect(spot.kind).toBe('spot')
    expect(spot.target).toEqual([...ANCHORS.bulletinBoard.position])
    const d = Math.hypot(...spot.position.map((v, i) => v - spot.target[i]))
    expect(spot.distance).toBeGreaterThan(d)
  })

  it('keeps point lights inside the room', () => {
    for (const q of presets) {
      for (const l of lightRig(q).lights) {
        if (l.kind !== 'point') continue
        expect(Math.abs(l.position[0])).toBeLessThan(HALF_W)
        expect(Math.abs(l.position[2])).toBeLessThan(HALF_D)
        expect(l.position[1]).toBeGreaterThan(0)
        expect(l.position[1]).toBeLessThan(ROOM.height)
      }
    }
  })

  it('enables post-processing only above low, with MSAA scaling', () => {
    expect(lightRig('low').post.enabled).toBe(false)
    expect(lightRig('medium').post.enabled).toBe(true)
    expect(lightRig('high').post.multisampling).toBeGreaterThan(lightRig('medium').post.multisampling)
  })
})

describe('stripTransforms', () => {
  it('spans each LED segment', () => {
    const t = stripTransforms(LED_STRIPS)
    expect(t).toHaveLength(LED_STRIPS.length)
    LED_STRIPS.forEach((s, i) => {
      const len = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2])
      expect(t[i].scale).toEqual([STRIP_THICKNESS, STRIP_THICKNESS, len])
      expect(t[i].position[0]).toBeCloseTo((s.from[0] + s.to[0]) / 2)
      expect(t[i].position[2]).toBeCloseTo((s.from[2] + s.to[2]) / 2)
    })
  })
})
