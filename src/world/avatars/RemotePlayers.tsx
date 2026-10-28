/**
 * Other people in this room (Phase 3, workstream C): each one drawn with the same `Character` as
 * you, in their own look, moving smoothly between the poses the server sends (src/net), with a
 * name tag (@handle) and their latest chat line in a bubble above the head. Emotes (wave, cheer,
 * dance) play on the character. Mounted once by World.tsx; draws nothing when you are alone.
 *
 * Nothing here re-renders per frame: poses are read from `poses` in `useFrame`. A player only
 * re-renders when their look, bubble or emote changes.
 *
 * Cost with a full home (12 people, ~40 meshes each): real shadows only on High quality with a
 * mouse (otherwise a one-quad blob shadow), and past `DETAIL_DISTANCE` the small face details are
 * skipped (`CharacterMotion.far`).
 */
import { memo, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/state/store'
import { INTERP_DELAY_MS } from '@/net/interpolation'
import { realtimeClient } from '@/net/session'
import { EMOTE_MS, poses, useRealtime, type ChatLine, type Player } from '@/net/store'
import { Character, type CharacterMotion } from './Character'
import { blobShadowMaterial, G } from './kit'

/** Name tags fade out between these distances (metres) and hide beyond. */
const TAG_FADE_START = 9
const TAG_HIDE = 16
/** Above the head (eyes are at 1.6 m; hats reach about 1.95 m). */
const TAG_HEIGHT = 2.08
const NO_POINTER = { pointerEvents: 'none' } as const
/** Beyond this distance (metres) other players drop their small details. */
export const DETAIL_DISTANCE = 8

/** Whether other players cast real shadows (the shadow pass would redraw every one of their meshes). */
export function remoteShadows(quality: string, touch: boolean): boolean {
  return quality === 'high' && !touch
}

/** Closer than this (metres, on the floor) and your camera is inside them: hide them instead. */
const NEAR_HIDE_M = 0.45
/** How much of each colour others glow with, so dark looks still read under the warm lamps. */
const LIFT = { low: 0.2, normal: 0.1 } as const
/** Lifted copies of the shared character materials, per lift amount. */
const lifted = new Map<number, WeakMap<THREE.Material, THREE.Material>>()

/**
 * A copy of `m` with a faint emissive of its own colour (a soft rim of light), shared by every
 * remote player. Materials that already glow are left alone.
 */
function liftedMaterial(current: THREE.Material, amount: number): THREE.Material {
  if (current.userData.lifted === amount) return current
  // Already lifted by another amount (quality changed): start again from the shared material.
  const m = (current.userData.source as THREE.Material | undefined) ?? current
  if (!(m instanceof THREE.MeshStandardMaterial) || (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0)) return m
  let cache = lifted.get(amount)
  if (!cache) lifted.set(amount, (cache = new WeakMap()))
  let out = cache.get(m)
  if (!out) {
    const copy = m.clone()
    copy.emissive = m.color.clone().multiplyScalar(amount).addScalar(amount * 0.15)
    copy.emissiveIntensity = 1
    copy.userData = { ...m.userData, lifted: amount, source: m }
    copy.name = `${m.name}:lifted`
    cache.set(m, copy)
    out = copy
  }
  return out
}

/** Swap the meshes under `root` to their lifted materials (cheap when already done). */
export function liftCharacter(root: THREE.Object3D, amount: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const next = liftedMaterial(mesh.material, amount)
    if (next !== mesh.material) mesh.material = next
  })
}

export function RemotePlayers() {
  const players = useRealtime((s) => s.players)
  const list = useMemo(() => Object.values(players), [players])
  // drei's Html picks its DOM parent when it mounts and re-creates its root (empty) if that parent
  // changes later; the canvas connects its event target a moment after start-up, so wait for it.
  const connected = useThree((s) => !!s.events.connected)
  if (!list.length || !connected) return null
  return (
    <group name="remote-players">
      {list.map((p) => (
        <RemotePlayer key={p.sid} player={p} />
      ))}
    </group>
  )
}

