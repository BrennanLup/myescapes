/**
 * Image-based light and atmosphere:
 * - a generated environment map of this room (warm ceiling bounce, lamp hot spots, cool windows,
 *   honey floor), so wood, brass, glass and ceramic get believable reflections and soft bounce;
 * - additive moonlight shafts through the windows, matching the shadowed moon light;
 * - faint haze cones under the pendants;
 * - slow dust motes drifting through the light.
 * Everything here is unlit, depth-tested and never writes depth, so it costs a few draw calls.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { HALF_D, HALF_W, LAMPS, ROOM, WINDOWS, type Vec3 } from '@/contracts/scene'
import { LIGHT } from '@/contracts/style'
import { moonShafts, shaftBounds, windowCorners, type Shaft } from './atmosphere'
import type { AtmosphereSpec } from './rig'

/** The environment is rendered once from the room centre at eye height. Lightformers face that point by default. */
const ENV_ORIGIN: Vec3 = [0, 1.6, 0]
const rel = (p: Vec3): Vec3 => [p[0] - ENV_ORIGIN[0], p[1] - ENV_ORIGIN[1], p[2] - ENV_ORIGIN[2]]

function RoomEnvironment({ intensity, resolution }: { intensity: number; resolution: number }) {
  const ceilingY = ROOM.height - ENV_ORIGIN[1]
  return (
    <Environment frames={1} resolution={resolution} environmentIntensity={intensity} background={false}>
      {/* Warm bounce off the ceiling and the honey floor. */}
      <Lightformer form="rect" intensity={0.45} color={LIGHT.fillWarm} position={[0, ceilingY, 0]} scale={[ROOM.width, ROOM.depth, 1]} />
      <Lightformer form="rect" intensity={0.4} color={LIGHT.hemiGround} position={[0, -ENV_ORIGIN[1], 0]} scale={[ROOM.width, ROOM.depth, 1]} />
      {/* Plaster walls, dim and warm. */}
      <Lightformer form="rect" intensity={0.18} color={LIGHT.hemiSky} position={[0, 0.4, -HALF_D]} scale={[ROOM.width, ROOM.height, 1]} />
      <Lightformer form="rect" intensity={0.18} color={LIGHT.hemiSky} position={[0, 0.4, HALF_D]} scale={[ROOM.width, ROOM.height, 1]} />
      <Lightformer form="rect" intensity={0.15} color={LIGHT.hemiSky} position={[HALF_W, 0.4, 0]} scale={[ROOM.depth, ROOM.height, 1]} />
      <Lightformer form="rect" intensity={0.15} color={LIGHT.hemiSky} position={[-HALF_W, 0.4, 0]} scale={[ROOM.depth, ROOM.height, 1]} />
      {/* Cool dusk windows. */}
      {WINDOWS.map((w, i) => {
        const c = windowCorners(w)
        const mid: Vec3 = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2, (c[0][2] + c[2][2]) / 2]
        return <Lightformer key={i} form="rect" intensity={2.2} color={LIGHT.windowCool} position={rel(mid).map((v, k) => (k === 1 ? v : v * 0.98)) as Vec3} scale={[w.width, w.height, 1]} />
      })}
      {/* Lamp hot spots: the bright specks that make varnish and brass read as glossy. */}
      {Object.entries(LAMPS).map(([id, p]) => (
        <Lightformer key={id} form="circle" intensity={id === 'boardSpot' ? 3 : 6} color={LIGHT.lampWarm} position={rel(p)} scale={id.startsWith('pendant') ? 0.7 : 0.4} />
      ))}
    </Environment>
  )
}

const shaftVertex = /* glsl */ `
  varying float vT;
  varying float vU;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  attribute float shaftT;
  attribute float shaftU;
  attribute float shaftE;
  varying float vE;
  void main() {
    vT = shaftT;
    vU = shaftU;
    vE = shaftE;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const shaftFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  varying float vU;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vE;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    // Every pow() base is clamped: a NaN here would spread over the whole screen through the bloom blur.
    vec3 v = normalize(cameraPosition - vPosW);
    // Faces seen edge-on fade out, so the prism's hard silhouette becomes a soft beam.
    float facing = pow(abs(dot(normalize(vNormalW), v)), 1.6);
    // Bright at the window, dying away towards the floor; never a hard start at the glass.
    float t = clamp(vT, 0.0, 1.0);
    float along = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.35);
    // Dusty streaks across the beam.
    float streak = 0.7 + 0.3 * noise(vU * 9.0) * noise(vU * 23.0 + 4.0);
    // Fade towards each face's long edges, so the prism's corners never read as glass panels.
    float edge = smoothstep(0.0, 0.3, vE) * smoothstep(1.0, 0.7, vE);
    float a = uOpacity * facing * along * streak * edge;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`

