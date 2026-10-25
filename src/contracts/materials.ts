/**
 * Material contract. Every mesh in the world should use a shared material by id
 * via `getMaterial(id)` from `src/world/materials` so the look stays consistent.
 * The materials workstream owns the implementation; this file only names them.
 *
 * Owned by the orchestrator.
 */
export const MATERIAL_IDS = [
  'woodLight',
  'woodDark',
  'woodFloor',
  'plaster',
  'plasterAccent',
  'baseboard',
  'ceiling',
  'fabricOrange',
  'fabricTeal',
  'fabricCream',
  'fabricPlum',
  'rug',
  'metal',
  'metalDark',
  'brass',
  'paper',
  'cork',
  'chalkboard',
  'ceramic',
  'leaf',
  'pot',
  'glass',
  'screen',
  'emissiveWarm',
  'emissiveTeal',
  'redString',
  'pinRed',
] as const

export type MaterialId = (typeof MATERIAL_IDS)[number]
