// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ApiErrorSchema } from '../../src/contracts/errors'
import { ReportSchema } from '../../src/contracts/models'
import { adminEmails, isAdminEmail } from '../context'
import { games, reports, reviews, venues, visitPhotos } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true, env: { ADMIN_EMAILS: ' Carol@Example.com , nobody@example.com' } })
})
afterAll(async () => {
  await t?.close()
})

const U = () => t.fx.users
const R = () => t.fx.reviews
const report = (as: string | undefined, payload: Record<string, unknown>) => t.inject({ method: 'POST', url: '/api/reports', as, payload })
const queue = (as: string, status?: string) => t.inject({ method: 'GET', url: `/api/admin/reports${status ? `?status=${status}` : ''}`, as })
const hide = (as: string, payload: Record<string, unknown>) => t.inject({ method: 'POST', url: '/api/admin/hide', as, payload })
const resolve = (as: string, id: string, action: 'hide' | 'dismiss') => t.inject({ method: 'POST', url: `/api/admin/reports/${id}/resolve`, as, payload: { action } })

describe('admin emails', () => {
  it('parses ADMIN_EMAILS case-insensitively, ignoring junk', () => {
    expect([...adminEmails({ ADMIN_EMAILS: 'A@x.com, b@Y.org;c@z.io  not-an-email' })]).toEqual(['a@x.com', 'b@y.org', 'c@z.io'])
    expect(adminEmails({}).size).toBe(0)
    expect(isAdminEmail('B@y.org', { ADMIN_EMAILS: 'b@y.org' })).toBe(true)
    expect(isAdminEmail('', { ADMIN_EMAILS: 'b@y.org' })).toBe(false)
    expect(isAdminEmail('b@y.org', {})).toBe(false)
  })

  it('a user whose email is in ADMIN_EMAILS is an admin; others are not', async () => {
    expect((await queue(U().carol)).statusCode).toBe(200)
    expect((await queue(U().admin)).statusCode).toBe(200) // users.is_admin still counts
    const bob = await queue(U().bob)
    expect(bob.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(bob.json()).code).toBe('forbidden')
  })
})

describe('reports', () => {
  it('anyone signed in can report a public review; a repeat returns the same open report', async () => {
    const res = await report(U().bob, { targetType: 'review', targetId: R().carol, reason: 'spam', note: 'Looks like an ad' })
    expect(res.statusCode).toBe(201)
    const { id } = res.json() as { id: string }
    const again = await report(U().bob, { targetType: 'review', targetId: R().carol, reason: 'offensive' })
    expect(again.statusCode).toBe(201)
    expect(again.json()).toEqual({ id })
    const row = (await t.db.select().from(reports).where(eq(reports.id, id)))[0]
    expect(row).toMatchObject({ reporterId: U().bob, targetType: 'review', targetId: R().carol, reason: 'spam', note: 'Looks like an ad', status: 'open' })
  })

  it('cannot report what you cannot see (private, or friends-only from a stranger): 404', async () => {
    expect((await report(U().carol, { targetType: 'review', targetId: R().aliceSolo, reason: 'spam' })).statusCode).toBe(404)
    expect((await report(U().carol, { targetType: 'review', targetId: R().bobTogether, reason: 'spam' })).statusCode).toBe(404)
    // alice is bob's friend, so she can see (and report) his friends-only review.
    expect((await report(U().alice, { targetType: 'review', targetId: R().bobTogether, reason: 'spoilers' })).statusCode).toBe(201)
    expect((await report(U().carol, { targetType: 'review', targetId: 'rev_nope', reason: 'spam' })).statusCode).toBe(404)
  })

  it('photos, games and venues can be reported', async () => {
    expect((await report(U().carol, { targetType: 'photo', targetId: t.fx.photos.bobTogether, reason: 'privacy' })).statusCode).toBe(201)
    expect((await report(U().carol, { targetType: 'game', targetId: t.fx.games.vault, reason: 'wrong_info' })).statusCode).toBe(201)
    expect((await report(U().carol, { targetType: 'venue', targetId: t.fx.venues.maple, reason: 'wrong_info' })).statusCode).toBe(201)
    expect((await report(U().carol, { targetType: 'venue', targetId: 'ven_nope', reason: 'wrong_info' })).statusCode).toBe(404)
  })

  it('validates the body and needs a signed-in user', async () => {
    expect((await report(U().carol, { targetType: 'user', targetId: U().alice, reason: 'spam' })).statusCode).toBe(400)
    expect((await report(U().carol, { targetType: 'review', targetId: R().carol, reason: 'because' })).statusCode).toBe(400)
    expect((await report(U().carol, { targetType: 'review', targetId: R().carol, reason: 'other', note: 'x'.repeat(1001) })).statusCode).toBe(400)
    expect((await report(undefined, { targetType: 'review', targetId: R().carol, reason: 'spam' })).statusCode).toBe(401)
  })
})

