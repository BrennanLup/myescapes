import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { MATERIAL_IDS } from '@/contracts/materials'
import { PALETTE, LIGHT } from '@/contracts/style'
import {
  getMaterial,
  getStandardMaterial,
  getTiledMaterial,
  getTexture,
  getNormalTexture,
  getRoughnessTexture,
  getBumpTexture,
  roughnessMapMean,
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
    for (const n of TEXTURE_NAMES) {
      expect(getTexture(n)).toBeNull()
      expect(getNormalTexture(n)).toBeNull()
      expect(getRoughnessTexture(n)).toBeNull()
      expect(getBumpTexture(n)).toBeNull()
      expect(roughnessMapMean(n)).toBe(1)
    }
    const floor = getStandardMaterial('woodFloor')
    expect(floor.map).toBeNull()
    expect(floor.normalMap).toBeNull()
    expect(floor.roughnessMap).toBeNull()
    // Without a roughness map the scalar is the target mean itself.
    expect(floor.roughness).toBeGreaterThan(0.2)
    expect(floor.roughness).toBeLessThan(0.7)
    expect(getStandardMaterial('rug').color.getHex()).toBe(new THREE.Color(PALETTE.rug).getHex())
  })

  it('tiled variants are cached and untextured ids pass through', () => {
    expect(getTiledMaterial('plaster', 2, 1)).toBe(getTiledMaterial('plaster', 2, 1))
    expect(getTiledMaterial('metal', 3, 3)).toBe(getMaterial('metal'))
    expect(() => warmMaterials()).not.toThrow()
  })

  it('uses smooth shading everywhere and physical extras where they matter', () => {
    for (const id of MATERIAL_IDS) expect(getStandardMaterial(id).flatShading, id).toBe(false)
    const glass = getMaterial('glass')
    expect(glass).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect((glass as THREE.MeshPhysicalMaterial).transmission).toBe(0)
    expect((glass as THREE.MeshPhysicalMaterial).roughness).toBeLessThan(0.1)
    for (const id of ['woodLight', 'woodDark', 'woodFloor'] as const) {
      const m = getMaterial(id) as THREE.MeshPhysicalMaterial
      expect(m, id).toBeInstanceOf(THREE.MeshPhysicalMaterial)
      expect(m.clearcoat, id).toBeGreaterThan(0)
    }
    const sofa = getMaterial('fabricPlum') as THREE.MeshPhysicalMaterial
    expect(sofa).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(sofa.sheen).toBeGreaterThan(0)
  })

  it('metals are metallic, dielectrics are not', () => {
    expect(getStandardMaterial('brass').metalness).toBeGreaterThanOrEqual(0.9)
    expect(getStandardMaterial('metal').metalness).toBeGreaterThanOrEqual(0.8)
    for (const id of ['plaster', 'fabricTeal', 'ceramic', 'leaf', 'paper', 'glass'] as const) {
      expect(getStandardMaterial(id).metalness, id).toBe(0)
    }
  })

  it('tiled clones repeat every texture slot (with real textures)', () => {
    // Fake a textured base: tiled clones must re-repeat map, normal and roughness maps.
    const base = getStandardMaterial('woodFloor')
    const saved = { map: base.map, normalMap: base.normalMap, roughnessMap: base.roughnessMap }
    base.map = new THREE.Texture()
    base.normalMap = new THREE.Texture()
    base.roughnessMap = new THREE.Texture()
    try {
      const t = getTiledMaterial('woodFloor', 7, 3)
      expect(t).not.toBe(base)
      expect(t).toBeInstanceOf(THREE.MeshPhysicalMaterial)
      for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) {
        expect(t[slot], slot).not.toBe(base[slot])
        expect(t[slot]?.repeat.x, slot).toBe(7)
        expect(t[slot]?.repeat.y, slot).toBe(3)
        expect(t[slot]?.source, slot).toBe(base[slot]?.source)
      }
      expect(t.color.getHex()).toBe(base.color.getHex())
    } finally {
      Object.assign(base, saved)
    }
  })
})
