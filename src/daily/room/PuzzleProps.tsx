/**
 * The day's challenge as physical props: the lock by the door, clue posters on the west wall (or the
 * cipher above the door), the guess board on the east wall, the hint bell and the entrance plaque.
 * Every prop is an interactable with an id `daily:*`; the page listens to the generic `interact`
 * event and opens the matching close-up panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { boxFromCenter, useColliders } from '@/contracts/colliders'
import { interactable } from '@/contracts/interaction'
import { LIGHT, PALETTE } from '@/contracts/style'
import { useStore } from '@/state/store'
import { getMaterial } from '@/world/materials'
import type { LockClue } from '../../gate/generators'
import type { DailyChallenge, GridMark } from '../engine'
import { KIND_LABEL } from '../ui/DailyGame'
import { BANNER_POS, BELL_POS, BOARD_POS, BOARD_SIZE, clueSlots, DR, LOCK_POS, PLAQUE_POS } from './layout'
import { useRoomPlay } from './playStore'
import { boardTexture, canvasFontsReady, cipherBannerTexture, cipherKeyTexture, clueTexture, lockFaceTexture, plaqueTexture, searchSignTexture, sequenceTexture } from './textures'

function useDisposable<T extends { dispose(): void } | null>(v: T): T {
  useEffect(() => () => v?.dispose(), [v])
  return v
}

/** 0 until the canvas fonts are loaded, then 1: a dependency that redraws the textures once. */
export function useFontsVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let alive = true
    void canvasFontsReady().then((ok) => {
      if (alive && ok) setV(1)
    })
    return () => {
      alive = false
    }
  }, [])
  return v
}

/** A flat picture (texture or fallback colour) in a wooden frame, facing local +Z. */
function Framed({ tex, w, h, frame = 'woodDark', fallback = PALETTE.paper }: { tex: THREE.Texture | null; w: number; h: number; frame?: 'woodDark' | 'woodLight' | 'brass'; fallback?: string }) {
  return (
    <group>
      <mesh position={[0, 0, 0.015]} material={getMaterial(frame)}>
        <boxGeometry args={[w + 0.08, h + 0.08, 0.03]} />
      </mesh>
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[w, h]} />
        {tex ? <meshStandardMaterial map={tex} roughness={0.85} /> : <meshStandardMaterial color={fallback} roughness={0.9} />}
      </mesh>
    </group>
  )
}

/** Mounted on the west wall: local +Z faces east into the room. */
const WEST = Math.PI / 2
/** Mounted on the east wall. */
const EAST = -Math.PI / 2

export function Clues({ c }: { c: DailyChallenge }) {
  if (c.kind === 'combination') return <CombinationPosters c={c} />
  if (c.kind === 'cipher') return <CipherProps c={c} />
  if (c.kind === 'sequence') return <SequencePanel c={c} />
  return <SearchSign c={c} />
}

function CombinationPosters({ c }: { c: Extract<DailyChallenge, { kind: 'combination' }> }) {
  const slots = useMemo(() => clueSlots(c.data.clues.length), [c])
  return (
    <>
      {c.data.clues.map((clue, i) => (
        <Poster key={i} index={i} clue={clue} position={slots[i]} />
      ))}
    </>
  )
}

function Poster({ index, clue, position }: { index: number; clue: LockClue; position: [number, number, number] }) {
  const fonts = useFontsVersion()
  const tex = useDisposable(useMemo(() => (fonts >= 0 ? clueTexture(clue, index) : null), [clue, index, fonts]))
  return (
    <group position={position} rotation={[0, WEST, 0]} {...interactable({ id: `daily:clue:${index}`, kind: 'prop', label: `Read clue ${index + 1}` })}>
      <Framed tex={tex} w={0.96} h={1.2} />
    </group>
  )
}

function CipherProps({ c }: { c: Extract<DailyChallenge, { kind: 'cipher' }> }) {
  const fonts = useFontsVersion()
  const banner = useDisposable(useMemo(() => (fonts >= 0 ? cipherBannerTexture(c) : null), [c, fonts]))
  const key = useDisposable(useMemo(() => (fonts >= 0 ? cipherKeyTexture(c) : null), [c, fonts]))
  return (
    <>
      <group position={BANNER_POS} {...interactable({ id: 'daily:clue:0', kind: 'prop', label: 'Read the symbols' })}>
        <Framed tex={banner} w={2.0} h={0.5} fallback={PALETTE.chalkboard} />
      </group>
      <group position={[DR.minX + 0.03, 1.75, 1.0]} rotation={[0, WEST, 0]} {...interactable({ id: 'daily:clue:1', kind: 'prop', label: 'Read the key' })}>
        <Framed tex={key} w={1.12} h={1.4} frame="woodLight" fallback="#f6ead2" />
      </group>
    </>
  )
}

