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
import { Environment, Lightformer, Sparkles } from '@react-three/drei'
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
  void main() {
    vT = shaftT;
    vU = shaftU;
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
    float a = uOpacity * facing * along * streak;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`

/** A closed-sided prism from the window opening to its floor patch, with per-vertex t (0 window, 1 floor) and u (across). */
function shaftGeometry(s: Shaft): THREE.BufferGeometry {
  const pos: number[] = []
  const ts: number[] = []
  const us: number[] = []
  const U = [0, 1, 1, 0]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const quad: Array<[Vec3, number, number]> = [
      [s.window[i], 0, U[i]],
      [s.window[j], 0, U[j]],
      [s.floor[j], 1, U[j]],
      [s.window[i], 0, U[i]],
      [s.floor[j], 1, U[j]],
      [s.floor[i], 1, U[i]],
    ]
    for (const [p, t, u] of quad) {
      pos.push(...p)
      ts.push(t)
      us.push(u + i * 0.37)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('shaftT', new THREE.Float32BufferAttribute(ts, 1))
  g.setAttribute('shaftU', new THREE.Float32BufferAttribute(us, 1))
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

function Dust({ count }: { count: number }) {
  const zones = useMemo(() => {
    const shafts = moonShafts().map(shaftBounds)
    const lampZones = [LAMPS.pendantA, LAMPS.pendantB, LAMPS.floorLamp].map((p) => ({ center: [p[0], 1.6, p[2]] as Vec3, size: [2.4, 2.6, 2.4] as Vec3 }))
    return [...shafts.map((z) => ({ ...z, cool: true })), ...lampZones.map((z) => ({ ...z, cool: false }))]
  }, [])
  const per = Math.max(8, Math.round(count / zones.length))
  return (
    <group name="lighting:dust">
      {zones.map((z, i) => (
        <Sparkles
          key={i}
          count={per}
          position={z.center}
          scale={z.size}
          size={1.1}
          speed={0.12}
          noise={0.6}
          opacity={z.cool ? 0.4 : 0.25}
          color={z.cool ? LIGHT.windowCool : LIGHT.fillWarm}
        />
      ))}
    </group>
  )
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
