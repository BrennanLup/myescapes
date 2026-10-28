/**
 * Pure description of the light rig per quality preset. No three.js imports so
 * it is trivially unit-testable; `index.tsx` turns it into real lights.
 */
import { LAMPS, LED_STRIPS, ANCHORS, HALF_W, type Vec3 } from '@/contracts/scene'
import { LIGHT } from '@/contracts/style'
import type { QualityPreset } from '@/state/store'

export interface HemiLightSpec {
  kind: 'hemisphere'
  id: string
  skyColor: string
  groundColor: string
  intensity: number
}
export interface PointLightSpec {
  kind: 'point'
  id: string
  position: Vec3
  color: string
  intensity: number
  distance: number
  decay: number
}
export interface SpotLightSpec {
  kind: 'spot'
  id: string
  position: Vec3
  target: Vec3
  color: string
  intensity: number
  distance: number
  decay: number
  angle: number
  penumbra: number
  castShadow: boolean
  shadowMapSize: number
}
export interface DirectionalLightSpec {
  kind: 'directional'
  id: string
  position: Vec3
  target: Vec3
  color: string
  intensity: number
  castShadow?: boolean
  shadowMapSize?: number
}
export type LightSpec = HemiLightSpec | PointLightSpec | SpotLightSpec | DirectionalLightSpec

export interface PostSpec {
  /** Mount the EffectComposer (AO, bloom, tone mapping, grade, vignette, grain). Off at low: renderer tone maps instead. */
  enabled: boolean
  multisampling: number
  /** Screen-space ambient occlusion (N8AO): contact shadows in corners, under furniture and between books. */
  ao: { enabled: boolean; radius: number; intensity: number; distanceFalloff: number; quality: 'performance' | 'low' | 'medium'; halfRes: boolean }
  bloom: { intensity: number; threshold: number; smoothing: number; mipmapBlur: boolean }
  /** Colour grade applied after tone mapping. */
  grade: { saturation: number; contrast: number; brightness: number }
  vignette: { offset: number; darkness: number }
  /** Film grain opacity (0 = off). */
  grain: number
}

/** Image-based light and the "air" in the room: window light shafts, lamp haze and dust motes. */
export interface AtmosphereSpec {
  /** scene.environmentIntensity for the generated room environment map (0 = no env map). */
  envIntensity: number
  envResolution: number
  /** Moonlight shafts through the windows (additive volumes). */
  shafts: boolean
  shaftOpacity: number
  /** Soft cones of haze under the two pendants. */
  lampHaze: boolean
  /** Floating dust motes in the shafts and lamp pools. */
  dustCount: number
}

export interface LightRig {
  quality: QualityPreset
  lights: LightSpec[]
  post: PostSpec
  atmosphere: AtmosphereSpec
  /** Emissive intensity for the teal LED strip meshes (HDR, so bloom picks it up). */
  ledEmissiveIntensity: number
}

const lamp = (id: string, position: Vec3, intensity: number, distance: number, color: string = LIGHT.lampWarm): PointLightSpec => ({
  kind: 'point',
  id,
  position,
  color,
  intensity,
  distance,
  decay: 2,
})

const pendant = (id: string, position: Vec3, shadowMapSize = 0): SpotLightSpec => ({
  kind: 'spot',
  id,
  position,
  target: [position[0], 0, position[2]],
  color: LIGHT.fillWarm,
  intensity: 44,
  distance: 12,
  decay: 2,
  angle: 1.15,
  penumbra: 1,
  castShadow: shadowMapSize > 0,
  shadowMapSize,
})

/**
 * Where the moonlight comes from: the moon's azimuth on the sky cylinder (south-south-east,
 * seen through the south-east window), raised to about 28 degrees so the window light lands
 * a few metres inside the room as bright patches.
 */
export const MOON_TARGET: Vec3 = [1, 0, -1]
export const MOON_POSITION: Vec3 = [MOON_TARGET[0] + 8.6, 9.5, MOON_TARGET[2] + 15.8]
/** Unit vector the moonlight travels along (from the moon into the room). */
export function moonDirection(): Vec3 {
  const d = MOON_TARGET.map((v, i) => v - MOON_POSITION[i]) as Vec3
  const n = Math.hypot(...d)
  return [d[0] / n, d[1] / n, d[2] / n]
}

/** Warm bounce colour off the honey floor, so ceilings and undersides never go muddy. */
export const HEMI_GROUND = LIGHT.hemiGround

