/**
 * A stylised, low-poly character built from three.js primitives: head, body, arms and legs on
 * simple joints, dressed by an `Outfit` (src/world/avatars/catalog.ts). Animated procedurally by
 * `poseAt` (animation.ts) from speed and an optional emote.
 *
 * Coordinates: the group's origin is between the feet on the floor; the character faces local
 * -Z, so `rotation-y={yaw}` uses the same yaw as the camera (`runtime.player.yaw`). Eyes are at
 * PLAYER.eyeHeight (1.6 m). The whole character is ignored by the interaction raycast.
 *
 * The JSX below describes the look as ~40 small meshes; after each new look `bakeCharacter`
 * (bake.ts) merges them into about a dozen, one per joint and finish, so each character costs a
 * dozen draw calls instead of forty. The animation moves the joints, so it moves the merged meshes.
 *
 * Used for you (LocalAvatar), the wardrobe preview, and other players (workstream C):
 *
 *   const motion = useMemo(() => ({ speed: 0, action: 'idle' as CharacterAction }), [])
 *   // update motion.speed / motion.action from the network each frame, no re-render needed
 *   <Character outfit={outfit} motion={motion} position={[x, 0, z]} rotation-y={yaw} />
 */
import { memo, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame, type ThreeElements } from '@react-three/fiber'
import type * as THREE from 'three'
import { advancePhase, poseAt, type CharacterAction } from './animation'
import { fabricHex, hairHex, skinHex, type Outfit } from './catalog'
import { bakeCharacter, disposeFades, EMPTY_BAKE, fadeCharacter, showDetail, unbake, type Baked } from './bake'
import { G, KIT_COLORS, M, shade } from './kit'

/** Mutable motion input, read every frame (write to it instead of re-rendering). */
export interface CharacterMotion {
  /** Horizontal speed in m/s. */
  speed: number
  action?: CharacterAction
  /** Look pitch in radians (the head follows a little). */
  lookPitch?: number
  /**
   * Far away: skip the small details (eyes, nose, mouth, ears, key ring), about a quarter of the
   * meshes, which are a pixel or two at that distance anyway. Set by RemotePlayers.
   */
  far?: boolean
  /** 0..1, default 1: see-through (your own character when it is in the way). */
  opacity?: number
}

export type CharacterProps = Omit<ThreeElements['group'], 'children'> & {
  outfit: Outfit
  motion?: CharacterMotion
  /** Used when no `motion` is given. */
  speed?: number
  action?: CharacterAction
  /** Cast shadows (default true). */
  shadows?: boolean
}

// Body measurements (metres).
const HIP_Y = 0.9
const UPPER_LEG = 0.42
const LOWER_LEG = 0.4
const LEG_R = 0.072
const HIP_X = 0.095
const SHOULDER_Y = 0.45
const SHOULDER_X = 0.235
const UPPER_ARM = 0.27
const FOREARM = 0.25
const ARM_R = 0.052
const NECK_Y = 0.5
const HEAD_R = 0.155
const HEAD_Y = 0.17
const TORSO_H = 0.5

type Joint = RefObject<THREE.Group | null>

