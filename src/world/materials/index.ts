/**
 * Shared PBR material set (workstream 3: Materials and Look).
 *
 * `getMaterial(id)` returns one cached THREE.Material per id (all
 * MeshStandardMaterial, some MeshPhysicalMaterial for varnish, sheen and
 * glass). Base colours come from PALETTE / LIGHT; most materials also get a
 * procedural detail map that multiplies that colour, plus normal and
 * roughness maps derived from the same generator. Never dispose a returned material;
 * clone it for per-object tweaks, or use `getTiledMaterial` for a different
 * texture repeat.
 */
import * as THREE from 'three'
import { useMemo } from 'react'
import { MATERIAL_IDS, type MaterialId } from '@/contracts/materials'
import { PALETTE, LIGHT } from '@/contracts/style'
import { getTexture, getNormalTexture, getRoughnessTexture, roughnessMapMean, type TextureName } from './textures'

export {
  getTexture,
  getBumpTexture,
  getNormalTexture,
  getRoughnessTexture,
  roughnessMapMean,
  canvasAvailable,
  textureGenerationMs,
  textureTimings,
  TEXTURE_NAMES,
  TEXTURE_ANISOTROPY,
} from './textures'
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
  /** Target mean roughness (the roughness map, if any, is scaled to average this). */
  roughness: number
  metalness?: number
  map?: TextureName
  /** Use the texture's normal map at this normalScale. */
  normal?: number
  /** Use the texture's roughness map (scaled so its mean equals `roughness`). */
  roughMap?: boolean
  /** Take normal / roughness maps from another texture than `map` (or without a map). */
  detail?: TextureName
  side?: THREE.Side
  emissive?: string
  emissiveIntensity?: number
  emissiveMap?: TextureName
  transparent?: boolean
  opacity?: number
  /** Full-colour map: material colour becomes white when the map exists. */
  fullColorMap?: boolean
  /** MeshPhysicalMaterial extras (only set where the look needs them). */
  physical?: {
    clearcoat?: number
    clearcoatRoughness?: number
    sheen?: number
    sheenRoughness?: number
    /** Mix of the base colour towards white for the sheen tint (0 = base colour). */
    sheenLift?: number
    ior?: number
    specularIntensity?: number
  }
  envMapIntensity?: number
}

const VARNISH = { clearcoat: 0.35, clearcoatRoughness: 0.22 }
const FABRIC: Spec = {
  roughness: 0.9,
  map: 'fabric',
  normal: 0.7,
  roughMap: true,
  physical: { sheen: 0.6, sheenRoughness: 0.55, sheenLift: 0.35 },
}

const SPECS: Record<MaterialId, Spec> = {
  woodLight: { roughness: 0.5, map: 'woodGrain', normal: 0.45, roughMap: true, physical: VARNISH },
  woodDark: { roughness: 0.44, map: 'woodGrain', normal: 0.45, roughMap: true, physical: VARNISH },
  woodFloor: {
    roughness: 0.42,
    map: 'planks',
    normal: 0.8,
    roughMap: true,
    physical: { clearcoat: 0.3, clearcoatRoughness: 0.18 },
  },
  plaster: { roughness: 0.92, map: 'plaster', normal: 0.35, roughMap: true },
  plasterAccent: { roughness: 0.86, map: 'plaster', normal: 0.3, roughMap: true },
  // Semi-gloss painted trim.
  baseboard: { roughness: 0.42, detail: 'plaster', normal: 0.12 },
  ceiling: { roughness: 0.95, map: 'plaster', normal: 0.25, roughMap: true },
  fabricOrange: FABRIC,
  fabricTeal: FABRIC,
  fabricCream: FABRIC,
  fabricPlum: FABRIC,
  rug: { roughness: 1, map: 'rug', normal: 0.9, fullColorMap: true },
  // Brushed steel / aluminium, dark powder-coated steel, polished brass. Metals
  // rely on scene.environment for their reflections.
  metal: { roughness: 0.34, metalness: 0.9, map: 'brushed', roughMap: true },
  metalDark: { roughness: 0.48, metalness: 0.65, detail: 'brushed', roughMap: true },
  brass: {
    roughness: 0.26,
    metalness: 0.95,
    detail: 'brushed',
    roughMap: true,
    emissive: PALETTE.brass,
    emissiveIntensity: 0.04,
  },
  paper: { roughness: 0.9, map: 'paper', normal: 0.35, roughMap: true, side: THREE.DoubleSide },
  cork: { roughness: 1, map: 'cork', normal: 0.9 },
  chalkboard: { roughness: 0.85, map: 'chalk', normal: 0.25, roughMap: true },
  // Glazed ceramic: glossy dielectric with a crisp clearcoat highlight.
  ceramic: { roughness: 0.22, physical: { clearcoat: 0.6, clearcoatRoughness: 0.06 } },
  // Waxy leaves: a faint self-glow of their own colour fakes light passing through.
  leaf: { roughness: 0.48, side: THREE.DoubleSide, emissive: PALETTE.leaf, emissiveIntensity: 0.06 },
  // Unglazed terracotta.
  pot: { roughness: 0.88, map: 'clay', normal: 0.5, roughMap: true },
  glass: {
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    physical: { ior: 1.5, specularIntensity: 1 },
    envMapIntensity: 1.2,
  },
  screen: { roughness: 0.12, emissive: '#2f9fa0', emissiveIntensity: EMISSIVE.screen, emissiveMap: 'screen' },
  emissiveWarm: { roughness: 0.5, emissive: LIGHT.lampWarm, emissiveIntensity: EMISSIVE.warm },
  emissiveTeal: { roughness: 0.5, emissive: LIGHT.ledTeal, emissiveIntensity: EMISSIVE.teal },
  redString: { roughness: 0.6, emissive: PALETTE.redString, emissiveIntensity: EMISSIVE.string },
  pinRed: { roughness: 0.3, emissive: PALETTE.pinRed, emissiveIntensity: EMISSIVE.pin },
}