function SequencePanel({ c }: { c: Extract<DailyChallenge, { kind: 'sequence' }> }) {
  const fonts = useFontsVersion()
  const tex = useDisposable(useMemo(() => (fonts >= 0 ? sequenceTexture(c) : null), [c, fonts]))
  return (
    <group position={[DR.minX + 0.03, 1.7, 1.0]} rotation={[0, WEST, 0]} {...interactable({ id: 'daily:clue:0', kind: 'prop', label: 'Study the sequence' })}>
      <Framed tex={tex} w={3.4} h={0.68} frame="brass" fallback="#2a2f35" />
    </group>
  )
}

function SearchSign({ c }: { c: Extract<DailyChallenge, { kind: 'search' }> }) {
  const fonts = useFontsVersion()
  const tex = useDisposable(useMemo(() => (fonts >= 0 ? searchSignTexture(c.data.symbol, c.data.count) : null), [c, fonts]))
  return (
    <group position={[DR.minX + 0.03, 1.75, 1.0]} rotation={[0, WEST, 0]} {...interactable({ id: 'daily:clue:0', kind: 'prop', label: 'Read the note' })}>
      <Framed tex={tex} w={1.5} h={0.75} />
    </group>
  )
}

/** Above the door on non-cipher days: a simple "EXIT" sign that lights green once open. */
export function ExitSign() {
  const open = useRoomPlay((s) => s.doorOpen)
  return (
    <group position={[BANNER_POS[0], BANNER_POS[1] - 0.05, BANNER_POS[2]]}>
      <mesh position={[0, 0, 0.03]} material={getMaterial('metalDark')}>
        <boxGeometry args={[0.62, 0.24, 0.06]} />
      </mesh>
      <mesh position={[0, 0, 0.062]}>
        <planeGeometry args={[0.54, 0.16]} />
        <meshBasicMaterial color={open ? '#7fe08a' : '#c4513f'} toneMapped={false} />
      </mesh>
    </group>
  )
}

const LOCK_LABEL: Record<DailyChallenge['kind'], string> = {
  combination: 'Dial the code',
  cipher: 'Spell the word',
  sequence: 'Set the next three',
  search: 'Check what you found',
}

