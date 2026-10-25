/**
 * Preallocated string mesh: every link is a thin triangular-prism tube made of two
 * halves (6 rings each). The halves meet in the middle while tied and separate when
 * the string unties, so one fixed topology covers drawing, hanging and untying.
 * Updating writes into the same Float32Arrays every frame (no allocations).
 */
import * as THREE from 'three'
import { sagPointInto } from './sag'

export const RING = 3
export const HALF = 6
export const POINTS = HALF * 2
export const VERTS_PER_LINK = POINTS * RING
export const INDICES_PER_LINK = (HALF - 1) * 2 * RING * 6

export class StringGeometry {
  readonly geometry = new THREE.BufferGeometry()
  readonly maxLinks: number
  private readonly pos: Float32Array
  private readonly nrm: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly nrmAttr: THREE.BufferAttribute
  private readonly pts = new Float32Array(POINTS * 3)

  constructor(maxLinks: number) {
    this.maxLinks = maxLinks
    const verts = maxLinks * VERTS_PER_LINK
    this.pos = new Float32Array(verts * 3)
    this.nrm = new Float32Array(verts * 3)
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage)
    const index = new Uint16Array(maxLinks * INDICES_PER_LINK)
    let k = 0
    for (let l = 0; l < maxLinks; l++) {
      const base = l * VERTS_PER_LINK
      for (let j = 0; j < POINTS - 1; j++) {
        if (j === HALF - 1) continue // the gap between the two halves
        for (let s = 0; s < RING; s++) {
          const s2 = (s + 1) % RING
          const a = base + j * RING + s
          const b = base + j * RING + s2
          const c = base + (j + 1) * RING + s
          const d = base + (j + 1) * RING + s2
          index[k++] = a
          index[k++] = c
          index[k++] = b
          index[k++] = b
          index[k++] = c
          index[k++] = d
        }
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.geometry.setAttribute('position', this.posAttr)
    this.geometry.setAttribute('normal', this.nrmAttr)
    this.geometry.setDrawRange(0, 0)
    // Everything lives on the north-wall board; a generous fixed bound avoids recomputing it.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, -7.9), 8)
  }

  /**
   * Writes link `slot`: the left half covers curve parameters [l0, l1], the right half [r0, r1].
   * Tied: l = [0, .5], r = [.5, 1]. Drawing to p: l = [0, min(p,.5)], r = [.5, max(p,.5)].
   * Untying to p: l = [0, p/2], r = [1 - p/2, 1].
   */
  writeLink(
    slot: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    drop: number,
    l0: number,
    l1: number,
    r0: number,
    r1: number,
    radius: number,
  ) {
    const pts = this.pts
    const pos = this.pos
    const nrm = this.nrm
    const dx = bx - ax
    const dyLin = by - ay
    const dz = bz - az
    let v = slot * VERTS_PER_LINK * 3
    for (let j = 0; j < POINTS; j++) {
      const left = j < HALF
      const u = (left ? j : j - HALF) / (HALF - 1)
      const t = left ? l0 + (l1 - l0) * u : r0 + (r1 - r0) * u
      sagPointInto(pts, j * 3, ax, ay, az, bx, by, bz, t, drop)
      // Analytic tangent of the parabola: never degenerate, even for collapsed halves.
      let tx = dx
      let ty = dyLin - 4 * drop * (1 - 2 * t)
      let tz = dz
      let len = Math.hypot(tx, ty, tz)
      if (len < 1e-9) {
        tx = 1
        ty = 0
        tz = 0
        len = 1
      }
      tx /= len
      ty /= len
      tz /= len
      // side = tangent x +Z (board normal), up = side x tangent (points out of the board).
      let sx = ty
      let sy = -tx
      const sl = Math.hypot(sx, sy) || 1
      sx /= sl
      sy /= sl
      const ux = sy * tz
      const uy = -sx * tz
      const uz = sx * ty - sy * tx
      const px = pts[j * 3]
      const py = pts[j * 3 + 1]
      const pz = pts[j * 3 + 2]
      for (let s = 0; s < RING; s++) {
        const th = Math.PI / 2 + (s * 2 * Math.PI) / RING
        const c = Math.cos(th)
        const sn = Math.sin(th)
        const nx = c * sx + sn * ux
        const ny = c * sy + sn * uy
        const nz = sn * uz
        pos[v] = px + nx * radius
        pos[v + 1] = py + ny * radius
        pos[v + 2] = pz + nz * radius
        nrm[v] = nx
        nrm[v + 1] = ny
        nrm[v + 2] = nz
        v += 3
      }
    }
  }

  /** Uploads the first `count` links and draws only those. */
  commit(count: number) {
    const n = Math.min(count, this.maxLinks)
    this.geometry.setDrawRange(0, n * INDICES_PER_LINK)
    if (n === 0) return
    const floats = n * VERTS_PER_LINK * 3
    this.posAttr.clearUpdateRanges()
    this.posAttr.addUpdateRange(0, floats)
    this.posAttr.needsUpdate = true
    this.nrmAttr.clearUpdateRanges()
    this.nrmAttr.addUpdateRange(0, floats)
    this.nrmAttr.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
  }
}