function build(id: MaterialId): THREE.MeshStandardMaterial {
  const s = SPECS[id]
  const map = s.map ? getTexture(s.map) : null
  const detail = s.detail ?? s.map
  const params: THREE.MeshStandardMaterialParameters = {
    name: `mat:${id}`,
    color: s.fullColorMap && map ? '#ffffff' : MATERIAL_COLORS[id],
    roughness: s.roughness,
    metalness: s.metalness ?? 0,
    side: s.side ?? THREE.FrontSide,
  }
  let m: THREE.MeshStandardMaterial
  if (s.physical) {
    const p = s.physical
    const pm = new THREE.MeshPhysicalMaterial(params)
    if (p.clearcoat) {
      pm.clearcoat = p.clearcoat
      pm.clearcoatRoughness = p.clearcoatRoughness ?? 0.1
    }
    if (p.sheen) {
      pm.sheen = p.sheen
      pm.sheenRoughness = p.sheenRoughness ?? 0.5
      pm.sheenColor.set(MATERIAL_COLORS[id]).lerp(new THREE.Color('#ffffff'), p.sheenLift ?? 0)
    }
    if (p.ior !== undefined) pm.ior = p.ior
    if (p.specularIntensity !== undefined) pm.specularIntensity = p.specularIntensity
    m = pm
  } else {
    m = new THREE.MeshStandardMaterial(params)
  }
  if (map) m.map = map
  if (detail && s.normal) {
    const n = getNormalTexture(detail)
    if (n) {
      m.normalMap = n
      m.normalScale.set(s.normal, s.normal)
    }
  }
  if (detail && s.roughMap) {
    const r = getRoughnessTexture(detail)
    if (r) {
      m.roughnessMap = r
      m.roughness = s.roughness / roughnessMapMean(detail)
    }
  }
  if (s.envMapIntensity !== undefined) m.envMapIntensity = s.envMapIntensity
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

/** Same as getMaterial but typed as MeshStandardMaterial (every id is one, or a MeshPhysicalMaterial subclass). */
export function getStandardMaterial(id: MaterialId): THREE.MeshStandardMaterial {
  return getMaterial(id) as THREE.MeshStandardMaterial
}

const tiledCache = new Map<string, THREE.MeshStandardMaterial>()

/** Texture slots that tiled clones re-repeat (the emissive screen map stays 0..1). */
const TILED_SLOTS = ['map', 'normalMap', 'roughnessMap', 'bumpMap'] as const

/**
 * A cached clone of `getMaterial(id)` whose texture maps repeat `rx` x `ry`
 * times across the mesh's 0..1 UVs (e.g. a 4 m wall of plaster: (2, 1)).
 * Materials without maps return the shared material unchanged.
 */
export function getTiledMaterial(id: MaterialId, rx: number, ry: number): THREE.MeshStandardMaterial {
  const base = getStandardMaterial(id)
  if (!TILED_SLOTS.some((k) => base[k])) return base
  const key = `${id}|${rx}|${ry}`
  let m = tiledCache.get(key)
  if (!m) {
    m = base.clone()
    m.name = `mat:${id}:${rx}x${ry}`
    for (const k of TILED_SLOTS) {
      const t = base[k]
      if (!t) continue
      // Clones share the source image, so the GPU upload happens once.
      const c = t.clone()
      c.repeat.set(rx, ry)
      c.needsUpdate = true
      m[k] = c
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
