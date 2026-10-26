// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { FX, loadFixtures } from '../db/fixtures'
import { reviews, users } from '../db/schema'
import { createTestDb, type TestDb } from '../db/testing'
import { HttpError } from '../http'
import { assertCanPublish, authorIsPublic, checkHandle, handleBase, isOnboarded, suggestFreeHandle, updateProfile } from './users'

let tdb: TestDb
beforeAll(async () => {
  tdb = await createTestDb()
  await loadFixtures(tdb.db)
})
afterAll(async () => {
  await tdb?.close()
})

describe('handles', () => {
  it('handleBase makes a valid base from names or emails', () => {
    expect(handleBase('Brennan Lup')).toBe('brennanlup')
    expect(handleBase('', 'mia.w@example.com')).toBe('miaw')
    expect(handleBase('7')).toBe('escaper')
    expect(handleBase('Al', 'al@example.com')).toBe('escaperal')
  })

  it('suggestFreeHandle skips taken and reserved handles', async () => {
    expect(await suggestFreeHandle(tdb.db, 'Alice')).toBe('alice2')
    expect(await suggestFreeHandle(tdb.db, 'Alice', '', FX.users.alice)).toBe('alice')
    expect(await suggestFreeHandle(tdb.db, 'Admin')).toBe('admin2')
  })

  it('checkHandle is case-insensitive', async () => {
    expect(await checkHandle(tdb.db, 'BOB')).toEqual({ handle: 'bob', available: false, reason: 'taken' })
  })

  it('two users racing for one handle: the second gets handle_taken', async () => {
    await tdb.db.insert(users).values([
      { id: 'usr_r1', name: 'R1', email: 'r1@example.com' },
      { id: 'usr_r2', name: 'R2', email: 'r2@example.com' },
    ])
    const results = await Promise.allSettled([updateProfile(tdb.db, 'usr_r1', { handle: 'racer' }), updateProfile(tdb.db, 'usr_r2', { handle: 'racer' })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(HttpError)
    expect((rejected.reason as HttpError).code).toBe('handle_taken')
  })
})

describe('publishing rules', () => {
  it('a public review needs onboarding', () => {
    expect(() => assertCanPublish({ onboarded: false }, 'public')).toThrow(/display name/)
    expect(() => assertCanPublish({ onboarded: false }, 'private')).not.toThrow()
    expect(() => assertCanPublish({ onboarded: true }, 'public')).not.toThrow()
    expect(isOnboarded({ handle: 'a', displayName: null })).toBe(false)
  })

  it('authorIsPublic filters out reviews by users without a public name', async () => {
    await tdb.db.update(users).set({ handle: null }).where(eq(users.id, FX.users.carol))
    const rows = await tdb.db.select({ id: reviews.id }).from(reviews).innerJoin(users, eq(users.id, reviews.authorId)).where(authorIsPublic())
    expect(rows.map((r) => r.id)).not.toContain(FX.reviews.carol)
    expect(rows.map((r) => r.id)).toContain(FX.reviews.aliceTogether)
  })
})