/** Midpoint of an LED strip, nudged into the room so the spill hits nearby surfaces. */
export function stripMidpoint(i: number, nudge: Vec3 = [0, 0, 0]): Vec3 {
  const s = LED_STRIPS[i]
  return [(s.from[0] + s.to[0]) / 2 + nudge[0], (s.from[1] + s.to[1]) / 2 + nudge[1], (s.from[2] + s.to[2]) / 2 + nudge[2]]
}

export function lightRig(quality: QualityPreset): LightRig {
  const shadows = quality !== 'low'
  const lights: LightSpec[] = [
    // Warm ambient fill. At low there is no environment map, so it carries the whole room;
    // above low the generated environment does most of the bounce and this only lifts the shadows.
    { kind: 'hemisphere', id: 'fill', skyColor: LIGHT.hemiSky, groundColor: HEMI_GROUND, intensity: quality === 'low' ? 1.4 : 0.14 },
    lamp('floorLamp', LAMPS.floorLamp, quality === 'low' ? 9 : 12, quality === 'low' ? 9 : 8),
    lamp('deskLamp', LAMPS.deskLamp, quality === 'low' ? 5 : 7, 6),
    // Pendants have shades, so they throw a soft downward cone instead of blasting the ceiling.
    pendant('pendantA', LAMPS.pendantA, quality === 'high' ? 1024 : 0),
    pendant('pendantB', LAMPS.pendantB),
    {
      kind: 'spot',
      id: 'boardSpot',
      position: LAMPS.boardSpot,
      target: [...ANCHORS.bulletinBoard.position] as Vec3,
      color: LIGHT.fillWarm,
      intensity: 26,
      distance: 10,
      decay: 2,
      angle: 0.9,
      penumbra: 0.75,
      castShadow: shadows,
      shadowMapSize: quality === 'high' ? 2048 : 1024,
    },
  ]
  if (quality !== 'low') {
    // Teal spill from the long north strip onto the top of the wall and ceiling.
    lights.push(lamp('ledSpillNorth', stripMidpoint(0, [0, -0.5, 1.2]), 1.4, 7, LIGHT.ledTeal))
    // Moonlight through the windows. The walls and ceiling cast, so it only lands where the
    // window openings let it in: cool patches with mullion shadows on the floor.
    lights.push({
      kind: 'directional',
      id: 'moon',
      position: MOON_POSITION,
      target: MOON_TARGET,
      color: LIGHT.windowCool,
      intensity: 4.5,
      castShadow: true,
      shadowMapSize: quality === 'high' ? 2048 : 1024,
    })
  }
  if (quality === 'high') {
    lights.push(lamp('ledSpillDesk', stripMidpoint(1, [0.3, 0, 0]), 1.6, 3.5, LIGHT.ledTeal))
    lights.push(lamp('ledSpillShelves', stripMidpoint(2, [-0.3, 0.15, 0]), 1.6, 3.5, LIGHT.ledTeal))
    lights.push(lamp('windowWest', [-HALF_W + 0.6, 1.9, 6.7], 2.2, 5, LIGHT.windowCool))
  }

  const post: PostSpec = {
    enabled: quality !== 'low',
    multisampling: quality === 'high' ? 4 : quality === 'medium' ? 2 : 0,
    ao: {
      enabled: quality !== 'low',
      radius: 0.9,
      intensity: quality === 'high' ? 3 : 2.5,
      distanceFalloff: 0.6,
      quality: quality === 'high' ? 'medium' : 'performance',
      halfRes: quality !== 'high',
    },
    bloom: {
      intensity: quality === 'high' ? 1.05 : 0.85,
      // Scene values are linear HDR before tone mapping; only emissives (> 1) cross this.
      threshold: 1.0,
      smoothing: 0.3,
      mipmapBlur: true,
    },
    grade: { saturation: 0.1, contrast: 0.16, brightness: -0.02 },
    vignette: { offset: 0.28, darkness: 0.62 },
    grain: quality === 'high' ? 0.05 : 0.035,
  }

  const atmosphere: AtmosphereSpec = {
    envIntensity: quality === 'low' ? 0 : 0.32,
    envResolution: quality === 'high' ? 256 : 128,
    shafts: quality !== 'low',
    shaftOpacity: quality === 'high' ? 0.6 : 0.5,
    lampHaze: quality !== 'low',
    dustCount: quality === 'high' ? 260 : quality === 'medium' ? 110 : 0,
  }

  return { quality, lights, post, atmosphere, ledEmissiveIntensity: quality === 'low' ? 1.2 : 2.6 }
}

export function shadowCasterCount(rig: LightRig): number {
  return rig.lights.filter((l) => (l.kind === 'spot' || l.kind === 'directional') && l.castShadow).length
}