/** A closed-sided prism from the window opening to its floor patch, with per-vertex t (0 window, 1 floor) and u (across). */
function shaftGeometry(s: Shaft): THREE.BufferGeometry {
  const pos: number[] = []
  const ts: number[] = []
  const us: number[] = []
  const es: number[] = []
  const U = [0, 1, 1, 0]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    // [corner, t along the beam, e across this face]
    const quad: Array<[Vec3, number, number]> = [
      [s.window[i], 0, 0],
      [s.window[j], 0, 1],
      [s.floor[j], 1, 1],
      [s.window[i], 0, 0],
      [s.floor[j], 1, 1],
      [s.floor[i], 1, 0],
    ]
    for (const [p, t, e] of quad) {
      pos.push(...p)
      ts.push(t)
      es.push(e)
      us.push((e === 0 ? U[i] : U[j]) + i * 0.37)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('shaftT', new THREE.Float32BufferAttribute(ts, 1))
  g.setAttribute('shaftU', new THREE.Float32BufferAttribute(us, 1))
  g.setAttribute('shaftE', new THREE.Float32BufferAttribute(es, 1))
  g.computeVertexNormals()
  return g
}

function additiveMaterial(color: string, opacity: number, vertexShader: string, fragmentShader: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
}

function MoonShafts({ opacity }: { opacity: number }) {
  const shafts = useMemo(() => moonShafts(), [])
  const geoms = useMemo(() => shafts.map(shaftGeometry), [shafts])
  const material = useMemo(() => additiveMaterial(LIGHT.windowCool, opacity, shaftVertex, shaftFragment), [opacity])
  useEffect(
    () => () => {
      geoms.forEach((g) => g.dispose())
      material.dispose()
    },
    [geoms, material],
  )
  return (
    <group name="lighting:shafts">
      {geoms.map((g, i) => (
        <mesh key={shafts[i].id} name={`shaft:${shafts[i].id}`} geometry={g} material={material} renderOrder={5} raycast={() => null} />
      ))}
    </group>
  )
}

const hazeVertex = /* glsl */ `
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vT = uv.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const hazeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 v = normalize(cameraPosition - vPosW);
    float facing = pow(abs(dot(normalize(vNormalW), v)), 2.0);
    // uv.y is 1 at the apex (the shade) and 0 at the base.
    float a = uOpacity * facing * pow(clamp(vT, 0.0, 1.0), 1.8);
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`

const HAZE_HEIGHT = 3.0
const hazeGeometry = new THREE.ConeGeometry(1.5, HAZE_HEIGHT, 40, 1, true)

function LampHaze() {
  const material = useMemo(() => additiveMaterial(LIGHT.lampWarm, 0.1, hazeVertex, hazeFragment), [])
  useEffect(() => () => material.dispose(), [material])
  const lamps = [LAMPS.pendantA, LAMPS.pendantB]
  return (
    <group name="lighting:haze">
      {lamps.map((p, i) => (
        // The cone's apex sits just under the shade; it opens towards the floor.
        <mesh key={i} geometry={hazeGeometry} material={material} position={[p[0], p[1] - 0.15 - HAZE_HEIGHT / 2, p[2]]} renderOrder={5} raycast={() => null} />
      ))}
    </group>
  )
}

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute vec3 aSeed;
  attribute vec3 aColor;
  attribute vec3 aHalf;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    // Slow drift that wraps inside its zone box, plus a gentle sway.
    vec3 p = position;
    p.y = position.y + mod(aSeed.x * 7.0 + uTime * (0.02 + 0.03 * aSeed.y), 2.0 * aHalf.y) - aHalf.y;
    p.x += sin(uTime * 0.21 + aSeed.z * 40.0) * 0.18 * aHalf.x / max(aHalf.x, 1.0);
    p.z += cos(uTime * 0.17 + aSeed.x * 31.0) * 0.18 * aHalf.z / max(aHalf.z, 1.0);
    vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed.y) / max(-mv.z, 0.5) * 6.0;
    vColor = aColor;
    vTwinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed.z) + aSeed.y * 20.0);
  }
`

const dustFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    // Soft round mote with a bounded falloff (drei's Sparkles divides by the distance to the
    // centre, which is infinite on the centre pixel and blows up the HDR bloom).
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = uOpacity * vTwinkle * pow(clamp(1.0 - d, 0.0, 1.0), 2.0);
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }
`

interface DustZone {
  center: Vec3
  size: Vec3
  color: string
}

function dustGeometry(zones: DustZone[], per: number): THREE.BufferGeometry {
  let seed = 1234567
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const pos: number[] = []
  const seeds: number[] = []
  const colors: number[] = []
  const halves: number[] = []
  const c = new THREE.Color()
  for (const z of zones) {
    c.set(z.color)
    for (let i = 0; i < per; i++) {
      pos.push(z.center[0] + (rand() - 0.5) * z.size[0], z.center[1], z.center[2] + (rand() - 0.5) * z.size[2])
      seeds.push(rand(), rand(), rand())
      colors.push(c.r, c.g, c.b)
      halves.push(z.size[0] / 2, z.size[1] / 2, z.size[2] / 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3))
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
  g.setAttribute('aHalf', new THREE.Float32BufferAttribute(halves, 3))
  return g
}

function Dust({ count }: { count: number }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const { geometry, material } = useMemo(() => {
    const shafts: DustZone[] = moonShafts().map((s) => ({ ...shaftBounds(s), color: LIGHT.windowCool }))
    const lamps: DustZone[] = [LAMPS.pendantA, LAMPS.pendantB, LAMPS.floorLamp].map((p) => ({ center: [p[0], 1.6, p[2]], size: [2.4, 2.6, 2.4], color: LIGHT.fillWarm }))
    const zones = [...shafts, ...lamps]
    const geometry = dustGeometry(zones, Math.max(8, Math.round(count / zones.length)))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: 1.4 }, uPixelRatio: { value: 1 }, uOpacity: { value: 0.55 } },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry, material }
  }, [count])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.1)
    material.uniforms.uPixelRatio.value = dpr
  })
  return <points name="lighting:dust" geometry={geometry} material={material} frustumCulled={false} renderOrder={6} raycast={() => null} />
}

export function Atmosphere({ spec }: { spec: AtmosphereSpec }) {
  return (
    <group name="lighting:atmosphere">
      {spec.envIntensity > 0 && <RoomEnvironment intensity={spec.envIntensity} resolution={spec.envResolution} />}
      {spec.shafts && <MoonShafts opacity={spec.shaftOpacity} />}
      {spec.lampHaze && <LampHaze />}
      {spec.dustCount > 0 && <Dust count={spec.dustCount} />}
    </group>
  )
}