export const Character = memo(function Character({ outfit, motion, speed = 0, action = 'idle', shadows = true, ...group }: CharacterProps) {
  const j = {
    body: useRef<THREE.Group>(null),
    hipL: useRef<THREE.Group>(null),
    hipR: useRef<THREE.Group>(null),
    kneeL: useRef<THREE.Group>(null),
    kneeR: useRef<THREE.Group>(null),
    shL: useRef<THREE.Group>(null),
    shR: useRef<THREE.Group>(null),
    elL: useRef<THREE.Group>(null),
    elR: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
  }
  const root = useRef<THREE.Group>(null)
  /** The merged meshes (see bake.ts), redone when the look changes. */
  const bake = useRef<Baked>(EMPTY_BAKE)
  const shownDetail = useRef(true)
  const opacity = useRef(1)
  const fades = useRef(new Map<THREE.Material, THREE.Material>())
  useLayoutEffect(() => {
    const g = root.current
    if (!g) return
    const joints = new Set<THREE.Object3D>()
    for (const r of Object.values(j)) if (r.current) joints.add(r.current)
    bake.current = bakeCharacter(g, joints, shadows, bake.current)
    showDetail(bake.current, shownDetail.current)
    // New meshes start solid: let the next frame fade them again if needed.
    opacity.current = 1
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the joints are stable refs
  }, [outfit, shadows])
  useLayoutEffect(() => {
    const cache = fades.current
    return () => {
      unbake(bake.current)
      bake.current = EMPTY_BAKE
      disposeFades(cache)
    }
  }, [])
  /** Marks a group of small details: baked into the "near" meshes only (see bake.ts). */
  const detailRef = (g: THREE.Group | null) => {
    if (g) g.userData.detail = true
  }
  const anim = useRef({ phase: 0, time: Math.random() * 10 })

  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1)
    const a = anim.current
    const v = motion?.speed ?? speed
    a.time += dt
    a.phase = advancePhase(a.phase, v, dt)
    const p = poseAt({ time: a.time, phase: a.phase, speed: v, action: motion?.action ?? action, lookPitch: motion?.lookPitch ?? 0 })
    const set = (ref: Joint, x: number, z = 0, y = 0) => {
      const o = ref.current
      if (o) o.rotation.set(x, y, z)
    }
    const b = j.body.current
    if (b) {
      b.position.y = p.bob
      b.rotation.set(-p.lean, p.twist, p.sway)
    }
    set(j.hipL, p.hipL)
    set(j.hipR, p.hipR)
    set(j.kneeL, -p.kneeL)
    set(j.kneeR, -p.kneeR)
    set(j.shL, p.shoulderL, -p.armOutL)
    set(j.shR, p.shoulderR, p.armOutR)
    set(j.elL, p.elbowL)
    set(j.elR, p.elbowR)
    set(j.head, -p.headPitch, p.headRoll)
    const detail = !motion?.far
    if (detail !== shownDetail.current) {
      shownDetail.current = detail
      showDetail(bake.current, detail)
    }
    const o = Math.min(1, Math.max(0, motion?.opacity ?? 1))
    // Re-applied every frame while see-through (a far/near swap may show another mesh).
    if ((o < 0.999 || opacity.current < 0.999) && root.current) fadeCharacter(root.current, o, fades.current)
    opacity.current = o
  })

  const c = colours(outfit)
  return (
    <group {...group} userData={{ raycastIgnore: true, ...(group.userData ?? {}) }}>
      <group ref={root}>
        <group ref={j.body}>
          {/* Legs */}
          <group position={[0, HIP_Y, 0]}>
            <Leg side={-1} hip={j.hipL} knee={j.kneeL} outfit={outfit} c={c} />
            <Leg side={1} hip={j.hipR} knee={j.kneeR} outfit={outfit} c={c} />
            <Pelvis outfit={outfit} c={c} />
          </group>
          {/* Torso, arms, head */}
          <group position={[0, HIP_Y, 0]}>
            <Torso outfit={outfit} c={c} />
            <Arm side={-1} shoulder={j.shL} elbow={j.elL} outfit={outfit} c={c} />
            <Arm side={1} shoulder={j.shR} elbow={j.elR} outfit={outfit} c={c} />
            <mesh geometry={G.cylinder(0.052, 0.058, 0.1, 10)} material={M(c.skin)} position={[0, NECK_Y + 0.02, 0]} />
            <group ref={j.head} position={[0, NECK_Y, 0]}>
              <Head outfit={outfit} c={c} detailRef={detailRef} />
            </group>
            <TorsoAccessory outfit={outfit} c={c} detailRef={detailRef} />
          </group>
        </group>
      </group>
    </group>
  )
})

type Colours = ReturnType<typeof colours>
function colours(o: Outfit) {
  return {
    skin: skinHex(o.skin),
    hair: hairHex(o.hairColor),
    top: fabricHex(o.topColor),
    bottom: fabricHex(o.bottomColor),
    shoes: fabricHex(o.shoesColor),
    hat: fabricHex(o.hatColor),
  }
}

interface PartProps {
  outfit: Outfit
  c: Colours
}

/** Flags a group of small details that is skipped far away (see `CharacterMotion.far`). */
type DetailRef = (g: THREE.Group | null) => void

// ---------------------------------------------------------------- legs and shoes

function Leg({ side, hip, knee, outfit, c }: PartProps & { side: -1 | 1; hip: Joint; knee: Joint }) {
  const covered = outfit.bottom === 'bottom-trousers' || outfit.bottom === 'bottom-cargo'
  const upper = outfit.bottom === 'bottom-skirt' ? c.skin : c.bottom
  const lower = covered ? c.bottom : c.skin
  return (
    <group ref={hip} position={[side * HIP_X, 0, 0]}>
      <mesh geometry={G.capsule(LEG_R + 0.006, UPPER_LEG - LEG_R)} material={M(upper, { flat: true })} position={[0, -UPPER_LEG / 2, 0]} />
      {outfit.bottom === 'bottom-shorts' ? (
        <mesh geometry={G.cylinder(LEG_R + 0.018, LEG_R + 0.024, 0.08, 10)} material={M(c.bottom, { flat: true })} position={[0, -UPPER_LEG + 0.12, 0]} />
      ) : null}
      {outfit.bottom === 'bottom-cargo' ? (
        <mesh geometry={G.box(0.05, 0.11, 0.1)} material={M(shade(c.bottom, -0.08), { flat: true })} position={[side * (LEG_R + 0.012), -UPPER_LEG * 0.55, 0]} />
      ) : null}
      <group ref={knee} position={[0, -UPPER_LEG, 0]}>
        <mesh geometry={G.capsule(LEG_R - 0.004, LOWER_LEG - LEG_R)} material={M(lower, { flat: true })} position={[0, -LOWER_LEG / 2, 0]} />
        <group position={[0, -LOWER_LEG - 0.02, 0]}>
          <Shoe outfit={outfit} c={c} side={side} />
        </group>
      </group>
    </group>
  )
}

