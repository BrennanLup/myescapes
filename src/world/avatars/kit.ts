/**
 * Shared geometries and materials for characters. Everything is cached at module level and
 * shared by every character on screen (your own, other players, the wardrobe preview), so a dozen
 * characters cost a few dozen geometries and one material per colour. Never disposed: the set is
 * small and bounded by the catalogue.
 *
 * Characters don't use `src/world/materials` (owned by the room visuals) because they need any
 * colour from the catalogue; the look (matte, slightly rough, low-poly) follows the same style.
 */
import * as THREE from 'three'

const geoms = new Map<string, THREE.BufferGeometry>()
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoms.get(key) as T | undefined
  if (!g) {
    g = make()
    g.computeBoundingSphere()
    geoms.set(key, g)
  }
  return g
}

const r3 = (n: number) => Math.round(n * 1000)

export const G = {
  capsule: (radius: number, length: number) =>
    cached(`cap:${r3(radius)}:${r3(length)}`, () => new THREE.CapsuleGeometry(radius, length, 3, 10)),
  sphere: (radius: number, w = 14, h = 10) => cached(`sph:${r3(radius)}:${w}:${h}`, () => new THREE.SphereGeometry(radius, w, h)),
  /** Spherical cap from the top (theta in radians from the pole). */
  cap: (radius: number, theta: number) =>
    cached(`scap:${r3(radius)}:${r3(theta)}`, () => new THREE.SphereGeometry(radius, 16, 9, 0, Math.PI * 2, 0, theta)),
  box: (w: number, h: number, d: number) => cached(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  /** A box with softened edges (a squashed, bevel-less look via extra segments is not needed). */
  cylinder: (top: number, bottom: number, height: number, seg = 12, open = false) =>
    cached(`cyl:${r3(top)}:${r3(bottom)}:${r3(height)}:${seg}:${open}`, () => new THREE.CylinderGeometry(top, bottom, height, seg, 1, open)),
  cone: (radius: number, height: number, seg = 6) => cached(`cone:${r3(radius)}:${r3(height)}:${seg}`, () => new THREE.ConeGeometry(radius, height, seg)),
  torus: (radius: number, tube: number, arc = Math.PI * 2, radial = 6, tubular = 18) =>
    cached(`tor:${r3(radius)}:${r3(tube)}:${r3(arc)}:${radial}:${tubular}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular, arc)),
}

const mats = new Map<string, THREE.Material>()

export interface MatOptions {
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
  flat?: boolean
}

/** A cached matte material for a colour. */
export function M(hex: string, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${hex}:${opts.roughness ?? 0.82}:${opts.metalness ?? 0}:${opts.emissive ?? ''}:${opts.emissiveIntensity ?? 0}:${opts.flat ? 1 : 0}`
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: opts.roughness ?? 0.82,
      metalness: opts.metalness ?? 0,
      flatShading: opts.flat ?? false,
      ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 1 } : {}),
    })
    m.name = `avatar:${key}`
    mats.set(key, m)
  }
  return m
}

/** Fixed colours used by the character itself (not part of the outfit). */
export const KIT_COLORS = {
  eye: '#2a1d1a',
  eyeShine: '#ffffff',
  blush: '#e8968a',
  mouth: '#7a3a32',
  sole: '#f3ede4',
  gold: '#d4a24c',
  gem: '#c4313f',
  lens: '#bfe3ef',
  frame: '#2b2624',
  strap: '#4a3a30',
  lanternGlow: '#ffc27a',
  scarf: '#b8503f',
  scarfStripe: '#efe0c8',
  backpack: '#e0a93a',
  headphone: '#3d4248',
  headphoneAccent: '#2de2d0',
} as const

/** Darken (amount < 0) or lighten (amount > 0) a hex colour, for trims and soles. */
export function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)))
  return `#${c.getHexString()}`
}

/** Test helper: how many shared geometries and materials exist. */
export function kitStats() {
  return { geometries: geoms.size, materials: mats.size }
}
