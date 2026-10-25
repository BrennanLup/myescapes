// PLACEHOLDER (orchestrator). Owned by workstream 3: Materials and Look.
import * as THREE from 'three'
import type { MaterialId } from '@/contracts/materials'
import { PALETTE, LIGHT } from '@/contracts/style'

const cache = new Map<MaterialId, THREE.Material>()

const COLORS: Record<MaterialId, string> = {
  woodLight: PALETTE.woodLight, woodDark: PALETTE.woodDark, woodFloor: PALETTE.woodFloor, plaster: PALETTE.plaster,
  plasterAccent: PALETTE.plasterAccent, baseboard: PALETTE.baseboard, ceiling: PALETTE.ceiling, fabricOrange: PALETTE.fabricOrange,
  fabricTeal: PALETTE.fabricTeal, fabricCream: PALETTE.fabricCream, fabricPlum: PALETTE.fabricPlum, rug: PALETTE.rug,
  metal: PALETTE.metal, metalDark: PALETTE.metalDark, brass: PALETTE.brass, paper: PALETTE.paper, cork: PALETTE.cork,
  chalkboard: PALETTE.chalkboard, ceramic: PALETTE.ceramic, leaf: PALETTE.leaf, pot: PALETTE.pot, glass: '#cfe8ff',
  screen: PALETTE.screen, emissiveWarm: LIGHT.lampWarm, emissiveTeal: LIGHT.ledTeal, redString: PALETTE.redString, pinRed: PALETTE.pinRed,
}

/** Shared material by id. Never dispose the returned material; clone it if you need to modify it. */
export function getMaterial(id: MaterialId): THREE.Material {
  let m = cache.get(id)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: COLORS[id], roughness: 0.8 })
    cache.set(id, m)
  }
  return m
}
