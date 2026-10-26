// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Entry } from '@/contracts/types'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { MAX_OVERLAY_ENTRIES, SeedRepository } from './seedRepository'
import { mergeCrew, normalizeEntry, seedRepositoryFor } from './repository'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'escapes-data-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function newEntry(): Entry {
  const review = structuredClone(FIXTURE_DATASET.reviews[0])
  return {
    room: { ...structuredClone(FIXTURE_DATASET.rooms[0]), id: 'room_new', name: 'The New Room' },
    review: { ...review, id: 'rev_new', roomId: 'wrong', crew: ['Brennan', 'Zoe'], puzzles: review.puzzles.map((p) => ({ ...p, reviewId: 'x' })) },
  }
}

describe('SeedRepository', () => {
  it('serves the seed when there is no overlay', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const d = await repo.getDataset()
    expect(repo.mode).toBe('seed')
    expect(d.source).toBe('seed')
    expect(d.rooms).toHaveLength(12)
    expect(await repo.getWishlist()).toEqual(d.wishlist)
  })

  it('saves an entry to DATA_DIR/store.json and keeps it across instances', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const saved = await repo.saveEntry(newEntry())
    expect(saved.review.roomId).toBe('room_new')
    expect(saved.review.puzzles.every((p) => p.reviewId === 'rev_new')).toBe(true)

    const stored = JSON.parse(await readFile(path.join(dir, 'store.json'), 'utf8'))
    expect(stored.entries).toHaveLength(1)

    const again = await new SeedRepository({ dataDir: dir }).getDataset()
    expect(again.rooms).toHaveLength(13)
    expect(again.rooms.at(-1)?.name).toBe('The New Room')
    expect(again.reviews.find((r) => r.id === 'rev_new')?.crew).toEqual(['Brennan', 'Zoe'])
    expect(again.crew.map((c) => c.name)).toContain('Zoe')
  })

  it('upserts: saving the same review id twice replaces it', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const e = newEntry()
    await repo.saveEntry(e)
    await repo.saveEntry({ ...e, room: { ...e.room, name: 'Renamed' }, review: { ...e.review, escaped: false } })
    const d = await repo.getDataset()
    expect(d.rooms.filter((r) => r.id === 'room_new')).toHaveLength(1)
    expect(d.rooms.find((r) => r.id === 'room_new')?.name).toBe('Renamed')
    expect(d.reviews.find((r) => r.id === 'rev_new')?.escaped).toBe(false)
  })

  it('never stores a voice transcript in the shared overlay (privacy: only you see it)', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const e = newEntry()
    const saved = await repo.saveEntry({ ...e, review: { ...e.review, voiceTranscript: 'my private voice note' } })
    // The caller still gets its own transcript back.
    expect(saved.review.voiceTranscript).toBe('my private voice note')
    const raw = await readFile(path.join(dir, 'store.json'), 'utf8')
    expect(raw).not.toContain('my private voice note')
    const other = await new SeedRepository({ dataDir: dir }).getDataset()
    expect(other.reviews.find((r) => r.id === 'rev_new')?.voiceTranscript).toBe('')
  })

  it('keeps only the newest entries in the overlay', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const e = newEntry()
    for (let i = 0; i < MAX_OVERLAY_ENTRIES + 5; i++) {
      await repo.saveEntry({ room: { ...e.room, id: `room_m${i}` }, review: { ...e.review, id: `rev_m${i}` } })
    }
    const stored = JSON.parse(await readFile(path.join(dir, 'store.json'), 'utf8'))
    expect(stored.entries).toHaveLength(MAX_OVERLAY_ENTRIES)
    expect(stored.entries[0].review.id).toBe('rev_m5')
  })

  it('serializes concurrent saves', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const e = newEntry()
        return repo.saveEntry({ room: { ...e.room, id: `room_c${i}` }, review: { ...e.review, id: `rev_c${i}` } })
      }),
    )
    expect((await repo.getDataset()).rooms).toHaveLength(17)
  })

  it('replaces the wishlist', async () => {
    const repo = new SeedRepository({ dataDir: dir })
    const items = [{ id: 'w_x', name: 'Moon Base', city: 'Toronto', link: '', addedBy: 'Maya', priority: 1, done: false }]
    expect(await repo.putWishlist(items)).toEqual(items)
    expect(await new SeedRepository({ dataDir: dir }).getWishlist()).toEqual(items)
    expect(await repo.putWishlist([])).toEqual([])
    expect(await repo.getWishlist()).toEqual([])
  })
})

describe('repository helpers', () => {
  it('seedRepositoryFor shares one seed repository per DATA_DIR', async () => {
    const a = await seedRepositoryFor(dir)
    expect(a.mode).toBe('seed')
    expect(await seedRepositoryFor(dir)).toBe(a)
  })

  it('normalizeEntry links review to room and puzzles to review', () => {
    const ok = normalizeEntry(newEntry())
    expect(ok.review.roomId).toBe(ok.room.id)
    expect(ok.review.puzzles.every((p) => p.reviewId === ok.review.id)).toBe(true)
  })

  it('mergeCrew adds unknown names once, case-insensitively', () => {
    const crew = mergeCrew([{ id: 'c1', name: 'Maya' }], [{ ...FIXTURE_DATASET.reviews[0], crew: ['maya', 'Zoe', 'zoe ', ''] }])
    expect(crew.map((c) => c.name)).toEqual(['Maya', 'Zoe'])
  })
})
