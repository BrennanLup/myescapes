/**
 * Stylized shared material set (workstream 3: Materials and Look).
 *
 * `getMaterial(id)` returns one cached THREE.Material per id. Base colours come
 * from PALETTE / LIGHT; most materials also get a light greyscale procedural
 * detail map that multiplies that colour. Never dispose a returned material;
 * clone it for per-object tweaks, or use `getTiledMaterial` for a different
 * texture repeat.
 */
import * as THREE from 'three'
import { useMemo } from 'react'
import { MATERIAL_IDS, type MaterialId } from '@/contracts/materials'
import { PALETTE, LIGHT } from '@/contracts/style'
import { getTexture, getBumpTexture, type TextureName } from './textures'

export { getTexture, getBumpTexture, canvasAvailable, textureGenerationMs, textureTimings, TEXTURE_NAMES } from './textures'
export type { TextureName } from './textures'

/** Emissive strengths, tuned for a luminance-threshold bloom with tone mapping. */
export const EMISSIVE = {
  warm: 2.6,
  teal: 2.8,
  screen: 1.2,
  string: 0.35,
  pin: 0.25,
} as const

/** Base colour for every material id (what `material.color` is set to). */
export const MATERIAL_COLORS: Record<MaterialId, string> = {
  woodLight: PALETTE.woodLight,
  woodDark: PALETTE.woodDark,
  woodFloor: PALETTE.woodFloor,
  plaster: PALETTE.plaster,
  plasterAccent: PALETTE.plasterAccent,
  baseboard: PALETTE.baseboard,
  ceiling: PALETTE.ceiling,
  fabricOrange: PALETTE.fabricOrange,
  fabricTeal: PALETTE.fabricTeal,
  fabricCream: PALETTE.fabricCream,
  fabricPlum: PALETTE.fabricPlum,
  rug: PALETTE.rug,
  metal: PALETTE.metal,
  metalDark: PALETTE.metalDark,
  brass: PALETTE.brass,
  paper: PALETTE.paper,
  cork: PALETTE.cork,
  chalkboard: PALETTE.chalkboard,
  ceramic: PALETTE.ceramic,
  leaf: PALETTE.leaf,
  pot: PALETTE.pot,
  glass: '#cfe8ff',
  screen: PALETTE.screen,
  emissiveWarm: LIGHT.lampWarm,
  emissiveTeal: LIGHT.ledTeal,
  redString: PALETTE.redString,
  pinRed: PALETTE.pinRed,
}

interface Spec {
  roughness: number
  metalness?: number
  map?: TextureName
  bump?: number
  flat?: boolean
  side?: THREE.Side
  emissive?: string
  emissiveIntensity?: number
  emissiveMap?: TextureName
  transparent?: boolean
  opacity?: number
  /** Full-colour map: material colour becomes white when the map exists. */
  fullColorMap?: boolean
}

const SPECS: Record<MaterialId, Spec> = {
  woodLight: { roughness: 0.62, map: 'woodGrain' },
  woodDark: { roughness: 0.55, map: 'woodGrain' },
  woodFloor: { roughness: 0.68, map: 'planks', bump: 0.6 },
  plaster: { roughness: 0.95, map: 'plaster' },
  plasterAccent: { roughness: 0.9, map: 'plaster' },
  baseboard: { roughness: 0.55 },
  ceiling: { roughness: 1, map: 'plaster' },
  fabricOrange: { roughness: 0.95, map: 'fabric', bump: 0.4, flat: true },
  fabricTeal: { roughness: 0.95, map: 'fabric', bump: 0.4, flat: true },
  fabricCream: { roughness: 0.95, map: 'fabric', bump: 0.4, flat: true },
  fabricPlum: { roughness: 0.95, map: 'fabric', bump: 0.4, flat: true },
  rug: { roughness: 1, map: 'rug', bump: 0.5, fullColorMap: true },
  metal: { roughness: 0.38, metalness: 0.55 },
  metalDark: { roughness: 0.48, metalness: 0.5 },
  brass: { roughness: 0.32, metalness: 0.7, emissive: PALETTE.brass, emissiveIntensity: 0.06 },
  paper: { roughness: 0.9, map: 'paper', side: THREE.DoubleSide },
  cork: { roughness: 1, map: 'cork', bump: 0.8 },
  chalkboard: { roughness: 0.95, map: 'chalk' },
  ceramic: { roughness: 0.28 },
  leaf: { roughness: 0.7, flat: true, side: THREE.DoubleSide },
  pot: { roughness: 0.85, flat: true },
  glass: { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22 },
  screen: { roughness: 0.25, emissive: '#2f9fa0', emissiveIntensity: EMISSIVE.screen, emissiveMap: 'screen' },
  emissiveWarm: { roughness: 0.5, emissive: LIGHT.lampWarm, emissiveIntensity: EMISSIVE.warm },
  emissiveTeal: { roughness: 0.5, emissive: LIGHT.ledTeal, emissiveIntensity: EMISSIVE.teal },
  redString: { roughness: 0.6, emissive: PALETTE.redString, emissiveIntensity: EMISSIVE.string },
  pinRed: { roughness: 0.3, emissive: PALETTE.pinRed, emissiveIntensity: EMISSIVE.pin },
}

