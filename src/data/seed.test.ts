// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatasetSchema, GENRES, PUZZLE_TYPES } from '@/contracts/types'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const raw: unknown = JSON.parse(readFileSync(path.join(root, 'seed/reviews.json'), 'utf8'))

describe('seed/reviews.json', () => {
  const data = DatasetSchema.parse(raw)

  it('validates against DatasetSchema', () => {
    expect(DatasetSchema.safeParse(raw).success).toBe(true)
    expect(data.source).toBe('seed')
  })

  it('has 12 rooms split between San Francisco and Toronto', () => {
    expect(data.rooms).toHaveLength(12)
    const sf = data.rooms.filter((r) => r.city === 'San Francisco').length
    const to = data.rooms.filter((r) => r.city === 'Toronto').length
    expect(sf + to).toBe(12)
    expect(sf).toBeGreaterThanOrEqual(5)
    expect(to).toBeGreaterThanOrEqual(5)
  })

  it('covers every genre and shares companies between rooms', () => {
    expect(new Set(data.rooms.map((r) => r.genre))).toEqual(new Set(GENRES))
    const counts = new Map<string, number>()
    for (const r of data.rooms) counts.set(r.company, (counts.get(r.company) ?? 0) + 1)
    expect([...counts.values()].filter((n) => n > 1).length).toBeGreaterThanOrEqual(3)
  })

  it('has one review per room with 2-5 puzzles, and every puzzle type appears', () => {
    const ids = new Set(data.rooms.map((r) => r.id))
    expect(ids.size).toBe(12)
    expect(data.reviews).toHaveLength(12)
    for (const rev of data.reviews) {
      expect(ids.has(rev.roomId)).toBe(true)
      expect(rev.puzzles.length).toBeGreaterThanOrEqual(2)
      expect(rev.puzzles.length).toBeLessThanOrEqual(5)
      for (const p of rev.puzzles) expect(p.reviewId).toBe(rev.id)
      expect(rev.date >= '2023-01-01' && rev.date <= '2026-12-31').toBe(true)
    }
    const types = new Set(data.reviews.flatMap((r) => r.puzzles.map((p) => p.type)))
    expect(types).toEqual(new Set(PUZZLE_TYPES))
    const puzzleIds = data.reviews.flatMap((r) => r.puzzles.map((p) => p.id))
    expect(new Set(puzzleIds).size).toBe(puzzleIds.length)
    expect(data.reviews.flatMap((r) => r.puzzles).filter((p) => p.memorable).length).toBeGreaterThanOrEqual(6)
  })

  it('varies every boolean, includes failed escapes, transcripts and dates across years', () => {
    for (const k of ['escaped', 'visibleTimer', 'multiRoom', 'flashlights', 'liveActors'] as const) {
      expect(new Set(data.reviews.map((r) => r[k]))).toEqual(new Set([true, false]))
    }
    expect(data.reviews.filter((r) => !r.escaped).length).toBeGreaterThanOrEqual(2)
    expect(data.reviews.filter((r) => r.voiceTranscript).length).toBeGreaterThanOrEqual(4)
    expect(new Set(data.reviews.map((r) => r.date.slice(0, 4)))).toEqual(new Set(['2023', '2024', '2025', '2026']))
    expect(new Set(data.reviews.map((r) => r.toolsUsed.join())).size).toBeGreaterThan(8)
  })

  it('has a crew of 4-5 and 5-6 wishlist items', () => {
    expect(data.crew.length).toBeGreaterThanOrEqual(4)
    expect(data.crew.length).toBeLessThanOrEqual(5)
    expect(data.wishlist.length).toBeGreaterThanOrEqual(5)
    expect(data.wishlist.length).toBeLessThanOrEqual(6)
    const names = new Set(data.crew.map((c) => c.name))
    for (const r of data.reviews) for (const n of r.crew) expect(names.has(n)).toBe(true)
  })

  it('references 1-2 generated photos per room that exist on disk', () => {
    for (const room of data.rooms) {
      expect(room.photos.length).toBeGreaterThanOrEqual(1)
      expect(room.photos.length).toBeLessThanOrEqual(2)
      room.photos.forEach((p, i) => {
        expect(p.url).toBe(`/seed/photos/${room.id}-${i + 1}.svg`)
        const file = path.join(root, 'public', p.url)
        expect(existsSync(file)).toBe(true)
        const kb = statSync(file).size / 1024
        expect(kb).toBeGreaterThan(1.5)
        // Bare photo: the views draw their own polaroid frame and caption.
        expect(readFileSync(file, 'utf8')).not.toContain('Caveat')
        expect(kb).toBeLessThan(14)
      })
    }
  })
})
