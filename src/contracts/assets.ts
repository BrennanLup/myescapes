/**
 * Asset manifest contract.
 *
 * Default policy: geometry is procedural (low-poly primitives) and textures are
 * generated on canvas, so most workstreams need no asset files at all. If a
 * workstream does ship a file, it goes under `public/assets/<workstream>/`,
 * must be CC0 (Kenney, Quaternius, Poly Pizza) and gets a line in CREDITS.md.
 * Models must be glTF/GLB compressed with Draco or meshopt. Initial load budget: 15 MB total.
 *
 * Register files in a manifest so the loading screen can show progress:
 *
 *   export const manifest: AssetManifest = [
 *     { id: 'plant-monstera', kind: 'gltf', url: '/assets/living/monstera.glb', bytes: 84_000, license: 'CC0', author: 'Quaternius' },
 *   ]
 *   registerAssets(manifest)
 *
 * Then load with drei (`useGLTF(assetUrl('plant-monstera'))`, `useTexture`) inside
 * <Suspense>. drei's `useProgress` drives the loading screen.
 *
 * Owned by the orchestrator.
 */

export type AssetKind = 'gltf' | 'texture' | 'audio' | 'font' | 'json'

export interface AssetEntry {
  id: string
  kind: AssetKind
  /** Absolute URL path served from `public/`, e.g. `/assets/living/plant.glb`. */
  url: string
  /** Approximate size in bytes; used for the performance budget check. */
  bytes: number
  license: 'CC0' | 'generated' | 'own'
  author?: string
  source?: string
}

export type AssetManifest = AssetEntry[]

/** Initial load budget in bytes (15 MB). */
export const LOAD_BUDGET_BYTES = 15 * 1024 * 1024

const registry = new Map<string, AssetEntry>()

export function registerAssets(manifest: AssetManifest): void {
  for (const a of manifest) registry.set(a.id, a)
}

export function assetUrl(id: string): string {
  const a = registry.get(id)
  if (!a) throw new Error(`Unknown asset id: ${id}`)
  return a.url
}

export function allAssets(): AssetEntry[] {
  return [...registry.values()]
}

export function totalAssetBytes(): number {
  let n = 0
  for (const a of registry.values()) n += a.bytes
  return n
}
