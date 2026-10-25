/**
 * Dusk backdrop seen through the windows: an open cylinder around the room
 * (inside faces) with a canvas texture of a peach-to-plum gradient, stars, a
 * moon and a low-poly skyline of rooftops and pine trees with warm windows.
 */
import * as THREE from 'three'
import { PALETTE } from '@/contracts/style'
import { rng } from './layout'

export const SKY = {
  radius: 30,
  /** World Y of the cylinder's bottom and top edges. */
  bottom: -20,
  top: 30,
  /** World Y of the outside ground line. */
  ground: -0.2,
  /** Texture u where the moon sits (visible through the south-east window). */
  moonU: 0.08,
  moonY: 4.6,
} as const

const W = 2048
const H = 512

/** Canvas y (pixels from the top) for a world height on the cylinder. */
function py(y: number) {
  return (1 - (y - SKY.bottom) / (SKY.top - SKY.bottom)) * H
}
/** Pixels per metre (horizontal, at the cylinder radius). */
const PXM = W / (2 * Math.PI * SKY.radius)

function drawSkyline(ctx: CanvasRenderingContext2D, seed: number, color: string, scale: number, lit: boolean) {
  const rand = rng(seed)
  const base = py(SKY.ground)
  let x = 0
  ctx.fillStyle = color
  while (x < W) {
    const pick = rand()
    if (pick < 0.45) {
      // Pine: stacked triangles.
      const h = (4 + rand() * 6) * scale * PXM
      const w = h * 0.45
      for (let i = 0; i < 3; i++) {
        const t = i / 3
        ctx.beginPath()
        ctx.moveTo(x + w / 2, base - h + t * h * 0.15)
        ctx.lineTo(x + w * (0.1 - t * 0.1) , base - h * (0.45 - t * 0.2) * 1.2)
        ctx.lineTo(x + w * (0.9 + t * 0.1), base - h * (0.45 - t * 0.2) * 1.2)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillRect(x + w * 0.1, base - h * 0.35, w * 0.8, h * 0.35)
      x += w * (0.6 + rand() * 0.6)
    } else if (pick < 0.7) {
      // Round deciduous tree.
      const r = (1.6 + rand() * 1.8) * scale * PXM
      ctx.beginPath()
      ctx.arc(x + r, base - r * 1.5, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(x + r * 0.85, base - r * 1.5, r * 0.3, r * 1.5)
      x += r * (1.4 + rand())
    } else {
      // House with a pitched roof and a chimney.
      const w = (5 + rand() * 6) * scale * PXM
      const h = (3 + rand() * 3) * scale * PXM
      const roof = w * (0.3 + rand() * 0.2)
      ctx.fillRect(x, base - h, w, h)
      ctx.beginPath()
      ctx.moveTo(x - w * 0.06, base - h)
      ctx.lineTo(x + w / 2, base - h - roof)
      ctx.lineTo(x + w * 1.06, base - h)
      ctx.closePath()
      ctx.fill()
      ctx.fillRect(x + w * 0.7, base - h - roof * 0.9, w * 0.08, roof * 0.6)
      if (lit) {
        const n = 1 + Math.floor(rand() * 3)
        for (let i = 0; i < n; i++) {
          if (rand() < 0.3) continue
          ctx.fillStyle = rand() < 0.5 ? '#ffc477' : '#ffa95c'
          const ww = w * 0.13
          ctx.fillRect(x + w * (0.15 + i * 0.27), base - h * 0.72, ww, ww * 1.1)
          ctx.fillStyle = color
        }
      }
      x += w * (1.1 + rand() * 0.5)
    }
    x += rand() * 12 * scale
  }
}

export function createSkyTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Gradient: deep plum high up, soft purple, rose, then the peach horizon glow.
  // Stops are placed by world height (the windows see roughly y = -0.5..6 on the cylinder).
  const groundPx = py(SKY.ground)
  const at = (y: number) => Math.min(1, Math.max(0, py(y) / groundPx))
  const g = ctx.createLinearGradient(0, 0, 0, groundPx)
  g.addColorStop(0, '#2c2148')
  g.addColorStop(at(16), '#463263')
  g.addColorStop(at(8), '#7c5288')
  g.addColorStop(at(4.5), '#c47a92')
  g.addColorStop(at(2), '#f0a08a')
  g.addColorStop(1, PALETTE.sky)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, py(SKY.ground) + 1)

  // Stars in the upper sky.
  const rand = rng(42)
  for (let i = 0; i < 260; i++) {
    const x = rand() * W
    const y = rand() * py(5)
    ctx.globalAlpha = 0.35 + rand() * 0.6
    ctx.fillStyle = '#fff4dc'
    const s = rand() < 0.1 ? 2.2 : 1.2
    ctx.fillRect(x, y, s, s)
  }
  ctx.globalAlpha = 1

  // Moon with a soft halo.
  const mx = SKY.moonU * W
  const my = py(SKY.moonY)
  const mr = 1.3 * PXM
  const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5)
  halo.addColorStop(0, 'rgba(255,240,215,0.55)')
  halo.addColorStop(1, 'rgba(255,240,215,0)')
  ctx.fillStyle = halo
  ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10)
  ctx.fillStyle = '#fff2d6'
  ctx.beginPath()
  ctx.arc(mx, my, mr, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(230,205,180,0.6)'
  ctx.beginPath()
  ctx.arc(mx - mr * 0.3, my + mr * 0.2, mr * 0.22, 0, Math.PI * 2)
  ctx.arc(mx + mr * 0.35, my - mr * 0.3, mr * 0.14, 0, Math.PI * 2)
  ctx.fill()

  // Two skyline layers: hazy far hills/trees, then darker near houses.
  drawSkyline(ctx, 3, '#9a6a8c', 0.6, false)
  drawSkyline(ctx, 11, '#4a3050', 0.42, true)

  // Ground below the skyline.
  const gg = ctx.createLinearGradient(0, py(SKY.ground), 0, H)
  gg.addColorStop(0, '#3a2840')
  gg.addColorStop(1, '#231a2a')
  ctx.fillStyle = gg
  ctx.fillRect(0, py(SKY.ground), W, H - py(SKY.ground))

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}
