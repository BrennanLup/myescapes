/**
 * Furniture Set B: the desk terminal on the west wall (workstream 5).
 * Static furniture is merged into one mesh per material; the screens, LEDs,
 * bulb and hover rim are separate so they can animate.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Anchor } from '@/world/Anchor'
import { getMaterial } from '@/world/materials'
import { useColliders } from '@/contracts/colliders'
import { interactable } from '@/contracts/interaction'
import { LIGHT } from '@/contracts/style'
import { useStore } from '@/state/store'
import { D, LAMP_BULB_LOCAL, deskColliders } from './layout'
import { ledParts, mergeByMaterial, staticParts, type PartMat } from './parts'
import { TERMINAL_CANVAS, drawSideScreen, drawTerminal, terminalFrame } from './terminal'

export const DESK_TERMINAL_ID = 'desk:terminal'

function tinted(base: THREE.Material, patch: Partial<THREE.MeshStandardMaterialParameters>) {
  const m = base.clone() as THREE.MeshStandardMaterial
  m.setValues(patch)
  return m
}

function useDeskMaterials() {
  const mats = useMemo(() => {
    const led = tinted(getMaterial('emissiveTeal'), {
      color: LIGHT.ledTeal,
      emissive: new THREE.Color(LIGHT.ledTeal),
      emissiveIntensity: 1.6,
      toneMapped: false,
    })
    const own = {
      stickyYellow: tinted(getMaterial('paper'), { color: '#ffe27a' }),
      stickyPink: tinted(getMaterial('paper'), { color: '#ff9fb8' }),
      plastic: tinted(getMaterial('metalDark'), { color: '#2a2e35', roughness: 0.55 }),
      shade: tinted(getMaterial('fabricOrange'), { side: THREE.DoubleSide, emissive: new THREE.Color('#7a3a10'), emissiveIntensity: 0.4 }),
      led,
    }
    const shared = (id: Exclude<PartMat, keyof typeof own>) => getMaterial(id)
    const get = (k: PartMat): THREE.Material => (k in own ? own[k as keyof typeof own] : shared(k as Exclude<PartMat, keyof typeof own>))
    return { own, get }
  }, [])
  useEffect(() => () => Object.values(mats.own).forEach((m) => m.dispose()), [mats])
  return mats
}

function useCanvasTexture(w: number, h: number) {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [w, h])
  useEffect(() => () => tex.dispose(), [tex])
  return tex
}

export function DeskProps() {
  const boxes = useMemo(() => deskColliders(), [])
  useColliders(boxes)

  const { get, own } = useDeskMaterials()
  const staticGeo = useMemo(() => mergeByMaterial(staticParts()), [])
  const ledGeo = useMemo(() => mergeByMaterial(ledParts()).get('led')!, [])
  useEffect(
    () => () => {
      staticGeo.forEach((g) => g.dispose())
      ledGeo.dispose()
    },
    [staticGeo, ledGeo],
  )

  const hovered = useStore((s) => s.hoveredId === DESK_TERMINAL_ID)
  const roomCount = useStore((s) => s.rooms.length)

  // Main terminal screen: animated canvas, used as both map and emissive map.
  const termTex = useCanvasTexture(TERMINAL_CANVAS.width, TERMINAL_CANVAS.height)
  const screenMat = useMemo(
    () =>
      tinted(getMaterial('screen'), {
        color: '#000000',
        map: termTex,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: termTex,
        emissiveIntensity: 1.1,
        roughness: 0.35,
        toneMapped: false,
      }),
    [termTex],
  )
  const sideTex = useCanvasTexture(384, 240)
  const sideMat = useMemo(() => {
    const ctx = sideTex.image instanceof HTMLCanvasElement ? sideTex.image.getContext('2d') : null
    if (ctx) drawSideScreen(ctx, 384, 240)
    sideTex.needsUpdate = true
    return tinted(getMaterial('screen'), {
      color: '#000000',
      map: sideTex,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: sideTex,
      emissiveIntensity: 0.8,
      roughness: 0.35,
      toneMapped: false,
    })
  }, [sideTex])
  const bulbMat = useMemo(
    () => tinted(getMaterial('emissiveWarm'), { color: LIGHT.lampWarm, emissive: new THREE.Color(LIGHT.lampWarm), emissiveIntensity: 2.2, toneMapped: false }),
    [],
  )
  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: LIGHT.ledTeal,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        visible: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      screenMat.dispose()
      sideMat.dispose()
      bulbMat.dispose()
      rimMat.dispose()
    },
    [screenMat, sideMat, bulbMat, rimMat],
  )

  const glow = useRef(0)
  const lastKey = useRef('')
  const ctx = useMemo(() => (termTex.image instanceof HTMLCanvasElement ? termTex.image.getContext('2d') : null), [termTex])

  useFrame((state, dt) => {
    const target = hovered ? 1 : 0
    glow.current += (target - glow.current) * (1 - Math.exp(-dt * 8))
    const g = glow.current
    screenMat.emissiveIntensity = 1.1 + g * 0.9
    sideMat.emissiveIntensity = 0.8 + g * 0.4
    own.led.emissiveIntensity = 1.6 + g * 2.4
    rimMat.opacity = g * 0.42
    rimMat.visible = g > 0.01

    const frame = terminalFrame(state.clock.elapsedTime, hovered, roomCount)
    if (ctx && frame.key !== lastKey.current) {
      lastKey.current = frame.key
      drawTerminal(ctx, frame)
      termTex.needsUpdate = true
    }
  })

  const mm = D.mainMonitor
  const sm = D.sideMonitor
  return (
    <Anchor name="desk">
      <group
        name="desk:terminal"
        {...interactable({ id: DESK_TERMINAL_ID, kind: 'desk', label: 'Log a new escape room', event: { type: 'record:open', payload: {} } })}
      >
        {[...staticGeo].map(([k, geo]) => (
          <mesh key={k} geometry={geo} material={get(k)} castShadow receiveShadow />
        ))}
        <mesh geometry={ledGeo} material={own.led} />

        <group position={mm.pos} rotation={[0, mm.rotY, 0]}>
          <mesh position={[0, 0, 0.019]} material={screenMat}>
            <planeGeometry args={[mm.w, mm.h]} />
          </mesh>
          <mesh material={rimMat} position={[0, 0, -0.01]} raycast={() => null}>
            <boxGeometry args={[mm.w + 0.1, mm.h + 0.1, 0.09]} />
          </mesh>
        </group>
        <group position={sm.pos} rotation={[0, sm.rotY, 0]}>
          <mesh position={[0, 0, 0.019]} material={sideMat}>
            <planeGeometry args={[sm.w, sm.h]} />
          </mesh>
          <mesh material={rimMat} position={[0, 0, -0.01]} raycast={() => null}>
            <boxGeometry args={[sm.w + 0.08, sm.h + 0.08, 0.08]} />
          </mesh>
        </group>

        <mesh position={LAMP_BULB_LOCAL} material={bulbMat}>
          <sphereGeometry args={[0.035, 12, 8]} />
        </mesh>
      </group>
    </Anchor>
  )
}
