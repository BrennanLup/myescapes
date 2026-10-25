import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { MATERIAL_IDS } from '@/contracts/materials'
import { PALETTE, LIGHT } from '@/contracts/style'
import {
  getMaterial,
  getStandardMaterial,
  getTiledMaterial,
  getTexture,
  canvasAvailable,
  warmMaterials,
  MATERIAL_COLORS,
  TEXTURE_NAMES,
  EMISSIVE,
} from './index'

describe('materials', () => {
  it('returns a lit material for every id', () => {
    for (const id of MATERIAL_IDS) {
      const m = getMaterial(id)
      expect(m, id).toBeInstanceOf(THREE.Material)
      expect(m, id).toBeInstanceOf(THREE.MeshStandardMaterial)
    }
  })

  it('caches: the same id returns the same instance', () => {
    for (const id of MATERIAL_IDS) expect(getMaterial(id)).toBe(getMaterial(id))
    expect(getMaterial('woodLight')).not.toBe(getMaterial('woodDark'))
  })

  it('base colours match the palette', () => {
    const paletteIds = Object.keys(PALETTE) as (keyof typeof PALETTE)[]
    for (const id of MATERIAL_IDS) {
      const expected = new THREE.Color(MATERIAL_COLORS[id])
      expect(getStandardMaterial(id).color.getHex(), id).toBe(expected.getHex())
      if ((paletteIds as string[]).includes(id)) {
        expect(MATERIAL_COLORS[id], id).toBe(PALETTE[id as keyof typeof PALETTE])
      }
    }
    expect(getStandardMaterial('emissiveWarm').color.getHex()).toBe(new THREE.Color(LIGHT.lampWarm).getHex())
    expect(getStandardMaterial('emissiveTeal').color.getHex()).toBe(new THREE.Color(LIGHT.ledTeal).getHex())
  })

  it('emissives are strong enough to bloom; glass is transparent', () => {
    expect(getStandardMaterial('emissiveWarm').emissiveIntensity).toBeGreaterThanOrEqual(2)
    expect(getStandardMaterial('emissiveTeal').emissiveIntensity).toBeGreaterThanOrEqual(2)
    expect(getStandardMaterial('emissiveTeal').emissive.getHex()).toBe(new THREE.Color(LIGHT.ledTeal).getHex())
    expect(getStandardMaterial('screen').emissiveIntensity).toBe(EMISSIVE.screen)
    const glass = getStandardMaterial('glass')
    expect(glass.transparent).toBe(true)
    expect(glass.opacity).toBeLessThan(0.5)
    expect(glass.depthWrite).toBe(false)
  })

  it('falls back to plain colour without canvas (jsdom)', () => {
    expect(canvasAvailable()).toBe(false)
    for (const n of TEXTURE_NAMES) expect(getTexture(n)).toBeNull()
    expect(getStandardMaterial('woodFloor').map).toBeNull()
    expect(getStandardMaterial('rug').color.getHex()).toBe(new THREE.Color(PALETTE.rug).getHex())
  })

  it('tiled variants are cached and untextured ids pass through', () => {
    expect(getTiledMaterial('plaster', 2, 1)).toBe(getTiledMaterial('plaster', 2, 1))
    expect(getTiledMaterial('metal', 3, 3)).toBe(getMaterial('metal'))
    expect(() => warmMaterials()).not.toThrow()
  })
})