function Shoe({ outfit, c, side }: PartProps & { side: -1 | 1 }) {
  // Origin: the ankle, about 0.06 m above the floor at rest. Toes point to -Z.
  const sole = M(KIT_COLORS.sole)
  switch (outfit.shoes) {
    case 'shoes-boots':
      return (
        <>
          <mesh geometry={G.box(0.12, 0.16, 0.13)} material={M(c.shoes, { flat: true })} position={[0, 0.02, 0.01]} />
          <mesh geometry={G.box(0.12, 0.07, 0.22)} material={M(c.shoes, { flat: true })} position={[0, -0.025, -0.04]} />
          <mesh geometry={G.box(0.125, 0.025, 0.23)} material={M(shade(c.shoes, -0.15))} position={[0, -0.06, -0.04]} />
        </>
      )
    case 'shoes-hightops':
      return (
        <>
          <mesh geometry={G.box(0.12, 0.13, 0.12)} material={M(c.shoes, { flat: true })} position={[0, 0.03, 0.01]} />
          <mesh geometry={G.box(0.12, 0.07, 0.22)} material={M(c.shoes, { flat: true })} position={[0, -0.025, -0.04]} />
          <mesh geometry={G.box(0.126, 0.03, 0.23)} material={sole} position={[0, -0.058, -0.04]} />
          <mesh geometry={G.box(0.124, 0.035, 0.05)} material={sole} position={[0, -0.03, -0.135]} />
          <mesh geometry={G.cylinder(0.02, 0.02, 0.005, 10)} material={sole} position={[side * 0.062, 0.04, 0.01]} rotation={[0, 0, Math.PI / 2]} />
        </>
      )
    case 'shoes-slippers':
      return (
        <>
          <mesh geometry={G.sphere(0.085, 12, 8)} material={M(c.shoes)} position={[0, -0.02, -0.05]} scale={[0.85, 0.6, 1.45]} />
          <mesh geometry={G.capsule(0.018, 0.07)} material={M(c.shoes)} position={[-0.025, 0.04, -0.1]} rotation={[0.5, 0, 0.25]} />
          <mesh geometry={G.capsule(0.018, 0.07)} material={M(c.shoes)} position={[0.025, 0.04, -0.1]} rotation={[0.5, 0, -0.25]} />
          <mesh geometry={G.sphere(0.012, 8, 6)} material={M(KIT_COLORS.eye)} position={[-0.022, 0.0, -0.165]} />
          <mesh geometry={G.sphere(0.012, 8, 6)} material={M(KIT_COLORS.eye)} position={[0.022, 0.0, -0.165]} />
          <mesh geometry={G.sphere(0.014, 8, 6)} material={M(KIT_COLORS.blush)} position={[0, -0.02, -0.175]} />
        </>
      )
    default: // sneakers
      return (
        <>
          <mesh geometry={G.box(0.115, 0.075, 0.22)} material={M(c.shoes, { flat: true })} position={[0, -0.02, -0.04]} />
          <mesh geometry={G.box(0.122, 0.03, 0.23)} material={sole} position={[0, -0.058, -0.04]} />
          <mesh geometry={G.box(0.07, 0.012, 0.08)} material={M(shade(c.shoes, -0.12))} position={[0, 0.019, -0.06]} />
        </>
      )
  }
}

function Pelvis({ outfit, c }: PartProps) {
  if (outfit.bottom === 'bottom-skirt') {
    return (
      <>
        <mesh geometry={G.cylinder(0.175, 0.17, 0.12, 14)} material={M(c.bottom, { flat: true })} position={[0, 0.0, 0]} />
        <mesh geometry={G.cylinder(0.175, 0.27, 0.3, 14, true)} material={M(c.bottom, { flat: true })} position={[0, -0.2, 0]} />
      </>
    )
  }
  return (
    <>
      <mesh geometry={G.capsule(0.15, 0.06)} material={M(c.bottom, { flat: true })} position={[0, -0.02, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.02, 0.78]} />
      <mesh geometry={G.cylinder(0.166, 0.166, 0.035, 14)} material={M(shade(c.bottom, -0.12))} position={[0, 0.05, 0]} scale={[1, 1, 0.8]} />
    </>
  )
}

// ---------------------------------------------------------------- torso and arms