describe('admin queue and resolve', () => {
  it('lists open reports newest first with the reporter as a public user (no email)', async () => {
    const res = await queue(U().admin)
    expect(res.statusCode).toBe(200)
    const list = (res.json() as { reports: unknown[] }).reports.map((r) => ReportSchema.parse(r))
    expect(list.every((r) => r.status === 'open')).toBe(true)
    const fixture = list.find((r) => r.id === t.fx.reports.open)!
    expect(fixture.reporter).toEqual({ id: U().carol, handle: 'carol', displayName: 'Carol', image: null })
    expect(res.body).not.toContain('@example.com')
    const times = list.map((r) => r.createdAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('hide: hides the target and closes every open report on it', async () => {
    const second = (await report(U().bob, { targetType: 'review', targetId: R().aliceGuest, reason: 'offensive' })).json() as { id: string }
    const res = await resolve(U().admin, t.fx.reports.open, 'hide')
    expect(res.statusCode).toBe(200)
    expect(ReportSchema.parse(res.json())).toMatchObject({ id: t.fx.reports.open, status: 'hidden' })
    expect(ReportSchema.parse(res.json()).resolvedAt).not.toBeNull()
    const rv = (await t.db.select().from(reviews).where(eq(reviews.id, R().aliceGuest)))[0]
    expect(rv.hiddenAt).not.toBeNull()
    expect(rv.hiddenReason).toBe('report:spam')
    const other = (await t.db.select().from(reports).where(eq(reports.id, second.id)))[0]
    expect(other).toMatchObject({ status: 'hidden', resolvedBy: U().admin })

    const hiddenList = (await queue(U().admin, 'hidden')).json() as { reports: { id: string }[] }
    expect(hiddenList.reports.map((r) => r.id)).toEqual(expect.arrayContaining([t.fx.reports.open, second.id]))
  })

  it('dismiss: closes only that report and leaves the target alone', async () => {
    const { id } = (await report(U().bob, { targetType: 'game', targetId: t.fx.games.lighthouse, reason: 'wrong_info' })).json() as { id: string }
    const res = await resolve(U().admin, id, 'dismiss')
    expect(ReportSchema.parse(res.json()).status).toBe('dismissed')
    const g = (await t.db.select().from(games).where(eq(games.id, t.fx.games.lighthouse)))[0]
    expect(g.status).toBe('active')
  })

  it('unknown reports are 404, bad actions 400, non-admins 403', async () => {
    expect((await resolve(U().admin, 'rpt_nope', 'hide')).statusCode).toBe(404)
    expect((await t.inject({ method: 'POST', url: `/api/admin/reports/${t.fx.reports.open}/resolve`, as: U().admin, payload: { action: 'delete' } })).statusCode).toBe(400)
    expect((await resolve(U().bob, t.fx.reports.open, 'dismiss')).statusCode).toBe(403)
  })
})

describe('admin hide', () => {
  it('hides and unhides a photo (public access follows)', async () => {
    const id = t.fx.photos.bobTogether
    expect((await t.inject({ method: 'GET', url: `/api/photos/${id}` })).statusCode).toBe(200)
    expect((await hide(U().admin, { targetType: 'photo', targetId: id, hidden: true })).json()).toEqual({ ok: true })
    expect((await t.inject({ method: 'GET', url: `/api/photos/${id}` })).statusCode).toBe(404)
    expect((await t.inject({ method: 'GET', url: `/api/photos/${id}`, as: U().bob })).statusCode).toBe(200)
    await hide(U().admin, { targetType: 'photo', targetId: id, hidden: false })
    expect((await t.inject({ method: 'GET', url: `/api/photos/${id}` })).statusCode).toBe(200)
  })

  it('hides a review with reason admin and closes its open reports', async () => {
    const { id } = (await report(U().bob, { targetType: 'review', targetId: R().carol, reason: 'spam' })).json() as { id: string }
    await hide(U().admin, { targetType: 'review', targetId: R().carol, hidden: true })
    const rv = (await t.db.select().from(reviews).where(eq(reviews.id, R().carol)))[0]
    expect(rv).toMatchObject({ hiddenReason: 'admin' })
    expect(rv.hiddenAt).not.toBeNull()
    expect((await t.db.select().from(reports).where(eq(reports.id, id)))[0].status).toBe('hidden')
    // A hidden review can no longer be reported by others.
    expect((await report(U().alice, { targetType: 'review', targetId: R().carol, reason: 'spam' })).statusCode).toBe(404)
    await hide(U().admin, { targetType: 'review', targetId: R().carol, hidden: false })
    const back = (await t.db.select().from(reviews).where(eq(reviews.id, R().carol)))[0]
    expect(back.hiddenAt).toBeNull()
    expect(back.hiddenReason).toBeNull()
  })

  it('hides games and venues; unhiding restores active but never reopens a closed venue', async () => {
    await hide(U().admin, { targetType: 'game', targetId: t.fx.games.vault, hidden: true })
    expect((await t.db.select().from(games).where(eq(games.id, t.fx.games.vault)))[0].status).toBe('hidden')
    await hide(U().admin, { targetType: 'game', targetId: t.fx.games.vault, hidden: false })
    expect((await t.db.select().from(games).where(eq(games.id, t.fx.games.vault)))[0].status).toBe('active')

    await t.db.update(venues).set({ status: 'closed' }).where(eq(venues.id, t.fx.venues.maple))
    await hide(U().admin, { targetType: 'venue', targetId: t.fx.venues.maple, hidden: false })
    expect((await t.db.select().from(venues).where(eq(venues.id, t.fx.venues.maple)))[0].status).toBe('closed')
    await hide(U().admin, { targetType: 'venue', targetId: t.fx.venues.maple, hidden: true })
    expect((await t.db.select().from(venues).where(eq(venues.id, t.fx.venues.maple)))[0].status).toBe('hidden')
    await t.db.update(venues).set({ status: 'active' }).where(eq(venues.id, t.fx.venues.maple))
  })

  it('unknown targets are 404; non-admins 403; signed out 401', async () => {
    expect((await hide(U().admin, { targetType: 'photo', targetId: 'pho_nope', hidden: true })).statusCode).toBe(404)
    expect((await hide(U().alice, { targetType: 'photo', targetId: t.fx.photos.bobTogether, hidden: true })).statusCode).toBe(403)
    expect((await t.inject({ method: 'POST', url: '/api/admin/hide', payload: { targetType: 'photo', targetId: 'x', hidden: true } })).statusCode).toBe(401)
    const photo = (await t.db.select().from(visitPhotos).where(eq(visitPhotos.id, t.fx.photos.bobTogether)))[0]
    expect(photo.hiddenAt).toBeNull()
  })
})