function build(id: MaterialId): THREE.MeshStandardMaterial {
  const s = SPECS[id]
  const map = s.map ? getTexture(s.map) : null
  const m = new THREE.MeshStandardMaterial({
    name: `mat:${id}`,
    color: s.fullColorMap && map ? '#ffffff' : MATERIAL_COLORS[id],
    roughness: s.roughness,
    metalness: s.metalness ?? 0,
    flatShading: s.flat ?? false,
    side: s.side ?? THREE.FrontSide,
  })
  if (map) m.map = map
  if (s.bump && s.map) {
    const bump = getBumpTexture(s.map)
    if (bump) {
      m.bumpMap = bump
      m.bumpScale = s.bump
    }
  }
  if (s.emissive) {
    m.emissive.set(s.emissive)
    m.emissiveIntensity = s.emissiveIntensity ?? 1
  }
  if (s.emissiveMap) {
    const em = getTexture(s.emissiveMap)
    if (em) m.emissiveMap = em
  }
  if (s.transparent) {
    m.transparent = true
    m.opacity = s.opacity ?? 0.3
    m.depthWrite = false
  }
  return m
}

const cache = new Map<MaterialId, THREE.Material>()

/** Shared material by id. Never dispose the returned material; clone it if you need to modify it. */
export function getMaterial(id: MaterialId): THREE.Material {
  let m = cache.get(id)
  if (!m) {
    m = build(id)
    cache.set(id, m)
  }
  return m
}

/** Same as getMaterial but typed as MeshStandardMaterial (every id is one). */
export function getStandardMaterial(id: MaterialId): THREE.MeshStandardMaterial {
  return getMaterial(id) as THREE.MeshStandardMaterial
}

const tiledCache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * A cached clone of `getMaterial(id)` whose texture maps repeat `rx` x `ry`
 * times across the mesh's 0..1 UVs (e.g. a 4 m wall of plaster: (2, 1)).
 * Materials without maps return the shared material unchanged.
 */
export function getTiledMaterial(id: MaterialId, rx: number, ry: number): THREE.MeshStandardMaterial {
  const base = getStandardMaterial(id)
  if (!base.map && !base.bumpMap) return base
  const key = `${id}|${rx}|${ry}`
  let m = tiledCache.get(key)
  if (!m) {
    m = base.clone()
    m.name = `mat:${id}:${rx}x${ry}`
    if (base.map) {
      m.map = base.map.clone()
      m.map.repeat.set(rx, ry)
      m.map.needsUpdate = true
    }
    if (base.bumpMap) {
      m.bumpMap = base.bumpMap.clone()
      m.bumpMap.repeat.set(rx, ry)
      m.bumpMap.needsUpdate = true
    }
    tiledCache.set(key, m)
  }
  return m
}

/** React convenience: the shared material for `id` (stable across renders). */
export function useMaterial(id: MaterialId): THREE.Material {
  return useMemo(() => getMaterial(id), [id])
}

/** Build every material now (e.g. behind the loading screen). */
export function warmMaterials(): void {
  for (const id of MATERIAL_IDS) getMaterial(id)
}

/** Test helper: drop cached materials. */
export function __resetMaterials() {
  cache.clear()
  tiledCache.clear()
}