function Torso({ outfit, c }: PartProps) {
  const top = M(c.top, { flat: true })
  const trim = M(shade(c.top, -0.1), { flat: true })
  const torsoSkin = outfit.top === 'top-tank'
  const parts: ReactNode[] = [
    <mesh key="torso" geometry={G.capsule(0.17, TORSO_H - 0.3)} material={top} position={[0, 0.25, 0]} scale={[1, 1, 0.74]} />,
    // Shoulders: skin under a tank top, fabric otherwise.
    <mesh key="shoulders" geometry={G.capsule(0.07, 0.3)} material={torsoSkin ? M(c.skin) : top} position={[0, SHOULDER_Y - 0.03, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.9]} />,
  ]
  switch (outfit.top) {
    case 'top-sweater':
      parts.push(<mesh key="collar" geometry={G.torus(0.065, 0.022, Math.PI * 2, 6, 14)} material={trim} position={[0, NECK_Y - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} />)
      parts.push(<mesh key="hem" geometry={G.cylinder(0.172, 0.172, 0.05, 14)} material={trim} position={[0, 0.04, 0]} scale={[1, 1, 0.76]} />)
      break
    case 'top-hoodie':
      parts.push(<mesh key="hood" geometry={G.torus(0.1, 0.05, Math.PI * 2, 6, 14)} material={top} position={[0, NECK_Y - 0.03, 0.04]} rotation={[Math.PI / 2 + 0.35, 0, 0]} />)
      parts.push(<mesh key="pocket" geometry={G.box(0.2, 0.09, 0.03)} material={trim} position={[0, 0.13, -0.125]} />)
      parts.push(<mesh key="stringL" geometry={G.cylinder(0.006, 0.006, 0.12, 5)} material={M(KIT_COLORS.sole)} position={[-0.035, NECK_Y - 0.11, -0.13]} />)
      parts.push(<mesh key="stringR" geometry={G.cylinder(0.006, 0.006, 0.12, 5)} material={M(KIT_COLORS.sole)} position={[0.035, NECK_Y - 0.11, -0.13]} />)
      break
    case 'top-jersey': {
      const stripe = M(c.top === fabricHex('white') ? fabricHex('navy') : fabricHex('white'), { flat: true })
      parts.push(<mesh key="s1" geometry={G.cylinder(0.173, 0.173, 0.045, 14)} material={stripe} position={[0, 0.2, 0]} scale={[1, 1, 0.76]} />)
      parts.push(<mesh key="s2" geometry={G.cylinder(0.172, 0.172, 0.045, 14)} material={stripe} position={[0, 0.3, 0]} scale={[1, 1, 0.76]} />)
      parts.push(<mesh key="vneck" geometry={G.cone(0.05, 0.06, 3)} material={M(c.skin)} position={[0, NECK_Y - 0.06, -0.105]} rotation={[Math.PI - 0.25, 0, 0]} />)
      break
    }
    case 'top-jacket':
      parts.push(<mesh key="shirt" geometry={G.box(0.09, 0.4, 0.02)} material={M(fabricHex('cream'))} position={[0, 0.27, -0.124]} />)
      parts.push(<mesh key="collar" geometry={G.torus(0.075, 0.025, Math.PI * 2, 6, 14)} material={trim} position={[0, NECK_Y - 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} />)
      parts.push(<mesh key="hem" geometry={G.cylinder(0.176, 0.176, 0.06, 14)} material={trim} position={[0, 0.04, 0]} scale={[1, 1, 0.78]} />)
      parts.push(<mesh key="zip" geometry={G.box(0.012, 0.42, 0.012)} material={M(KIT_COLORS.gold, { metalness: 0.6, roughness: 0.4 })} position={[0.05, 0.26, -0.13]} />)
      break
    case 'top-trench':
      parts.push(<mesh key="skirt" geometry={G.cylinder(0.18, 0.26, 0.5, 14, true)} material={top} position={[0, -0.2, 0]} scale={[1, 1, 0.82]} />)
      parts.push(<mesh key="belt" geometry={G.cylinder(0.176, 0.176, 0.04, 14)} material={M(shade(c.top, -0.22))} position={[0, 0.08, 0]} scale={[1, 1, 0.78]} />)
      parts.push(<mesh key="buckle" geometry={G.box(0.05, 0.04, 0.012)} material={M(KIT_COLORS.gold, { metalness: 0.6, roughness: 0.4 })} position={[0, 0.08, -0.14]} />)
      parts.push(<mesh key="lapelL" geometry={G.box(0.07, 0.18, 0.015)} material={trim} position={[-0.05, 0.4, -0.125]} rotation={[0, 0, 0.35]} />)
      parts.push(<mesh key="lapelR" geometry={G.box(0.07, 0.18, 0.015)} material={trim} position={[0.05, 0.4, -0.125]} rotation={[0, 0, -0.35]} />)
      break
    case 'top-tank':
      parts.push(<mesh key="neck" geometry={G.sphere(0.06, 10, 6)} material={M(c.skin)} position={[0, NECK_Y - 0.06, -0.08]} scale={[1, 0.8, 0.5]} />)
      break
    default: // tee
      parts.push(<mesh key="collar" geometry={G.torus(0.06, 0.012, Math.PI * 2, 5, 14)} material={trim} position={[0, NECK_Y - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} />)
  }
  return <>{parts}</>
}

function Arm({ side, shoulder, elbow, outfit, c }: PartProps & { side: -1 | 1; shoulder: Joint; elbow: Joint }) {
  const sleeve = M(c.top, { flat: true })
  const skin = M(c.skin)
  const longSleeves = ['top-sweater', 'top-hoodie', 'top-jacket', 'top-trench'].includes(outfit.top)
  const upper = outfit.top === 'top-tank' ? skin : sleeve
  return (
    <group ref={shoulder} position={[side * SHOULDER_X, SHOULDER_Y, 0]}>
      <mesh geometry={G.capsule(ARM_R + 0.008, UPPER_ARM - ARM_R)} material={upper} position={[0, -UPPER_ARM / 2, 0]} />
      {outfit.top === 'top-tee' || outfit.top === 'top-jersey' ? (
        <mesh geometry={G.cylinder(ARM_R + 0.02, ARM_R + 0.026, 0.1, 10)} material={sleeve} position={[0, -0.07, 0]} />
      ) : null}
      <group ref={elbow} position={[0, -UPPER_ARM, 0]}>
        <mesh geometry={G.capsule(ARM_R, FOREARM - ARM_R)} material={longSleeves ? sleeve : skin} position={[0, -FOREARM / 2, 0]} />
        {longSleeves ? <mesh geometry={G.cylinder(ARM_R + 0.012, ARM_R + 0.012, 0.04, 10)} material={M(shade(c.top, -0.1))} position={[0, -FOREARM + 0.04, 0]} /> : null}
        <mesh geometry={G.sphere(0.047, 10, 8)} material={skin} position={[0, -FOREARM - 0.03, 0]} scale={[0.9, 1.1, 0.8]} />
        <HandItem side={side} outfit={outfit} />
      </group>
    </group>
  )
}

/** Things held in a hand: the magnifier (right) and the lantern (left). */
function HandItem({ side, outfit }: { side: -1 | 1; outfit: Outfit }) {
  const gold = M(KIT_COLORS.gold, { metalness: 0.55, roughness: 0.38 })
  const y = -FOREARM - 0.06
  if (outfit.accessory === 'acc-magnifier' && side === 1) {
    return (
      <group position={[0, y, -0.03]} rotation={[0.3, 0, 0]}>
        <mesh geometry={G.cylinder(0.012, 0.014, 0.12, 8)} material={M(KIT_COLORS.strap)} position={[0, -0.02, 0]} />
        <mesh geometry={G.torus(0.05, 0.01, Math.PI * 2, 6, 16)} material={gold} position={[0, -0.13, 0]} />
        <mesh geometry={G.cylinder(0.046, 0.046, 0.006, 16)} material={M(KIT_COLORS.lens, { roughness: 0.1, metalness: 0.2 })} position={[0, -0.13, 0]} rotation={[Math.PI / 2, 0, 0]} />
      </group>
    )
  }
  if (outfit.accessory === 'acc-lantern' && side === -1) {
    return (
      <group position={[0, y - 0.02, 0]}>
        <mesh geometry={G.torus(0.025, 0.005, Math.PI, 4, 10)} material={gold} position={[0, -0.02, 0]} />
        <mesh geometry={G.cylinder(0.035, 0.045, 0.03, 8)} material={gold} position={[0, -0.04, 0]} />
        <mesh geometry={G.cylinder(0.035, 0.035, 0.08, 8)} material={M(KIT_COLORS.lanternGlow, { emissive: KIT_COLORS.lanternGlow, emissiveIntensity: 1.6 })} position={[0, -0.095, 0]} />
        <mesh geometry={G.cylinder(0.045, 0.04, 0.025, 8)} material={gold} position={[0, -0.15, 0]} />
      </group>
    )
  }
  return null
}

/** Accessories worn on the body: scarf, backpack, key ring. */
function TorsoAccessory({ outfit, detailRef }: PartProps & { detailRef?: DetailRef }) {
  switch (outfit.accessory) {
    case 'acc-scarf':
      return (
        <>
          <mesh geometry={G.torus(0.085, 0.035, Math.PI * 2, 6, 14)} material={M(KIT_COLORS.scarf, { flat: true })} position={[0, NECK_Y - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={G.box(0.07, 0.22, 0.03)} material={M(KIT_COLORS.scarf, { flat: true })} position={[0.06, NECK_Y - 0.15, -0.13]} rotation={[0.1, 0, 0.08]} />
          <mesh geometry={G.box(0.072, 0.02, 0.032)} material={M(KIT_COLORS.scarfStripe)} position={[0.068, NECK_Y - 0.22, -0.137]} rotation={[0.1, 0, 0.08]} />
        </>
      )
    case 'acc-backpack': {
      const bag = M(KIT_COLORS.backpack, { flat: true })
      const strap = M(KIT_COLORS.strap)
      return (
        <>
          <mesh geometry={G.box(0.28, 0.34, 0.14)} material={bag} position={[0, 0.27, 0.19]} />
          <mesh geometry={G.box(0.22, 0.12, 0.05)} material={M(shade(KIT_COLORS.backpack, -0.1), { flat: true })} position={[0, 0.17, 0.28]} />
          <mesh geometry={G.box(0.035, 0.34, 0.02)} material={strap} position={[-0.1, 0.3, -0.122]} />
          <mesh geometry={G.box(0.035, 0.34, 0.02)} material={strap} position={[0.1, 0.3, -0.122]} />
        </>
      )
    }
    case 'acc-keyring': {
      const gold = M(KIT_COLORS.gold, { metalness: 0.6, roughness: 0.35 })
      return (
        <group ref={detailRef} position={[0.17, 0.02, -0.04]}>
          <mesh geometry={G.torus(0.035, 0.007, Math.PI * 2, 5, 14)} material={gold} rotation={[0, Math.PI / 2, 0]} />
          {[-0.4, 0, 0.4].map((r, i) => (
            <group key={i} rotation={[r, 0, 0]} position={[0.005, -0.035, 0]}>
              <mesh geometry={G.box(0.008, 0.07, 0.016)} material={gold} position={[0, -0.04, 0]} />
              <mesh geometry={G.torus(0.012, 0.005, Math.PI * 2, 4, 10)} material={gold} rotation={[0, Math.PI / 2, 0]} />
              <mesh geometry={G.box(0.008, 0.012, 0.022)} material={gold} position={[0, -0.07, 0.01]} />
            </group>
          ))}
        </group>
      )
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------- head, face, hair, hats

function Head({ outfit, c, detailRef }: PartProps & { detailRef?: DetailRef }) {
  const skin = M(c.skin)
  const eye = M(KIT_COLORS.eye, { roughness: 0.4 })
  const shine = M(KIT_COLORS.eyeShine, { roughness: 0.3 })
  return (
    <group position={[0, HEAD_Y, 0]}>
      <mesh geometry={G.sphere(HEAD_R, 18, 14)} material={skin} scale={[1, 1.04, 0.98]} />
      {/* Small details, hidden far away (CharacterMotion.far). */}
      <group ref={detailRef}>
        {/* Ears */}
        <mesh geometry={G.sphere(0.03, 8, 6)} material={skin} position={[-HEAD_R + 0.005, -0.005, 0.01]} scale={[0.6, 1, 0.9]} />
        <mesh geometry={G.sphere(0.03, 8, 6)} material={skin} position={[HEAD_R - 0.005, -0.005, 0.01]} scale={[0.6, 1, 0.9]} />
        {/* Face: eyes, shine, cheeks, nose, smile. Eyes at PLAYER.eyeHeight. */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.055, 0.03, -HEAD_R + 0.012]}>
            <mesh geometry={G.sphere(0.026, 10, 8)} material={shine} scale={[1, 1.2, 0.45]} position={[0, 0, 0.004]} />
            <mesh geometry={G.sphere(0.019, 10, 8)} material={eye} scale={[1, 1.2, 0.6]} position={[0, -0.002, -0.006]} />
            <mesh geometry={G.sphere(0.006, 6, 4)} material={shine} position={[0.006, 0.008, -0.016]} />
            <mesh geometry={G.sphere(0.022, 8, 6)} material={M(KIT_COLORS.blush)} position={[s * 0.018, -0.045, 0.004]} scale={[1.2, 0.6, 0.4]} />
          </group>
        ))}
        <mesh geometry={G.sphere(0.018, 8, 6)} material={M(shade(c.skin, -0.04))} position={[0, -0.005, -HEAD_R - 0.004]} />
        <mesh geometry={G.torus(0.03, 0.006, Math.PI * 0.8, 4, 10)} material={M(KIT_COLORS.mouth)} position={[0, -0.045, -HEAD_R + 0.012]} rotation={[0, 0, Math.PI + Math.PI * 0.1]} />
      </group>
      <Hair outfit={outfit} c={c} />
      <Hat outfit={outfit} c={c} />
      <FaceAccessory outfit={outfit} c={c} />
    </group>
  )
}

function Hair({ outfit, c }: PartProps) {
  const hair = M(c.hair, { flat: true })
  const hatted = outfit.hat !== 'hat-none'
  const R = HEAD_R
  // A cap of hair tilted back so the forehead stays clear.
  const cap = (extra: number, theta: number, tilt: number, key = 'cap') => (
    <mesh key={key} geometry={G.cap(R + extra, theta)} material={hair} rotation={[tilt, 0, 0]} scale={[1, 1.04, 1]} />
  )
  switch (outfit.hair) {
    case 'hair-none':
      return null
    case 'hair-buzz':
      return cap(0.004, 1.35, 0.35)
    case 'hair-short':
      return (
        <>
          {cap(0.014, 1.45, 0.45)}
          <mesh geometry={G.box(0.2, 0.05, 0.08)} material={hair} position={[0.02, 0.11, -0.1]} rotation={[0.5, 0.2, -0.15]} />
        </>
      )
    case 'hair-bob':
      return (
        <>
          {cap(0.02, 1.95, 0.7)}
          <mesh geometry={G.cylinder(R + 0.03, R + 0.04, 0.16, 16, true)} material={hair} position={[0, -0.03, 0.03]} scale={[1, 1, 0.9]} />
        </>
      )
    case 'hair-long':
      return (
        <>
          {cap(0.018, 1.9, 0.62)}
          <mesh geometry={G.box(0.3, 0.42, 0.09)} material={hair} position={[0, -0.13, 0.1]} />
          <mesh geometry={G.box(0.06, 0.3, 0.08)} material={hair} position={[-0.135, -0.1, -0.02]} />
          <mesh geometry={G.box(0.06, 0.3, 0.08)} material={hair} position={[0.135, -0.1, -0.02]} />
        </>
      )
    case 'hair-ponytail':
      return (
        <>
          {cap(0.014, 1.6, 0.55)}
          <mesh geometry={G.sphere(0.04, 8, 6)} material={hair} position={[0, 0.06, R + 0.01]} />
          <mesh geometry={G.capsule(0.04, 0.2)} material={hair} position={[0, -0.07, R + 0.05]} rotation={[-0.3, 0, 0]} />
        </>
      )
    case 'hair-curly': {
      const curls: [number, number, number][] = [
        [0, 0.13, 0], [0.08, 0.11, -0.04], [-0.08, 0.11, -0.04], [0.1, 0.08, 0.06], [-0.1, 0.08, 0.06], [0, 0.1, 0.1],
        [0.06, 0.12, 0.05], [-0.06, 0.12, 0.05], [0.13, 0.02, 0.03], [-0.13, 0.02, 0.03], [0, 0.03, 0.14], [0.05, 0.13, -0.08], [-0.05, 0.13, -0.08],
      ]
      return (
        <>
          {cap(0.012, 1.5, 0.45)}
          {!hatted ? curls.map((p, i) => <mesh key={i} geometry={G.sphere(0.05, 7, 5)} material={hair} position={p} />) : null}
        </>
      )
    }
    case 'hair-bun':
      return (
        <>
          {cap(0.012, 1.55, 0.45)}
          {!hatted ? <mesh geometry={G.sphere(0.065, 10, 8)} material={hair} position={[0, 0.16, 0.06]} /> : null}
        </>
      )
    case 'hair-mohawk':
      return (
        <>
          {cap(0.003, 1.3, 0.35)}
          {!hatted ? <mesh geometry={G.box(0.035, 0.12, 0.3)} material={hair} position={[0, 0.16, 0.03]} rotation={[-0.15, 0, 0]} /> : null}
        </>
      )
    case 'hair-afro':
      return hatted ? cap(0.03, 1.7, 0.5) : <mesh geometry={G.sphere(R * 1.42, 12, 9)} material={hair} position={[0, 0.07, 0.04]} scale={[1, 0.92, 1]} />
  }
}

function Hat({ outfit, c }: PartProps) {
  const hat = M(c.hat, { flat: true })
  const trim = M(shade(c.hat, -0.12), { flat: true })
  const R = HEAD_R
  switch (outfit.hat) {
    case 'hat-none':
      return null
    case 'hat-beanie':
      return (
        <>
          <mesh geometry={G.cap(R + 0.03, 1.55)} material={hat} rotation={[0.3, 0, 0]} scale={[1, 1.12, 1]} />
          <mesh geometry={G.torus(R + 0.018, 0.028, Math.PI * 2, 6, 18)} material={trim} position={[0, 0.03, 0.015]} rotation={[Math.PI / 2 + 0.3, 0, 0]} />
          <mesh geometry={G.sphere(0.04, 8, 6)} material={M(KIT_COLORS.sole, { flat: true })} position={[0, R + 0.06, 0.05]} />
        </>
      )
    case 'hat-cap':
      return (
        <>
          <mesh geometry={G.cap(R + 0.022, 1.45)} material={hat} rotation={[0.25, 0, 0]} />
          <mesh geometry={G.cylinder(0.11, 0.11, 0.014, 14)} material={trim} position={[0, 0.07, -0.16]} scale={[1, 1, 0.75]} rotation={[-0.12, 0, 0]} />
          <mesh geometry={G.sphere(0.016, 6, 4)} material={trim} position={[0, R + 0.02, 0.02]} />
        </>
      )
    case 'hat-detective':
      return (
        <>
          <mesh geometry={G.cap(R + 0.026, 1.5)} material={hat} rotation={[0.2, 0, 0]} scale={[1, 1.08, 1.04]} />
          <mesh geometry={G.cylinder(0.1, 0.1, 0.014, 12)} material={hat} position={[0, 0.06, -0.165]} scale={[1, 1, 0.6]} rotation={[-0.25, 0, 0]} />
          <mesh geometry={G.cylinder(0.1, 0.1, 0.014, 12)} material={hat} position={[0, 0.03, 0.17]} scale={[1, 1, 0.6]} rotation={[0.35, 0, 0]} />
          <mesh geometry={G.box(0.02, 0.05, 0.08)} material={trim} position={[-R - 0.02, 0.08, 0]} rotation={[0, 0, -0.5]} />
          <mesh geometry={G.box(0.02, 0.05, 0.08)} material={trim} position={[R + 0.02, 0.08, 0]} rotation={[0, 0, 0.5]} />
          <mesh geometry={G.sphere(0.018, 6, 4)} material={trim} position={[0, R + 0.03, 0]} />
        </>
      )
    case 'hat-tophat':
      return (
        <group position={[0, R - 0.01, 0]} rotation={[0.08, 0, -0.06]}>
          <mesh geometry={G.cylinder(0.2, 0.2, 0.016, 18)} material={hat} />
          <mesh geometry={G.cylinder(0.12, 0.115, 0.24, 16)} material={hat} position={[0, 0.12, 0]} />
          <mesh geometry={G.cylinder(0.118, 0.118, 0.045, 16)} material={M(fabricHex(c.hat === fabricHex('red') ? 'black' : 'red'))} position={[0, 0.035, 0]} />
        </group>
      )
    case 'hat-crown': {
      const gold = M(KIT_COLORS.gold, { metalness: 0.65, roughness: 0.32 })
      const gem = M(c.hat, { roughness: 0.2, metalness: 0.1 })
      return (
        <group position={[0, R - 0.02, 0]}>
          <mesh geometry={G.cylinder(0.115, 0.11, 0.07, 10, true)} material={gold} position={[0, 0.03, 0]} />
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2
            return (
              <group key={i}>
                <mesh geometry={G.cone(0.03, 0.07, 4)} material={gold} position={[Math.sin(a) * 0.11, 0.1, Math.cos(a) * 0.11]} />
                <mesh geometry={G.sphere(0.014, 6, 4)} material={gem} position={[Math.sin(a) * 0.115, 0.035, Math.cos(a) * 0.115]} />
              </group>
            )
          })}
        </group>
      )
    }
  }
}

function FaceAccessory({ outfit }: PartProps) {
  if (outfit.accessory === 'acc-glasses') {
    const frame = M(KIT_COLORS.frame, { roughness: 0.5 })
    return (
      <group position={[0, 0.03, -HEAD_R - 0.004]}>
        <mesh geometry={G.torus(0.036, 0.0075, Math.PI * 2, 5, 16)} material={frame} position={[-0.056, 0, 0]} />
        <mesh geometry={G.torus(0.036, 0.0075, Math.PI * 2, 5, 16)} material={frame} position={[0.056, 0, 0]} />
        <mesh geometry={G.box(0.03, 0.008, 0.008)} material={frame} position={[0, 0.005, 0]} />
        <mesh geometry={G.box(0.008, 0.008, 0.13)} material={frame} position={[-0.135, 0.0, 0.07]} />
        <mesh geometry={G.box(0.008, 0.008, 0.13)} material={frame} position={[0.135, 0.0, 0.07]} />
      </group>
    )
  }
  if (outfit.accessory === 'acc-headphones') {
    const band = M(KIT_COLORS.headphone, { roughness: 0.5 })
    const accent = M(KIT_COLORS.headphoneAccent, { emissive: KIT_COLORS.headphoneAccent, emissiveIntensity: 0.5 })
    const hatted = outfit.hat !== 'hat-none'
    const r = HEAD_R + (hatted ? 0.06 : 0.035)
    return (
      <group position={[0, 0.0, 0.01]}>
        <mesh geometry={G.torus(r, 0.014, Math.PI, 6, 18)} material={band} />
        {[-1, 1].map((s) => (
          <group key={s} position={[s * (HEAD_R + 0.02), -0.005, 0]} rotation={[0, 0, Math.PI / 2]}>
            <mesh geometry={G.cylinder(0.05, 0.05, 0.04, 14)} material={band} />
            <mesh geometry={G.cylinder(0.03, 0.03, 0.042, 12)} material={accent} position={[0, s * -0.002, 0]} />
          </group>
        ))}
      </group>
    )
  }
  return null
}
