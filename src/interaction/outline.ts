/**
 * Inverted-hull outline: for each visible mesh under the hovered root we draw a
 * copy of its geometry, grown by a few millimetres about its bounding-box centre,
 * with an unlit teal material. Closed meshes use back faces (only the rim shows
 * around the silhouette); flat meshes (planes, photos, decals) use a coplanar hull
 * whose fragments inside the source's footprint are discarded, so it only ever
 * draws a border and never paints over the source (e.g. the chalk writing on the
 * wish-list board) whatever the view angle or depth precision. No post pass.
 */
import * as THREE from 'three'
import { LIGHT } from '@/contracts/style'
import { hullScale, outlineThickness, rimHalfExtents } from './logic'

const MAX_HULL_MESHES = 32

const vertexShader = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uScale;
varying vec3 vLocal;
void main() {
  vec3 p = uCenter + (position - uCenter) * uScale;
  vLocal = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform vec3 uCenter;
uniform vec3 uHole;
uniform float uRim;
varying vec3 vLocal;
void main() {
  // Flat hulls are a rim only: never draw over the source's own footprint.
  if (uRim > 0.5 && all(lessThan(abs(vLocal - uCenter), uHole))) discard;
  gl_FragColor = vec4(uColor * uGlow, 1.0);
  #include <colorspace_fragment>
}
`

const TEAL = new THREE.Color(LIGHT.ledTeal)

function makeHullMaterial(flat: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'interaction-outline',
    vertexShader,
    fragmentShader,
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uScale: { value: new THREE.Vector3(1, 1, 1) },
      uColor: { value: TEAL.clone() },
      uGlow: { value: 1 },
      uHole: { value: new THREE.Vector3() },
      uRim: { value: flat ? 1 : 0 },
    },
    side: flat ? THREE.DoubleSide : THREE.BackSide,
    polygonOffset: flat,
    polygonOffsetFactor: flat ? 2 : 0,
    polygonOffsetUnits: flat ? 2 : 0,
    toneMapped: false,
    fog: false,
  })
}

function isOutlinable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
  if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh) return false
  if (!m.visible || !m.geometry?.attributes?.position) return false
  // troika (drei <Text>) meshes have async glyph geometry; their hull looks wrong.
  const mat = m.material as THREE.Material & { isTroikaTextMaterial?: boolean; visible?: boolean }
  if (Array.isArray(m.material) ? false : mat?.isTroikaTextMaterial || mat?.visible === false) return false
  if ('sync' in m && 'font' in m && 'text' in m) return false
  return true
}

/**
 * Soft decals (transparent, no depth write: drop shadows, tape, the chalk writing)
 * are left out of the outline when the target has solid meshes; their hulls only
 * add stray rectangles around the real silhouette.
 */
export function isDecal(m: THREE.Mesh): boolean {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined
  return !!mat && mat.transparent && !mat.depthWrite
}

interface Hull {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  source: THREE.Mesh
  center: THREE.Vector3
  half: [number, number, number]
}

const _scale = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()

export class OutlineHulls {
  readonly group = new THREE.Group()
  private hulls: Hull[] = []
  private root: THREE.Object3D | null = null

  constructor() {
    this.group.name = 'interaction:outline'
    this.group.userData.interactionIgnore = true
    this.group.matrixAutoUpdate = false
  }

  get target() {
    return this.root
  }

  setTarget(root: THREE.Object3D | null) {
    if (root === this.root) return
    this.clear()
    this.root = root
    if (!root) return
    const found: THREE.Mesh[] = []
    const walk = (o: THREE.Object3D) => {
      if (found.length >= MAX_HULL_MESHES || !o.visible) return
      if (isOutlinable(o)) found.push(o)
      for (const c of o.children) walk(c)
    }
    walk(root)
    const solid = found.filter((m) => !isDecal(m))
    const sources = solid.length > 0 ? solid : found
    for (const source of sources) {
      const geometry = source.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      const box = geometry.boundingBox!
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const half: [number, number, number] = [size.x / 2, size.y / 2, size.z / 2]
      source.updateWorldMatrix(true, false)
      source.matrixWorld.decompose(_pos, _quat, _scale)
      const flat = hullScale(half, [_scale.x, _scale.y, _scale.z], 0.01).flat
      const mesh = new THREE.Mesh(geometry, makeHullMaterial(flat))
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.raycast = () => {}
      mesh.renderOrder = source.renderOrder
      mesh.material.uniforms.uCenter.value.copy(center)
      if (flat) mesh.material.uniforms.uHole.value.fromArray(rimHalfExtents(half, [_scale.x, _scale.y, _scale.z]))
      this.group.add(mesh)
      this.hulls.push({ mesh, source, center, half })
    }
  }

  /** Copies each source's world matrix and resizes the rim for the current view distance. */
  update(cameraPosition: THREE.Vector3, time: number) {
    if (!this.root) return
    const glow = 1.05 + Math.sin(time * 4) * 0.2
    for (const h of this.hulls) {
      h.source.updateWorldMatrix(true, false)
      const mw = h.source.matrixWorld
      h.mesh.matrix.copy(mw)
      h.mesh.matrixWorldNeedsUpdate = true
      h.mesh.visible = h.source.visible
      mw.decompose(_pos, _quat, _scale)
      _pos.set(h.center.x, h.center.y, h.center.z).applyMatrix4(mw)
      const t = outlineThickness(_pos.distanceTo(cameraPosition))
      const { scale } = hullScale(h.half, [_scale.x, _scale.y, _scale.z], t)
      h.mesh.material.uniforms.uScale.value.set(scale[0], scale[1], scale[2])
      h.mesh.material.uniforms.uGlow.value = glow
    }
  }

  clear() {
    for (const h of this.hulls) {
      this.group.remove(h.mesh)
      h.mesh.material.dispose() // geometry is shared with the source; never dispose it
    }
    this.hulls = []
    this.root = null
  }
}