const RemotePlayer = memo(function RemotePlayer({ player }: { player: Player }) {
  const root = useRef<THREE.Group>(null)
  const tag = useRef<HTMLDivElement>(null)
  const motion = useMemo<CharacterMotion>(() => ({ speed: 0, action: 'idle', lookPitch: 0 }), [])
  const emote = useRealtime((s) => s.emotes[player.sid])
  const bubble = useRealtime((s) => s.bubbles[player.sid])
  const shadows = useStore((s) => remoteShadows(s.settings.quality, s.isTouch))
  const lift = useStore((s) => (s.settings.quality === 'low' ? LIFT.low : LIFT.normal))
  const frames = useRef(0)
  const emoteRef = useRef(emote)
  emoteRef.current = emote

  useFrame(({ camera }) => {
    const g = root.current
    if (!g) return
    const clock = realtimeClient()?.clock
    const serverNow = clock ? clock.now() : Date.now()
    const pose = poses.get(player.sid)?.sample(serverNow - INTERP_DELAY_MS) ?? null
    if (!pose) {
      g.visible = false
      if (tag.current) tag.current.style.opacity = '0'
      return
    }
    // Two people on one spot (or you walked into them): hide them rather than fill the screen.
    const dx = camera.position.x - pose.p[0]
    const dz = camera.position.z - pose.p[2]
    const inside = dx * dx + dz * dz < NEAR_HIDE_M * NEAR_HIDE_M && camera.position.y < pose.p[1] + 2.1
    g.visible = !inside
    g.position.set(pose.p[0], pose.p[1], pose.p[2])
    // React re-renders put the shared materials back (a new look); re-apply now and then.
    if (frames.current++ % 20 === 0) liftCharacter(g, lift)
    g.rotation.y = pose.yaw
    const e = emoteRef.current
    const emoting = e && Date.now() - e.at < EMOTE_MS && pose.speed < 0.6
    motion.speed = pose.speed
    motion.action = emoting ? e.emote : 'idle'
    motion.lookPitch = pose.pitch

    const d = camera.position.distanceTo(g.position)
    motion.far = d > DETAIL_DISTANCE
    const el = tag.current
    if (el) {
      const o = inside || d >= TAG_HIDE ? 0 : d <= TAG_FADE_START ? 1 : 1 - (d - TAG_FADE_START) / (TAG_HIDE - TAG_FADE_START)
      el.style.opacity = o.toFixed(2)
    }
  })

  const handle = player.user.handle
  return (
    <group ref={root} visible={false} userData={{ raycastIgnore: true }} name={`remote-player-${handle ?? player.sid}`}>
      <Character outfit={player.outfit} motion={motion} shadows={shadows} />
      {shadows ? null : <mesh geometry={G.floorQuad(0.9)} material={blobShadowMaterial()} position={[0, 0.012, 0]} renderOrder={1} />}
      <Html position={[0, TAG_HEIGHT, 0]} center zIndexRange={[24, 10]} pointerEvents="none" style={NO_POINTER}>
        <div ref={tag} className="flex flex-col items-center gap-1.5 font-body transition-opacity duration-200" style={{ opacity: 0 }}>
          {bubble ? <Bubble line={bubble} /> : null}
          <NameTag player={player} />
        </div>
      </Html>
    </group>
  )
})

function NameTag({ player }: { player: Player }) {
  const { displayName, handle } = player.user
  return (
    <div
      data-testid="remote-player-tag"
      data-handle={handle ?? ''}
      className="flex max-w-[180px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[rgba(42,31,45,0.78)] py-0.5 pr-2.5 pl-1.5 text-[13px] font-bold text-panel shadow-[0_4px_12px_rgba(0,0,0,.3)] ring-1 ring-white/15 backdrop-blur-sm select-none"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${player.isOwner ? 'bg-warn' : 'bg-led'}`} />
      <span className="truncate">{handle ? `@${handle}` : displayName}</span>
      {player.isOwner ? <span className="rounded-full bg-warn/25 px-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#ffd98a]">host</span> : null}
    </div>
  )
}

function Bubble({ line }: { line: ChatLine }) {
  return (
    <div
      key={line.id}
      data-testid="chat-bubble"
      className="relative max-w-[220px] rounded-2xl bg-panel px-3 py-1.5 text-center text-[14px] leading-snug font-semibold break-words text-ink shadow-[0_6px_16px_rgba(40,20,20,.35)] ring-1 ring-panel-edge select-none"
    >
      {line.text}
      <span aria-hidden className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-panel ring-1 ring-panel-edge [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
    </div>
  )
}
