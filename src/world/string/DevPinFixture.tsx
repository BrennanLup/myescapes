/**
 * DEV ONLY (not imported by index.tsx). Stand-in for the bulletin board while it is a
 * placeholder: publishes fake `boardPins` for the active sort, animates
 * `runtime.pinPositions` towards them, and draws a cork panel, polaroids and pin heads.
 * Mount it temporarily next to <RedString /> to see the string; never ship it.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Vec3 } from '@/contracts/scene'
import type { SortKey } from '@/contracts/types'
import { runtime } from '@/contracts/runtime'
import { useStore, type BoardPin } from '@/state/store'

interface FakeRoom {
  id: string
  city: string
  brand: string
  genre: string
  date: string
  rating: number
  escapeTime: number
}

const CITIES = ['San Francisco', 'Toronto', 'Seattle', 'Austin']
const BRANDS = ['Puzzle Parlour', 'Escape Hatch', 'Lockbox', 'Clue Club', 'Riddle Inc']
const GENRES = ['mystery', 'horror', 'sci-fi', 'adventure']

export const FAKE_ROOMS: FakeRoom[] = Array.from({ length: 14 }, (_, i) => ({
  id: `room_dev_${i}`,
  city: CITIES[(i * 7) % CITIES.length],
  brand: BRANDS[(i * 3) % BRANDS.length],
  genre: GENRES[(i * 5 + 1) % GENRES.length],
  date: `${2022 + (i % 4)}-${String(1 + ((i * 5) % 12)).padStart(2, '0')}-10`,
  rating: 55 + ((i * 37) % 45),
  escapeTime: 38 + ((i * 13) % 22),
}))

function groupOf(r: FakeRoom, sort: SortKey): string {
  switch (sort) {
    case 'city':
      return r.city
    case 'brand':
      return r.brand
    case 'genre':
      return r.genre
    case 'date':
      return r.date.slice(0, 4)
    case 'rating':
      return `${Math.floor(r.rating / 10) * 10}s`
    case 'escapeTime':
      return r.escapeTime < 45 ? 'fast' : r.escapeTime < 52 ? 'close' : 'photo finish'
  }
}

const Z = -7.9
export function layoutFakePins(sort: SortKey): BoardPin[] {
  const groups = new Map<string, FakeRoom[]>()
  const rooms = [...FAKE_ROOMS].sort((a, b) => a.date.localeCompare(b.date))
  for (const r of rooms) {
    const g = groupOf(r, sort)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(r)
  }
  const keys = [...groups.keys()].sort()
  const pins: BoardPin[] = []
  const colW = 8.2 / keys.length
  let order = 0
  keys.forEach((k, gi) => {
    const members = groups.get(k)!
    const cols = members.length > 4 ? 2 : 1
    members.forEach((r, mi) => {
      const col = mi % cols
      const row = Math.floor(mi / cols)
      const x = -4.1 + colW * (gi + 0.5) + (cols === 2 ? (col - 0.5) * Math.min(0.75, colW * 0.48) : 0) + ((mi * 0.13) % 0.2) - 0.1
      const y = 3.2 - row * 0.62 - (col * 0.25) - ((mi * 0.07) % 0.1)
      pins.push({ roomId: r.id, group: k, order: order++, target: [x, y, Z] })
    })
  })
  return pins
}

export function DevPinFixture() {
  const sort = useStore((s) => s.sort)
  const pins = useMemo(() => layoutFakePins(sort), [sort])
  const photoRefs = useRef<(THREE.Group | null)[]>([])
  const live = useRef(new Map<string, Vec3>())

  useEffect(() => {
    useStore.getState().setBoardPins(pins)
  }, [pins])

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 4)
    FAKE_ROOMS.forEach((r, i) => {
      const pin = pins.find((p) => p.roomId === r.id)
      if (!pin) return
      let p = live.current.get(r.id)
      if (!p) {
        p = [...pin.target] as Vec3
        live.current.set(r.id, p)
      }
      p[0] += (pin.target[0] - p[0]) * k
      p[1] += (pin.target[1] - p[1]) * k
      p[2] = pin.target[2]
      runtime.pinPositions.set(r.id, p)
      const g = photoRefs.current[i]
      if (g) g.position.set(p[0], p[1], p[2])
    })
  })

  return (
    <group>
      <mesh position={[0, 2.05, -7.955]}>
        <planeGeometry args={[8.8, 2.9]} />
        <meshStandardMaterial color="#c69a63" roughness={0.95} />
      </mesh>
      {FAKE_ROOMS.map((r, i) => (
        <group key={r.id} ref={(g) => void (photoRefs.current[i] = g)}>
          <mesh position={[0, -0.2, -0.03]} rotation={[0, 0, ((i % 5) - 2) * 0.04]}>
            <planeGeometry args={[0.34, 0.4]} />
            <meshStandardMaterial color="#f6efe2" roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.18, -0.028]} rotation={[0, 0, ((i % 5) - 2) * 0.04]}>
            <planeGeometry args={[0.28, 0.26]} />
            <meshStandardMaterial color={['#5a8fa8', '#b8735a', '#6f9a63', '#8a6aa0'][i % 4]} roughness={0.9} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshStandardMaterial color="#e0403a" roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
