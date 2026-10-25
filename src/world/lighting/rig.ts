/**
 * Pure description of the light rig per quality preset. No three.js imports so
 * it is trivially unit-testable; `index.tsx` turns it into real lights.
 */
import { LAMPS, LED_STRIPS, ANCHORS, HALF_D, HALF_W, type Vec3 } from '@/contracts/scene'
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
}
export type LightSpec = HemiLightSpec | PointLightSpec | SpotLightSpec | DirectionalLightSpec

export interface PostSpec {
  /** Mount the EffectComposer (bloom + tone mapping + vignette). Off at low: renderer tone maps instead. */
  enabled: boolean
  multisampling: number
  bloom: { intensity: number; threshold: number; smoothing: number; mipmapBlur: boolean }
  vignette: { offset: number; darkness: number }
}

export interface LightRig {
  quality: QualityPreset
  lights: LightSpec[]
  post: PostSpec
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

const pendant = (id: string, position: Vec3): SpotLightSpec => ({
  kind: 'spot',
  id,
  position,
  target: [position[0], 0, position[2]],
  color: LIGHT.fillWarm,
  intensity: 36,
  distance: 11,
  decay: 2,
  angle: 1.15,
  penumbra: 1,
  castShadow: false,
  shadowMapSize: 0,
})

/** Warm bounce colour off the honey floor, so ceilings and undersides never go muddy. */
export const HEMI_GROUND = '#9a6550'

/** Midpoint of an LED strip, nudged into the room so the spill hits nearby surfaces. */
export function stripMidpoint(i: number, nudge: Vec3 = [0, 0, 0]): Vec3 {
  const s = LED_STRIPS[i]
  return [(s.from[0] + s.to[0]) / 2 + nudge[0], (s.from[1] + s.to[1]) / 2 + nudge[1], (s.from[2] + s.to[2]) / 2 + nudge[2]]
}

export function lightRig(quality: QualityPreset): LightRig {
  const shadows = quality !== 'low'
  const lights: LightSpec[] = [
    // Warm ambient fill: bright enough that corners never go black.
    { kind: 'hemisphere', id: 'fill', skyColor: LIGHT.hemiSky, groundColor: HEMI_GROUND, intensity: quality === 'low' ? 1.4 : 1.55 },
    lamp('floorLamp', LAMPS.floorLamp, 9, 9),
    lamp('deskLamp', LAMPS.deskLamp, 5, 6),
    // Pendants have shades, so they throw a soft downward cone instead of blasting the ceiling.
    pendant('pendantA', LAMPS.pendantA),
    pendant('pendantB', LAMPS.pendantB),
    {
      kind: 'spot',
      id: 'boardSpot',
      position: LAMPS.boardSpot,
      target: [...ANCHORS.bulletinBoard.position] as Vec3,
      color: LIGHT.fillWarm,
      intensity: 40,
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
    lights.push(lamp('ledSpillNorth', stripMidpoint(0, [0, -0.35, 0.5]), 3, 7, LIGHT.ledTeal))
    // Cool dusk light coming in through the windows (mostly south). No shadows.
    lights.push({
      kind: 'directional',
      id: 'windowFill',
      position: [-8, 6, HALF_D + 4],
      target: [2, 0, -2],
      color: LIGHT.windowCool,
      intensity: 0.15,
    })
  }
  if (quality === 'high') {
    lights.push(lamp('ledSpillDesk', stripMidpoint(1, [0.3, 0, 0]), 1.6, 3.5, LIGHT.ledTeal))
    lights.push(lamp('ledSpillShelves', stripMidpoint(2, [-0.3, 0.15, 0]), 1.6, 3.5, LIGHT.ledTeal))
    lights.push(lamp('windowWest', [-HALF_W + 0.6, 1.9, 6.7], 2.2, 5, LIGHT.windowCool))
  }

  const post: PostSpec = {
    enabled: quality !== 'low',
    multisampling: quality === 'high' ? 8 : quality === 'medium' ? 4 : 0,
    bloom: {
      intensity: quality === 'high' ? 0.9 : 0.75,
      // Scene values are linear HDR before tone mapping; only emissives (> 1) cross this.
      threshold: 1.0,
      smoothing: 0.25,
      mipmapBlur: true,
    },
    vignette: { offset: 0.32, darkness: 0.5 },
  }

  return { quality, lights, post, ledEmissiveIntensity: quality === 'low' ? 1.2 : 2.6 }
}

export function shadowCasterCount(rig: LightRig): number {
  return rig.lights.filter((l) => l.kind === 'spot' && l.castShadow).length
}