/** The lock box beside the door: shows the last guess, lamp per slot, and pops open when solved. */
export function LockBox({ c }: { c: DailyChallenge }) {
  const progress = useRoomPlay((s) => s.progress)
  const open = useRoomPlay((s) => s.doorOpen)
  const solved = progress?.status === 'solved'
  const lastRow = useMemo(() => {
    const rows = (progress?.grid ?? []).filter((r) => !(r.length === 1 && r[0] === 'hint'))
    return rows.length ? (rows[rows.length - 1] as GridMark[]) : null
  }, [progress])
  const lastGuess = progress?.guesses.length ? progress.guesses[progress.guesses.length - 1] : null
  const fonts = useFontsVersion()
  const face = useDisposable(useMemo(() => (fonts >= 0 ? lockFaceTexture(c, lastGuess, lastRow, solved) : null), [c, lastGuess, lastRow, solved, fonts]))
  const shackle = useRef<THREE.Group>(null)
  const brass = useMemo(() => {
    const m = (getMaterial('brass') as THREE.MeshStandardMaterial).clone()
    m.metalness = 0.3
    m.roughness = 0.4
    return m
  }, [])
  useDisposable(brass)
  const hovered = useStore((s) => s.hoveredId === 'daily:lock')
  useEffect(() => {
    brass.emissive.set(hovered ? LIGHT.lampWarm : '#000000')
    brass.emissiveIntensity = hovered ? 0.3 : 0
  }, [hovered, brass])
  useFrame((_, dt) => {
    const s = shackle.current
    if (!s) return
    const k = 1 - Math.exp(-dt * 3)
    s.position.y += ((open ? 0.1 : 0) - s.position.y) * k
    s.rotation.y += ((open ? 0.9 : 0) - s.rotation.y) * k
  })
  const label = progress && (progress.status === 'solved' || progress.status === 'failed') ? 'See your result' : LOCK_LABEL[c.kind]
  return (
    <group position={LOCK_POS} {...interactable({ id: 'daily:lock', kind: 'gate', label })}>
      <mesh position={[0, 0, 0.02]} material={getMaterial('metalDark')}>
        <boxGeometry args={[0.66, 0.5, 0.04]} />
      </mesh>
      <mesh position={[0, -0.02, 0.08]} material={brass}>
        <boxGeometry args={[0.56, 0.34, 0.08]} />
      </mesh>
      <mesh position={[0, -0.02, 0.121]}>
        <planeGeometry args={[0.48, 0.18]} />
        {face ? <meshBasicMaterial map={face} toneMapped={false} /> : <meshBasicMaterial color="#1f2326" />}
      </mesh>
      {/* Shackle */}
      <group position={[0, 0.15, 0.08]}>
        <group ref={shackle}>
          <mesh position={[0, 0.07, 0]} material={getMaterial('metal')}>
            <torusGeometry args={[0.13, 0.022, 8, 20, Math.PI]} />
          </mesh>
          <mesh position={[-0.13, 0.03, 0]} material={getMaterial('metal')}>
            <cylinderGeometry args={[0.022, 0.022, 0.09, 8]} />
          </mesh>
          <mesh position={[0.13, 0.03, 0]} material={getMaterial('metal')}>
            <cylinderGeometry args={[0.022, 0.022, 0.09, 8]} />
          </mesh>
        </group>
      </group>
      {/* Status lamp */}
      <mesh position={[0.24, -0.2, 0.125]}>
        <sphereGeometry args={[0.022, 10, 8]} />
        <meshBasicMaterial color={open ? '#7fe08a' : progress?.status === 'playing' ? LIGHT.ledTeal : '#c4513f'} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Chalkboard on the east wall with every guess so far. */
export function GuessBoard({ c }: { c: DailyChallenge }) {
  const progress = useRoomPlay((s) => s.progress)
  const maxGuesses = useRoomPlay((s) => s.maxGuesses)
  const guesses = progress?.guesses
  const grid = progress?.grid
  const hints = progress?.hintsUsed ?? 0
  const fonts = useFontsVersion()
  const tex = useDisposable(useMemo(() => (fonts >= 0 ? boardTexture(c, guesses ?? [], grid ?? [], maxGuesses, hints) : null), [c, guesses, grid, maxGuesses, hints, fonts]))
  return (
    <group position={BOARD_POS} rotation={[0, EAST, 0]} {...interactable({ id: 'daily:board', kind: 'prop', label: 'Check your guesses' })}>
      <Framed tex={tex} w={BOARD_SIZE[0]} h={BOARD_SIZE[1]} frame="woodLight" fallback={PALETTE.chalkboard} />
      {/* Chalk ledge */}
      <mesh position={[0, -BOARD_SIZE[1] / 2 - 0.06, 0.06]} material={getMaterial('woodLight')}>
        <boxGeometry args={[BOARD_SIZE[0], 0.04, 0.1]} />
      </mesh>
    </group>
  )
}

/** A brass desk bell on a round side table: ring it for a hint. */
export function HintBell() {
  const progress = useRoomPlay((s) => s.progress)
  const used = progress?.hintsUsed ?? 0
  const bell = useRef<THREE.Group>(null)
  const ring = useRef(0)
  const last = useRef(used)
  useEffect(() => {
    if (used > last.current) ring.current = 1
    last.current = used
  }, [used])
  useFrame((_, dt) => {
    const b = bell.current
    if (!b) return
    ring.current = Math.max(0, ring.current - dt * 1.5)
    b.rotation.z = Math.sin(performance.now() / 40) * 0.12 * ring.current
  })
  const boxes = useMemo(() => [boxFromCenter('daily:bell-table', [BELL_POS[0], 0.35, BELL_POS[2]], [0.62, 0.7, 0.62])], [])
  useColliders(boxes)
  const wood = getMaterial('woodLight')
  return (
    <group position={BELL_POS}>
      <mesh position={[0, 0.69, 0]} material={wood}>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 20]} />
      </mesh>
      <mesh position={[0, 0.34, 0]} material={getMaterial('woodDark')}>
        <cylinderGeometry args={[0.04, 0.06, 0.68, 8]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} material={getMaterial('woodDark')}>
        <cylinderGeometry args={[0.2, 0.22, 0.04, 16]} />
      </mesh>
      <group position={[0, 0.71, 0]} {...interactable({ id: 'daily:hint', kind: 'prop', label: 'Ring for a hint (−150)' })}>
        <mesh position={[0, 0.01, 0]} material={getMaterial('woodDark')}>
          <cylinderGeometry args={[0.1, 0.11, 0.02, 16]} />
        </mesh>
        <group ref={bell}>
          <mesh position={[0, 0.02, 0]} material={getMaterial('brass')}>
            <sphereGeometry args={[0.085, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, 0.115, 0]} material={getMaterial('brass')}>
            <cylinderGeometry args={[0.012, 0.012, 0.025, 8]} />
          </mesh>
        </group>
        {/* Hit box so the bell is easy to aim at */}
        <mesh position={[0, 0.06, 0]} visible={false}>
          <boxGeometry args={[0.3, 0.2, 0.3]} />
        </mesh>
      </group>
      {/* Little tent card */}
      <mesh position={[0.15, 0.75, 0.12]} rotation={[-0.35, -0.6, 0]} material={getMaterial('paper')}>
        <boxGeometry args={[0.14, 0.08, 0.005]} />
      </mesh>
    </group>
  )
}

/** Brass plaque left of the door with today's number and theme. */
export function Plaque({ c }: { c: DailyChallenge }) {
  const number = useRoomPlay((s) => s.number)
  const theme = useRoomPlay((s) => s.theme)
  const fonts = useFontsVersion()
  const tex = useDisposable(useMemo(() => (fonts >= 0 ? plaqueTexture(number, KIND_LABEL[c.kind], theme) : null), [number, c, theme, fonts]))
  return (
    <group position={PLAQUE_POS} {...interactable({ id: 'daily:plaque', kind: 'prop', label: "Read today's brief" })}>
      <Framed tex={tex} w={0.9} h={0.45} frame="woodDark" fallback={PALETTE.brass} />
    </group>
  )
}
